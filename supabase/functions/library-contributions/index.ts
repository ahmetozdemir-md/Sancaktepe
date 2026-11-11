import { createClient } from 'npm:@supabase/supabase-js@2.105.1'
import { Buffer } from 'node:buffer'
import { normalizeContribution } from '../../../src/library/contributionContent.ts'
import { libraryRow } from '../../../src/library/model.ts'
import { sanitizeContributionImage } from './images.mjs'

const origins = (Deno.env.get('LIBRARY_CONTRIBUTION_ORIGINS') ?? 'https://sancaktepe-kappa.vercel.app').split(',').map(value=>value.trim())
const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? Deno.env.get('SUPABASE_SECRET_KEY')
const url = Deno.env.get('SUPABASE_URL')
if (!serviceKey || !url) throw new Error('Missing server configuration')
const admin = createClient(url,serviceKey,{auth:{autoRefreshToken:false,persistSession:false}})
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const sha = async (value: string | Uint8Array) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', typeof value==='string' ? new TextEncoder().encode(value) : new Uint8Array(value)))).map(x=>x.toString(16).padStart(2,'0')).join('')
const headers = (origin:string) => ({'Access-Control-Allow-Origin':origin,'Access-Control-Allow-Headers':'authorization,x-client-info,apikey,content-type','Access-Control-Allow-Methods':'POST,OPTIONS','Vary':'Origin','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Content-Type':'application/json; charset=utf-8'})
const reply = (origin:string,body:unknown,status=200) => new Response(JSON.stringify(body),{status,headers:headers(origin)})
async function rpc(name:string,args:Record<string,unknown>) {
  const {data,error}=await admin.rpc(name,args)
  if(error) throw new Error('server-unavailable')
  return data
}
async function limited(key:string,limit:number,seconds:number) {
  if(!await rpc('library_take_limit',{p_key:key,p_limit:limit,p_seconds:seconds})) throw new Error('rate-limited')
}
async function readBody(request:Request):Promise<Record<string,unknown>> {
  if(!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) throw new Error('invalid-content')
  const reader=request.body?.getReader(); if(!reader) throw new Error('invalid-content')
  const chunks:Uint8Array[]=[]; let size=0
  for(;;) { const {done,value}=await reader.read(); if(done)break; size+=value.byteLength; if(size>6000000){await reader.cancel();throw new Error('request-too-large')} chunks.push(value) }
  const buffer=new Uint8Array(size); let offset=0; for(const chunk of chunks){buffer.set(chunk,offset);offset+=chunk.byteLength}
  const data=JSON.parse(new TextDecoder().decode(buffer)); if(!data || typeof data!=='object' || Array.isArray(data)) throw new Error('invalid-content')
  return data
}
async function cleanupAbandoned() {
  const {data:jobs,error}=await admin.from('library_contribution_jobs').select('id').eq('state','open').lt('expires_at',new Date(Date.now()-86400000).toISOString()).limit(10)
  if(error || !jobs?.length)return
  for(const job of jobs) {
    const {data:assets,error:readError}=await admin.from('library_contribution_assets').select('path').eq('job_id',job.id)
    if(readError)continue
    if(assets?.length){const {error:removeError}=await admin.storage.from('portal-library').remove(assets.map(a=>a.path));if(removeError)continue}
    await admin.from('library_contribution_jobs').delete().eq('id',job.id).eq('state','open')
  }
}
Deno.serve(async request=>{
  const origin=request.headers.get('origin') ?? ''
  if(!origins.includes(origin)) return new Response('Forbidden',{status:403})
  if(request.method==='OPTIONS')return new Response(null,{status:204,headers:headers(origin)})
  if(request.method!=='POST')return reply(origin,{error:'method-not-allowed'},405)
  try {
    // IP is only an additional limit. Parent-device and global counters cannot be reset by changing IP headers.
    const ipHash=await sha(serviceKey+':'+(request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown'))
    await limited('request-global',600,60);await limited('request-ip:'+ipHash,60,60)
    const body=await readBody(request)
    if(body.action==='login') {
      if(typeof body.password!=='string'||body.password.length>128||typeof body.parentToken!=='string'||typeof body.author!=='string')throw new Error('invalid-content')
      const result=await rpc('library_contributor_login',{p_parent_token:body.parentToken,p_password:body.password,p_author:body.author,p_ip_hash:ipHash})
      return reply(origin,result,result?.error ? 403 : 200)
    }
    const token=typeof body.token==='string' ? body.token : ''
    const context=await rpc('library_contributor_context',{p_token:token})
    if(!context) return reply(origin,{error:'session-expired'},401)
    if(body.action==='validate')return reply(origin,{expiresAt:context.expiresAt})
    if(body.action==='logout') { const {error}=await admin.from('library_contributor_sessions').delete().eq('token_hash',await sha(token));if(error)throw new Error('server-unavailable');return reply(origin,{ok:true}) }
    if(typeof body.id!=='string'||!uuid.test(body.id))throw new Error('invalid-content')
    if(body.action==='begin') {
      const result=await rpc('library_begin_submission',{p_token:token,p_id:body.id,p_ip_hash:ipHash})
      if(!result?.error)await cleanupAbandoned()
      return reply(origin,result,result?.error ? 429 : 200)
    }
    if(body.action==='upload') {
      if(typeof body.blockId!=='string'||!uuid.test(body.blockId)||typeof body.base64!=='string'||body.base64.length>5592410||!/^[A-Za-z0-9+/]+={0,2}$/.test(body.base64))throw new Error('invalid-file')
      await limited('decode-global',100,3600);await limited('decode-parent:'+context.parentHash,24,3600)
      const image=sanitizeContributionImage(Buffer.from(body.base64,'base64'))
      const reserved=await rpc('library_reserve_asset',{p_token:token,p_job:body.id,p_block:body.blockId,p_bytes:image.length,p_checksum:await sha(image)})
      if(reserved?.error)return reply(origin,reserved,400)
      if(!reserved.ready){
        const {error}=await admin.storage.from('portal-library').upload(reserved.path,image,{contentType:'image/png',upsert:false})
        if(error){const {data:existing,error:readError}=await admin.storage.from('portal-library').download(reserved.path);if(readError||!existing||await sha(new Uint8Array(await existing.arrayBuffer()))!==await sha(image))throw new Error('upload-retry')}
        const {error:markError}=await admin.from('library_contribution_assets').update({ready:true}).eq('job_id',body.id).eq('block_id',body.blockId).eq('path',reserved.path)
        if(markError)throw new Error('upload-retry')
      }
      return reply(origin,{path:reserved.path})
    }
    if(body.action==='submit') {
      const entry=normalizeContribution(body.entry)
      if(entry.id!==body.id)throw new Error('invalid-content')
      const result=await rpc('library_commit_submission',{p_token:token,p_job:body.id,p_entry:libraryRow(entry)})
      return reply(origin,result,result?.error ? 400 : 200)
    }
    throw new Error('invalid-action')
  } catch(error) {
    const allowed=['invalid-content','invalid-file','file-limit','rate-limited','request-too-large','upload-retry','invalid-action','server-unavailable']
    const code=error instanceof Error && allowed.includes(error.message) ? error.message : 'invalid-content'
    return reply(origin,{error:code},code==='server-unavailable'?503:code==='rate-limited'?429:400)
  }
})

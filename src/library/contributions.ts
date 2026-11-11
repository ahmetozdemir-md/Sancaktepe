import { supabase } from '../supabase'
import { normalizeContribution } from './contributionContent'
import type { LibraryEntry } from './model'

export interface ContributorSession { token:string; expiresAt:string }
export interface ContributorIdentity { parentToken:string; author:string }
const messages:Record<string,string>={
 'rate-limited':'Çok fazla deneme yapıldı. Bir süre sonra yeniden dene.',
 'assistant-login-required':'Önce Asistan Hekim girişinden yeniden giriş yap.',
 'session-expired':'Rehber gönderme oturumun sona erdi. Tekrar giriş yap; yazdığın içerik korunuyor.',
 'invalid-password':'Şifre doğru değil. Tekrar dene.',
 'not-configured':'Rehber gönderme henüz etkinleştirilmemiş.',
 'submission-limit':'Gönderim kotasına ulaşıldı. Cihaz başına saatte 3, günde 10 gönderim yapılabilir. Daha sonra yeniden dene.',
 'queue-full':'İncelenmeyi bekleyen gönderi sınırına ulaşıldı. Daha sonra yeniden dene.',
 'invalid-content':'Gönderilen içerik geçersiz veya çok büyük. Metin ve tablo alanlarını kontrol et.',
 'invalid-file':'Dosya güvenlik kontrolünden geçemedi. Yeniden yükle veya başka bir görsel seç.',
 'file-limit':'Dosya sınırına ulaşıldı. Gönderi başına en fazla 8 görsel ve toplam 16 MB kullanılabilir.',
 'upload-retry':'Dosya yüklemesi tamamlanamadı. Gönder düğmesine tekrar basabilirsin.',
 'submission-expired':'Gönderim süresi doldu. Yeni bir gönderi açıp içeriğini aktar.',
 'forbidden':'Bu gönderi için yetkin bulunmuyor.',
 'request-too-large':'Dosya çok büyük. Daha küçük bir görsel kullan.',
 'server-unavailable':'Gönderi kaydedilemedi. Bağlantını kontrol edip yeniden dene.',
}
export class ContributionAccessError extends Error {}
async function request(body:Record<string,unknown>):Promise<Record<string,unknown>> {
  if(!supabase)throw new Error('Rehber gönderme için çevrimiçi bağlantı gerekli.')
  const {data,error}=await supabase.functions.invoke('library-contributions',{body})
  let response=data
  if(error && error.context instanceof Response){try{response=await error.context.json()}catch{ /* Generic connection error below. */ }}
  if(response?.error){const message=messages[response.error] ?? messages['server-unavailable'];if(response.error==='session-expired')throw new ContributionAccessError(message);throw new Error(message)}
  if(error || !response || typeof response!=='object')throw new Error(messages['server-unavailable'])
  return response
}
export async function loginContributor(identity:ContributorIdentity,password:string):Promise<ContributorSession>{
 const result=await request({action:'login',parentToken:identity.parentToken,author:identity.author,password})
 if(typeof result.token!=='string'||!/^[0-9a-f]{64}$/.test(result.token)||typeof result.expiresAt!=='string')throw new Error(messages['server-unavailable'])
 return {token:result.token,expiresAt:result.expiresAt}
}
export async function logoutContributor(token:string){await request({action:'logout',token})}
export async function submitContribution(token:string,entry:LibraryEntry,files:Map<string,File>):Promise<void>{
 const started=await request({action:'begin',token,id:entry.id})
 if(started.submitted)return
 const blocks=[]
 for(const block of entry.blocks){
  const file=files.get(block.id)
  if(block.type==='image' && file){
   const bytes=new Uint8Array(await file.arrayBuffer());let binary='';for(let offset=0;offset<bytes.length;offset+=32768)binary+=String.fromCharCode(...bytes.subarray(offset,offset+32768))
   const result=await request({action:'upload',token,id:entry.id,blockId:block.id,base64:btoa(binary)})
   if(typeof result.path!=='string')throw new Error(messages['server-unavailable'])
   blocks.push({...block,path:result.path})
  } else blocks.push(block)
 }
 const payload=normalizeContribution({...entry,blocks})
 await request({action:'submit',token,id:entry.id,entry:payload})
}
export async function changeContributorPassword(password:string):Promise<void>{
 if(!supabase)throw new Error('Şifreyi değiştirmek için çevrimiçi yönetici oturumu gerekli.')
 const {error}=await supabase.rpc('change_library_contributor_password',{p_new_password:password})
 if(error)throw new Error('Şifre değiştirilemedi. Yetkili admin oturumunu ve bağlantını kontrol et.')
}

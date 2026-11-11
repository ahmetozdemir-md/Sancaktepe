import assert from 'node:assert/strict'
import { test } from 'node:test'
import { PNG } from 'pngjs'
import { normalizeContribution } from '../src/library/contributionContent.ts'
import { newLibraryEntry, libraryRow, filterLibrary } from '../src/library/model.ts'
import { sanitizeContributionImage } from '../supabase/functions/library-contributions/images.mjs'
const id = () => crypto.randomUUID()
const entry = () => ({...newLibraryEntry(),title:'Test rehber',blocks:[{id:id(),type:'text',text:'Test metni'}]})
const view = (entries, options={}) => filterLibrary(entries,{query:'',category:'all',...options})

test('contributor content cannot set approval, archive, attribution or publication flags',()=>{
 const result=normalizeContribution({...entry(),published:true,pinned:true,reviewStatus:'approved',archivedAt:'2026-01-01',submittedBy:'Admin',submittedAt:'2026-01-01',category:'Override',kind:'announcement'})
 assert.equal(result.published,false);assert.equal(result.pinned,false);assert.equal(result.reviewStatus,'pending');assert.equal(result.archivedAt,null);assert.equal(result.submittedBy,undefined);assert.equal(result.kind,'reference')
 assert.equal(libraryRow(result).review_status,'pending')
 assert.equal(libraryRow({...result,published:true}).review_status,'approved')
})
test('pending and rejected entries never leak to readers, even with forged published flag',()=>{
 const approved={...entry(),published:true}, pending={...entry(),reviewStatus:'pending',published:true}, rejected={...entry(),reviewStatus:'rejected',published:true,archivedAt:'2026-01-01'}
 assert.deepEqual(view([approved,pending,rejected]),[approved])
 assert.deepEqual(view([approved,pending,rejected],{admin:true,status:'all'}),[approved])
 assert.deepEqual(view([approved,pending,rejected],{admin:true,status:'pending'}),[pending])
 assert.deepEqual(view([approved,pending,rejected],{admin:true,status:'archived'}),[rejected])
})
test('contributor rejects unsupported files, forged paths, duplicate identities and oversized content',()=>{
 for(const mutate of [
  e=>({...e,id:'bad'}), e=>({...e,title:'x'.repeat(121)}), e=>({...e,sourceUrl:'javascript:alert(1)'}),
  e=>({...e,blocks:[{id:id(),type:'pdf',path:`${e.id}/${id()}.pdf`}]}),
  e=>({...e,blocks:[{id:id(),type:'image',path:`${id()}/${id()}.png`}]}),
  e=>({...e,blocks:[...e.blocks,...e.blocks]}),e=>({...e,blocks:[{id:id(),type:'text',text:'x'.repeat(20001)}]}),
  e=>({...e,blocks:Array.from({length:21},()=>({id:id(),type:'text',text:'X'}))}),
  e=>({...e,blocks:Array.from({length:9},()=>({id:id(),type:'image',path:`${e.id}/${id()}.png`}))}),
  e=>({...e,extra:'x'.repeat(262144)}), e=>({...e,blocks:[{id:id(),type:'section',title:'Boş konu'}]})
 ])assert.throws(()=>normalizeContribution(mutate(entry())))
})
test('text and table formatting are allowlisted; attacker HTML and style objects are not passed through',()=>{
 const e=entry();e.blocks=[{id:id(),type:'text',text:'<script>test</script>',html:'<img onerror=alert(1)>',richText:{type:'doc',content:[{type:'html',attrs:{html:'<script>test</script>'}}]}},{id:id(),type:'table',caption:'',headers:['A'],rows:[['X']],headerColor:'url(javascript:alert(1))',rowColors:['#FFEEAA'],style:{backgroundImage:'url(https://attacker.example)'}}]
 const result=normalizeContribution(e)
 assert.equal(result.blocks[0].text,'<script>test</script>');assert.equal(result.blocks[0].html,undefined);assert.equal(result.blocks[0].richText,undefined)
 assert.equal(result.blocks[1].headerColor,undefined);assert.deepEqual(result.blocks[1].rowColors,['#ffeeaa']);assert.equal(result.blocks[1].style,undefined)
 for(const block of [{...e.blocks[1],headers:Array(13).fill('X')},{...e.blocks[1],rows:[['X','Y']]},{...e.blocks[1],rows:Array(101).fill(['X'])}])assert.throws(()=>normalizeContribution({...e,blocks:[block]}))
})
const png=()=>PNG.sync.write({width:2,height:2,data:Buffer.from([255,0,0,255,0,255,0,255,0,0,255,255,255,255,255,255])})
test('image normalization preserves pixels and strips trailing payloads',()=>{
 const original=png(),bytes=Buffer.concat([original,Buffer.from('<script>malicious payload</script>')])
 const normalized=sanitizeContributionImage(bytes)
 assert.deepEqual(PNG.sync.read(normalized).data,PNG.sync.read(original).data)
 assert.equal(normalized.includes(Buffer.from('malicious payload')),false)
 assert.equal(normalized.subarray(-8,-4).toString(),'IEND')
})
test('decoder rejects SVG, corrupted CRC, truncated chunks, duplicate headers and excessive dimensions',()=>{
 const invalidCrc=png();invalidCrc[29]^=1
 const huge=png();huge.writeUInt32BE(50000,16)
 const interlaced=png();interlaced[28]=1
 const duplicate=Buffer.concat([png().subarray(0,33),png().subarray(8)])
 const hugeChunk=png();hugeChunk.writeUInt32BE(0x7fffffff,33)
 for(const bytes of [Buffer.from('<svg onload="alert(1)"></svg>'),invalidCrc,huge,interlaced,duplicate,hugeChunk,png().subarray(0,45)])assert.throws(()=>sanitizeContributionImage(bytes),/invalid-file/)
})

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { PNG } from 'pngjs'
import { MAX_ASSET_BYTES, libraryExternalUrl, libraryRow, newLibraryEntry, parseLibraryRow, safeExternalUrl, validateLibraryEntry } from '../src/library/model.ts'
import { validateAsset } from '../src/library/assetValidation.ts'
import { normalizeContribution } from '../src/library/contributionContent.ts'
import { sanitizeContributionImage, MAX_IMAGE_BYTES } from '../supabase/functions/library-contributions/images.mjs'
const link=()=>({...newLibraryEntry(),title:'Kurum rehberi',entryType:'link',externalUrl:'https://drive.google.com/file/d/example/view?usp=sharing',blocks:[]})

test('direct links persist independently of ordinary source citations and legacy entries',()=>{
 const entry=link(),row=libraryRow(entry),parsed=parseLibraryRow(row)
 assert.equal(row.entry_type,'link');assert.equal(row.external_url,entry.externalUrl)
 assert.equal(parsed.entryType,'link');assert.equal(libraryExternalUrl(parsed),entry.externalUrl);assert.deepEqual(validateLibraryEntry(parsed),[])
 const legacy=parseLibraryRow({id:crypto.randomUUID(),title:'Eski rehber',source_url:entry.externalUrl,blocks:[]})
 assert.equal(legacy.entryType,'content');assert.equal(libraryExternalUrl(legacy),null)
 assert.ok(validateLibraryEntry({...entry,entryType:'content'}).length)
})
test('direct navigation rejects unsafe protocols, embedded credentials, whitespace and excessive URLs',()=>{
 for(const url of ['javascript:alert(1)','data:text/html,hi','file:///tmp/a','ftp://example.org','//example.org','https://user:secret@example.org','https://user%40name@example.org','https://example.org/\npath','https://example.org/a b','https://example.org/'+'a'.repeat(2000),'https://','']){
  assert.equal(safeExternalUrl(url),null,url)
  assert.ok(validateLibraryEntry({...link(),externalUrl:url}).length,url)
 }
 assert.equal(safeExternalUrl(' https://drive.google.com/file/d/example/view?usp=sharing '),link().externalUrl)
 assert.equal(safeExternalUrl('https://example.org/path?q=a%20b#section'),'https://example.org/path?q=a%20b#section')
 assert.equal(safeExternalUrl('http://example.org/reference'),'http://example.org/reference')
 assert.equal(libraryExternalUrl(parseLibraryRow({...libraryRow(link()),external_url:'javascript:alert(1)'})),null)
})
test('contributed links remain pending and cannot combine files with a redirect',()=>{
 const sent=normalizeContribution({...link(),published:true,reviewStatus:'approved',pinned:true})
 assert.equal(sent.entryType,'link');assert.equal(sent.externalUrl,link().externalUrl);assert.equal(sent.reviewStatus,'pending');assert.equal(sent.published,false);assert.equal(sent.pinned,false);assert.deepEqual(sent.blocks,[])
 for(const invalid of [{...link(),entryType:'script'},{...link(),externalUrl:'javascript:alert(1)'},{...link(),blocks:[{id:crypto.randomUUID(),type:'text',text:'Hidden content'}]}])assert.throws(()=>normalizeContribution(invalid))
})
test('file intake accepts exactly 1 MiB and rejects one extra byte before conversion',async()=>{
 assert.equal(MAX_ASSET_BYTES,1048576);assert.equal(MAX_IMAGE_BYTES,MAX_ASSET_BYTES)
 const bytes=new Uint8Array(MAX_ASSET_BYTES);bytes.set([137,80,78,71,13,10,26,10])
 await validateAsset(new File([bytes],'boundary.png',{type:'image/png'}))
 await assert.rejects(validateAsset(new File([bytes,new Uint8Array([0])],'oversized.png',{type:'image/png'})),/1 MB/)
 await assert.rejects(validateAsset(new File([bytes],'fake.svg',{type:'image/svg+xml'})))
})
test('server PNG processing rejects an oversized request even if its image pixels are tiny',()=>{
 const input=PNG.sync.write({width:1,height:1,data:Buffer.from([10,20,30,255])})
 const boundary=Buffer.concat([input,Buffer.alloc(MAX_ASSET_BYTES-input.length)])
 assert.equal(PNG.sync.read(sanitizeContributionImage(boundary)).width,1)
 assert.throws(()=>sanitizeContributionImage(Buffer.concat([boundary,Buffer.from([0])])),/file-too-large/)
})

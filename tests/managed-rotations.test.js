import test from 'node:test';
import assert from 'node:assert/strict';
import { renderManagement, handleManagement } from '../public/nobet-planlayici/management.js';
const state = { schemaVersion: 1, updatedAt: '2026-11-06T00:00:00Z', groups:[{id:'g',order:1,from:'2026-01',until:null}], people:[{id:'p',name:'Asistan',groupId:'g',from:'2026-01-01',until:null}], assignments:[],targets:[],absences:[],requests:[],holidays:[],months:{'2026-11':{completedAt:null}},rotations:[{id:'r',personId:'p',start:'2026-11-01',end:'2026-11-30',site:null,unit:'Nöbet ertesi'}],portalSource:{version:1,fromMonth:'2026-11',warnings:[]}};
test('managed current rotations show hospital-less post-call and direct editing stays in the source app',()=>{
 const html=renderManagement(state,'2026-11','rotations');
 assert.match(html,/Asistan uygulamasından otomatik alınır/);
 assert.match(html,/Hastanesiz/);
 assert.doesNotMatch(html,/data-action="mg-(?:add-record|edit-record|delete-record|bulk-rotations|import)"/);
 const historical=renderManagement(state,'2026-10','rotations');
 assert.match(historical,/data-action="mg-add-record"/);
});
test('managed rotation add/import/edit/delete/bulk handlers cannot create a second local source',async()=>{
 const messages=[];const ctx={state,month:'2026-11',toast:message=>messages.push(message),commit:()=>assert.fail('must not commit'),dialog:()=>assert.fail('must not open editor')};
 for(const [action,dataset] of [['mg-add-record',{kind:'rotation'}],['mg-import',{kind:'rotation'}],['mg-edit-record',{collection:'rotations',id:'r'}],['mg-delete-record',{collection:'rotations',id:'r'}],['mg-bulk-rotations',{}]]) assert.equal(await handleManagement(action,{dataset},ctx),true);
 assert.equal(messages.length,5);
});

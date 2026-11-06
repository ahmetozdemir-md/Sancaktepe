import test from 'node:test';
import assert from 'node:assert/strict';
import {ensureAssistantRegistry,assistantDutyEnabled,setAssistantArchived,setAssistantDutyEnabled,assistantIdentityForName,renameAssistantInPlanner,renameAssistantBindings,validateAssistantRegistry} from '../src/assistantIdentity.js';
const people=[{id:'p-active',name:'İpek',from:'2026-10-01',until:null},{id:'p-old',name:'Mezun',from:'2026-10-01',until:'2026-11-01'}];
const seed=()=>ensureAssistantRegistry(['İpek','Mezun','Yeni Rotasyoner'],{},people,'2026-11');
test('initial identities link the exact existing person IDs and retain current duty participation only',()=>{
 const result=seed();assert.equal(result.registry['p-active'].dutyEnabled,true);assert.equal(result.registry['p-old'].dutyEnabled,false);
 assert.equal(result.registry['p-active'].plannerPersonId,'p-active');
 const extra=assistantIdentityForName(result.registry,'Yeni Rotasyoner');assert.ok(extra);assert.equal(extra.dutyEnabled,false);assert.equal(extra.plannerPersonId,undefined);
 assert.equal(Object.keys(result.registry).length,3);assert.equal(validateAssistantRegistry(result.registry).valid,true);
 assert.deepEqual(result.warnings,[]);assert.equal(ensureAssistantRegistry(['İpek','Mezun','Yeni Rotasyoner'],result.registry,people,'2026-11').changed,false);
});
test('names use canonical Unicode, Turkish case and whitespace without accent folding or fuzzy matching',()=>{
 const result=ensureAssistantRegistry(['  İPEK  ','Ipek'],{},people,'2026-11');
 assert.equal(result.registry['p-active'].name,'İPEK');assert.equal(result.registry['p-active'].dutyEnabled,true);
 const different=assistantIdentityForName(result.registry,'Ipek');assert.notEqual(different.id,'p-active');assert.equal(different.dutyEnabled,false);
});
test('master additions are explicitly excluded, user inclusion persists, and removed people retain their identity archived',()=>{
 const first=seed().registry;const enabled=setAssistantDutyEnabled(first,assistantIdentityForName(first,'Yeni Rotasyoner').id,true);
 assert.equal(ensureAssistantRegistry(['İpek','Mezun','Yeni Rotasyoner'],enabled,people,'2026-12').registry[assistantIdentityForName(enabled,'Yeni Rotasyoner').id].dutyEnabled,true);
 const removed=ensureAssistantRegistry(['Mezun'],first,people,'2026-12').registry;
 assert.equal(removed['p-active'].archived,true);assert.equal(removed['p-active'].dutyEnabled,false);
 assert.throws(()=>setAssistantDutyEnabled(removed,'p-active',true),/aktif listesine/);
 const returned=ensureAssistantRegistry(['İpek','Mezun'],removed,people,'2027-01').registry;
 assert.equal(returned['p-active'].archived,true,'explicit archive stays archived even while the historical name is retained');assert.equal(returned['p-active'].dutyEnabled,false);const restored=setAssistantArchived(returned,'p-active',false,'2027-01');assert.equal(restored['p-active'].archived,false);assert.equal(restored['p-active'].dutyEnabled,false,'restoring still needs deliberate duty inclusion');
});
test('ambiguous rich names never bind one assistant to an arbitrary existing person',()=>{
 const result=ensureAssistantRegistry(['İpek'],{},[...people,{...people[0],id:'duplicate'}],'2026-11');
 assert.equal(Object.values(result.registry)[0].plannerPersonId,undefined);assert.equal(Object.values(result.registry)[0].dutyEnabled,false);assert.equal(result.warnings[0].code,'ambiguous-planner-name');
});
function planner(){return {assistants:['İpek','Diğer'],assistantRanks:{İpek:2,Diğer:1},assistantRegistry:{p:{name:'İpek',dutyEnabled:true,plannerPersonId:'p-active'},q:{name:'Diğer',dutyEnabled:false}},locationOwners:{room:['İpek','Diğer']},locationOwnersByMonth:{'2026-11':{room:['İpek']}},postDutyPoolByMonth:{'2026-12':['İpek']},manualAssignments:{'2026-11-02':{room:['İpek','Diğer']}},dutyRoster:{'2026-11-01':[{name:'İpek',site:'Sancaktepe'},{name:'Diğer',site:'Feriha Öz'}]},rotatorRoster:{'2026-11-03':['İpek']},rotatorAssignments:{'2026-11-03':{room:['İpek']}},specialistDutyRoster:{'2026-11-01':[{name:'İpek',site:'Sancaktepe'}]},note:'İpek notu aynen kalır'};}
test('rename keeps shared identity and updates every explicit assistant roster field, preserving notes and specialists',()=>{
 const before=planner();const copy=structuredClone(before);const renamed=renameAssistantInPlanner(before,'p','İpek Deniz');
 assert.deepEqual(before,copy);assert.equal(renamed.assistantRegistry.p.plannerPersonId,'p-active');assert.equal(renamed.assistantRegistry.p.name,'İpek Deniz');assert.deepEqual(renamed.assistantRegistry.p.aliases,['İpek']);
 assert.deepEqual(renamed.assistants,['İpek Deniz','Diğer']);assert.deepEqual(renamed.assistantRanks,{'İpek Deniz':2,Diğer:1});assert.deepEqual(renamed.locationOwners.room,['İpek Deniz','Diğer']);assert.deepEqual(renamed.locationOwnersByMonth['2026-11'].room,['İpek Deniz']);assert.deepEqual(renamed.postDutyPoolByMonth['2026-12'],['İpek Deniz']);assert.deepEqual(renamed.manualAssignments['2026-11-02'].room,['İpek Deniz','Diğer']);assert.equal(renamed.dutyRoster['2026-11-01'][0].name,'İpek Deniz');assert.equal(renamed.rotatorRoster['2026-11-03'][0],'İpek Deniz');assert.equal(renamed.rotatorAssignments['2026-11-03'].room[0],'İpek Deniz');assert.deepEqual(renamed.specialistDutyRoster,before.specialistDutyRoster);assert.equal(renamed.note,before.note);
 assert.equal(assistantIdentityForName(ensureAssistantRegistry(renamed.assistants,renamed.assistantRegistry,people,'2026-11').registry,'İpek Deniz').id,'p');
 assert.deepEqual(renameAssistantBindings({login:'İpek',other:'Diğer'},'İpek','İpek Deniz'),{login:'İpek Deniz',other:'Diğer'});
});
test('rename rejects duplicates and invalid names before mutating data',()=>{
 const original=planner();for(const name of ['Diğer','  DİĞER  ','','   ','123','İpek | x']) assert.throws(()=>renameAssistantInPlanner(original,'p',name));
 assert.equal(original.assistantRegistry.p.name,'İpek');assert.throws(()=>setAssistantDutyEnabled(original.assistantRegistry,'none',true),/bulunamadı/);
});
test('registry validation rejects duplicate links, nonboolean inclusion and archived duty participation',()=>{
 assert.equal(validateAssistantRegistry({a:{name:'İpek',dutyEnabled:true,plannerPersonId:'p'},b:{name:'Işık',dutyEnabled:false,plannerPersonId:'p'}}).valid,false);
 assert.equal(validateAssistantRegistry({a:{name:'İpek',dutyEnabled:'yes'}}).valid,false);
 assert.equal(validateAssistantRegistry({a:{name:'İpek',dutyEnabled:true,archived:true}}).valid,false);
});

test('monthly participation keeps November intact when a person leaves in December and supports later re-inclusion',()=>{
 const before=seed().registry;const december=setAssistantDutyEnabled(before,'p-active',false,'2026-12');
 assert.equal(assistantDutyEnabled(december['p-active'],'2026-10'),null);assert.equal(assistantDutyEnabled(december['p-active'],'2026-11'),true);assert.equal(assistantDutyEnabled(december['p-active'],'2026-12'),false);assert.equal(assistantDutyEnabled(december['p-active'],'2027-01'),false);
 const returned=setAssistantDutyEnabled(december,'p-active',true,'2027-02');assert.equal(assistantDutyEnabled(returned['p-active'],'2027-01'),false);assert.equal(assistantDutyEnabled(returned['p-active'],'2027-02'),true);assert.equal(returned['p-active'].dutyEnabled,true);assert.deepEqual(setAssistantDutyEnabled(returned,'p-active',true,'2027-02'),returned);
 const archived=setAssistantArchived(returned,'p-active',true,'2027-03');assert.equal(archived['p-active'].archived,true);assert.equal(assistantDutyEnabled(archived['p-active'],'2026-11'),true);assert.equal(assistantDutyEnabled(archived['p-active'],'2027-03'),false);
});
test('monthly participation validation rejects duplicate, invalid or unordered effective months',()=>{
 for(const history of [[{from:'bad',enabled:true}],[{from:'2026-11',enabled:true},{from:'2026-11',enabled:false}],[{from:'2026-12',enabled:true},{from:'2026-11',enabled:false}],[{from:'2026-11',enabled:1}]])assert.equal(validateAssistantRegistry({p:{name:'İpek',dutyEnabled:true,dutyHistory:history}}).valid,false);
});
test('an old label reappearing after a rename cannot bind the same planner person twice',()=>{
 const old={p:{name:'Yeni İsim',dutyEnabled:true,plannerPersonId:'p-active',aliases:['İpek'],dutyHistory:[{from:'2026-11',enabled:true}]}};const result=ensureAssistantRegistry(['Yeni İsim','İpek'],old,people,'2026-11');assert.equal(Object.values(result.registry).filter(p=>p.plannerPersonId==='p-active').length,1);assert.ok(result.warnings.some(w=>w.code==='already-linked-planner-person'));assert.equal(validateAssistantRegistry(result.registry).valid,true);
});

test('archiving cancels future automatic re-inclusion while preserving prior monthly history',()=>{
 const before=seed().registry;const planned=setAssistantDutyEnabled(before,'p-active',true,'2027-02');const archived=setAssistantArchived(planned,'p-active',true,'2026-12');assert.equal(assistantDutyEnabled(archived['p-active'],'2026-11'),true);assert.equal(assistantDutyEnabled(archived['p-active'],'2027-02'),false);assert.equal(archived['p-active'].dutyEnabled,false);assert.equal(validateAssistantRegistry(archived).valid,true);const gone=ensureAssistantRegistry(['Mezun'],planned,people,'2026-12').registry;assert.equal(assistantDutyEnabled(gone['p-active'],'2027-02'),false);assert.equal(validateAssistantRegistry(gone).valid,true);
});

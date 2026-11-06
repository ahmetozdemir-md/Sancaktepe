import test from 'node:test';import assert from 'node:assert/strict';
import {synchronizePlannerRoster} from '../src/plannerRosterSync.js';
import {ensureAssistantRegistry,setAssistantDutyEnabled,setAssistantArchived,assistantIdentityForName,renameAssistantInPlanner} from '../src/assistantIdentity.js';
import {initialState,activePeople,targetFor} from '../public/nobet-planlayici/domain.js';
import {validateState} from '../public/nobet-planlayici/state-schema.js';
import {sourceSignature} from '../src/sourceSyncSafety.js';
const options={fromMonth:'2026-11',currentMonth:'2026-11'};
function fixture(){return{schemaVersion:1,updatedAt:'2026-11-06T00:00:00Z',groups:[{id:'g1',order:1,from:'2026-10',until:null},{id:'g2',order:2,from:'2026-10',until:null}],people:[{id:'a',name:'İpek',groupId:'g1',from:'2026-10-01',until:null},{id:'b',name:'Ahmet',groupId:'g2',from:'2026-10-01',until:null}],targets:[{id:'t1',personId:null,groupId:'g1',from:'2026-10',weekday:1,weekend:0},{id:'t2',personId:null,groupId:'g2',from:'2026-10',weekday:3,weekend:1}],capabilities:[{id:'c',personId:null,groupId:'g2',from:'2026-10',triangle:false,square:true,circle:false,companion:false}],assignments:[{id:'d',personId:'a',date:'2026-11-02',site:'Sancaktepe',overrides:[]}],requests:[],absences:[],rotations:[],holidays:[],months:{'2026-10':{completedAt:null},'2026-11':{completedAt:null},'2026-12':{completedAt:null}}};}
function portalFor(state,names=state.people.map(p=>p.name)){const assistantRanks=Object.fromEntries(names.map((name,index)=>[name,index===0?1:2]));return{assistants:names,assistantRanks,assistantRegistry:ensureAssistantRegistry(names,{},state.people,'2026-11').registry};}
const synchronize=(state,portal,extra={})=>synchronizePlannerRoster(state,portal,{...options,...extra});
const assertValid=state=>assert.equal(validateState(state).valid,true,validateState(state).errors.join('\n'));

test('seeding 63 existing people and two rotators retains exactly 58 active participants and every planning record',()=>{
 const state=initialState();for(const person of state.people.slice(-5))person.until='2026-11-01';const before=structuredClone(state);assert.equal(activePeople(state,'2026-11').length,58);
 const names=[...state.people.map(p=>p.name),'Büşra Rotasyoner','Selin Rotasyoner'];const portal=portalFor(state,names);const result=synchronize(state,portal);
 assert.equal(result.state.people.length,63);assert.equal(activePeople(result.state,'2026-11').length,58);assert.deepEqual(result.state.people.map(p=>p.id),state.people.map(p=>p.id));assert.deepEqual(state,before);
 for(const key of ['assignments','targets','requests','absences','capabilities','holidays','groups','months'])assert.deepEqual(result.state[key],state[key]);assert.deepEqual(result.warnings,[]);assert.equal(result.state.portalSource.registryManaged,true);assertValid(result.state);assert.equal(synchronize(result.state,portal).changed,false);
});
test('a new unchecked master record stays excluded; explicit inclusion adds its stable ID once into the right cohort',()=>{
 const state=fixture(),portal=portalFor(state,['İpek','Ahmet','Yeni']);portal.assistantRanks.Yeni=1;
 const disabled=synchronize(state,portal);assert.equal(disabled.state.people.length,2);const id=assistantIdentityForName(portal.assistantRegistry,'Yeni').id;
 portal.assistantRegistry=setAssistantDutyEnabled(portal.assistantRegistry,id,true,'2026-11');const included=synchronize(disabled.state,portal);const added=included.state.people.find(p=>p.portalIdentityId===id);
 assert.equal(added.id,id);assert.equal(added.groupId,'g1');assert.equal(activePeople(included.state,'2026-11').length,3);assert.equal(targetFor(included.state,id,'2026-11').weekday,1);assert.equal(included.state.groups.length,2);assertValid(included.state);assert.equal(synchronize(included.state,portal).changed,false);assert.equal(synchronize(included.state,portal).state.people.length,3);
});
test('a real rename follows the explicit shared identity and preserves duty, target, request and capability references',()=>{
 const state=fixture(),portal=portalFor(state);const named=renameAssistantInPlanner(portal,'a','İpek Deniz');const result=synchronize(state,named);const person=result.state.people.find(p=>p.id==='a');
 assert.equal(person.name,'İpek Deniz');assert.equal(person.portalIdentityId,'a');assert.deepEqual(result.state.assignments,state.assignments);assert.deepEqual(result.state.targets,state.targets);assert.deepEqual(result.state.capabilities,state.capabilities);assert.equal(result.state.people.length,2);assertValid(result.state);
});
test('a reused old label cannot steal an existing explicit identity regardless of registry key order',()=>{
 const state=fixture();state.people[0].portalIdentityId='a';const base=portalFor(state);const renamed=renameAssistantInPlanner(base,'a','İpek Deniz');renamed.assistants.push('İpek');renamed.assistantRanks['İpek']=1;renamed.assistantRegistry={'000-new':{name:'İpek',dutyEnabled:true,dutyHistory:[{from:'2026-11',enabled:true}]},...renamed.assistantRegistry};
 const result=synchronize(state,renamed);assert.equal(result.state.people.find(p=>p.id==='a').name,'İpek Deniz');assert.equal(result.state.people.find(p=>p.id==='a').portalIdentityId,'a');assert.equal(result.state.people.find(p=>p.id==='000-new').name,'İpek');assert.equal(result.state.people.length,3);assert.equal(result.warnings.length,0);assertValid(result.state);
});
test('future exclusion preserves November and warns about retained December duties immediately',()=>{
 const state=fixture();state.assignments.push({id:'december',personId:'a',date:'2026-12-02',site:'Sancaktepe',overrides:[]});const portal=portalFor(state);portal.assistantRegistry=setAssistantDutyEnabled(portal.assistantRegistry,'a',false,'2026-12');
 const result=synchronize(state,portal);assert.equal(activePeople(result.state,'2026-11').some(p=>p.id==='a'),true);assert.equal(activePeople(result.state,'2026-12').some(p=>p.id==='a'),false);assert.deepEqual(result.state.assignments,state.assignments);assert.ok(result.warnings.some(w=>w.code==='registry-existing-duties'&&w.personId==='a'&&w.month==='2026-12'));assert.equal(result.warnings.some(w=>w.code==='registry-existing-duties'&&w.month==='2026-11'),false);assertValid(result.state);
});
test('dated future archive history takes precedence over the global archived flag',()=>{
 const state=fixture(),portal=portalFor(state);portal.assistantRegistry=setAssistantArchived(portal.assistantRegistry,'a',true,'2026-12');const result=synchronize(state,portal);
 assert.equal(activePeople(result.state,'2026-11').some(p=>p.id==='a'),true);assert.equal(activePeople(result.state,'2026-12').some(p=>p.id==='a'),false);assert.equal(result.warnings.some(w=>w.code==='registry-existing-duties'&&w.month==='2026-11'),false);assert.deepEqual(result.state.assignments,state.assignments);assertValid(result.state);
});
test('a newly imported person with a dated future archive is active in its declared earlier month only',()=>{
 const state=fixture(),portal=portalFor(state,['İpek','Ahmet','Doğru Geçmiş']);portal.assistantRanks['Doğru Geçmiş']=2;const id=assistantIdentityForName(portal.assistantRegistry,'Doğru Geçmiş').id;portal.assistantRegistry=setAssistantDutyEnabled(portal.assistantRegistry,id,true,'2026-11');portal.assistantRegistry=setAssistantArchived(portal.assistantRegistry,id,true,'2026-12');const result=synchronize(state,portal);
 assert.equal(activePeople(result.state,'2026-11').some(p=>p.id===id),true);assert.equal(activePeople(result.state,'2026-12').some(p=>p.id===id),false);assertValid(result.state);
});
test('old person and cohort lifetimes remain unchanged while monthly flags allow deliberate re-inclusion',()=>{
 const state=fixture();state.people[0].until='2026-11-01';state.groups[0].until='2026-11';state.assignments=[];const portal=portalFor(state);portal.assistantRegistry=setAssistantDutyEnabled(portal.assistantRegistry,'a',true,'2026-12');
 const result=synchronize(state,portal);assert.equal(activePeople(result.state,'2026-11').some(p=>p.id==='a'),false);assert.equal(activePeople(result.state,'2026-12').some(p=>p.id==='a'),true);assert.equal(result.state.people[0].until,'2026-11-01');assert.equal(result.state.groups[0].until,'2026-11');assert.equal(result.state.people[0].groupId,'g1');assertValid(result.state);
});
test('cohort matching uses current source membership before stale numeric history after a whole-cohort shift',()=>{
 const state=fixture();state.groups[0].rankHistory=[{from:'2026-11',rank:1}];state.groups[1].rankHistory=[{from:'2026-11',rank:2}];const portal=portalFor(state,['İpek','Ahmet','Yeni']);portal.assistantRanks={İpek:2,Ahmet:1,Yeni:1};const id=assistantIdentityForName(portal.assistantRegistry,'Yeni').id;portal.assistantRegistry=setAssistantDutyEnabled(portal.assistantRegistry,id,true,'2026-11');
 const result=synchronize(state,portal);assert.equal(result.state.people.find(p=>p.id===id).groupId,'g2');assert.equal(result.state.groups.length,2);assert.equal(targetFor(result.state,id,'2026-11').weekday,3);assertValid(result.state);
});
test('a future enabled participant joins the returning cohort at that month instead of a new cohort',()=>{
 const state=fixture();state.people[0].until='2026-11-01';state.groups[0].until='2026-11';state.assignments=[];const portal=portalFor(state,['İpek','Ahmet','Yeni']);portal.assistantRanks={İpek:1,Ahmet:2,Yeni:1};portal.assistantRegistry=setAssistantDutyEnabled(portal.assistantRegistry,'a',true,'2026-12');const id=assistantIdentityForName(portal.assistantRegistry,'Yeni').id;portal.assistantRegistry=setAssistantDutyEnabled(portal.assistantRegistry,id,true,'2026-12');const result=synchronize(state,portal);
 assert.equal(result.state.people.find(p=>p.id===id).groupId,'g1');assert.equal(result.state.groups.length,2);assert.equal(activePeople(result.state,'2026-11').some(p=>p.id===id),false);assert.equal(activePeople(result.state,'2026-12').some(p=>p.id===id),true);assertValid(result.state);
});
test('closed and future cohorts do not distort the ordinal fallback for a newly included participant',()=>{
 const state=fixture();state.groups[0].until='2026-11';state.people[0].until='2026-11-01';state.groups.push({id:'future',order:3,from:'2027-01',until:null});state.assignments=[];const portal=portalFor(state,['İpek','Ahmet','Yeni']);portal.assistantRanks={İpek:2,Ahmet:1,Yeni:1};const id=assistantIdentityForName(portal.assistantRegistry,'Yeni').id;portal.assistantRegistry=setAssistantDutyEnabled(portal.assistantRegistry,id,true,'2026-11');const result=synchronize(state,portal);assert.equal(result.state.people.find(p=>p.id===id).groupId,'g2');assert.equal(result.state.groups.length,3);assertValid(result.state);
});
test('an unmatched local person is excluded from this month only, with stable warnings and preserved duties/history',()=>{
 const state=fixture(),portal=portalFor(state);state.people.push({id:'orphan',name:'Yalnız Eski Programda',groupId:'g1',from:'2026-10-01',until:null});state.assignments.push({id:'orphan-duty',personId:'orphan',date:'2026-11-02',site:'Feriha Öz',overrides:[]});const result=synchronize(state,portal);
 assert.equal(activePeople(result.state,'2026-10').some(p=>p.id==='orphan'),true);assert.equal(activePeople(result.state,'2026-11').some(p=>p.id==='orphan'),false);assert.deepEqual(result.state.assignments,state.assignments);assert.ok(result.warnings.some(w=>w.code==='registry-orphan'&&w.personId==='orphan'));assert.ok(result.warnings.some(w=>w.code==='registry-existing-duties'&&w.personId==='orphan'));assert.equal(synchronize(result.state,portal).changed,false);assert.deepEqual(synchronize(result.state,portal).warnings,result.warnings);assertValid(result.state);
});
test('empty or missing registry does not exclude existing staff before the master registry is initialized',()=>{
 const state=fixture(),portal=portalFor(state);delete portal.assistantRegistry;assert.equal(synchronize(state,portal).state,state);portal.assistantRegistry={};assert.equal(synchronize(state,portal).state,state);
});
test('invalid roots and monthly identity histories reject rather than overwrite existing state',()=>{
 const state=fixture(),portal=portalFor(state);assert.throws(()=>synchronizePlannerRoster(state,portal,{fromMonth:'bad',currentMonth:'2026-11'}));portal.assistantRegistry.a.dutyHistory=[{from:'bad',enabled:true}];assert.throws(()=>synchronize(state,portal));assert.throws(()=>synchronizePlannerRoster({},portal,options));
});
test('jsonb object key order does not manufacture another roster write',()=>{
 const state=fixture(),portal=portalFor(state);const result=synchronize(state,portal);const reorder=value=>Array.isArray(value)?value.map(reorder):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,reorder(value[key])])):value;const next=synchronize(reorder(result.state),reorder(portal));assert.equal(next.changed,false);assert.equal(sourceSignature(next.state),sourceSignature(result.state));
});

test('an explicit earlier participation month can backdate only a newly source-created person and cohort',()=>{
 const state=fixture(),portal=portalFor(state,['İpek','Ahmet','Yeni']);portal.assistantRanks.Yeni=3;const id=assistantIdentityForName(portal.assistantRegistry,'Yeni').id;portal.assistantRegistry=setAssistantDutyEnabled(portal.assistantRegistry,id,true,'2026-12');const december=synchronize(state,portal).state;const added=december.people.find(p=>p.id===id);assert.equal(added.sourceCreated,true);assert.equal(added.from,'2026-12-01');assert.equal(december.groups.find(g=>g.id===added.groupId).sourceCreated,true);assert.equal(activePeople(december,'2026-11').some(p=>p.id===id),false);
 portal.assistantRegistry=setAssistantDutyEnabled(portal.assistantRegistry,id,true,'2026-11');const backdated=synchronize(december,portal).state;assert.equal(backdated.people.find(p=>p.id===id).from,'2026-11-01');assert.equal(backdated.groups.find(g=>g.id===added.groupId).from,'2026-11');assert.equal(activePeople(backdated,'2026-11').some(p=>p.id===id),true);assert.equal(backdated.people.find(p=>p.id==='a').from,'2026-10-01');assert.deepEqual(backdated.assignments,state.assignments);assertValid(backdated);assert.equal(synchronize(backdated,portal).changed,false);
});
test('removing earlier inclusion never moves source-created birth later or changes legacy lifecycle fields',()=>{
 const state=fixture(),portal=portalFor(state,['İpek','Ahmet','Yeni']);portal.assistantRanks.Yeni=1;const id=assistantIdentityForName(portal.assistantRegistry,'Yeni').id;portal.assistantRegistry=setAssistantDutyEnabled(portal.assistantRegistry,id,true,'2026-11');const included=synchronize(state,portal).state;included.assignments.push({id:'kept-new-duty',personId:id,date:'2026-11-04',site:'Sancaktepe',overrides:[]});portal.assistantRegistry=setAssistantDutyEnabled(portal.assistantRegistry,id,false,'2026-11');portal.assistantRegistry=setAssistantDutyEnabled(portal.assistantRegistry,id,true,'2026-12');const later=synchronize(included,portal).state;assert.equal(later.people.find(p=>p.id===id).from,'2026-11-01');assert.equal(later.assignments.some(a=>a.id==='kept-new-duty'),true);assert.equal(activePeople(later,'2026-11').some(p=>p.id===id),false);assert.equal(activePeople(later,'2026-12').some(p=>p.id===id),true);
 const legacy=fixture();legacy.people[0].from='2026-12-01';legacy.assignments=[];const oldPortal=portalFor(legacy);oldPortal.assistantRegistry=setAssistantDutyEnabled(oldPortal.assistantRegistry,'a',true,'2026-11');const untouched=synchronize(legacy,oldPortal).state;assert.equal(untouched.people.find(p=>p.id==='a').from,'2026-12-01');assert.equal(untouched.groups[0].from,'2026-10');assertValid(untouched);
});

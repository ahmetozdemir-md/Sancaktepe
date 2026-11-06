import test from 'node:test';
import assert from 'node:assert/strict';
import { personGroupId, personAtMonth, groupRankAt, personDutyActive, personRosterEnabled, groupActiveInMonth, synchronizePersonRanks } from '../public/nobet-planlayici/person-history.js';
import { activePeople, targetFor, validateAssignment, rankOf } from '../public/nobet-planlayici/domain.js';
import { capabilitiesFor } from '../public/nobet-planlayici/capabilities.js';
import { sortPeopleBySeniority } from '../public/nobet-planlayici/person-order.js';
import { buildShareModel } from '../public/nobet-planlayici/sharing.js';
import { summaryCSV } from '../public/nobet-planlayici/exporters.js';
import { validateState } from '../public/nobet-planlayici/state-schema.js';
import { createPublicationPreview } from '../src/month-publication.js';

function fixture() {
  return {
    schemaVersion: 1, updatedAt: '2026-11-06T00:00:00.000Z',
    groups: [
      { id: 'g1', order: 1, from: '2026-10', until: null },
      { id: 'g2', order: 2, from: '2026-10', until: null },
    ],
    people: [
      { id: 'a', name: 'İpek', groupId: 'g2', from: '2026-10-01', until: null },
      { id: 'b', name: 'Ahmet', groupId: 'g1', from: '2026-10-01', until: null },
      { id: 'old', name: 'Arşiv', groupId: 'g1', from: '2026-10-01', until: '2026-11-01' },
    ],
    targets: [
      { id: 't1', groupId: 'g1', personId: null, from: '2026-10', weekday: 1, weekend: 0 },
      { id: 't2', groupId: 'g2', personId: null, from: '2026-10', weekday: 3, weekend: 1 },
    ],
    capabilities: [
      { id: 'c1', groupId: 'g1', personId: null, from: '2026-10', triangle: true, square: false, circle: true, companion: false },
      { id: 'c2', groupId: 'g2', personId: null, from: '2026-10', triangle: false, square: true, circle: false, companion: false },
    ],
    assignments: [
      { id: 'ao', personId: 'a', date: '2026-10-06', site: 'Feriha Öz', overrides: [] },
      { id: 'bo', personId: 'b', date: '2026-10-06', site: 'Feriha Öz', overrides: [] },
      { id: 'an', personId: 'a', date: '2026-11-02', site: 'Feriha Öz', overrides: [] },
      { id: 'bn', personId: 'b', date: '2026-11-02', site: 'Feriha Öz', overrides: [] },
    ],
    requests: [], absences: [], rotations: [], holidays: [],
    months: { '2026-10': { completedAt: null }, '2026-11': { completedAt: null }, '2026-12': { completedAt: null } },
  };
}
const portal = ranks => ({ assistants: ['İpek', 'Ahmet', 'Arşiv', 'Yeni'], assistantRanks: { İpek: 1, Ahmet: 2, Arşiv: 2, Yeni: 3, ...ranks } });
const sync = (state, source = portal(), options = {}) => synchronizePersonRanks(state, source, { fromMonth: '2026-11', currentMonth: '2026-11', ...options });

test('legacy person display history and explicit group rank history retain earlier-month fallback',()=>{
 const person={groupId:'g1',groupHistory:[{from:'2026-11',groupId:'g2'}]};assert.equal(personGroupId(person,'2026-10'),'g1');assert.equal(personGroupId(person,'2026-11'),'g2');assert.deepEqual(personAtMonth(person,'2026-11'),{...person,groupId:'g2'});assert.equal(person.groupId,'g1');
 assert.equal(groupRankAt({rankHistory:[{from:'2026-11',rank:4}]},'2026-10',2),2);assert.equal(groupRankAt({rankHistory:[{from:'2026-11',rank:4}]},'2026-12',2),4);
});
test('source rank changes only the displayed cohort rank, retaining identities and all manual planning records',()=>{
 const state=fixture(),before=structuredClone(state),result=sync(state);
 assert.deepEqual(state,before);assert.equal(result.changed,true);assert.deepEqual(result.warnings,[]);assert.equal(result.state.people,state.people);
 assert.equal(result.state.people[0].groupId,'g2');assert.equal(result.state.people[0].groupHistory,undefined);assert.deepEqual(result.state.groups.find(g=>g.id==='g2').rankHistory,[{from:'2026-11',rank:1}]);assert.deepEqual(result.state.groups.find(g=>g.id==='g1').rankHistory,[{from:'2026-11',rank:2}]);
 for(const key of ['targets','capabilities','assignments','requests','absences','rotations','holidays','months'])assert.equal(result.state[key],state[key]);assert.equal(sync(result.state).changed,false);assert.equal(sync(result.state).state,result.state);
});
test('renumbering never transfers targets or clinical flags; personal manual changes and expiry still work',()=>{
 const state=sync(fixture()).state;
 for(const month of ['2026-10','2026-11','2026-12']){assert.deepEqual(targetFor(state,'a',month),{weekday:3,weekend:1});assert.equal(capabilitiesFor(state,'a',month).square,true);assert.equal(capabilitiesFor(state,'a',month).triangle,false);}
 state.targets.push({id:'personal',personId:'a',groupId:null,from:'2026-11',through:'2026-11',weekday:7,weekend:1});state.capabilities.push({id:'personal-flags',personId:'a',groupId:null,from:'2026-11',through:'2026-11',triangle:true,square:false,circle:true,companion:false});
 assert.equal(targetFor(state,'a','2026-11').weekday,7);assert.equal(targetFor(state,'a','2026-12').weekday,3);assert.equal(capabilitiesFor(state,'a','2026-11').triangle,true);assert.equal(capabilitiesFor(state,'a','2026-12').square,true);
});
test('current group controls stay with the same members while list order, sharing and CSV follow the source rank',()=>{
 const state=sync(fixture()).state;
 assert.equal(activePeople(state,'2026-11').find(p=>p.id==='a').groupId,'g2');assert.equal(rankOf(state,'g2','2026-10'),2);assert.equal(rankOf(state,'g2','2026-11'),1);assert.equal(rankOf(state,'g1','2026-11'),2);
 assert.deepEqual(sortPeopleBySeniority(state,'2026-11',activePeople(state,'2026-11')).map(p=>p.id),['a','b']);assert.deepEqual(sortPeopleBySeniority(state,'2026-10',activePeople(state,'2026-10')).slice(0,2).map(p=>p.id),['b','old']);
 const row=buildShareModel(state,'2026-11').rows.find(row=>row.date==='2026-11-02');assert.deepEqual(row.hospitals.find(h=>h.site==='Feriha Öz').names,['İpek','Ahmet']);assert.match(summaryCSV(state,'2026-11'),/İpek;1;/u);
});
test('new-month source rank history preserves prior rank while same-month updates are deterministic',()=>{
 const november=sync(fixture()).state;const december=sync(november,portal({İpek:3,Ahmet:2}),{currentMonth:'2026-12'}).state;
 assert.equal(rankOf(december,'g2','2026-10'),2);assert.equal(rankOf(december,'g2','2026-11'),1);assert.equal(rankOf(december,'g2','2026-12'),3);assert.equal(december.people[0].groupId,'g2');
 const edited=sync(december,portal({İpek:2,Ahmet:1}),{currentMonth:'2026-12'}).state;assert.deepEqual(edited.groups.find(g=>g.id==='g2').rankHistory,[{from:'2026-11',rank:1},{from:'2026-12',rank:2}]);assert.equal(sync(edited,portal({İpek:2,Ahmet:1}),{currentMonth:'2026-12'}).changed,false);
});
test('source ranks never begin before the configured cutoff or current month',()=>{
 const result=sync(fixture(),portal(),{fromMonth:'2027-01'}).state;assert.equal(rankOf(result,'g2','2026-12'),2);assert.equal(rankOf(result,'g2','2027-01'),1);
 const late=sync(fixture(),portal(),{currentMonth:'2026-12'}).state;assert.equal(rankOf(late,'g2','2026-11'),2);assert.equal(rankOf(late,'g2','2026-12'),1);
});
test('exact Turkish case, Unicode and whitespace match; different accents do not guess identities',()=>{
 const state=fixture();state.people[0].name='  İpek  ';const matched=sync(state,{assistants:['İPEK','Ahmet'],assistantRanks:{İPEK:1,Ahmet:2}});assert.equal(rankOf(matched.state,'g2','2026-11'),1);
 const unmatched=sync(state,{assistants:['Ipek','Ahmet'],assistantRanks:{Ipek:1,Ahmet:2}});assert.equal(rankOf(unmatched.state,'g2','2026-11'),2);assert.ok(unmatched.warnings.some(w=>w.personId==='a'&&w.code==='source-rank-name'));
});
test('invalid or missing source ranks never create groups, move people, or change their planning settings',()=>{
 for(const invalid of [undefined,0,-1,1.5,100000]){const state=fixture(),result=sync(state,portal({İpek:invalid}));assert.equal(result.state.groups.length,2);assert.equal(result.state.groups.find(g=>g.id==='g2').rankHistory,undefined);assert.equal(result.state.people,state.people);assert.ok(result.warnings.some(w=>w.personId==='a'&&w.code==='source-rank-missing'));assert.deepEqual(targetFor(result.state,'a','2026-11'),{weekday:3,weekend:1});}
});
test('a source rank thirteen displays thirteen without empty synthetic groups or new inherited settings',()=>{
 const state=fixture();for(let rank=3;rank<=11;rank++)state.groups.push({id:`g${rank}`,order:rank,from:'2026-10',until:null});const source=portal({İpek:13,Ahmet:2});for(let rank=4;rank<=13;rank++)source.assistants.push(`Başka ${rank}`);
 const result=sync(state,source);assert.equal(result.state.groups.length,11);assert.equal(rankOf(result.state,'g2','2026-11'),13);assert.deepEqual(targetFor(result.state,'a','2026-11'),{weekday:3,weekend:1});assert.equal(capabilitiesFor(result.state,'a','2026-11').square,true);assert.equal(sync(result.state,source).changed,false);
});
test('mixed individual ranks within one cohort are visible and never split the cohort or transfer settings',()=>{
 const state=fixture();state.people[1].groupId='g2';const result=sync(state,portal({İpek:1,Ahmet:2}));assert.equal(result.changed,false);assert.ok(result.warnings.some(w=>w.code==='source-cohort-rank-conflict'));assert.equal(result.state.people,state.people);assert.equal(rankOf(result.state,'g2','2026-11'),2);assert.equal(capabilitiesFor(result.state,'b','2026-11').square,true);
});
test('two different planning cohorts cannot silently merge through the same numeric source rank',()=>{
 const state=fixture(),result=sync(state,portal({İpek:1,Ahmet:1}));assert.equal(result.changed,false);assert.ok(result.warnings.some(w=>w.code==='source-cohort-rank-collision'));assert.deepEqual(result.state,state);
});
test('legacy automatic person transfers are repaired at the current month without deleting earlier display history',()=>{
 const state=fixture();state.groups.forEach(g=>g.from='2026-09');state.people[0].groupHistory=[{from:'2026-10',groupId:'g1'},{from:'2026-11',groupId:'g1'}];const result=sync(state).state;
 assert.deepEqual(result.people[0].groupHistory,[{from:'2026-10',groupId:'g1'},{from:'2026-11',groupId:'g2'}]);assert.equal(personGroupId(result.people[0],'2026-10'),'g1');assert.equal(personGroupId(result.people[0],'2026-11'),'g2');assert.equal(rankOf(result,'g2','2026-11'),1);assert.equal(targetFor(result,'a','2026-11').weekday,3);assert.equal(validateState(result).valid,true,validateState(result).errors.join('\n'));
});
test('rank history validation rejects invalid, duplicate, unsorted and out-of-period entries',()=>{
 const variants=[[{from:'2026-11',rank:0}],[{from:'bad',rank:1}],[{from:'2026-11',rank:1},{from:'2026-11',rank:2}],[{from:'2026-12',rank:1},{from:'2026-11',rank:2}],[{from:'2026-09',rank:1}]];
 for(const history of variants){const state=fixture();state.groups[0].rankHistory=history;assert.equal(validateState(state).valid,false);}
 const valid=sync(fixture()).state;assert.equal(validateState(valid).valid,true,validateState(valid).errors.join('\n'));
});
test('display rank changes retain valid duty dates and publication membership',()=>{
 const state=sync(fixture()).state;assert.equal(validateAssignment(state,{personId:'a',date:'2026-11-06',site:'Feriha Öz'}).errors.length,0);
 const view={assistants:['İpek','Ahmet'],assistantRanks:{İpek:1,Ahmet:2},dutyRoster:{},manualAssignments:{},locations:[]};const preview=createPublicationPreview(state,view,'2026-11');assert.equal(preview.canPublish,true,JSON.stringify(preview.errors));assert.equal(preview.count,2);
});

test('master monthly participation excludes future duties without changing earlier active months or stored assignments',()=>{
 const state=fixture();state.people[0].rosterHistory=[{from:'2026-11',enabled:true},{from:'2026-12',enabled:false}];state.assignments.push({id:'already-planned',personId:'a',date:'2026-12-02',site:'Feriha Öz',overrides:[]});
 assert.equal(personRosterEnabled(state.people[0],'2026-10'),null);assert.equal(personDutyActive(state.people[0],'2026-11-02'),true);assert.equal(personDutyActive(state.people[0],'2026-12-02'),false);assert.equal(activePeople(state,'2026-11').some(p=>p.id==='a'),true);assert.equal(activePeople(state,'2026-12').some(p=>p.id==='a'),false);assert.equal(validateState(state).valid,true,validateState(state).errors.join('\n'));assert.ok(validateAssignment(state,{personId:'a',date:'2026-12-04',site:'Feriha Öz'}).errors.some(e=>e.code==='inactive'));assert.equal(state.assignments.some(a=>a.id==='already-planned'),true);
});
test('explicit monthly re-inclusion reopens an old person and cohort only from that month, without rewriting lifecycle history',()=>{
 const state=fixture();state.people[0].until='2026-11-01';state.groups.find(g=>g.id==='g2').until='2026-11';state.people[0].rosterHistory=[{from:'2026-11',enabled:false},{from:'2026-12',enabled:true}];
 assert.equal(activePeople(state,'2026-11').some(p=>p.id==='a'),false);assert.equal(activePeople(state,'2026-12').some(p=>p.id==='a'),true);assert.equal(groupActiveInMonth(state,state.groups.find(g=>g.id==='g2'),'2026-11'),false);assert.equal(groupActiveInMonth(state,state.groups.find(g=>g.id==='g2'),'2026-12'),true);assert.equal(personDutyActive(state.people[0],'2026-12-04'),true);assert.equal(state.people[0].until,'2026-11-01');assert.equal(state.groups.find(g=>g.id==='g2').until,'2026-11');
 state.assignments.push({id:'after-return',personId:'a',date:'2026-12-04',site:'Feriha Öz',overrides:[]});const result=sync(state,portal(),{currentMonth:'2026-12'}).state;assert.equal(rankOf(result,'g2','2026-12'),1);assert.equal(targetFor(result,'a','2026-12').weekday,3);assert.equal(validateState(result).valid,true,validateState(result).errors.join('\n'));
});
test('roster history structural validation rejects malformed participation entries',()=>{
 for(const history of ['bad',[{from:'bad',enabled:true}],[{from:'2026-11',enabled:true},{from:'2026-11',enabled:false}],[{from:'2026-11',enabled:1}]]){const state=fixture();state.people[0].rosterHistory=history;assert.equal(validateState(state).valid,false);}
});

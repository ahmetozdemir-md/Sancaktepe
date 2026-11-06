import test from 'node:test';import assert from 'node:assert/strict';
import {sourceSignature,createSourceRevisionTracker,invalidateSourceCompletion} from '../src/sourceSyncSafety.js';
test('JSONB key ordering cannot manufacture source changes',()=>assert.equal(sourceSignature({people:[{id:'p',name:'A'}],months:{a:{completedAt:null}}}),sourceSignature({months:{a:{completedAt:null}},people:[{name:'A',id:'p'}]})));
test('source provenance lets an in-flight local edit cross only known source revisions',()=>{
 const tracker=createSourceRevisionTracker();tracker.record(1,2);tracker.record(2,3);
 const store=(expected,actual)=>{if(expected!==actual)throw new Error('conflict');return actual+1};
 assert.equal(store(tracker.resolve(1),3),4);
 assert.throws(()=>store(tracker.resolve(1),4),/conflict/,'a later manual write must still conflict');
 tracker.record(4,5);assert.equal(tracker.resolve(1),3,'never cross the manual 3→4 write');
});
test('source provenance retention is bounded and never jumps invalid revisions',()=>{
 const tracker=createSourceRevisionTracker(2);tracker.record(1,2);tracker.record(2,3);tracker.record(3,4);tracker.record(4,7);
 assert.equal(tracker.resolve(1),1);assert.equal(tracker.resolve(2),4);assert.equal(tracker.resolve(4),4);
});
test('actual source changes reopen affected completed months while preserving historical and metadata-only completion',()=>{
 const before={people:[{id:'p',groupId:'a'}],rotations:[{id:'r',personId:'p',start:'2026-11-01',end:'2026-11-30',site:'Sancaktepe',unit:'YBÜ'}],months:{'2026-10':{completedAt:'done'},'2026-11':{completedAt:'done'},'2026-12':{completedAt:'done'}}};
 const meta=structuredClone(before);meta.rotations[0].id='new-id';meta.portalSource={version:1};assert.deepEqual(invalidateSourceCompletion(before,meta,'2026-11').months,before.months);
 const changed=structuredClone(meta);changed.rotations[0].site='Feriha Öz';const result=invalidateSourceCompletion(before,changed,'2026-11');
 assert.equal(result.months['2026-11'].completedAt,null);assert.equal(result.months['2026-10'].completedAt,'done');assert.equal(result.months['2026-12'].completedAt,'done');assert.equal(before.months['2026-11'].completedAt,'done');
 changed.people[0].groupHistory=[{from:'2026-12',groupId:'b'}];assert.equal(invalidateSourceCompletion(before,changed,'2026-11').months['2026-12'].completedAt,null);
});

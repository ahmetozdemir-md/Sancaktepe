import test from 'node:test';import assert from 'node:assert/strict';
import {canStartPortalRefresh,canAdoptPortalRefresh} from '../src/portalRefreshGuard.js';
const idle=()=>({accessMode:'admin',role:'admin',hydrated:true,revision:'r1',payload:'saved',savedPayload:'saved',editVersion:0,visible:true,saving:false,dutyPlannerOpen:false,ownersEditMode:false,plannerEditing:false,bulkBusy:false,libraryBusy:false});
test('published refresh waits for every active work surface and for admin autosave',()=>{
 const context=idle();assert.equal(canStartPortalRefresh(context),true);
 for(const key of ['saving','dutyPlannerOpen','ownersEditMode','plannerEditing','bulkBusy','libraryBusy'])assert.equal(canStartPortalRefresh({...context,[key]:true}),false,key);
 assert.equal(canStartPortalRefresh({...context,payload:'edited'}),false);assert.equal(canStartPortalRefresh({...context,accessMode:''}),false);
 assert.equal(canStartPortalRefresh({...context,visible:false}),false);
});
test('an intervening edit, save revision or login change prevents stale response adoption',()=>{
 const start=idle();assert.equal(canAdoptPortalRefresh(start,{...start}),true);
 for(const changed of [{editVersion:1},{revision:'r2'},{payload:'new'},{accessMode:'assistant'},{saving:true}])assert.equal(canAdoptPortalRefresh(start,{...start,...changed}),false);
});
test('initial protected loading may replace cached fallback but never a user edit made during await',()=>{
 const start={...idle(),hydrated:false,payload:'cached',savedPayload:''};assert.equal(canStartPortalRefresh(start),true);
 assert.equal(canAdoptPortalRefresh(start,{...start,payload:'background view date'}),true);
 assert.equal(canAdoptPortalRefresh(start,{...start,editVersion:1}),false);
});
test('assistant local name preferences do not block fresh published schedules',()=>{
 const assistant={...idle(),accessMode:'assistant',role:'assistant',payload:'local binding'};assert.equal(canStartPortalRefresh(assistant),true);
});

test('admin reauthentication cannot overwrite pending edits while the local role is temporarily unset',()=>{
 const reauth={...idle(),role:'',accessMode:'admin',payload:'unsaved admin edit'};
 assert.equal(canStartPortalRefresh(reauth),false);
 assert.equal(canAdoptPortalRefresh({...reauth,payload:'saved'},reauth),false);
 assert.equal(canStartPortalRefresh({...reauth,hydrated:false}),true,'initial cached fallback is distinct from an existing unsaved admin snapshot');
});

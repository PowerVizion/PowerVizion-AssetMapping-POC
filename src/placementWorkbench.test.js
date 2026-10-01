import test from 'node:test';import assert from 'node:assert/strict';
import {setupQueue,placementProgress,nextSetup,beginCandidate,pickCandidate,needsDiscard,persistCandidate,savedPlacement} from './placementWorkbench.js';
const catalog=Array.from({length:57},(_,i)=>({setup_number:i+1,filename:'WINNIPEG- Setup '+String(i+1).padStart(3,'0')+'.jpg'}));
const saved={dataset_id:'MH_SUB_1',setup_id:'001',panorama_file:catalog[0].filename,x:1,y:2,z:3,placement_method:'manual_3d',orientation_status:'unknown',notes:'Original'};
test('queue status/progress count catalog entries once; filters distinguish placed and unplaced',()=>{
 assert.deepEqual(placementProgress(catalog,[saved,saved,{...saved,setup_id:'999'}]),{total:57,placed:1,remaining:56,percent:2});
 assert.equal(setupQueue(catalog,[saved],'All').length,57);assert.equal(setupQueue(catalog,[saved],'Placed')[0].setup_id,'001');assert.equal(setupQueue(catalog,[saved],'Unplaced').length,56);assert.equal(setupQueue(catalog,[saved],'Unplaced')[0].setup_id,'002');assert.equal(placementProgress([],[]).percent,0);
});
test('queue navigation handles filters, current item excluded after save, and both boundaries',()=>{
 assert.equal(nextSetup(catalog,[saved],'001',1,'Unplaced'),'002');assert.equal(nextSetup(catalog,[saved],'002',-1),'001');assert.equal(nextSetup(catalog,[saved],'001',-1),null);assert.equal(nextSetup(catalog,[saved],'057'),null);assert.equal(nextSetup(catalog,[saved],'001',1,'Placed'),null);
});
test('draft requires explicit editing for existing position, snapshots original, and never auto-places',()=>{
 assert.throws(()=>beginCandidate('MH_SUB_1',catalog[0],saved),/Edit Position/);const draft=beginCandidate('MH_SUB_1',catalog[0],saved,true);assert.equal(draft.point,null);assert.notEqual(draft.expected,saved);assert.deepEqual(draft.expected,saved);assert.equal(draft.notes,'Original');assert.equal(draft.orientation_status,'unknown');
});
test('candidate picks are finite and temporary; reposition/cancel never mutate saved XYZ',()=>{
 const before=JSON.stringify(saved),draft=beginCandidate('MH_SUB_1',catalog[0],saved,true);assert.throws(()=>pickCandidate(null,{x:0,y:0,z:0}),/Activate/);assert.throws(()=>pickCandidate(draft,null),/visible/);assert.throws(()=>pickCandidate(draft,{x:NaN,y:0,z:0}),/visible/);
 const picked=pickCandidate(draft,{x:4,y:5,z:6});assert.equal(draft.point,null);assert.deepEqual(picked.point,{x:4,y:5,z:6});assert.equal(needsDiscard(picked),true);assert.equal(needsDiscard({...picked,point:null}),true);assert.equal(needsDiscard(null),false);assert.equal(JSON.stringify(saved),before);
});
test('Save creates one manual record; Save & Next advances only after successful save',async()=>{
 let stations=[saved],current='002',draft=pickCandidate(beginCandidate('MH_SUB_1',catalog[1]),{x:4,y:5,z:6}),calls=0;
 const row=await persistCandidate(draft,false,async(path,options)=>{calls++;assert.equal(path,'');assert.equal(options.method,'POST');const data=JSON.parse(options.body);assert.equal(data.point,undefined);assert.equal(data.expected,undefined);assert.equal(data.placement_method,'manual_3d');return data;});
 stations=savedPlacement(stations,row);current=nextSetup(catalog,stations,current,1,'Unplaced');draft=null;
 assert.equal(calls,1);assert.equal(current,'003');assert.equal(placementProgress(catalog,stations).placed,2);assert.equal(needsDiscard(draft),false);assert.deepEqual(stations[0],saved);
});
test('replacement requires confirmation and optimistic expected record; failure retains caller draft',async()=>{
 const draft=pickCandidate(beginCandidate('MH_SUB_1',catalog[0],saved,true),{x:7,y:8,z:9});let called=false;
 const request=async(path,options)=>{called=true;assert.equal(path,'/MH_SUB_1/001');assert.equal(options.method,'PUT');assert.deepEqual(JSON.parse(options.body).expected,saved);throw Error('Conflict');};
 await assert.rejects(persistCandidate(draft,false,request),/Confirm/);assert.equal(called,false);await assert.rejects(persistCandidate(draft,true,request),/Conflict/);assert.deepEqual(draft.point,{x:7,y:8,z:9});await assert.rejects(persistCandidate({...draft,point:null},true,request),/Pick/);
});

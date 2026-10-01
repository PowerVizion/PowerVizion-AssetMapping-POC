import test from 'node:test';
import assert from 'node:assert/strict';
import {Vector3,PerspectiveCamera} from 'three';
import {groundState,applyGround,nearestSavedStation,returnToPointCloud} from './groundNavigation.js';
import {movementDelta} from './flyNavigation.js';
test('ground reference retained, explicitly reset, eye height validated',()=>{
 assert.deepEqual(groundState({},230),{eyeHeight:1.7,groundZ:230});
 assert.deepEqual(groundState({eyeHeight:1.9,groundZ:230},270),{eyeHeight:1.9,groundZ:230});
 assert.deepEqual(groundState({eyeHeight:1.5,groundZ:230},270,true),{eyeHeight:1.5,groundZ:270});
 assert.deepEqual(groundState({eyeHeight:99,groundZ:NaN},230),{eyeHeight:1.7,groundZ:230});
});
test('walking plane applies native Z and eye height across rebases preserving XY and direction',()=>{
 for(const centerZ of [200,250])for(const eyeHeight of [1.5,1.7,1.9]){
  const camera=new PerspectiveCamera();camera.position.set(12,13,60);const target=new Vector3(15,17,65),direction=target.clone().sub(camera.position);
  applyGround(camera,target,new Vector3(0,0,centerZ),{groundZ:230,eyeHeight});
  assert.equal(camera.position.x,12);assert.equal(camera.position.y,13);assert.ok(Math.abs(camera.position.z+centerZ-230-eyeHeight)<1e-10);assert.ok(target.clone().sub(camera.position).distanceTo(direction)<1e-10);
 }
});
test('WASD walking remains horizontal when looking up/down, QE ignored, shift faster, frame independent',()=>{
 for(const z of [-.99,0,.99]){const direction=new Vector3(.1,.1,z).normalize();
 for(const key of ['KeyW','KeyS','KeyA','KeyD']){const delta=movementDelta(direction,new Set([key]),.1,'Normal','Ground Walk');assert.equal(delta.z,0);assert.ok(Math.abs(delta.length()-.14)<1e-10);}
 assert.equal(movementDelta(direction,new Set(['KeyQ','KeyE']),.1,'Normal','Ground Walk').length(),0);
 assert.ok(Math.abs(movementDelta(direction,new Set(['KeyW','ShiftLeft']),.1,'Normal','Ground Walk').length()-.42)<1e-10);
 assert.notEqual(movementDelta(direction,new Set(['KeyE']),.1,'Normal','Fly').z,0);
 }
 const travel=fps=>Array.from({length:fps},()=>movementDelta(new Vector3(0,1,1),new Set(['KeyW']),1/fps,'Normal','Ground Walk').length()).reduce((a,b)=>a+b,0);
 assert.ok(Math.abs(travel(30)-travel(120))<1e-10);
});
const row=(id,x,y,z,dataset_id='test')=>({setup_id:id,dataset_id,x,y,z});
test('nearest station uses only finite saved XYZ in dataset, full 3D distance and deterministic ties',()=>{
 const rows=[row('002',3,4,12),row('001',0,0,13),row('003',NaN,0,0),row('004',0,0,0,'other')];
 assert.equal(nearestSavedStation([0,0,0],rows,'test').setup_id,'001');assert.equal(nearestSavedStation([0,0,0],rows,'test').distance,13);
 assert.equal(nearestSavedStation([3,4,11],rows,'test').setup_id,'002');assert.equal(nearestSavedStation([3,4,11],rows,'test').distance,1);
 assert.equal(nearestSavedStation([0,0,0],[],'test'),null);assert.equal(nearestSavedStation([NaN,0,0],rows,'test'),null);
});
test('Real World A to B to C returns C without losing cloud settings or ground state',()=>{
 for(const mode of ['Orbit','Fly','Ground Walk']){
 const before={mode,selected:'001',cameraSetup:'001',camera:{position:[1,2,3],target:[4,5,6]},variantId:'detail_10m',color:'Elevation',size:2.5,speed:'Slow',groundZ:230,eyeHeight:1.9,connections:true};
 const after=returnToPointCloud(before,row('003',3,4,12));assert.equal(after.selected,'003');assert.equal(after.returnSetup,'003');
 for(const key of Object.keys(before).filter(k=>k!=='selected'))assert.deepEqual(after[key],before[key]);
 assert.equal(returnToPointCloud(before,row('003',3,4,12),true).mode,'Ground Walk');
 assert.equal(returnToPointCloud(before,null).selected,'001');assert.equal(returnToPointCloud(before,null).returnSetup,null);
 }
});

test('explicit resume at a saved station initializes a provisional walking reference only if absent',()=>{const next=returnToPointCloud({},row('001',3,4,230),true);assert.equal(next.groundZ,230);assert.equal(next.eyeHeight,1.7);assert.equal(returnToPointCloud({groundZ:228},row('002',3,4,235),true).groundZ,228);assert.equal(returnToPointCloud({},null,true).groundZ,undefined);});

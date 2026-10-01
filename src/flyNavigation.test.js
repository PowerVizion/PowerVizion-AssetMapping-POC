import test from 'node:test';
import assert from 'node:assert/strict';
import {Vector3,PerspectiveCamera} from 'three';
import {movementDelta,lookDirection,cameraSnapshot,restoreCamera,installFlyNavigation} from './flyNavigation.js';
const forward=new Vector3(0,1,0);
test('six-axis movement follows camera forward, horizontal right and native Z up',()=>{
 for(const [key,expected] of Object.entries({KeyW:[0,.5,0],KeyS:[0,-.5,0],KeyA:[-.5,0,0],KeyD:[.5,0,0],KeyQ:[0,0,-.5],KeyE:[0,0,.5]}))assert.deepEqual(movementDelta(forward,new Set([key]),.1,'Normal').toArray().map(x=>x||0),expected);
});
test('movement is frame-rate independent, normalized diagonally, speed-scaled and stall-clamped',()=>{
 const travel=fps=>{let sum=0;for(let i=0;i<fps;i++)sum+=movementDelta(forward,new Set(['KeyW']),1/fps,'Normal').length();return sum;};
 assert.ok(Math.abs(travel(30)-travel(120))<1e-10);
 assert.ok(Math.abs(movementDelta(forward,new Set(['KeyW','KeyD']),.1,'Normal').length()-.5)<1e-12);
 assert.equal(movementDelta(forward,new Set(['KeyW']),.1,'Slow').length(),.1);
 assert.equal(movementDelta(forward,new Set(['KeyW','ShiftLeft']),.1,'Fast').length(),6);
 assert.equal(movementDelta(forward,new Set(['KeyW']),5,'Normal').length(),.5);
});
test('mouse look changes yaw/pitch while avoiding poles and roll',()=>{const dir=lookDirection(forward,100,50);assert.ok(dir.x>0&&dir.z<0);assert.ok(Math.abs(dir.length()-1)<1e-12);assert.ok(Math.abs(lookDirection(forward,0,1e6).z)<1);});
test('camera native position/target round-trip across variant centers; invalid state rejected',()=>{
 const camera=new PerspectiveCamera();camera.up.set(0,0,1);camera.position.set(3,4,5);const target=new Vector3(6,7,8),center=new Vector3(629700,5526800,240);const state=cameraSnapshot(camera,target,center);
 const nextCenter=new Vector3(629600,5526700,230),other=new PerspectiveCamera(),otherTarget=new Vector3();assert.equal(restoreCamera(other,otherTarget,nextCenter,state),true);assert.deepEqual(cameraSnapshot(other,otherTarget,nextCenter),state);assert.equal(restoreCamera(other,otherTarget,nextCenter,{position:[NaN,0,0],target:[0,0,0]}),false);
});
class Surface extends EventTarget {capture=null;focus(){doc.activeElement=this;}setPointerCapture(id){this.capture=id;}hasPointerCapture(id){return this.capture===id;}releasePointerCapture(){this.capture=null;}}
const doc=new EventTarget();doc.hidden=false;doc.activeElement=null;
const emit=(target,type,values={})=>{const event=new Event(type,{cancelable:true});Object.assign(event,values);target.dispatchEvent(event);};
test('controller requires explicit activation; Escape, blur and hidden page release all movement/capture',()=>{
 const canvas=new Surface(),win=new EventTarget(),camera=new PerspectiveCamera();camera.up.set(0,0,1);camera.lookAt(0,1,0);const controls={target:new Vector3(0,20,0)};let pauses=0;
 const controller=installFlyNavigation({canvas,camera,controls,getSettings:()=>({speed:'Normal'}),onPaused:()=>pauses++,onInput:()=>{},win,doc});
 emit(canvas,'keydown',{code:'KeyW'});controller.update(100);controller.update(200);assert.equal(camera.position.length(),0);
 for(const reason of ['escape','blur','hidden']){controller.resume();emit(canvas,'keydown',{code:'KeyW'});controller.update(100);controller.update(200);const before=camera.position.clone();assert.ok(before.length()>0);emit(canvas,'pointerdown',{button:0,pointerId:1,clientX:10,clientY:10});assert.equal(canvas.capture,1);
 if(reason==='escape')emit(canvas,'keydown',{code:'Escape'});if(reason==='blur')emit(win,'blur');if(reason==='hidden'){doc.hidden=true;emit(doc,'visibilitychange');doc.hidden=false;}
 controller.update(300);assert.deepEqual(camera.position.toArray(),before.toArray());assert.equal(canvas.capture,null);}
 assert.equal(pauses,3);controller.dispose();controller.resume();emit(canvas,'keydown',{code:'KeyW'});const before=camera.position.clone();controller.update(400);controller.update(500);assert.deepEqual(camera.position.toArray(),before.toArray());
});

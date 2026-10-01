import {Vector3} from 'three';
export const movementSpeeds={Slow:1,Normal:5,Fast:20};
const up=new Vector3(0,0,1);
export function movementDelta(direction,keys,seconds,speed,mode='Fly') {
 const forward=direction.clone().normalize();if(mode==='Ground Walk'){forward.z=0;forward.normalize();}const right=new Vector3().crossVectors(forward,up).normalize();
 const delta=new Vector3().addScaledVector(forward,Number(keys.has('KeyW'))-Number(keys.has('KeyS')))
  .addScaledVector(right,Number(keys.has('KeyD'))-Number(keys.has('KeyA')))
  .addScaledVector(up,mode==='Ground Walk'?0:Number(keys.has('KeyE'))-Number(keys.has('KeyQ')));
 if(delta.lengthSq())delta.normalize().multiplyScalar((mode==='Ground Walk'?({Slow:0.8,Normal:1.4,Fast:2.2}[speed]||1.4):(movementSpeeds[speed]||5))*(keys.has('ShiftLeft')||keys.has('ShiftRight')?3:1)*Math.max(0,Math.min(seconds,0.1)));
 return delta;
}
export function lookDirection(direction,dx,dy) {
 const yaw=Math.atan2(direction.y,direction.x)-dx*0.003;
 const pitch=Math.max(-Math.PI/2+0.01,Math.min(Math.PI/2-0.01,Math.asin(Math.max(-1,Math.min(1,direction.z)))-dy*0.003));
 return new Vector3(Math.cos(yaw)*Math.cos(pitch),Math.sin(yaw)*Math.cos(pitch),Math.sin(pitch));
}
export function cameraSnapshot(camera,target,center) {return {position:camera.position.clone().add(center).toArray(),target:target.clone().add(center).toArray()};}
export function restoreCamera(camera,target,center,state) {
 if(!state||![state.position,state.target].every(a=>Array.isArray(a)&&a.length===3&&a.every(Number.isFinite)))return false;
 camera.position.fromArray(state.position).sub(center);target.fromArray(state.target).sub(center);camera.lookAt(target);return true;
}
// No pointer lock. Only the explicitly focused canvas handles movement and drag-look.
export function installFlyNavigation({canvas,camera,controls,getSettings,onPaused,onInput,win=window,doc=document}) {
 const keys=new Set();let dragging=null,last=0,enabled=false;
 const releaseDrag=()=>{if(dragging&&canvas.hasPointerCapture(dragging.id))canvas.releasePointerCapture(dragging.id);dragging=null;};
 const release=()=>{keys.clear();releaseDrag();};
 const pause=()=>{enabled=false;release();onPaused();};
 const down=e=>{if(!enabled||e.button!==0)return;onInput();canvas.focus();dragging={id:e.pointerId,x:e.clientX,y:e.clientY};canvas.setPointerCapture(e.pointerId);};
 const move=e=>{if(!enabled||!dragging||e.pointerId!==dragging.id)return;const direction=camera.getWorldDirection(new Vector3());const next=lookDirection(direction,e.clientX-dragging.x,e.clientY-dragging.y);dragging.x=e.clientX;dragging.y=e.clientY;controls.target.copy(camera.position).addScaledVector(next,20);camera.lookAt(controls.target);};
 const keydown=e=>{if(e.code==='Escape'){pause();return;}if(!enabled||e.ctrlKey||e.altKey||e.metaKey)return;if(['KeyW','KeyS','KeyA','KeyD','KeyQ','KeyE','ShiftLeft','ShiftRight'].includes(e.code)){e.preventDefault();keys.add(e.code);onInput();}};
 const keyup=e=>keys.delete(e.code);
 const hidden=()=>{if(doc.hidden)pause();};
 const listeners=[[canvas,'pointerdown',down],[canvas,'pointermove',move],[canvas,'pointerup',releaseDrag],[canvas,'pointercancel',release],[canvas,'lostpointercapture',()=>{dragging=null;}],[canvas,'keydown',keydown],[canvas,'keyup',keyup],[canvas,'blur',pause],[win,'blur',pause],[doc,'visibilitychange',hidden]];
 listeners.forEach(([target,type,fn])=>target.addEventListener(type,fn));
 return {resume(){release();enabled=true;last=0;canvas.focus();},pause,
  update(now){const dt=last?Math.min((now-last)/1000,0.1):0;last=now;if(!enabled||doc.activeElement!==canvas)return;const delta=movementDelta(camera.getWorldDirection(new Vector3()),keys,dt,getSettings().speed,getSettings().mode);camera.position.add(delta);controls.target.add(delta);},
  dispose(){enabled=false;release();listeners.forEach(([target,type,fn])=>target.removeEventListener(type,fn));}};
}

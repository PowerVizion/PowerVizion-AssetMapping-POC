import React,{useEffect,useRef,useState} from 'react';
import {Scene,PerspectiveCamera,WebGLRenderer,SphereGeometry,MeshBasicMaterial,Mesh,Texture,SRGBColorSpace,NoToneMapping,Vector3} from 'three';
import {defaultPanoramaView,normalizePanoramaView,dragPanorama,zoomPanorama} from './panoramaView.js';
import './panorama360.css';

export default function Panorama360({src,filename,setupId,memory,positionStatus}) {
 const host=useRef(null),update=useRef(null);
 const [status,setStatus]=useState('loading'),[error,setError]=useState(''),[attempt,setAttempt]=useState(0);
 const [view,setView]=useState(()=>normalizePanoramaView(memory.current.get(src)));
 useEffect(()=>{
  const container=host.current,controller=new AbortController();let active=true,renderer,geometry,material,texture,bitmap,observer,frame,drag=null;
  let current=normalizePanoramaView(memory.current.get(src));setView(current);setStatus('loading');setError('');
  const scene=new Scene(),camera=new PerspectiveCamera(current.fov,1,.1,100);camera.position.set(0,0,0);
  const listeners=[];const listen=(target,type,fn,options)=>{target.addEventListener(type,fn,options);listeners.push(()=>target.removeEventListener(type,fn,options));};
  function render(){frame=null;if(!active||!renderer||!texture)return;const yaw=current.yaw*Math.PI/180,pitch=current.pitch*Math.PI/180;camera.fov=current.fov;camera.updateProjectionMatrix();camera.lookAt(new Vector3(Math.cos(pitch)*Math.cos(yaw),Math.sin(pitch),Math.cos(pitch)*Math.sin(yaw)));renderer.render(scene,camera);}
  function requestRender(){if(!frame)frame=requestAnimationFrame(render);}
  function change(next){current=normalizePanoramaView(next);memory.current.set(src,current);setView(current);requestRender();}
  update.current=change;
  function release(){if(drag&&renderer?.domElement.hasPointerCapture(drag.id))renderer.domElement.releasePointerCapture(drag.id);drag=null;}
  function failed(message){if(!active)return;release();setError(message);setStatus('error');}
  async function start(){try{
   renderer=new WebGLRenderer({antialias:true});renderer.setPixelRatio(Math.min(devicePixelRatio||1,2));renderer.outputColorSpace=SRGBColorSpace;renderer.toneMapping=NoToneMapping;renderer.setClearColor('#101b22');
   const canvas=renderer.domElement;canvas.tabIndex=0;canvas.setAttribute('aria-label','Interactive 360 panorama '+setupId);container.appendChild(canvas);
   listen(canvas,'webglcontextlost',e=>{e.preventDefault();failed('Graphics context lost. Retry 360 View or use Flat Image.');});
   listen(canvas,'pointerdown',e=>{if(e.button!==0)return;e.preventDefault();canvas.focus();drag={id:e.pointerId,x:e.clientX,y:e.clientY};canvas.setPointerCapture(e.pointerId);});
   listen(canvas,'pointermove',e=>{if(!drag||drag.id!==e.pointerId)return;change(dragPanorama(current,e.clientX-drag.x,e.clientY-drag.y,container.clientWidth,container.clientHeight));drag.x=e.clientX;drag.y=e.clientY;});
   listen(canvas,'pointerup',release);listen(canvas,'pointercancel',release);listen(canvas,'lostpointercapture',()=>{drag=null;});listen(canvas,'blur',release);listen(window,'blur',release);
   listen(canvas,'wheel',e=>{e.preventDefault();change(zoomPanorama(current,Math.max(-100,Math.min(100,e.deltaY*(e.deltaMode===1?16:e.deltaMode===2?container.clientHeight:1)))));},{passive:false});
   listen(canvas,'keydown',e=>{const moves={ArrowLeft:[-5,0],ArrowRight:[5,0],ArrowUp:[0,5],ArrowDown:[0,-5]};if(moves[e.key]){e.preventDefault();const [yaw,pitch]=moves[e.key];change({...current,yaw:current.yaw+yaw,pitch:current.pitch+pitch});}if(e.key==='Escape')release();});
   function resize(){const width=Math.max(1,container.clientWidth),height=Math.max(1,container.clientHeight);renderer.setSize(width,height);camera.aspect=width/height;requestRender();}
   observer=new ResizeObserver(resize);observer.observe(container);resize();
   const started=performance.now();const response=await fetch(src,{signal:controller.signal});if(!response.ok)throw new Error('Panorama image is missing or unavailable.');
   const blob=await response.blob();const decoded=await createImageBitmap(blob,{imageOrientation:'flipY'});
   if(!active){decoded.close();return;}bitmap=decoded;
   if(bitmap.width!==4096||bitmap.height!==2048)throw new Error('Expected a 4096 × 2048 equirectangular image. Use Flat Image to inspect this file.');
   if(renderer.capabilities.maxTextureSize<bitmap.width)throw new Error('This graphics device cannot display the full-resolution image. Use Flat Image.');
   texture=new Texture(bitmap);texture.colorSpace=SRGBColorSpace;texture.needsUpdate=true;texture.anisotropy=Math.min(8,renderer.capabilities.getMaxAnisotropy());
   geometry=new SphereGeometry(10,64,40);geometry.scale(-1,1,1);material=new MeshBasicMaterial({map:texture});scene.add(new Mesh(geometry,material));
   render();setStatus('ready');
   if(import.meta.env.DEV)console.info('360 panorama ready',setupId,Math.round(performance.now()-started)+'ms',JSON.stringify(renderer.info.memory));
  }catch(e){if(e.name!=='AbortError')failed(e.message||'360 View unavailable. Retry or use Flat Image.');}}
  start();return()=>{active=false;controller.abort();release();listeners.forEach(remove=>remove());observer?.disconnect();cancelAnimationFrame(frame);memory.current.set(src,current);geometry?.dispose();material?.dispose();texture?.dispose();bitmap?.close();if(import.meta.env.DEV&&renderer)console.info('360 panorama disposed',setupId,JSON.stringify(renderer.info.memory));renderer?.dispose();renderer?.forceContextLoss();container.replaceChildren();update.current=null;};
 },[src,attempt]);
 return <div className="panorama360"><div className="terrestrialZoom"><button disabled={status!=='ready'} onClick={()=>update.current?.({...view,fov:view.fov-5})}>Zoom In</button><button disabled={status!=='ready'} onClick={()=>update.current?.({...view,fov:view.fov+5})}>Zoom Out</button><button disabled={status!=='ready'} onClick={()=>update.current?.(defaultPanoramaView)}>Reset View</button><output aria-label="Panorama FOV">FOV {Math.round(view.fov)}°</output></div><div className="panorama360Surface"><div className="panorama360Canvas" ref={host}/><div className="panorama360Hud"><strong>Setup {setupId} · 360 Panorama</strong><span>Position: {positionStatus}</span><span>Orientation: Unknown</span></div>{status!=='ready'&&<div className="panorama360Message" role={status==='error'?'alert':'status'}><strong>Setup {setupId} · {status==='loading'?'Loading 360 panorama…':'Panorama unavailable'}</strong><span>{status==='error'?error:filename}</span>{status==='error'&&<button onClick={()=>setAttempt(n=>n+1)}>Retry 360 View</button>}</div>}</div><p className="terrestrialHint">Drag or use arrow keys to look · Wheel to zoom · No north/heading alignment. Flat Image remains available.</p></div>;
}

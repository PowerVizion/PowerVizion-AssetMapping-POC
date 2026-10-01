import React,{useEffect,useRef} from 'react';
import {stationLocal} from './stationGeometry.js';
import './stations.css';
export function WorkbenchMarkers({workbench,viewer,bridge,ready,overlay,onEditing}) {
 const markers=useRef(new Map());
 useEffect(()=>{onEditing(Boolean(workbench.draft)||workbench.busy);},[Boolean(workbench.draft),workbench.busy,onEditing]);
 useEffect(()=>{workbench.onReady(ready?viewer.current:null);return()=>workbench.onReady(null);},[ready,workbench.onReady,viewer]);
 bridge.current={placing:Boolean(workbench.draft)&&!workbench.busy,pick:workbench.onPick,project(camera,center,width,height){
  for(const row of [...workbench.stations,...(workbench.draft?.point?[{...workbench.draft.point,setup_id:'candidate'}]:[])]){
   const el=markers.current.get(row.setup_id);if(!el)continue;const p=stationLocal(row,center).project(camera);
   el.style.display=p.z>=-1&&p.z<=1&&Math.abs(p.x)<=1&&Math.abs(p.y)<=1?'block':'none';el.style.left=(p.x+1)*width/2+'px';el.style.top=(1-p.y)*height/2+'px';
  }
 }};
 return overlay(<div className="stationMarkers">{workbench.stations.map(row=><button key={row.setup_id} ref={el=>{if(el)markers.current.set(row.setup_id,el);else markers.current.delete(row.setup_id);}} className={'stationMarker '+(row.setup_id===workbench.setup?'highlightStation':'')} aria-label={'Saved station Setup '+row.setup_id} disabled={workbench.busy} onClick={()=>workbench.onSelect(row.setup_id)}>◎ {row.setup_id}</button>)}{workbench.draft?.point&&<span ref={el=>{if(el)markers.current.set('candidate',el);else markers.current.delete('candidate');}} className="stationMarker draftStation">✚ {workbench.setup} · Candidate</span>}</div>);
}

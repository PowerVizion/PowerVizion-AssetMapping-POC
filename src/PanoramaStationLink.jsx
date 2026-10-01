import {stationPositionLabel} from './groundNavigation.js';
import React, {useEffect,useState} from 'react';
import {stationRequest} from './stationApi.js';
import {nearestStations} from './stationNeighbors.js';
import './stations.css';
export function PanoramaStationLink({datasetId,setupId,onReturn,onNavigate,onStationState}) {
 const [result,setResult]=useState(null),[error,setError]=useState(''),[version,setVersion]=useState(0);
 useEffect(()=>{
  const controller=new AbortController();setResult(null);setError('');
  stationRequest('/'+encodeURIComponent(datasetId),{signal:controller.signal})
   .then(rows=>{if(!controller.signal.aborted)setResult({datasetId,setupId,rows});})
   .catch(e=>{if(e.name!=='AbortError')setError('Station locations could not be checked.');});
  return()=>controller.abort();
 },[datasetId,setupId,version]);
 const rows=result?.datasetId===datasetId&&result?.setupId===setupId?result.rows:null;
 const station=rows?.find(row=>row.setup_id===setupId);
 const neighbors=station?nearestStations(station,rows):[];
 useEffect(()=>{onStationState?.({setupId,position:error?'Unavailable':!rows?'Checking saved position…':station?stationPositionLabel(station):'Not assigned'});},[setupId,rows,station,error,onStationState]);
 return <section className="stationPanel" aria-label="Panorama station navigation">
  <div className="viewToggle"><button disabled={!rows||Boolean(error)} onClick={()=>onReturn(station)}>POINT CLOUD</button><button aria-pressed="true">REAL WORLD · Setup {setupId}</button></div><p>Captured 360 panorama · Orientation: Unknown</p>
  {error?<p role="alert">{error} <button onClick={()=>setVersion(v=>v+1)}>Retry Stations</button></p>:!rows?<p role="status">Loading station locations…</p>:!station?<p>No 3D station position assigned.</p>:<>
   <div className="panoramaStationLink"><span>Station Position: {stationPositionLabel(station)} · Orientation: Unknown</span><button className="stationViewSwitch" onClick={()=>onReturn(station)}>Return to Point Cloud</button><button onClick={()=>onReturn(station,true)}>Resume Ground Walk</button></div>
   <p>Panorama heading is independent of the 3D camera; orientation is unknown. Resume Ground Walk retains the saved walking plane; if none exists, it uses this provisional station elevation as a manual reference, not detected ground.</p><h3>Nearby Stations</h3><p>Approximate XYZ distance between saved provisional positions.</p>
   {neighbors.length?<ul className="stationNeighbors">{neighbors.map(row=><li key={row.setup_id}><span>Setup {row.setup_id}</span><span>{row.distance.toFixed(1)} m</span><button aria-label={'Go to Setup '+row.setup_id} onClick={()=>onNavigate(row)}>Go</button></li>)}</ul>:<p>No other saved stations nearby.</p>}
  </>}
 </section>;
}

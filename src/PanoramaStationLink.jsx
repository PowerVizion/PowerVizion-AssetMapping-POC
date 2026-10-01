import React, {useEffect,useState} from 'react';
import {stationRequest} from './stationApi.js';
import './stations.css';
export function PanoramaStationLink({datasetId,setupId,onReturn}) {
 const [station,setStation]=useState(null),[error,setError]=useState('');
 useEffect(()=>{const controller=new AbortController();setStation(null);setError('');stationRequest('/'+encodeURIComponent(datasetId),{signal:controller.signal}).then(rows=>setStation(rows.find(row=>row.setup_id===setupId))).catch(e=>{if(e.name!=='AbortError')setError('Station location could not be checked.');});return()=>controller.abort();},[datasetId,setupId]);
 return <div className="panoramaStationLink">{station && <><span>Station Position: Manual / Provisional · Orientation: Unknown</span><button onClick={()=>onReturn(station)}>Return to 3D Station</button></>}{error&&<p role="status">{error}</p>}</div>;
}

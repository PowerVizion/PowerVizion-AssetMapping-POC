import React,{useCallback,useEffect,useRef,useState} from 'react';
import PointCloudViewer from './PointCloudViewer.jsx';
import Panorama360 from './Panorama360.jsx';
import {PanoramaImage} from './TerrestrialData.jsx';
import {stationRequest} from './stationApi.js';
import {stationPositionLabel} from './groundNavigation.js';
import {setupId,setupQueue,placementProgress,nextSetup,beginCandidate,pickCandidate,needsDiscard,persistCandidate,savedPlacement} from './placementWorkbench.js';
import './placementWorkbench.css';
const API='http://127.0.0.1:4000/api/terrestrial-datasets';
export default function PlacementWorkbench({dataset,panoramaViews,leaveGuard,onBack}) {
 const [catalog,setCatalog]=useState(null),[stations,setStations]=useState([]),[setup,setSetup]=useState('001');
 const [draft,setDraft]=useState(null),[filter,setFilter]=useState('All'),[view,setView]=useState('360');
 const [error,setError]=useState(''),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false),[dialog,setDialog]=useState(null),[version,setVersion]=useState(0);
 const [cloudReady,setCloudReady]=useState(false);
 const renderer=useRef(null),locked=useRef(false),pending=useRef(null),guard=useRef(null),focused=useRef(null),dialogButton=useRef(null);
 const onReady=useCallback(value=>{renderer.current=value;setCloudReady(Boolean(value));},[]);
 useEffect(()=>{const abort=new AbortController();setError('');
  Promise.all([stationRequest('/'+encodeURIComponent(dataset.dataset_id),{signal:abort.signal}),fetch(API+'/'+encodeURIComponent(dataset.dataset_id)+'/panoramas',{signal:abort.signal}).then(r=>{if(!r.ok)throw Error('Panorama queue unavailable.');return r.json();})])
   .then(([rows,items])=>{if(!abort.signal.aborted){setStations(rows);setCatalog(items);}}).catch(e=>{if(e.name!=='AbortError')setError(e.message);});return()=>abort.abort();
 },[dataset.dataset_id,version]);
 function leave(action){if(locked.current){setNotice('Wait for the station request to finish.');return;}if(needsDiscard(draft)){pending.current=action;setDialog({type:'discard'});}else action();}
 guard.current=leave;
 useEffect(()=>{if(leaveGuard)leaveGuard.current=action=>guard.current(action);return()=>{if(leaveGuard)leaveGuard.current=null;};},[leaveGuard]);
 useEffect(()=>{if(!draft&&!busy)return;const unload=e=>{e.preventDefault();e.returnValue='';};window.addEventListener('beforeunload',unload);return()=>window.removeEventListener('beforeunload',unload);},[draft,busy]);
 useEffect(()=>{if(dialog)dialogButton.current?.focus();},[dialog]);
 const item=catalog?.find(row=>setupId(row)===setup),existing=stations.find(row=>row.setup_id===setup);
 const progress=placementProgress(catalog||[],stations),queue=setupQueue(catalog||[],stations,filter);
 const previous=nextSetup(catalog||[],stations,setup,-1,filter),next=nextSetup(catalog||[],stations,setup,1,filter);
 useEffect(()=>{if(cloudReady&&focused.current!==setup){focused.current=setup;if(existing)renderer.current?.focusStation(existing);}},[cloudReady,setup,existing]);
 function navigate(id){if(!id||id===setup)return;leave(()=>{setDraft(null);setSetup(id);setError('');setNotice('');});}
 function begin(edit=false){try{setDraft(beginCandidate(dataset.dataset_id,item,existing,edit));setError('');setNotice('');}catch(e){setError(e.message);}}
 // Validate outside React's state updater so empty-space picks become useful errors.
 function onPick(point){try{const candidate=pickCandidate(draft,point);setDraft(candidate);setError('');}catch(e){setError(e.message);}}
 async function save(advance=false,confirmed=false){
  if(locked.current||!draft?.point)return;
  if(draft.expected&&!confirmed){setDialog({type:'replace',advance});return;}
  locked.current=true;setBusy(true);setError('');setDialog(null);
  try{const row=await persistCandidate(draft,confirmed,stationRequest);const rows=savedPlacement(stations,row);setStations(rows);setDraft(null);
   const following=advance?nextSetup(catalog,rows,setup,1,filter):null;
   if(following)setSetup(following);setNotice('Saved Setup '+row.setup_id+' — Manual / Provisional.'+(advance&&!following?' End of the current queue.':''));
  }catch(e){setError(e.message+' Your candidate is retained. Refresh stations after resolving a conflict.');}finally{locked.current=false;setBusy(false);}
 }
 async function remove(){if(locked.current||!existing)return;locked.current=true;setBusy(true);setDialog(null);setError('');try{await stationRequest('/'+encodeURIComponent(dataset.dataset_id)+'/'+existing.setup_id,{method:'DELETE',body:JSON.stringify({expected:existing})});setStations(rows=>rows.filter(row=>row.setup_id!==existing.setup_id));setNotice('Removed placement for Setup '+setup+'. Panorama retained.');}catch(e){setError(e.message);}finally{locked.current=false;setBusy(false);}}
 function dismiss(){setDialog(null);pending.current=null;}
 if(!catalog)return <main className="page"><button onClick={onBack}>Back to Dataset</button>{error?<div role="alert">{error}<button onClick={()=>setVersion(v=>v+1)}>Retry Workbench</button></div>:<p role="status">Loading placement queue…</p>}</main>;
 const src=API+'/'+encodeURIComponent(dataset.dataset_id)+'/panoramas/'+encodeURIComponent(item.filename);
 return <main className="placementWorkbench">
 <fieldset disabled={busy||Boolean(dialog)} className="workbenchContent">
 <header className="workbenchHeading"><div><p className="eyebrow">SCAN STATION PLACEMENT</p><h1>Placement Workbench</h1><p>{dataset.display_name}</p></div><button onClick={()=>leave(onBack)}>Back to Dataset</button></header>
 <div className="placementProgress" aria-label="Placement progress"><strong>{progress.total} Total Setups</strong><span>{progress.placed} Placed</span><span>{progress.remaining} Unplaced</span><progress max="100" value={progress.percent}/><span>{progress.percent}% Complete</span><span className="placementQuality">Manual / Provisional · Orientation: Unknown · Not survey-certified</span></div>
 {error&&<p role="alert" className="workbenchError">{error}</p>}{notice&&<p role="status">{notice}</p>}
 <div className="workbenchNav"><button disabled={!previous||busy} onClick={()=>navigate(previous)}>Previous</button><label>Jump to Setup<select value={setup} onChange={e=>navigate(e.target.value)}>{catalog.map(row=><option key={row.filename} value={setupId(row)}>Setup {setupId(row)}{stations.some(s=>s.setup_id===setupId(row))?' · Placed':''}</option>)}</select></label><button disabled={!next||busy} onClick={()=>navigate(next)}>Next</button><strong>Setup {setup} of {catalog.length}</strong><span className={'badge '+(existing?'good':'neutral')}>{existing?'PLACED':'NOT PLACED'}</span><button onClick={()=>leave(()=>{setDraft(null);setVersion(v=>v+1);})}>Refresh Stations</button></div>
 <div className="workbenchBody"><aside className="setupQueue" aria-label="Setup queue"><label>Queue Filter<select value={filter} onChange={e=>setFilter(e.target.value)}><option>All</option><option>Placed</option><option>Unplaced</option></select></label><div>{queue.map(row=><button key={row.setup_id} aria-current={row.setup_id===setup?'step':undefined} onClick={()=>navigate(row.setup_id)}><span>{row.station?'✓':'○'} Setup {row.setup_id}</span><small>{row.setup_id===setup?'Current · ':''}{row.station?'Placed':'Not Placed'}</small></button>)}{!queue.length&&<p>No setups in this filter.</p>}</div></aside>
 <div className="workbenchMain"><div className="workbenchSplit">
 <section aria-label="Placement Point Cloud"><h2>POINT CLOUD</h2><PointCloudViewer dataset={dataset} workbench={{stations,setup,draft,busy,onReady,onPick,onSelect:navigate}}/></section>
 <section className="workbenchPanorama" aria-label="Placement Real World"><h2>REAL WORLD · Setup {setup}</h2><p className="terrestrialFilename">{item.filename}</p><p>Captured panorama · {existing?stationPositionLabel(existing):'No saved position'} · Orientation: Unknown</p><div className="panoramaModeBar"><button aria-pressed={view==='360'} onClick={()=>setView('360')}>360 View</button><button aria-pressed={view==='flat'} onClick={()=>setView('flat')}>Flat Image</button></div>{view==='360'?<Panorama360 key={src} src={src} setupId={setup} filename={item.filename} memory={panoramaViews} positionStatus={existing?stationPositionLabel(existing):'Not assigned'}/>:<PanoramaImage key={src} src={src} filename={item.filename}/>}</section>
 </div><section className="candidatePanel" aria-label="Station candidate">
 {draft?<><h2>{draft.expected?'Replace':'Place'} Setup {setup} · {draft.point?'Candidate Position':'Click a point in the cloud'}</h2><p>Manual / Provisional · Placement Method: Manual 3D · Orientation: Unknown</p>{draft.point&&<output aria-label="Candidate XYZ">X: {draft.point.x.toFixed(3)} · Y: {draft.point.y.toFixed(3)} · Z: {draft.point.z.toFixed(3)}</output>}<label>Placement Note<textarea maxLength={2000} value={draft.notes} onChange={e=>setDraft({...draft,notes:e.target.value})}/></label><div className="workbenchActions"><button disabled={!draft.point||!cloudReady||busy} onClick={()=>save(false)}>Save</button><button disabled={!draft.point||!cloudReady||busy} className="saveNext" onClick={()=>save(true)}>Save &amp; Next</button><button onClick={()=>{setDraft(null);setError('');setNotice('Candidate cancelled; saved placements unchanged.');}}>Cancel</button><button disabled={!draft.point} onClick={()=>{setDraft({...draft,point:null});setNotice('Click a new rendered point. Nothing has been saved.');}}>Reposition</button></div><p>Candidate only — no CSV write until Save. Replacement requires confirmation.</p></>:existing?<><h2>Setup {setup} · PLACED</h2><output>X: {existing.x.toFixed(3)} · Y: {existing.y.toFixed(3)} · Z: {existing.z.toFixed(3)}</output><p>Placement Method: {existing.placement_method} · {stationPositionLabel(existing)} · Orientation: {existing.orientation_status}</p>{existing.notes&&<p>{existing.notes}</p>}<div className="workbenchActions"><button disabled={!cloudReady} onClick={()=>renderer.current?.focusStation(existing)}>Focus Existing</button><button disabled={!cloudReady} onClick={()=>begin(true)}>Edit Position</button><button onClick={()=>setDialog({type:'delete'})}>Delete Placement</button></div><p>Existing placement is protected. Choose Edit Position before making a replacement candidate.</p></>:<><h2>Setup {setup} · Not Placed</h2><p>Inspect both views, activate placement, then click a visible cloud point at the estimated scanner location.</p><button disabled={!cloudReady} onClick={()=>begin()}>Place Setup {setup}</button></>}
 {busy&&<p role="status">Saving station changes…</p>}
 </section></div></div>
 </fieldset>
 {dialog&&<div className="workbenchModalBackdrop"><section role="alertdialog" aria-modal="true" aria-labelledby="placement-dialog-title" className="workbenchDialog" onKeyDown={e=>{if(e.key==='Escape')dismiss();}}><h2 id="placement-dialog-title">{dialog.type==='discard'?'Unsaved station placement':dialog.type==='replace'?'Replace saved Setup '+setup+'?':'Delete placement for Setup '+setup+'?'}</h2><p>{dialog.type==='discard'?'Discard this candidate and leave, or stay to finish it.':dialog.type==='replace'?'This explicitly replaces the saved XYZ and notes with this manual/provisional candidate. Orientation remains unknown.':'This removes the saved spatial placement. The panorama and evidence associations remain available.'}</p><div className="workbenchActions"><button ref={dialogButton} onClick={dismiss}>{dialog.type==='discard'?'Stay':'Keep Existing'}</button><button onClick={()=>{if(dialog.type==='discard'){const action=pending.current;setDraft(null);dismiss();action?.();}else if(dialog.type==='replace')save(dialog.advance,true);else remove();}}>{dialog.type==='discard'?'Discard':dialog.type==='replace'?'Confirm Replacement':'Confirm Delete Placement'}</button></div></section></div>}
 </main>;
}

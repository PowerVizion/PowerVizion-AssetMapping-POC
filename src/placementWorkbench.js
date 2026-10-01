export const setupId = item => String(item.setup_number).padStart(3,'0');
export function setupQueue(catalog,stations,filter='All') {
 return catalog.map(item=>({...item,setup_id:setupId(item),station:stations.find(row=>row.setup_id===setupId(item))||null}))
 .filter(item=>filter==='Placed'?item.station:filter==='Unplaced'?!item.station:true);
}
export function placementProgress(catalog,stations) {
 const placed=setupQueue(catalog,stations,'Placed').length,total=catalog.length;
 return {total,placed,remaining:total-placed,percent:total?Math.round(placed/total*100):0};
}
export function nextSetup(catalog,stations,current,direction=1,filter='All') {
 const position=catalog.findIndex(item=>setupId(item)===current);
 const eligible=new Set(setupQueue(catalog,stations,filter).map(item=>item.setup_id));
 for(let i=position+direction;i>=0&&i<catalog.length;i+=direction)if(eligible.has(setupId(catalog[i])))return setupId(catalog[i]);
 return null;
}
export function beginCandidate(datasetId,item,existing,edit=false) {
 if(existing&&!edit)throw Error('Choose Edit Position before replacing a saved station.');
 return {dataset_id:datasetId,setup_id:setupId(item),panorama_file:item.filename,placement_method:'manual_3d',orientation_status:'unknown',notes:existing?.notes||'',expected:existing?{...existing}:null,point:null};
}
export function pickCandidate(draft,point) {
 if(!draft)throw Error('Activate Place Setup first.');
 if(!point||!['x','y','z'].every(key=>Number.isFinite(point[key])))throw Error('No visible cloud point here. Click a rendered surface.');
 return {...draft,point:{x:point.x,y:point.y,z:point.z}};
}
export function needsDiscard(draft) {return Boolean(draft);}
export async function persistCandidate(draft,confirmed,request) {
 if(!draft?.point)throw Error('Pick a candidate position before saving.');
 if(draft.expected&&!confirmed)throw Error('Confirm replacement of the existing station.');
 const {point,expected,...metadata}=draft;
 return request(expected?'/'+encodeURIComponent(draft.dataset_id)+'/'+draft.setup_id:'',{method:expected?'PUT':'POST',body:JSON.stringify({...metadata,...point,...(expected?{expected}:{})})});
}
export function savedPlacement(stations,row){return [...stations.filter(item=>item.setup_id!==row.setup_id),row].sort((a,b)=>a.setup_id.localeCompare(b.setup_id));}

// Native survey Z is kept in memory so variant rebasing cannot change the walking plane.
export const eyeHeights=[1.5,1.7,1.9];
export function groundState(state={},cameraZ=0,reset=false) {
 const eyeHeight=eyeHeights.includes(state.eyeHeight)?state.eyeHeight:1.7;
 return {eyeHeight,groundZ:!reset&&Number.isFinite(state.groundZ)?state.groundZ:cameraZ};
}
export function applyGround(camera,target,center,settings) {
 if(!Number.isFinite(settings.groundZ))return;
 const z=settings.groundZ+settings.eyeHeight-center.z,delta=z-camera.position.z;
 camera.position.z=z;target.z+=delta;
}
export function nearestSavedStation(position,stations,datasetId) {
 if(!position?.every(Number.isFinite)||position.length!==3)return null;
 return stations.filter(row=>row.dataset_id===datasetId&&['x','y','z'].every(k=>Number.isFinite(row[k])))
 .map(row=>({...row,distance:Math.hypot(row.x-position[0],row.y-position[1],row.z-position[2])}))
 .sort((a,b)=>a.distance-b.distance||a.setup_id.localeCompare(b.setup_id))[0]||null;
}
export function returnToPointCloud(previous={},station,resumeGround=false) {
 const initialGround=resumeGround&&!Number.isFinite(previous.groundZ)&&Number.isFinite(station?.z)?{groundZ:station.z,eyeHeight:eyeHeights.includes(previous.eyeHeight)?previous.eyeHeight:1.7}:{};
 return {...previous,...initialGround,mode:resumeGround?'Ground Walk':previous.mode==='Walk / Fly'?'Fly':previous.mode||'Orbit',selected:station?.setup_id||previous.selected,returnSetup:station?.setup_id||null,resumeGround};
}
export function stationPositionLabel(row) {return row?.placement_method==='manual_3d'?'Manual / Provisional':row?.placement_method==='leica_export'?'Leica export':'Saved position';}

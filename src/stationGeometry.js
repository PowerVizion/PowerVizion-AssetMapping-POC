import { Vector3 } from 'three';
export function stationLocal(row, center) { return new Vector3(row.x,row.y,row.z).sub(center); }
export function stationGlobal(local, center) { const point=local.clone().add(center);return {x:point.x,y:point.y,z:point.z}; }
// Pick only decoded, currently visible cloud points. No ground plane or invented depth.
export function pickStationPoint(cloud,camera,center,pixel,width,height) {
  const point=new Vector3(),projected=new Vector3();let best=null,bestDepth=Infinity;
  for(const node of cloud.visibleNodes) {
    const object=node.sceneNode,positions=object.geometry.getAttribute('position');
    for(let i=0;i<positions.count;i++) {
      point.fromBufferAttribute(positions,i).applyMatrix4(object.matrixWorld);
      projected.copy(point).project(camera);
      if(projected.z < -1 || projected.z > 1)continue;
      const dx=(projected.x+1)*width/2-pixel.x,dy=(1-projected.y)*height/2-pixel.y;
      if(dx*dx+dy*dy<=100 && projected.z<bestDepth) {bestDepth=projected.z;best=point.clone();}
    }
  }
  return best ? stationGlobal(best,center) : null;
}
export function nearestStations(row,stations) {return stations.filter(item=>item.setup_id!==row.setup_id).map(item=>({...item,distance:Math.hypot(item.x-row.x,item.y-row.y,item.z-row.z)})).sort((a,b)=>a.distance-b.distance).slice(0,3);}

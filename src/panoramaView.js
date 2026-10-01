export const defaultPanoramaView={yaw:0,pitch:0,fov:75};
export function normalizePanoramaView(value={}) {
 const number=(n,fallback)=>Number.isFinite(n)?n:fallback;
 return {yaw:((number(value.yaw,0)%360)+360)%360,pitch:Math.max(-85,Math.min(85,number(value.pitch,0))),fov:Math.max(35,Math.min(100,number(value.fov,75)))};
}
export function dragPanorama(view,dx,dy,width,height) {
 return normalizePanoramaView({...view,yaw:view.yaw-dx*view.fov/Math.max(height,1),pitch:view.pitch+dy*view.fov/Math.max(height,1)});
}
export function zoomPanorama(view,delta) {return normalizePanoramaView({...view,fov:view.fov+delta*.035});}

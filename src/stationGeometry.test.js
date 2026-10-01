import test from 'node:test';
import assert from 'node:assert/strict';
import {Vector3,PerspectiveCamera,BufferGeometry,Float32BufferAttribute,Points,PointsMaterial} from 'three';
import {stationLocal,stationGlobal,pickStationPoint,nearestStations} from './stationGeometry.js';
test('native station coordinates round-trip across differently rebased variants',()=>{
 const row={x:629555.125,y:5526750.375,z:240.625};for(const center of [new Vector3(629677,5526808,246),new Vector3(629676,5526798,244)])assert.deepEqual(stationGlobal(stationLocal(row,center),center),row);
});
test('picking returns an actual front cloud point and rejects empty space',()=>{
 const camera=new PerspectiveCamera(60,1,.1,100);camera.position.set(0,0,10);camera.lookAt(0,0,0);camera.updateMatrixWorld(true);const geometry=new BufferGeometry();geometry.setAttribute('position',new Float32BufferAttribute([0,0,0,0,0,2],3));const object=new Points(geometry,new PointsMaterial());object.updateMatrixWorld(true);const cloud={visibleNodes:[{sceneNode:object}]},center=new Vector3(629550,5526700,230);
 assert.deepEqual(pickStationPoint(cloud,camera,center,{x:250,y:250},500,500),{x:629550,y:5526700,z:232});assert.equal(pickStationPoint(cloud,camera,center,{x:0,y:0},500,500),null);geometry.dispose();object.material.dispose();
});
test('neighbors use only saved XYZ positions and exclude current setup',()=>{const a={setup_id:'001',x:0,y:0,z:0},b={setup_id:'002',x:3,y:4,z:0};assert.equal(nearestStations(a,[a,b])[0].distance,5);assert.equal(nearestStations(a,[a]).length,0);});

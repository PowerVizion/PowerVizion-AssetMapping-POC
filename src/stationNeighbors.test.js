import test from 'node:test';
import assert from 'node:assert/strict';
import {nearestStations} from './stationNeighbors.js';
const row=(setup_id,x,y,z=0,dataset_id='MH_SUB_1')=>({setup_id,x,y,z,dataset_id});
test('nearest three use true XYZ, ascending distance and not setup numbering',()=>{
 const a=row('001',0,0), b=row('057',0,0,2), c=row('030',3,4), d=row('003',0,0,8), e=row('002',100,100);
 const result=nearestStations(a,[e,d,c,b,a]);assert.deepEqual(result.map(r=>r.setup_id),['057','030','003']);assert.deepEqual(result.map(r=>r.distance),[2,5,8]);
});
test('unplaced current, invalid coordinates and other datasets never produce links',()=>{
 const a=row('001',0,0), b=row('002',3,4);assert.deepEqual(nearestStations(a,[b]),[]);
 assert.deepEqual(nearestStations(a,[a,row('002',NaN,0),row('003',1,0,0,'other')]),[]);
});
test('edits and deletions immediately change derived neighbors; use latest saved coordinates',()=>{
 const a=row('001',0,0), b=row('002',3,4), c=row('003',10,0);
 assert.equal(nearestStations(a,[a,b,c])[0].setup_id,'002');
 assert.equal(nearestStations(a,[a,{...b,x:30},c])[0].setup_id,'003');
 assert.deepEqual(nearestStations(a,[a,c]).map(r=>r.setup_id),['003']);
 assert.equal(nearestStations(a,[{...a,x:10},c])[0].distance,0);
});
test('equal distances have stable order, zero-distance stations remain navigable',()=>{
 const a=row('001',0,0);assert.deepEqual(nearestStations(a,[a,row('003',0,0),row('002',0,0)]).map(r=>r.setup_id),['002','003']);
});

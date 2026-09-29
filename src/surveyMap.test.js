import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {mappedSurveys,mapPositions} from './surveyMap.js';
const datasets=JSON.parse(readFileSync(new URL('../data/terrestrial_datasets.json',import.meta.url),'utf8'));
test('configured MH footprint retains supplied latitude/longitude and provisional status',()=>{
 const survey=mappedSurveys(datasets).find(row=>row.dataset_id==='MH_SUB_1');
 assert.deepEqual(survey.map.footprint,[[49.87843190,-97.19690070],[49.87837430,-97.19320163],[49.88079879,-97.19311112],[49.88085640,-97.19681038]]);
 assert.equal(survey.map.crs_status,'provisional');assert.match(survey.map.crs_notes,/not survey-certified/);
});
test('fit positions include separate survey geometry and unchanged assets',()=>{
 const assets=[{id:'a',latitude:53.475,longitude:-113.547}];const before=JSON.stringify(assets);
 const positions=mapPositions(assets,mappedSurveys(datasets));assert.equal(positions.length,5);assert.deepEqual(positions[0],[53.475,-113.547]);
 assert.ok(Math.min(...positions.map(p=>p[1]))<-113);assert.ok(Math.max(...positions.map(p=>p[1]))>-98);assert.equal(JSON.stringify(assets),before);
 assert.equal(mapPositions([],mappedSurveys(datasets)).length,4);
});
test('disabled and invalid survey polygons are excluded without suppressing valid layers',()=>{
 const valid=datasets[0];for(const map of [{...valid.map,enabled:false},{...valid.map,geometry_type:'point'},{...valid.map,footprint:[[100,0],[1,1],[2,2]]},{...valid.map,footprint:[[1,1],[1,1],[1,1]]},{...valid.map,footprint:[['49',-97],[1,1],[2,2]]}])assert.equal(mappedSurveys([{map},valid]).length,1);
});

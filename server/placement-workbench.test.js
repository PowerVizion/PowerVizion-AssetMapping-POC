import test from 'node:test';import assert from 'node:assert/strict';import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import path from 'node:path';import express from 'express';
import {terrestrialStationsRouter,stationStore,columns} from './terrestrial-stations.js';
import {beginCandidate,pickCandidate,persistCandidate,savedPlacement,nextSetup,placementProgress} from '../src/placementWorkbench.js';
test('workbench save, Save & Next, explicit replacement and delete integrate with isolated CSV API',async t=>{
 const folder=await mkdtemp(path.join(tmpdir(),'pv-placement-'));const configPath=path.join(folder,'datasets.json'),csvPath=path.join(folder,'stations.csv');await mkdir(path.join(folder,'Panoramas'));
 const catalog=[1,2,3].map(n=>({setup_number:n,filename:'Setup '+String(n).padStart(3,'0')+'.jpg'}));
 await writeFile(configPath,JSON.stringify([{dataset_id:'TEST',panorama_directory:'Panoramas',panorama_pattern:'Setup ###.jpg',setup_count:3}]));await writeFile(csvPath,columns.join(',')+'\n');for(const item of catalog)await writeFile(path.join(folder,'Panoramas',item.filename),Buffer.from([255,216,255,224]));
 const options={configPath,csvPath,getRoot:()=>folder};const app=express();app.use(express.json());app.use('/stations',terrestrialStationsRouter(options));const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 t.after(async()=>{await new Promise(r=>server.close(r));assert.equal(path.dirname(folder),path.resolve(tmpdir()));await rm(folder,{recursive:true,force:true});});
 const request=async(suffix='',init={})=>{const response=await fetch('http://127.0.0.1:'+server.address().port+'/stations'+suffix,{...init,headers:{'Content-Type':'application/json'}});const data=await response.json();if(!response.ok)throw Error(data.error);return data;};
 let rows=[],setup='001';
 for(let i=0;i<2;i++){const draft=pickCandidate({...beginCandidate('TEST',catalog[i]),notes:'Fixture, "quoted"\nNew line'},{x:i+1,y:i+2,z:i+3});const bytes=await readFile(csvPath);assert.equal((await request('/TEST')).length,i);assert.deepEqual(await readFile(csvPath),bytes);const row=await persistCandidate(draft,false,request);rows=savedPlacement(rows,row);setup=nextSetup(catalog,rows,setup,1,'Unplaced');}
 assert.equal(setup,'003');assert.equal(placementProgress(catalog,rows).placed,2);assert.deepEqual(await stationStore(options).list(),rows);
 const original=rows[0],edit=pickCandidate(beginCandidate('TEST',catalog[0],original,true),{x:4,y:5,z:6});const before=await readFile(csvPath);await assert.rejects(persistCandidate(edit,false,request),/Confirm/);assert.deepEqual(await readFile(csvPath),before);
 const updated=await persistCandidate(edit,true,request);assert.equal(updated.x,4);await assert.rejects(persistCandidate(edit,true,request));await request('/TEST/001',{method:'DELETE',body:JSON.stringify({expected:updated})});assert.equal((await stationStore(options).list()).length,1);assert.ok((await readFile(csvPath,'utf8')).startsWith(columns.join(',')));
});

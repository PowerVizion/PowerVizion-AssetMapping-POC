import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import express from 'express';
import {stationStore,terrestrialStationsRouter,columns} from './terrestrial-stations.js';
test('station CSV API validation, atomic persistence and conflicts',async t=>{
 const temporary=await mkdtemp(path.join(tmpdir(),'powervizion-stations-test-'));const csvPath=path.join(temporary,'stations.csv'),configPath=path.join(temporary,'datasets.json');const root=path.join(temporary,'images');await mkdir(path.join(root,'Panoramas'),{recursive:true});
 const header='\uFEFF'+columns.join(',')+'\r\n';await writeFile(csvPath,header);
 await writeFile(configPath,JSON.stringify([{dataset_id:'MH_SUB_1',panorama_directory:'Panoramas',panorama_pattern:'WINNIPEG- Setup ###.jpg',setup_count:57}]));
 await writeFile(path.join(root,'Panoramas','WINNIPEG- Setup 001.jpg'),Buffer.from([255,216,255,224]));
 const options={csvPath,configPath,getRoot:()=>root},app=express();app.use(express.json());app.use('/api/terrestrial-stations',terrestrialStationsRouter(options));const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
 t.after(async()=>{await new Promise(resolve=>server.close(resolve));assert.equal(path.dirname(temporary),path.resolve(tmpdir()));assert.ok(path.basename(temporary).startsWith('powervizion-stations-test-'));await rm(temporary,{recursive:true,force:true});});
 const base=`http://127.0.0.1:${server.address().port}/api/terrestrial-stations`;
 async function request(method,suffix='',body,origin){const r=await fetch(base+suffix,{method,headers:{'Content-Type':'application/json',...(origin?{Origin:origin}:{})},...(body?{body:JSON.stringify(body)}:{})});return {status:r.status,body:await r.json()};}
 const row={dataset_id:'MH_SUB_1',setup_id:'001',panorama_file:'WINNIPEG- Setup 001.jpg',x:629550.123456,y:5526700.98765,z:230.125,placement_method:'manual_3d',orientation_status:'unknown',notes:'Test, "quoted"\nNext line'};let current=row;
 await t.test('create keeps full native XYZ, quoted notes, header and newline style',async()=>{const r=await request('POST','',row);assert.equal(r.status,201);assert.deepEqual(r.body,row);assert.equal(await readFile(csvPath+'.bak','utf8'),header);assert.ok((await readFile(csvPath,'utf8')).startsWith(header));});
 await t.test('fresh store and API reads recover only the saved setup',async()=>{assert.deepEqual(await stationStore(options).list(),[row]);assert.deepEqual((await request('GET','/MH_SUB_1')).body,[row]);assert.equal((await request('GET','/unknown')).status,404);});
 await t.test('duplicate cannot append or overwrite',async()=>{assert.equal((await request('POST','',{...row,x:1})).status,409);assert.deepEqual(await stationStore(options).list(),[row]);});
 await t.test('nonfinite, nonnumeric XYZ and invalid identifiers/setup/panorama rejected',async()=>{
  for(const patch of [{x:null},{x:'123'},{x:Infinity},{y:NaN},{z:''},{dataset_id:'unknown'},{setup_id:'058'},{setup_id:'2'},{setup_id:'002',panorama_file:'WINNIPEG- Setup 002.jpg'},{panorama_file:'../bad.jpg'},{placement_method:'auto'},{orientation_status:'verified'},{notes:'x'.repeat(2001)}])assert.equal((await request('POST','',{...row,...patch})).status,400,JSON.stringify(patch));
  assert.deepEqual(await stationStore(options).list(),[row]);
 });
 await t.test('edit uses optimistic concurrency and survives reload',async()=>{const changed={...row,x:629551.75,notes:'Edited'};assert.equal((await request('PUT','/MH_SUB_1/001',changed)).status,409);const r=await request('PUT','/MH_SUB_1/001',{...changed,expected:row});assert.equal(r.status,200);current=r.body;assert.deepEqual(await stationStore(options).list(),[changed]);assert.equal((await request('PUT','/MH_SUB_1/001',{...row,expected:row})).status,409);});
 await t.test('lock and cross-origin protections preserve bytes',async()=>{const before=await readFile(csvPath);await writeFile(csvPath+'.lock','');assert.equal((await request('DELETE','/MH_SUB_1/001',{expected:current})).status,409);await rm(csvPath+'.lock');assert.equal((await request('POST','',row,'https://example.org')).status,403);assert.deepEqual(await readFile(csvPath),before);});
 await t.test('delete rejects stale state and leaves header only',async()=>{assert.equal((await request('DELETE','/MH_SUB_1/001',{expected:row})).status,409);assert.equal((await request('DELETE','/MH_SUB_1/001',{expected:current})).status,200);assert.equal(await readFile(csvPath,'utf8'),header);});
 await t.test('concurrent creates allow exactly one placement',async()=>{const results=await Promise.all([request('POST','',row),request('POST','',row)]);assert.deepEqual(results.map(r=>r.status).sort(),[201,409]);assert.equal((await stationStore(options).list()).length,1);});
 await t.test('malformed CSV fails closed without changing original content',async()=>{for(const text of ['wrong,header\n',header+'MH_SUB_1,001,broken\n']){await writeFile(csvPath,text);assert.equal((await request('POST','',row)).status,500);assert.equal(await readFile(csvPath,'utf8'),text);}});
});

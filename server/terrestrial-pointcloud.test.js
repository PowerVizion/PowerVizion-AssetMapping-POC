import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { terrestrialPointCloudRouter } from './terrestrial-pointcloud.js';

test('restricted Potree routes and byte-range streaming', async t => {
  const temporary = await mkdtemp(path.join(tmpdir(), 'powervizion-potree-test-'));
  const root = path.join(temporary,'root'), cloud = path.join(root,'test'), outside = path.join(temporary,'outside');
  await mkdir(cloud,{recursive:true}); await mkdir(outside);
  const configPath = path.join(temporary,'datasets.json');
  let configuredRoot = root;
  const dataset = {dataset_id:'MH_SUB_1',web_point_cloud:{directory:'test'},point_cloud_variants:[{id:'preview_1m',directory:'test'},{id:'detail_10m',directory:'detail'}]};
  await writeFile(configPath,JSON.stringify([dataset]));
  const bytes = Buffer.from(Array.from({length:256},(_,i)=>i));
  await writeFile(path.join(cloud,'metadata.json'),'{}');
  await writeFile(path.join(cloud,'octree.bin'),bytes);
  await writeFile(path.join(cloud,'hierarchy.bin'),bytes);
  await writeFile(path.join(cloud,'secret.txt'),'private');
  await writeFile(path.join(outside,'metadata.json'),'{}');
  await symlink(outside,path.join(root,'escape'),'junction');
  const app=express(); app.use('/api/terrestrial-datasets',terrestrialPointCloudRouter({configPath,getRoot:()=>configuredRoot}));
  const server=app.listen(0,'127.0.0.1'); await new Promise(resolve=>server.once('listening',resolve));
  t.after(async()=>{await new Promise(resolve=>server.close(resolve));assert.equal(path.dirname(temporary),path.resolve(tmpdir()));assert.ok(path.basename(temporary).startsWith('powervizion-potree-test-'));await rm(temporary,{recursive:true,force:true});});
  const detail = path.join(root,'detail'); await mkdir(detail);
  await writeFile(path.join(detail,'metadata.json'), JSON.stringify({points:10000000}));
  for (const name of ['hierarchy.bin','octree.bin']) await writeFile(path.join(detail,name),Buffer.from(bytes).reverse());
  const base=`http://127.0.0.1:${server.address().port}/api/terrestrial-datasets/MH_SUB_1/point-cloud/`;
  await t.test('metadata, binary files and HEAD return correct types and lengths',async()=>{
    const metadata=await fetch(base+'metadata.json');assert.equal(metadata.status,200);assert.match(metadata.headers.get('content-type'),/^application\/json/);
    for(const filename of ['hierarchy.bin','octree.bin']) {const response=await fetch(base+filename);assert.equal(response.status,200);assert.deepEqual(Buffer.from(await response.arrayBuffer()),bytes);assert.equal(response.headers.get('x-content-type-options'),'nosniff');const head=await fetch(base+filename,{method:'HEAD'});assert.equal(head.headers.get('content-length'),'256');assert.equal((await head.arrayBuffer()).byteLength,0);}
  });
  await t.test('byte ranges return exactly requested data and invalid ranges return 416',async()=>{
    for(const filename of ['hierarchy.bin','octree.bin']) {const response=await fetch(base+filename,{headers:{Range:'bytes=10-31'}});assert.equal(response.status,206);assert.equal(response.headers.get('content-range'),'bytes 10-31/256');assert.deepEqual(Buffer.from(await response.arrayBuffer()),bytes.subarray(10,32));}
    assert.equal((await fetch(base+'octree.bin',{headers:{Range:'bytes=999-1000'}})).status,416);
  });
  await t.test('unexpected files and encoded traversal are rejected',async()=>{
    for(const filename of ['secret.txt','../metadata.json','..\\metadata.json','C:\\secret.txt','octree.bin:stream','%2e%2e%2fsecret.txt']) assert.equal((await fetch(base+encodeURIComponent(filename))).status,404);
    assert.equal((await fetch(base.replace('MH_SUB_1','unknown')+'metadata.json')).status,404);
    assert.equal((await fetch(base+'octree.bin',{method:'POST'})).status,404);
  });
  await t.test('approved variants resolve independent metadata, HEAD and byte ranges',async()=>{
    const metadata=await fetch(base+'detail_10m/metadata.json');assert.equal(metadata.status,200);assert.equal((await metadata.json()).points,10000000);
    for(const variant of ['preview_1m','detail_10m']) for(const filename of ['hierarchy.bin','octree.bin']) {
      const head=await fetch(base+variant+'/'+filename,{method:'HEAD'});assert.equal(head.status,200);assert.equal(head.headers.get('content-length'),'256');
      const response=await fetch(base+variant+'/'+filename,{headers:{Range:'bytes=10-31'}});assert.equal(response.status,206);assert.equal(response.headers.get('content-range'),'bytes 10-31/256');
      assert.deepEqual(Buffer.from(await response.arrayBuffer()),(variant==='preview_1m'?bytes:Buffer.from(bytes).reverse()).subarray(10,32));
      assert.equal((await fetch(base+variant+'/'+filename,{headers:{Range:'bytes=999-1000'}})).status,416);
    }
  });
  await t.test('unknown variants, encoded traversal, and non-allowlisted variant files are denied',async()=>{
    for(const suffix of ['unknown/metadata.json','%2e%2e%2fdetail/metadata.json','detail_10m/secret.txt','detail_10m/%2e%2e%5cmetadata.json']) assert.equal((await fetch(base+suffix)).status,404);
  });
  await t.test('variant configuration cannot escape the root; missing variant file fails safely',async()=>{
    await rm(path.join(detail,'hierarchy.bin'));assert.equal((await fetch(base+'detail_10m/hierarchy.bin')).status,404);
    for(const directory of ['../outside',outside,'escape']) {
      await writeFile(configPath,JSON.stringify([{...dataset,point_cloud_variants:[{id:'detail_10m',directory}]}]));assert.equal((await fetch(base+'detail_10m/metadata.json')).status,404);
    }
    await writeFile(configPath,JSON.stringify([dataset]));
  });
  await t.test('unset root and missing files return JSON without local paths',async()=>{
    configuredRoot=undefined;const response=await fetch(base+'metadata.json');assert.equal(response.status,404);assert.equal((await response.text()).includes(root),false);configuredRoot=root;
    await rm(path.join(cloud,'hierarchy.bin'));assert.equal((await fetch(base+'hierarchy.bin')).status,404);
  });
  await t.test('directory traversal, absolute paths and junction escape rejected',async()=>{
    for(const directory of ['../outside',outside,'escape']) {await writeFile(configPath,JSON.stringify([{...dataset,web_point_cloud:{directory}}]));assert.equal((await fetch(base+'metadata.json')).status,404);}
  });
  await t.test('malformed configuration fails gracefully',async()=>{
    await writeFile(configPath,'{bad');const response=await fetch(base+'metadata.json');assert.equal(response.status,500);assert.deepEqual(await response.json(),{error:'Unable to load point-cloud configuration'});
  });
});

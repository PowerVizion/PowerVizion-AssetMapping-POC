import {allowedDevOrigin} from './dev-origin.js';
import express from 'express';
import { readFile, open, rename, unlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { parse } from 'csv-parse/sync';
import { stringify } from 'csv-stringify/sync';
import { expectedPanoramas, resolvePanoramaFile } from './terrestrial-panoramas.js';
export const columns = ['dataset_id','setup_id','panorama_file','x','y','z','placement_method','orientation_status','notes'];
const fail = (status,message) => Object.assign(new Error(message),{status});
const key = row => JSON.stringify([row.dataset_id,row.setup_id]);
const identifier = value => typeof value === 'string' && value.length > 0 && value.length <= 255 && !/[\\/:\x00]/.test(value);
export function stationStore({csvPath,configPath,getRoot}) {
  async function dataset(id, status = 400) {
    if (!identifier(id)) throw fail(status,'Invalid dataset');
    const rows = JSON.parse((await readFile(configPath,'utf8')).replace(/^\uFEFF/,''));
    const result = rows.find(row=>row.dataset_id===id);
    if (!result) throw fail(status,'Dataset does not exist');
    return result;
  }
  function valuesValid(row) {
    return identifier(row.dataset_id) && /^\d{3}$/.test(row.setup_id) && identifier(row.panorama_file) &&
      ['x','y','z'].every(axis=>typeof row[axis]==='number' && Number.isFinite(row[axis])) &&
      row.placement_method==='manual_3d' && row.orientation_status==='unknown' && typeof row.notes==='string' && row.notes.length<=2000 && !row.notes.includes('\0');
  }
  async function read() {
    const source=await readFile(csvPath,'utf8');
    const records=parse(source,{bom:true,skip_empty_lines:true});
    if(JSON.stringify(records.shift())!==JSON.stringify(columns)) throw fail(500,'Invalid station CSV header');
    const seen=new Set();
    const rows=records.map(values=>{
      const row=Object.fromEntries(columns.map((column,i)=>[column,values[i]]));
      for(const axis of ['x','y','z']) { if(!row[axis]?.trim()) throw fail(500,'Missing station coordinate'); row[axis]=Number(row[axis]); }
      if(!valuesValid(row)||seen.has(key(row))) throw fail(500,'Invalid or duplicate station record');
      seen.add(key(row));return row;
    });
    return {rows,source};
  }
  async function validate(body) {
    if(!body || typeof body!=='object' || Array.isArray(body)) throw fail(400,'Station details required');
    const row=Object.fromEntries(columns.map(column=>[column,body[column]]));
    row.placement_method ??= 'manual_3d'; row.orientation_status ??= 'unknown'; row.notes ??= '';
    if(!valuesValid(row)) throw fail(400,'Valid dataset/setup, finite numeric XYZ, manual_3d placement and unknown orientation are required');
    const config=await dataset(row.dataset_id);
    const panorama=expectedPanoramas(config).find(item=>String(item.setup_number).padStart(3,'0')===row.setup_id);
    if(!panorama || panorama.filename!==row.panorama_file) throw fail(400,'Setup and panorama must match the dataset');
    try {await resolvePanoramaFile(config,row.panorama_file,getRoot());}
    catch {throw fail(400,'The selected panorama is missing or invalid');}
    return row;
  }
  async function mutate(action) {
    // Exclusive lock coordinates this CSV across server processes. Never steal a lock.
    const lockPath = csvPath + '.lock';
    let lock;
    try { lock = await open(lockPath, 'wx'); }
    catch (error) {
      if (error.code === 'EEXIST') throw fail(409, 'Stations are being saved. Refresh and try again.');
      throw error;
    }
    const temporary = csvPath + '.' + randomUUID() + '.tmp';
    const backup = csvPath + '.' + randomUUID() + '.backup.tmp';
    try {
      const { rows, source } = await read();
      const result = await action(rows);
      const newline = source.includes('\r\n') ? '\r\n' : '\n';
      const contents = (source.startsWith('\uFEFF') ? '\uFEFF' : '') + stringify(rows, { header: true, columns, record_delimiter: newline });
      const file = await open(temporary, 'wx');
      try { await file.writeFile(contents, 'utf8'); await file.sync(); }
      finally { await file.close(); }
      // Keep the previous valid bytes for operator recovery before publishing.
      const previous = await open(backup, 'wx');
      try { await previous.writeFile(source, 'utf8'); await previous.sync(); }
      finally { await previous.close(); }
      await rename(backup, csvPath + '.bak');
      // Same-directory rename publishes a complete CSV; readers see old or new content.
      await rename(temporary, csvPath);
      return result;
    } finally {
      try {
        await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; });
        await unlink(backup).catch(error => { if (error.code !== 'ENOENT') throw error; });
      } finally {
        await lock.close();
        await unlink(lockPath);
      }
    }
  }

  function current(row,expected) {
    if(!row) throw fail(404,'Station not found');
    if(!expected || !columns.every(column=>row[column]===expected[column])) throw fail(409,'Station changed since it was loaded. Refresh before editing.');
  }
  return {
    list:async id=>{if(id!==undefined)await dataset(id,404);return (await read()).rows.filter(row=>id===undefined||row.dataset_id===id);},
    create:body=>mutate(async rows=>{const row=await validate(body);if(rows.some(item=>key(item)===key(row)))throw fail(409,'This setup already has a station. Use Edit Position.');rows.push(row);return row;}),
    update:(id,setup,body)=>mutate(async rows=>{const i=rows.findIndex(row=>row.dataset_id===id&&row.setup_id===setup);current(rows[i],body?.expected);const row=await validate(body);if(row.dataset_id!==id||row.setup_id!==setup)throw fail(400,'Cannot change dataset or setup');rows[i]=row;return row;}),
    remove:(id,setup,expected)=>mutate(rows=>{const i=rows.findIndex(row=>row.dataset_id===id&&row.setup_id===setup);current(rows[i],expected);rows.splice(i,1);return {ok:true};})
  };
}
export function terrestrialStationsRouter(options) {
  const router=express.Router(),store=stationStore(options);
  router.use((req,res,next)=>{res.set('Cache-Control','no-store');if(!['GET','HEAD','OPTIONS'].includes(req.method)){if(req.get('origin')&&!allowedDevOrigin(req.get('origin')))return res.status(403).json({error:'Origin not allowed'});if(!req.is('application/json'))return res.status(415).json({error:'JSON body required'});}next();});
  const route=fn=>async(req,res,next)=>{try{await fn(req,res);}catch(error){next(error);}};
  router.get('/',route(async(req,res)=>res.json(await store.list())));
  router.get('/:datasetId',route(async(req,res)=>res.json(await store.list(req.params.datasetId))));
  router.post('/',route(async(req,res)=>res.status(201).json(await store.create(req.body))));
  router.put('/:datasetId/:setupId',route(async(req,res)=>res.json(await store.update(req.params.datasetId,req.params.setupId,req.body))));
  router.delete('/:datasetId/:setupId',route(async(req,res)=>res.json(await store.remove(req.params.datasetId,req.params.setupId,req.body?.expected))));
  router.use((error,req,res,next)=>{if(res.headersSent)return next(error);const status=error.status||500;res.status(status).json({error:status>=500?'Unable to read or save station CSV. Check the file and retry.':error.message});});
  return router;
}

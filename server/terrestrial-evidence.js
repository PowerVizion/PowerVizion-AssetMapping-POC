import {allowedDevOrigin} from './dev-origin.js';
import express from 'express';
import { readFile, open, rename, unlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { parse } from 'csv-parse/sync';
import { stringify } from 'csv-stringify/sync';
import { expectedPanoramas, resolvePanoramaFile } from './terrestrial-panoramas.js';

export const columns = ['asset_location_id', 'dataset_id', 'setup_id', 'panorama_file', 'association_method', 'notes'];
const fail = (status, message) => Object.assign(new Error(message), { status });
const key = row => JSON.stringify([row.dataset_id, row.setup_id]);
const same = (a, b) => Boolean(a && b && columns.every(column => a[column] === b[column]));

export function evidenceStore({ csvPath, configPath, getRoot, assetExists }) {
  async function read() {
    const source = await readFile(csvPath, 'utf8');
    const records = parse(source, { bom: true, skip_empty_lines: true });
    if (JSON.stringify(records.shift()) !== JSON.stringify(columns)) throw fail(500, 'Invalid terrestrial evidence CSV header');
    const rows = records.map(values => Object.fromEntries(columns.map((column, i) => [column, values[i]])));
    const keys = new Set();
    for (const row of rows) {
      if (columns.some(column => typeof row[column] !== 'string') || !row.asset_location_id || !row.dataset_id ||
          !/^\d{3}$/.test(row.setup_id) || row.association_method !== 'manual_verified' || /[\\/:\x00]/.test(row.panorama_file) || !row.panorama_file || keys.has(key(row))) {
        throw fail(500, 'Invalid or duplicate terrestrial evidence CSV record');
      }
      keys.add(key(row));
    }
    return { rows, source };
  }
  async function validate(body) {
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw fail(400, 'Association details are required');
    const { asset_location_id, dataset_id, setup_id, panorama_file } = body;
    for (const value of [asset_location_id, dataset_id, setup_id, panorama_file]) {
      if (typeof value !== 'string' || !value || value.length > 255 || /[\\/:\x00]/.test(value)) throw fail(400, 'Invalid association identifier or filename');
    }
    if (!/^\d{3}$/.test(setup_id)) throw fail(400, 'Setup ID must use three digits, for example 001');
    const notes = body.notes ?? '';
    if (typeof notes !== 'string' || notes.length > 2000 || notes.includes('\0')) throw fail(400, 'Notes must be text of at most 2000 characters');
    if (body.association_method !== undefined && body.association_method !== 'manual_verified') throw fail(400, 'Association method must be manual_verified');
    if (!await assetExists(asset_location_id)) throw fail(400, 'Asset does not exist');
    const datasets = JSON.parse((await readFile(configPath, 'utf8')).replace(/^\uFEFF/, ''));
    if (!Array.isArray(datasets)) throw fail(500, 'Invalid dataset configuration');
    const dataset = datasets.find(item => item?.dataset_id === dataset_id);
    if (!dataset) throw fail(400, 'Dataset does not exist');
    const panorama = expectedPanoramas(dataset).find(item => String(item.setup_number).padStart(3, '0') === setup_id);
    if (!panorama || panorama.filename !== panorama_file) throw fail(400, 'Setup ID and panorama filename do not match the dataset');
    try { await resolvePanoramaFile(dataset, panorama_file, getRoot()); }
    catch (error) {
      if (error.status === 500) throw error;
      throw fail(400, 'The selected panorama is missing, unreadable, or invalid');
    }
    return { asset_location_id, dataset_id, setup_id, panorama_file, association_method: 'manual_verified', notes };
  }
  async function mutate(action) {
    // Exclusive lock coordinates this CSV across server processes. Never steal a lock.
    const lockPath = csvPath + '.lock';
    let lock;
    try { lock = await open(lockPath, 'wx'); }
    catch (error) {
      if (error.code === 'EEXIST') throw fail(409, 'Evidence is being saved. Refresh and try again.');
      throw error;
    }
    const temporary = csvPath + '.' + randomUUID() + '.tmp';
    try {
      const { rows, source } = await read();
      const result = await action(rows);
      const newline = source.includes('\r\n') ? '\r\n' : '\n';
      const contents = (source.startsWith('\uFEFF') ? '\uFEFF' : '') + stringify(rows, { header: true, columns, record_delimiter: newline });
      const file = await open(temporary, 'wx');
      try { await file.writeFile(contents, 'utf8'); await file.sync(); }
      finally { await file.close(); }
      // Same-directory rename publishes a complete CSV; readers see old or new content.
      await rename(temporary, csvPath);
      return result;
    } finally {
      try {
        await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; });
      } finally {
        await lock.close();
        await unlink(lockPath);
      }
    }
  }
  function requireCurrent(row, expected) {
    if (!row) throw fail(404, 'Association not found');
    if (!same(row, expected)) throw fail(409, 'Association changed since it was loaded. Refresh before editing.');
  }
  return {
    list: async assetId => (await read()).rows.filter(row => assetId === undefined || row.asset_location_id === assetId),
    create: body => mutate(async rows => {
      const row = await validate(body);
      if (rows.some(existing => key(existing) === key(row))) throw fail(409, 'This setup is already associated. Use Change Association.');
      rows.push(row);
      return row;
    }),
    update: (datasetId, setupId, body) => mutate(async rows => {
      const index = rows.findIndex(row => row.dataset_id === datasetId && row.setup_id === setupId);
      requireCurrent(rows[index], body?.expected);
      const row = await validate(body);
      if (row.dataset_id !== datasetId || row.setup_id !== setupId) throw fail(400, 'Cannot change the dataset or setup of an association');
      rows[index] = row;
      return row;
    }),
    remove: (datasetId, setupId, expected) => mutate(rows => {
      const index = rows.findIndex(row => row.dataset_id === datasetId && row.setup_id === setupId);
      requireCurrent(rows[index], expected);
      rows.splice(index, 1);
      return { ok: true };
    })
  };
}

export function terrestrialEvidenceRouter(options) {
  const router = express.Router();
  const store = evidenceStore(options);
  router.use((req, res, next) => {
    res.set('Cache-Control', 'no-store');
    // Same local admin UI only; do not allow cross-site form submissions to mutate CSV.
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
      if (req.get('origin') && !allowedDevOrigin(req.get('origin'))) return res.status(403).json({ error: 'Origin not allowed' });
      if (!req.is('application/json')) return res.status(415).json({ error: 'JSON body required' });
    }
    next();
  });
  const route = fn => async (req, res, next) => { try { await fn(req, res); } catch (error) { next(error); } };
  router.get('/', route(async (req, res) => res.json(await store.list())));
  router.get('/assets/:assetId', route(async (req, res) => {
    if (!await options.assetExists(req.params.assetId)) throw fail(404, 'Asset does not exist');
    res.json(await store.list(req.params.assetId));
  }));
  router.post('/', route(async (req, res) => res.status(201).json(await store.create(req.body))));
  router.put('/:datasetId/:setupId', route(async (req, res) => res.json(await store.update(req.params.datasetId, req.params.setupId, req.body))));
  router.delete('/:datasetId/:setupId', route(async (req, res) => res.json(await store.remove(req.params.datasetId, req.params.setupId, req.body?.expected))));
  router.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    const status = error.status || 500;
    res.status(status).json({ error: status >= 500 ? 'Unable to read or save terrestrial evidence. Check the CSV and retry.' : error.message });
  });
  return router;
}

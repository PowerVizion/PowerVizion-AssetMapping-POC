import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import express from 'express';
import { evidenceStore, terrestrialEvidenceRouter, columns } from './terrestrial-evidence.js';

test('CSV associations validate, persist and change without a database', async t => {
  const temporary = await mkdtemp(path.join(tmpdir(), 'powervizion-evidence-test-'));
  const csvPath = path.join(temporary, 'evidence.csv');
  const configPath = path.join(temporary, 'datasets.json');
  const root = path.join(temporary, 'images');
  await mkdir(path.join(root, 'Panoramas'), { recursive: true });
  const header = '\uFEFF' + columns.join(',') + '\r\n';
  await writeFile(csvPath, header);
  await writeFile(configPath, JSON.stringify([{ dataset_id: 'MH_SUB_1', panorama_directory: 'Panoramas', panorama_pattern: 'WINNIPEG- Setup ###.jpg', setup_count: 57 }]));
  const filename = number => `WINNIPEG- Setup ${String(number).padStart(3, '0')}.jpg`;
  for (const number of [1, 2, 57]) await writeFile(path.join(root, 'Panoramas', filename(number)), Buffer.from([0xff, 0xd8, 0xff, 0xe0]));
  const options = { csvPath, configPath, getRoot: () => root, assetExists: id => ['DEMO-STR-001', 'DEMO-STR-002'].includes(id) };
  const app = express();
  app.use(express.json());
  app.use('/api/terrestrial-evidence', terrestrialEvidenceRouter(options));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(async () => {
    await new Promise(resolve => server.close(resolve));
    assert.equal(path.dirname(temporary), path.resolve(tmpdir()));
    assert.ok(path.basename(temporary).startsWith('powervizion-evidence-test-'));
    await rm(temporary, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${server.address().port}/api/terrestrial-evidence`;
  async function request(method, suffix = '', body, origin) {
    const response = await fetch(base + suffix, { method, headers: { 'Content-Type': 'application/json', ...(origin ? { Origin: origin } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: response.status, body: await response.json() };
  }
  const row = { asset_location_id: 'DEMO-STR-001', dataset_id: 'MH_SUB_1', setup_id: '001', panorama_file: filename(1), association_method: 'manual_verified', notes: 'Pole, "north"\nSecond line' };
  let current;
  await t.test('create preserves escaped notes and CSV header, and returns manual_verified', async () => {
    const result = await request('POST', '', row);
    assert.equal(result.status, 201); assert.deepEqual(result.body, row); current = result.body;
    assert.ok((await readFile(csvPath, 'utf8')).startsWith(header));
    assert.deepEqual(await evidenceStore(options).list(), [row]);
  });
  await t.test('all and per-asset reads survive a fresh store instance', async () => {
    assert.deepEqual((await request('GET')).body, [row]);
    assert.deepEqual((await request('GET', '/assets/DEMO-STR-001')).body, [row]);
    assert.deepEqual((await request('GET', '/assets/DEMO-STR-002')).body, []);
    assert.equal((await request('GET', '/assets/unknown')).status, 404);
    assert.deepEqual(await evidenceStore(options).list('DEMO-STR-001'), [row]);
  });
  await t.test('duplicate and second asset for same setup cannot append extra records', async () => {
    const before = await readFile(csvPath);
    assert.equal((await request('POST', '', row)).status, 409);
    assert.equal((await request('POST', '', { ...row, asset_location_id: 'DEMO-STR-002' })).status, 409);
    assert.deepEqual(await readFile(csvPath), before);
  });
  await t.test('invalid asset, dataset, setup, filename, notes and method cannot write', async () => {
    const before = await readFile(csvPath);
    for (const change of [
      { asset_location_id: 'unknown' }, { dataset_id: 'unknown' }, { setup_id: '1' }, { setup_id: '058', panorama_file: filename(58) },
      { setup_id: '002' }, { panorama_file: '../secret.jpg' }, { panorama_file: '..\\secret.jpg' }, { panorama_file: 'C:\\secret.jpg' },
      { notes: {} }, { notes: 'a'.repeat(2001) }, { association_method: 'automatic' }, { setup_id: '003', panorama_file: filename(3) }
    ]) assert.equal((await request('POST', '', { ...row, ...change })).status, 400, JSON.stringify(change));
    assert.deepEqual(await readFile(csvPath), before);
  });
  await t.test('stale update rejected; atomic change moves evidence to new asset', async () => {
    const changed = { ...row, asset_location_id: 'DEMO-STR-002', notes: 'Changed' };
    assert.equal((await request('PUT', '/MH_SUB_1/001', { ...changed, expected: { ...current, notes: 'stale' } })).status, 409);
    const result = await request('PUT', '/MH_SUB_1/001', { ...changed, expected: current });
    assert.equal(result.status, 200); current = result.body;
    assert.deepEqual((await request('GET', '/assets/DEMO-STR-001')).body, []);
    assert.deepEqual((await request('GET', '/assets/DEMO-STR-002')).body, [changed]);
    assert.equal((await request('PUT', '/MH_SUB_1/001', { ...changed, asset_location_id: 'unknown', expected: current })).status, 400);
    assert.deepEqual(await evidenceStore(options).list(), [changed]);
  });
  await t.test('exclusive lock refuses simultaneous writes without damaging data', async () => {
    const before = await readFile(csvPath);
    await writeFile(csvPath + '.lock', '');
    assert.equal((await request('POST', '', { ...row, setup_id: '002', panorama_file: filename(2) })).status, 409);
    assert.deepEqual(await readFile(csvPath), before);
    await unlink(csvPath + '.lock');
  });
  await t.test('two concurrent creates cannot produce duplicate associations', async () => {
    const next = { ...row, setup_id: '002', panorama_file: filename(2) };
    const results = await Promise.all([request('POST', '', next), request('POST', '', next)]);
    assert.deepEqual(results.map(result => result.status).sort(), [201, 409]);
    assert.equal((await evidenceStore(options).list()).length, 2);
    assert.equal((await request('DELETE', '/MH_SUB_1/002', { expected: next })).status, 200);
  });
  await t.test('cross-origin mutations rejected', async () => {
    assert.equal((await request('DELETE', '/MH_SUB_1/001', { expected: current }, 'https://example.com')).status, 403);
  });
  await t.test('stale deletion rejected; deletion works even when image is missing', async () => {
    assert.equal((await request('DELETE', '/MH_SUB_1/001', { expected: row })).status, 409);
    await unlink(path.join(root, 'Panoramas', filename(1)));
    assert.equal((await request('DELETE', '/MH_SUB_1/001', { expected: current })).status, 200);
    assert.equal(await readFile(csvPath, 'utf8'), header);
    assert.equal((await request('DELETE', '/MH_SUB_1/001', { expected: current })).status, 404);
  });
  await t.test('malformed CSV and wrong header fail closed and preserve original bytes', async () => {
    for (const bad of ['bad,header\n', header + '"unfinished', header + 'a,b\r\n']) {
      await writeFile(csvPath, bad);
      assert.equal((await request('GET')).status, 500);
      assert.equal((await request('POST', '', row)).status, 500);
      assert.equal(await readFile(csvPath, 'utf8'), bad);
    }
  });
});

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { stringify } from 'csv-stringify/sync';
import { schema } from '../server/schema.js';
import { assetColumns, validateAssets } from './atco-csv.js';
import { importAssets } from './atco-assets.js';

const row = (id = '7L63-9999', changes = {}) => ({ circuit: '7L63', structure_id: id, latitude: '50', longitude: '-110',
  asset_type: 'Transmission Structure', approved_for_import: 'true', coordinate_source: 'kml', coordinate_reference: 'fixture.kml#9999', ...changes });
const csv = rows => stringify(rows, { header: true, columns: assetColumns });
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pv-atco-assets-'));
  t.after(() => { assert.equal(path.dirname(root), fs.realpathSync(os.tmpdir())); fs.rmSync(root, { recursive: true, force: true }); });
  const databasePath = path.join(root, 'fixture.sqlite'), csvPath = path.join(root, 'assets.csv');
  const db = new DatabaseSync(databasePath); db.exec(schema);
  db.exec(`INSERT INTO projects(id,name) VALUES('POC-001','Existing'),('OTHER','Unrelated');
    INSERT INTO asset_locations(id,project_id,structure_number,asset_type,latitude,longitude,review_status,notes)
    VALUES('DEMO','POC-001','7L63-9999','Pole',51,-111,'Reviewed','Keep me'),('OTHER','OTHER','OTHER-1','Pole',52,-112,'Reviewed','Keep too');
    INSERT INTO asset_media(id,asset_location_id,file_name) VALUES('MEDIA','DEMO','old.jpg');
    INSERT INTO components(id,asset_location_id,component_type) VALUES('COMP','DEMO','Pole');
    INSERT INTO review_events(id,asset_location_id,event_type) VALUES('EVENT','DEMO','Reviewed');
    INSERT INTO ai_detections(id,asset_location_id,media_id,notes) VALUES('AI','DEMO','MEDIA','Existing');
    INSERT INTO media_annotations(annotation_id,asset_location_id,media_id,center_x,center_y,radius) VALUES('ANN','DEMO','MEDIA',0.2,0.3,0.1);
    INSERT INTO data_quality_exceptions(id,asset_location_id,exception_type) VALUES('DQ','DEMO','Existing');`);
  db.close(); fs.writeFileSync(csvPath, csv([row()]));
  const options = { csvPath, databasePath };
  return { root, ...options, options, write: rows => fs.writeFileSync(csvPath, csv(rows)),
    read: sql => { const db = new DatabaseSync(databasePath, { readOnly: true }); try { return db.prepare(sql).all(); } finally { db.close(); } },
    exec: sql => { const db = new DatabaseSync(databasePath); try { db.exec(sql); } finally { db.close(); } } };
}
async function apply(f, extra = {}) {
  const plan = await importAssets(f.options);
  return importAssets({ ...f.options, apply: true, confirmPlan: plan.planToken, ...extra });
}

test('valid CSV accepts future structures and absent optional columns', () => {
  const input = stringify([row('7L63-12345')], { header: true, columns: assetColumns.slice(0, 8) });
  assert.equal(validateAssets(input).rejected, 0);
  assert.equal(validateAssets(csv([])).rejected, 0);
});
test('complete input validation rejects unsafe coordinates, identity, approval and provenance', () => {
  for (const changes of [{ circuit: '' }, { circuit: 'OTHER' }, { structure_id: '' }, { latitude: '' }, { longitude: '' },
    { latitude: 'NaN' }, { longitude: 'Infinity' }, { latitude: '91' }, { longitude: '-181' }, { latitude: '0x20' },
    { asset_type: '' }, { approved_for_import: 'false' }, { coordinate_source: 'inspection_manifest' }, { coordinate_reference: '' }]) {
    assert.equal(validateAssets(csv([row('7L63-9999', changes)])).rejected, 1, JSON.stringify(changes));
  }
  assert.equal(validateAssets(csv([row(), row()])).rejected, 1);
  assert.equal(validateAssets('circuit,circuit\n7L63,7L63').rejected, 1);
  assert.equal(validateAssets('invalid,header\n"unterminated').rejected, 1);
});
test('invalid batch fails before any writes or backup, including otherwise valid rows', async t => {
  const f = fixture(t), before = fs.readFileSync(f.databasePath);
  f.write([row(), row('7L63-222', { latitude: '' })]);
  const result = await importAssets({ ...f.options, apply: true });
  assert.equal(result.ok, false); assert.equal(result.summary.rejected, 1);
  assert.deepEqual(fs.readFileSync(f.databasePath), before);
  assert.equal(fs.existsSync(path.join(f.root, 'atco-backups')), false);
});
test('dry-run and empty template are read-only, and missing DB is never created', async t => {
  const f = fixture(t), before = fs.readFileSync(f.databasePath);
  const plan = await importAssets(f.options);
  assert.equal(plan.summary.created, 1); assert.equal(plan.createProject, true);
  assert.deepEqual(fs.readFileSync(f.databasePath), before);
  assert.equal(fs.existsSync(path.join(f.root, 'atco-backups')), false);
  f.write([]); const empty = await importAssets(f.options);
  assert.equal(empty.createProject, false); assert.equal(empty.summary.created, 0);
  await assert.rejects(importAssets({ ...f.options, apply: true, confirmPlan: empty.planToken }), /Empty staging/);
  assert.deepEqual(fs.readFileSync(f.databasePath), before);
  const missing = path.join(f.root, 'absent.sqlite');
  await assert.rejects(importAssets({ ...f.options, databasePath: missing }));
  assert.equal(fs.existsSync(missing), false);
});
test('additive insert, idempotence, safe update and omitted-asset preservation', async t => {
  const f = fixture(t), before = f.read("SELECT * FROM asset_locations WHERE project_id != 'ATCO-7L63'");
  const untouched = ['asset_media', 'components', 'review_events', 'ai_detections', 'media_annotations', 'data_quality_exceptions'];
  const snapshots = untouched.map(table => f.read(`SELECT * FROM ${table}`));
  f.write([row(), row('7L63-10000')]);
  const first = await apply(f); assert.deepEqual(first.summary, { created: 2, updated: 0, unchanged: 0, rejected: 0 });
  assert.ok(fs.existsSync(first.backupPath));
  const firstBackupBytes = fs.readFileSync(first.backupPath);
  const backupDb = new DatabaseSync(first.backupPath, { readOnly: true });
  assert.equal(backupDb.prepare("SELECT count(*) AS n FROM projects WHERE id='ATCO-7L63'").get().n, 0); backupDb.close();
  const second = await apply(f); assert.deepEqual(second.summary, { created: 0, updated: 0, unchanged: 2, rejected: 0 });
  assert.notEqual(first.backupPath, second.backupPath);
  assert.deepEqual(fs.readFileSync(first.backupPath), firstBackupBytes);
  f.exec("UPDATE asset_locations SET review_status='Human Verified',notes='Keep notes',client_asset_tag='Keep tag' WHERE id='ATCO-7L63-9999'");
  f.write([row('7L63-9999', { latitude: '51.5', asset_type: 'Tower' })]);
  assert.equal((await apply(f)).summary.updated, 1);
  const asset = f.read("SELECT * FROM asset_locations WHERE id='ATCO-7L63-9999'")[0];
  assert.equal(asset.latitude, 51.5); assert.equal(asset.asset_type, 'Tower');
  assert.equal(asset.review_status, 'Human Verified'); assert.equal(asset.notes, 'Keep notes'); assert.equal(asset.client_asset_tag, 'Keep tag');
  assert.equal(f.read("SELECT * FROM asset_locations WHERE project_id='ATCO-7L63'").length, 2);
  assert.equal(f.read("SELECT * FROM projects WHERE id='ATCO-7L63'").length, 1);
  assert.deepEqual(f.read("SELECT * FROM asset_locations WHERE project_id != 'ATCO-7L63'"), before);
  assert.deepEqual(untouched.map(table => f.read(`SELECT * FROM ${table}`)), snapshots);
});
test('apply requires a fresh plan; altered input and DB invalidate it', async t => {
  const f = fixture(t); await assert.rejects(importAssets({ ...f.options, apply: true }), /dry-run/);
  const plan = await importAssets(f.options);
  f.write([row('7L63-9999', { latitude: '52' })]);
  await assert.rejects(importAssets({ ...f.options, apply: true, confirmPlan: plan.planToken }), /dry-run/);
  f.write([row()]); f.exec("UPDATE asset_locations SET notes='Concurrent edit' WHERE id='DEMO'");
  await assert.rejects(importAssets({ ...f.options, apply: true, confirmPlan: plan.planToken }), /dry-run/);
});
test('ID collisions and ambiguous ATCO structures reject without touching unrelated rows', async t => {
  const f = fixture(t);
  f.exec("INSERT INTO asset_locations(id,project_id,structure_number) VALUES('ATCO-7L63-9999','OTHER','X')");
  const before = fs.readFileSync(f.databasePath);
  assert.equal((await importAssets(f.options)).summary.rejected, 1);
  assert.deepEqual(fs.readFileSync(f.databasePath), before);
  f.exec("INSERT INTO projects(id,name) VALUES('ATCO-7L63','ATCO'); INSERT INTO asset_locations(id,project_id,structure_number) VALUES('a','ATCO-7L63','7L63-10000'),('b','ATCO-7L63','7L63-10000')");
  f.write([row('7L63-10000')]); assert.equal((await importAssets(f.options)).summary.rejected, 1);
});
test('backup failure aborts without asset or project changes', async t => {
  const f = fixture(t), before = fs.readFileSync(f.databasePath);
  const blocker = path.join(f.root, 'not-a-directory'); fs.writeFileSync(blocker, 'keep');
  await assert.rejects(apply(f, { backupDirectory: blocker }));
  assert.deepEqual(fs.readFileSync(f.databasePath), before);
});
test('unexpected insert failure rolls back project and earlier assets; backup retained', async t => {
  const f = fixture(t);
  f.exec("CREATE TRIGGER fail_atco BEFORE INSERT ON asset_locations WHEN NEW.structure_number='7L63-10000' BEGIN SELECT RAISE(ABORT,'fixture failure'); END");
  f.write([row(), row('7L63-10000')]); const before = f.read('SELECT * FROM asset_locations');
  let error; try { await apply(f); } catch (caught) { error = caught; }
  assert.match(error.message, /fixture failure/); assert.ok(fs.existsSync(error.backupPath));
  assert.deepEqual(f.read('SELECT * FROM asset_locations'), before);
  assert.equal(f.read("SELECT * FROM projects WHERE id='ATCO-7L63'").length, 0);
});
test('backup includes committed WAL data', async t => {
  const f = fixture(t), writer = new DatabaseSync(f.databasePath);
  try {
    writer.exec("PRAGMA journal_mode=WAL; INSERT INTO review_events(id,asset_location_id,event_type) VALUES('WAL','DEMO','Keep WAL')");
    const result = await apply(f), copy = new DatabaseSync(result.backupPath, { readOnly: true });
    try { assert.equal(copy.prepare("SELECT event_type FROM review_events WHERE id='WAL'").get().event_type, 'Keep WAL'); }
    finally { copy.close(); }
  } finally { writer.close(); }
});

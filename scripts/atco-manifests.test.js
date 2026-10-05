import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { stringify } from 'csv-stringify/sync';
import { combineManifests, scanApproved, writeReport } from './atco-manifests.js';

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pv-atco-manifests-'));
  t.after(() => { assert.equal(path.dirname(root), fs.realpathSync(os.tmpdir())); fs.rmSync(root, { recursive: true, force: true }); });
  const rawRoot = path.join(root, 'raw'), approvedRoot = path.join(root, 'approved'); fs.mkdirSync(rawRoot);
  const manifestPaths = [path.join(rawRoot, 'one.csv'), path.join(rawRoot, 'two.csv')];
  const image = (base, name) => { const filename = path.join(base, name); fs.mkdirSync(path.dirname(filename), { recursive: true }); fs.writeFileSync(filename, Buffer.from([255,216,255,217])); };
  const row = (Structure, ImageFile, other = {}) => ({ Circuit: '7L63', Structure, Clip: 'CLIP001', Frame: '0010', ImageFile,
    StructureImagePath: `${Structure}/${ImageFile}`, UISRawStructure: Structure, UISInFrame: '0001', UISOutFrame: '0020', UISConfidence: '0.8',
    Latitude: '53.1', Longitude: '-110.5', Severity: 'Historical fixture', AnomalyComments: 'Comma, quote " and\nnewline', ...other });
  const write = sets => sets.forEach((rows, i) => fs.writeFileSync(manifestPaths[i], stringify(rows, { header: true })));
  return { root, rawRoot, approvedRoot, manifestPaths, image, row, write };
}
test('manifest consolidation preserves provenance, deduplicates and inventories missing/unlisted/UNASSIGNED', t => {
  const f = fixture(t), one = f.row('7L63-9999', 'one.jpg'), unassigned = f.row('UNASSIGNED', 'u.jpg');
  f.write([[one, unassigned], [one, f.row('7L63-10000', 'missing.jpg')]]);
  f.image(f.rawRoot, '7L63-9999/one.jpg'); f.image(f.rawRoot, 'UNASSIGNED/u.jpg'); f.image(f.rawRoot, '7L63-9999/extra.JPG');
  const originals = f.manifestPaths.map(p => fs.readFileSync(p));
  const result = combineManifests(f);
  assert.equal(result.records.length, 2); assert.equal(result.unassigned.length, 1);
  assert.equal(result.report.duplicates.length, 1); assert.equal(result.report.missingSourceFiles.length, 1);
  assert.equal(result.report.filesAbsentFromManifest[0].filename, 'extra.JPG'); assert.equal(result.report.unassignedFiles.length, 1);
  assert.deepEqual(result.report.assignedStructures, ['7L63-10000', '7L63-9999']);
  assert.equal(result.records[0].uis_start_frame, '0001'); assert.equal(result.records[0].frame, '0010');
  assert.equal(result.records[0].inspection_latitude, '53.1'); assert.equal(result.records[0].latitude, undefined);
  assert.equal(result.records[0].source_rows.length, 2);
  assert.equal(result.records[0].reference_anomalies.AnomalyComments, one.AnomalyComments);
  assert.deepEqual(f.manifestPaths.map(p => fs.readFileSync(p)), originals);
});
test('conflicts remain explicit and cannot become a unique QC match', t => {
  const f = fixture(t); f.write([[f.row('7L63-9999', 'same.jpg')], [f.row('7L63-9999', 'same.jpg', { Severity: 'Conflicting' })]]);
  f.image(f.rawRoot, '7L63-9999/same.jpg'); f.image(f.approvedRoot, '7L63-9999/same.jpg');
  const combined = combineManifests(f);
  assert.equal(combined.report.conflicts.length, 1); assert.equal(combined.records[0].source_rows.length, 2);
  assert.equal(scanApproved({ ...f, combined }).files[0].matched, false);
});
test('approved package absent is a normal report; matching uses structure, filename and unique provenance', t => {
  const f = fixture(t); f.write([[f.row('7L63-9999', 'same.jpg')], [f.row('7L63-10000', 'same.jpg')]]);
  const combined = combineManifests(f);
  assert.equal(scanApproved({ ...f, combined }).message, 'QC approved package not yet available.');
  for (const filename of ['7L63-9999/same.jpg', '7L63-10000/same.jpg', '7L63-9999/unknown.jpg', 'UNASSIGNED/same.jpg']) f.image(f.approvedRoot, filename);
  const report = scanApproved({ ...f, combined });
  assert.equal(report.files.filter(file => file.matched).length, 2);
  assert.equal(report.files.filter(file => file.duplicateFilename).length, 3);
  assert.equal(report.files.find(file => file.filename === 'unknown.jpg').issue, 'Missing source provenance');
  assert.equal(report.structures.find(row => row.structure === '7L63-9999').approvedJpgCount, 2);
});
test('same structure and filename with different clip/frame stays ambiguous', t => {
  const f = fixture(t); f.write([[f.row('7L63-9999', 'one.jpg')], [f.row('7L63-9999', 'one.jpg', { Clip: 'CLIP002' })]]);
  f.image(f.approvedRoot, '7L63-9999/one.jpg');
  const combined = combineManifests(f); assert.equal(combined.records.length, 2);
  assert.equal(scanApproved({ ...f, combined }).files[0].matched, false);
});
test('unsafe source paths and malformed manifests cannot silently stage records', t => {
  const f = fixture(t); f.write([[f.row('7L63-9999', 'one.jpg', { StructureImagePath: '../escape.jpg' })], [f.row('7L63-9999', '../bad.jpg')]]);
  assert.equal(combineManifests(f).report.invalidRows.length, 2);
  fs.writeFileSync(f.manifestPaths[0], 'Circuit,ImageFile\n7L63,a.jpg');
  assert.throws(() => combineManifests(f), /Missing CSV columns/);
});
test('reports cannot overwrite inputs, outputs, or write within source/QC roots', t => {
  const f = fixture(t); fs.mkdirSync(f.approvedRoot);
  for (const root of [f.rawRoot, f.approvedRoot]) assert.throws(() => writeReport(path.join(root, 'new.json'), {}, [f.rawRoot, f.approvedRoot]), /outside/);
  const report = path.join(f.root, 'report.json'); writeReport(report, { ok: true }, [f.rawRoot, f.approvedRoot]);
  assert.throws(() => writeReport(report, { changed: true }, [f.rawRoot, f.approvedRoot]), /EEXIST/);
  assert.equal(JSON.parse(fs.readFileSync(report)).ok, true);
});
test('junctions cannot escape source inventory or redirect report writes into a source root', t => {
  const f = fixture(t), outside = path.join(f.root, 'outside'); fs.mkdirSync(outside);
  f.image(outside, 'escape.jpg');
  fs.symlinkSync(outside, path.join(f.rawRoot, '7L63-9999'), 'junction');
  f.write([[f.row('7L63-9999', 'escape.jpg', { StructureImagePath: 'linked/escape.jpg' })], [f.row('7L63-10000', 'safe.jpg')]]);
  const combined = combineManifests(f);
  assert.equal(combined.report.invalidRows.length, 1);
  assert.deepEqual(combined.report.skippedLinks, ['7L63-9999']);
  assert.equal(combined.report.jpgCount, 0);
  const redirect = path.join(f.root, 'redirect'); fs.symlinkSync(f.rawRoot, redirect, 'junction');
  assert.throws(() => writeReport(path.join(redirect, 'report.json'), {}, [f.rawRoot, f.approvedRoot]), /outside/);
  assert.equal(fs.existsSync(path.join(f.rawRoot, 'report.json')), false);
});

test('relocated package accepts historical paths on another drive and retains provenance', t => {
  const f = fixture(t);
  const originals = ['Z:\\original machine\\7L63\\7L63-9999\\one.jpg', 'D:\\ATCO_POC_STRUCTURE_EXPORTS\\7L63\\UNASSIGNED\\u.jpg'];
  f.write([[f.row('7L63-9999', 'one.jpg', { StructureImagePath: originals[0] })], [f.row('UNASSIGNED', 'u.jpg', { StructureImagePath: originals[1] })]]);
  f.image(f.rawRoot, '7L63-9999/one.jpg'); f.image(f.rawRoot, 'UNASSIGNED/u.jpg'); f.image(f.rawRoot, '7L63-9999/unlisted.jpg');
  const bytes = f.manifestPaths.map(p => fs.readFileSync(p));
  // Copy the package to a new parent, leaving the original package untouched.
  const moved = path.join(f.root, 'different parent', '7L63'); fs.cpSync(f.rawRoot, moved, { recursive: true });
  const result = combineManifests({ rawRoot: moved, manifestPaths: f.manifestPaths.map(p => path.join(moved, path.basename(p))) });
  assert.equal(result.report.invalidRows.length, 0); assert.equal(result.report.missingSourceFiles.length, 0);
  assert.equal(result.report.relocatedPathCount, 2); assert.equal(result.report.validNormalizedRecords, 2);
  assert.equal(result.records.length, 1); assert.equal(result.unassigned.length, 1);
  const record = result.records[0];
  assert.equal(record.original_structure_image_path, originals[0]); assert.equal(record.source_rows[0].values.StructureImagePath, originals[0]);
  assert.equal(record.current_resolved_path, fs.realpathSync(path.join(moved, '7L63-9999', 'one.jpg')));
  assert.equal(record.source_path, '7L63-9999/one.jpg'); assert.equal(record.current_file_exists, true);
  assert.equal(result.unassigned[0].original_structure_image_path, originals[1]);
  assert.equal(result.report.unassignedFiles.length, 1);
  assert.equal(result.report.filesAbsentFromManifest[0].filename, 'unlisted.jpg');
  assert.deepEqual(f.manifestPaths.map(p => fs.readFileSync(p)), bytes);
});
test('unsafe filenames and structures reject regardless of historical paths; invalid rows do not hide disk files', t => {
  const f = fixture(t);
  const filenames = ['../one.jpg', '..\\one.jpg', 'C:\\one.jpg', 'C:one.jpg', '\\\\server\\share\\one.jpg', '/one.jpg'];
  const rows = filenames.map(name => f.row('7L63-9999', name));
  rows.push(f.row('../7L63-9999', 'one.jpg'), f.row('..\\7L63-9999', 'one.jpg'));
  rows.push(f.row('7L63-9999', 'one.jpg', { StructureImagePath: 'Z:\\old\\different.jpg' }));
  f.write([rows, [f.row('7L63-10000', 'missing.jpg', { StructureImagePath: 'Z:\\old\\missing.jpg' })]]);
  f.image(f.rawRoot, '7L63-9999/one.jpg');
  const result = combineManifests(f);
  assert.equal(result.report.invalidRows.length, rows.length);
  assert.equal(result.report.missingSourceFiles.length, 1);
  assert.equal(result.records[0].current_file_exists, false);
  assert.equal(result.report.filesAbsentFromManifest[0].filename, 'one.jpg');
});
test('current paths are not marked relocated and Windows filename case remains supported', t => {
  const f = fixture(t); f.image(f.rawRoot, '7L63-9999/one.jpg');
  f.write([[f.row('7L63-9999', 'one.jpg', { StructureImagePath: path.join(f.rawRoot, '7L63-9999', 'one.jpg') })], [f.row('7L63-10000', 'missing.jpg')]]);
  const result = combineManifests(f); assert.equal(result.report.relocatedPathCount, 0);
  if (process.platform === 'win32') {
    f.write([[f.row('7L63-9999', 'ONE.JPG', { StructureImagePath: 'Z:\\old\\one.jpg' })], [f.row('7L63-10000', 'missing.jpg')]]);
    const folded = combineManifests(f); assert.equal(folded.report.invalidRows.length, 0); assert.equal(folded.records[0].current_file_exists, true);
  }
});

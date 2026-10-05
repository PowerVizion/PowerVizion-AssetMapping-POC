import fs from 'node:fs';
import path from 'node:path';
import { readCsv } from './atco-csv.js';

const fold = value => value.toLowerCase();
const jpg = value => /\.jpg$/i.test(value);
const required = ['Circuit', 'Structure', 'Clip', 'Frame', 'ImageFile'];
const anomalyFields = ['ComprehensiveAnomalyCount', 'AnomalyIDs', 'Severity', 'Component', 'Problem', 'Cause', 'Remedy', 'RecommendedPriority', 'AnomalyComments'];
export function isWithin(root, filename) {
  const relative = path.relative(root, filename);
  return relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}
function inventory(root) {
  if (!fs.existsSync(root)) return { available: false, files: [], skipped: [] };
  root = fs.realpathSync(root);
  const files = [], skipped = [];
  function visit(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const filename = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) { skipped.push(path.relative(root, filename)); continue; }
      if (!isWithin(root, fs.realpathSync(filename))) { skipped.push(path.relative(root, filename)); continue; }
      if (entry.isDirectory()) visit(filename);
      else if (entry.isFile() && jpg(entry.name)) files.push({ path: path.relative(root, filename).split(path.sep).join('/'), filename: entry.name });
    }
  }
  visit(root);
  return { available: true, files, skipped };
}
function sourceFile(root, row) {
  const filename = row.ImageFile;
  if (!filename || /[\\/:\x00]/.test(filename) || !jpg(filename) || /[<>"|?*]/.test(filename)) throw Error('Invalid JPG filename');
  if (row.Structure !== 'UNASSIGNED' && !/^7L63-[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*$/.test(row.Structure)) throw Error('Invalid source structure');
  // Historical paths never select the physical file. Only validated child names do.
  const original = row.StructureImagePath || '';
  if (original && fold(path.win32.basename(original)) !== fold(filename)) throw Error('Original source filename disagrees with ImageFile');
  const folder = path.join(root, row.Structure);
  const target = path.join(folder, filename);
  if (!isWithin(root, target)) throw Error('Source path escapes package');
  if (fs.existsSync(folder) && (!fs.statSync(folder).isDirectory() || !isWithin(root, fs.realpathSync(folder)) || path.dirname(fs.realpathSync(folder)) !== root)) throw Error('Structure must resolve to a child folder inside raw root');
  const exists = fs.existsSync(target);
  const physical = exists ? fs.realpathSync(target) : target;
  if (exists && (!isWithin(root, physical) || !fs.statSync(physical).isFile() || fold(path.basename(physical)) !== fold(filename))) throw Error('Source path is not a contained matching regular file');
  const oldPath = original && (path.win32.isAbsolute(original) || path.isAbsolute(original)) ? original : path.resolve(root, original);
  const relocated = Boolean(original) && fold(path.win32.normalize(oldPath)) !== fold(path.win32.normalize(target));
  return { target: physical, exists, relocated };
}

export function combineManifests({ rawRoot, manifestPaths }) {
  rawRoot = fs.realpathSync(rawRoot);
  const byIdentity = new Map(), duplicates = [], conflicts = [], missingSourceFiles = [], invalidRows = [];
  const referenced = new Set();
  let relocatedPathCount = 0;
  for (const manifestPath of manifestPaths) {
    const records = readCsv(fs.readFileSync(manifestPath, 'utf8'), required);
    records.forEach((row, index) => {
      const provenance = { manifest: path.resolve(manifestPath), row: index + 2 };
      try {
        if (row.Circuit !== '7L63' || !row.Clip || !row.Frame) throw Error('Circuit 7L63, clip and frame are required');
        const { target, exists, relocated } = sourceFile(rawRoot, row);
        if (relocated) relocatedPathCount++;
        const relative = path.relative(rawRoot, target).split(path.sep).join('/');
        referenced.add(fold(relative));
        const identity = JSON.stringify([row.Circuit, row.Structure, row.Clip, row.Frame, fold(row.ImageFile)]);
        const record = { source_identity: identity, circuit: row.Circuit, structure_id: row.Structure,
          clip: row.Clip, frame: row.Frame, image_file: row.ImageFile, source_path: relative,
          original_structure_image_path: row.StructureImagePath || '', current_resolved_path: target,
          source_path_relocated: relocated, current_file_exists: exists,
          uis_raw_structure: row.UISRawStructure || '', uis_start_frame: row.UISInFrame || '',
          uis_end_frame: row.UISOutFrame || '', uis_confidence: row.UISConfidence || '',
          inspection_latitude: row.Latitude || '', inspection_longitude: row.Longitude || '',
          reference_anomalies: Object.fromEntries(anomalyFields.map(key => [key, row[key] || ''])),
          source_rows: [{ ...provenance, values: row }], conflicted: false };
        if (!exists) missingSourceFiles.push({ source_identity: identity, source_path: relative, ...provenance });
        const previous = byIdentity.get(identity);
        if (!previous) byIdentity.set(identity, record);
        else {
          const original = previous.source_rows[0].values;
          const differingFields = [...new Set([...Object.keys(original), ...Object.keys(row)])].filter(key => (original[key] || '') !== (row[key] || ''));
          previous.source_rows.push({ ...provenance, values: row });
          if (differingFields.length) {
            previous.conflicted = true;
            conflicts.push({ source_identity: identity, differingFields, sources: previous.source_rows.map(({ values, ...source }) => source) });
          } else duplicates.push({ source_identity: identity, ...provenance });
        }
      } catch (error) { invalidRows.push({ ...provenance, error: error.message, values: row }); }
    });
  }
  const disk = inventory(rawRoot), records = [...byIdentity.values()];
  const unassigned = records.filter(row => row.structure_id === 'UNASSIGNED');
  return { format_version: 1, raw_root: rawRoot, records: records.filter(row => row.structure_id !== 'UNASSIGNED'), unassigned,
    report: { manifestRows: records.reduce((count, row) => count + row.source_rows.length, 0) + invalidRows.length,
      assignedStructures: [...new Set(records.filter(row => row.structure_id !== 'UNASSIGNED').map(row => row.structure_id))].sort(),
      validNormalizedRecords: records.length, relocatedPathCount,
      jpgCount: disk.files.length, duplicates, conflicts, invalidRows, missingSourceFiles,
      filesAbsentFromManifest: disk.files.filter(file => !referenced.has(fold(file.path))),
      unassignedFiles: disk.files.filter(file => file.path.split('/')[0] === 'UNASSIGNED'), skippedLinks: disk.skipped } };
}

export function scanApproved({ approvedRoot, combined }) {
  const disk = inventory(approvedRoot);
  if (!disk.available) return { available: false, message: 'QC approved package not yet available.', structures: [], files: [] };
  const names = new Map();
  for (const file of disk.files) names.set(fold(file.filename), (names.get(fold(file.filename)) || 0) + 1);
  const files = disk.files.map(file => {
    const parts = file.path.split('/'), structure = parts[0];
    const matches = combined.records.filter(row => row.structure_id === structure && fold(row.image_file) === fold(file.filename));
    const eligibleLayout = parts.length === 2 && /^7L63-[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*$/.test(structure);
    const matched = eligibleLayout && matches.length === 1 && !matches[0].conflicted;
    return { ...file, structure, matched, source_identity: matched ? matches[0].source_identity : null,
      duplicateFilename: names.get(fold(file.filename)) > 1,
      issue: matched ? null : !eligibleLayout ? 'Invalid structure/folder layout' : !matches.length ? 'Missing source provenance' : 'Ambiguous or conflicting source provenance' };
  });
  return { available: true, message: 'Read-only QC inventory; no media imported or approved automatically.', files,
    structures: [...new Set(files.map(file => file.structure))].sort().map(structure => {
      const group = files.filter(file => file.structure === structure);
      return { structure, approvedJpgCount: group.length, matchingOriginalManifest: group.filter(file => file.matched).length,
        notMatchingOriginalManifest: group.filter(file => !file.matched).length,
        duplicateFilenames: group.filter(file => file.duplicateFilename).map(file => file.filename),
        missingSourceProvenance: group.filter(file => !file.matched).map(file => ({ filename: file.filename, issue: file.issue })) };
    }), skippedLinks: disk.skipped };
}

export function writeReport(output, value, protectedRoots) {
  // Existing parent must resolve outside every input package. Never overwrite.
  const target = path.join(fs.realpathSync(path.dirname(path.resolve(output))), path.basename(output));
  for (const root of protectedRoots) {
    const resolved = fs.existsSync(root) ? fs.realpathSync(root) : path.resolve(root);
    if (isWithin(resolved, target)) throw Error('Report output must be outside source and QC packages');
  }
  fs.writeFileSync(target, JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
}

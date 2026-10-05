import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { DatabaseSync, backup } from 'node:sqlite';
import { validateAssets } from './atco-csv.js';

export const projectId = 'ATCO-7L63';
const hash = value => createHash('sha256').update(value).digest('hex');
const counts = () => ({ created: 0, updated: 0, unchanged: 0, rejected: 0 });

function planImport(db, assets, text, databasePath) {
  const projects = db.prepare('SELECT * FROM projects ORDER BY id').all();
  const existing = db.prepare('SELECT * FROM asset_locations ORDER BY id').all();
  const changes = [], errors = [], summary = counts();
  for (const asset of assets) {
    const id = `ATCO-${asset.structure_id}`;
    const matches = existing.filter(row => row.project_id === projectId && row.structure_number?.toUpperCase() === asset.structure_id.toUpperCase());
    const collision = existing.find(row => row.id === id);
    if (matches.length > 1 || (collision && (collision.project_id !== projectId || collision.structure_number !== asset.structure_id))) {
      errors.push({ structure_id: asset.structure_id, error: 'Ambiguous identity or ID collision; no records will be written' });
      summary.rejected++;
      continue;
    }
    const current = matches[0];
    const action = !current ? 'created' : ['asset_type', 'latitude', 'longitude'].some(key => current[key] !== asset[key]) ? 'updated' : 'unchanged';
    summary[action]++;
    changes.push({ action, id: current?.id || id, asset });
  }
  const token = hash(JSON.stringify({ version: 1, databasePath, input: hash(text), projects, existing }));
  return { summary, errors, changes, token, createProject: assets.length > 0 && !projects.some(row => row.id === projectId) };
}

async function createBackup(databasePath, backupDirectory) {
  // An exclusive, timestamped directory prevents overwriting an older backup.
  fs.mkdirSync(backupDirectory, { recursive: true });
  const folder = path.join(backupDirectory, `${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID()}`);
  fs.mkdirSync(folder);
  const destination = path.join(folder, 'poc.sqlite');
  const source = new DatabaseSync(databasePath, { readOnly: true });
  try { await backup(source, destination); } finally { source.close(); }
  const check = new DatabaseSync(destination, { readOnly: true });
  try {
    if (check.prepare('PRAGMA integrity_check').get().integrity_check !== 'ok') throw Error('Backup integrity check failed');
  } finally { check.close(); }
  return destination;
}

export async function importAssets({ csvPath, databasePath, apply = false, confirmPlan, backupDirectory, onBackup = () => {} }) {
  const text = fs.readFileSync(csvPath, 'utf8');
  const validation = validateAssets(text);
  if (validation.errors.length) return { ok: false, dryRun: !apply, summary: { ...counts(), rejected: validation.rejected }, errors: validation.errors };
  // Never create a missing DB, execute schema migrations, or import server/db.js.
  databasePath = fs.realpathSync(databasePath);
  const db = new DatabaseSync(databasePath, { readOnly: !apply });
  let transaction = false, backupPath;
  try {
    db.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000');
    db.exec(apply ? 'BEGIN IMMEDIATE' : 'BEGIN'); transaction = true;
    const plan = planImport(db, validation.assets, text, databasePath);
    const result = { ok: !plan.errors.length, dryRun: !apply, project: projectId, createProject: plan.createProject,
      summary: plan.summary, errors: plan.errors, planToken: plan.token,
      changes: plan.changes.map(({ action, id, asset }) => ({ action, id, structure_id: asset.structure_id, latitude: asset.latitude, longitude: asset.longitude, asset_type: asset.asset_type })) };
    if (plan.errors.length || !apply) { db.exec('ROLLBACK'); transaction = false; return result; }
    if (confirmPlan !== plan.token) throw Error('Run --dry-run and pass its current planToken using --confirm-plan. Input or database may have changed.');
    if (!validation.assets.length) throw Error('Empty staging template: nothing approved for import');
    // Hold the write reservation while backing up via a separate read connection.
    // SQLite backup includes committed WAL pages, unlike copying only the DB file.
    backupPath = await createBackup(databasePath, backupDirectory || path.join(path.dirname(databasePath), 'atco-backups'));
    onBackup(backupPath);
    if (plan.createProject) db.prepare('INSERT INTO projects (id, name, description) VALUES (?, ?, ?)').run(projectId, 'ATCO 7L63', 'ATCO 7L63 Asset Mapping POC');
    const insert = db.prepare('INSERT INTO asset_locations (id, project_id, structure_number, asset_type, latitude, longitude) VALUES (?, ?, ?, ?, ?, ?)');
    const update = db.prepare('UPDATE asset_locations SET asset_type = ?, latitude = ?, longitude = ? WHERE id = ? AND project_id = ?');
    for (const { action, id, asset } of plan.changes) {
      if (action === 'created') insert.run(id, projectId, asset.structure_id, asset.asset_type, asset.latitude, asset.longitude);
      if (action === 'updated') update.run(asset.asset_type, asset.latitude, asset.longitude, id, projectId);
    }
    db.exec('COMMIT'); transaction = false;
    return { ...result, backupPath };
  } catch (error) {
    if (transaction) { db.exec('ROLLBACK'); transaction = false; }
    error.backupPath = backupPath;
    throw error;
  } finally { if (transaction) db.exec('ROLLBACK'); db.close(); }
}

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

const ROOT = process.cwd();
const DB_PATH = path.join(ROOT, 'data', 'poc.sqlite');
const MANIFEST_PATH = path.join(ROOT, 'data', 'atco', '7L63', 'media_manifest.csv');
const BACKUP_ROOT = path.join(ROOT, 'data', 'atco-backups');

function parseArgs() {
  const args = process.argv.slice(2);
  const out = {
    dryRun: args.includes('--dry-run'),
    apply: args.includes('--apply'),
    structure: null,
    confirmPlan: null,
  };

  const s = args.indexOf('--structure');
  if (s >= 0) out.structure = args[s + 1];

  const c = args.indexOf('--confirm-plan');
  if (c >= 0) out.confirmPlan = args[c + 1];

  if (out.dryRun === out.apply) {
    throw new Error('Use exactly one of --dry-run or --apply');
  }

  return out;
}

function parseCsv(text) {
  text = text.replace(/^\uFEFF/, '');

  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];

    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') {
        quoted = false;
      } else {
        field += ch;
      }
    } else {
      if (ch === '"') {
        quoted = true;
      } else if (ch === ',') {
        row.push(field);
        field = '';
      } else if (ch === '\n') {
        row.push(field.replace(/\r$/, ''));
        rows.push(row);
        row = [];
        field = '';
      } else {
        field += ch;
      }
    }
  }

  if (field.length || row.length) {
    row.push(field.replace(/\r$/, ''));
    rows.push(row);
  }

  const headers = rows.shift();
  return rows
    .filter(r => r.some(v => v !== ''))
    .map(r => Object.fromEntries(headers.map((h, i) => [h, r[i] ?? ''])));
}

function mediaRecord(row) {
  return {
    id: row.future_media_id,
    asset_location_id: `ATCO-${row.structure_id}`,
    file_name: row.image_file,
    s3_key: row.future_s3_key,
    local_path: '',
    capture_method: '8K Frame Export',
    caption: `${row.structure_id} aerial inspection | ${row.inspection_date} | ${row.clip} | frame ${row.frame}`,
    frame_number: String(row.frame),
    timecode: '',
    approved: 1,
  };
}

function sameMedia(a, b) {
  return (
    a.asset_location_id === b.asset_location_id &&
    a.file_name === b.file_name &&
    (a.s3_key ?? '') === b.s3_key &&
    (a.capture_method ?? '') === b.capture_method &&
    (a.caption ?? '') === b.caption &&
    String(a.frame_number ?? '') === String(b.frame_number ?? '') &&
    (a.timecode ?? '') === b.timecode &&
    Number(a.approved) === Number(b.approved)
  );
}

function makeBackup() {
  fs.mkdirSync(BACKUP_ROOT, { recursive: true });

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const dir = path.join(BACKUP_ROOT, `${stamp}-7L63-media`);

  fs.mkdirSync(dir, { recursive: false });

  fs.copyFileSync(DB_PATH, path.join(dir, 'poc.sqlite'));

  for (const suffix of ['-wal', '-shm']) {
    const source = `${DB_PATH}${suffix}`;
    if (fs.existsSync(source)) {
      fs.copyFileSync(source, path.join(dir, `poc.sqlite${suffix}`));
    }
  }

  return path.join(dir, 'poc.sqlite');
}

const args = parseArgs();

const csvText = fs.readFileSync(MANIFEST_PATH, 'utf8');
let rows = parseCsv(csvText);

rows = rows.filter(r =>
  String(r.approved_for_demo).toLowerCase() === 'true'
);

if (args.structure) {
  rows = rows.filter(r => r.structure_id === args.structure);
}

rows.sort((a, b) =>
  a.structure_id.localeCompare(b.structure_id) ||
  Number(a.frame) - Number(b.frame)
);

const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA foreign_keys = ON');

const getAsset = db.prepare(`
  SELECT id
  FROM asset_locations
  WHERE id = ?
`);

const getMediaById = db.prepare(`
  SELECT *
  FROM asset_media
  WHERE id = ?
`);

const getMediaByKey = db.prepare(`
  SELECT id
  FROM asset_media
  WHERE s3_key = ?
`);

const creates = [];
const unchanged = [];
const rejected = [];

for (const row of rows) {
  const desired = mediaRecord(row);

  if (!row.structure_id || !row.image_file || !row.future_s3_key || !row.future_media_id) {
    rejected.push({
      id: desired.id,
      reason: 'Required media manifest field missing'
    });
    continue;
  }

  const asset = getAsset.get(desired.asset_location_id);

  if (!asset) {
    rejected.push({
      id: desired.id,
      reason: `Missing asset ${desired.asset_location_id}`
    });
    continue;
  }

  const existing = getMediaById.get(desired.id);

  if (existing) {
    if (sameMedia(existing, desired)) {
      unchanged.push(desired);
    } else {
      rejected.push({
        id: desired.id,
        reason: 'Existing media ID has different values'
      });
    }
    continue;
  }

  const keyCollision = getMediaByKey.get(desired.s3_key);

  if (keyCollision) {
    rejected.push({
      id: desired.id,
      reason: `S3 key already belongs to ${keyCollision.id}`
    });
    continue;
  }

  creates.push(desired);
}

const planBody = {
  structure: args.structure ?? 'ALL',
  creates: creates.map(x => ({
    id: x.id,
    asset_location_id: x.asset_location_id,
    s3_key: x.s3_key,
    frame_number: x.frame_number
  })),
  unchanged: unchanged.map(x => x.id),
  rejected
};

const planToken = crypto
  .createHash('sha256')
  .update(JSON.stringify(planBody))
  .digest('hex');

const summary = {
  selected: rows.length,
  created: creates.length,
  unchanged: unchanged.length,
  rejected: rejected.length
};

if (args.dryRun) {
  console.log(JSON.stringify({
    ok: rejected.length === 0,
    dryRun: true,
    structure: args.structure ?? 'ALL',
    summary,
    errors: rejected,
    planToken,
    changes: creates.map(x => ({
      action: 'created',
      id: x.id,
      asset_location_id: x.asset_location_id,
      frame_number: x.frame_number,
      s3_key: x.s3_key
    }))
  }, null, 2));

  db.close();
  process.exit(rejected.length ? 1 : 0);
}

if (!args.confirmPlan || args.confirmPlan !== planToken) {
  db.close();
  throw new Error(
    `Plan token mismatch. Run a fresh --dry-run and use its planToken. Expected: ${planToken}`
  );
}

if (rejected.length) {
  db.close();
  throw new Error('Apply refused because rejected rows exist.');
}

const backupPath = makeBackup();

const insert = db.prepare(`
  INSERT INTO asset_media (
    id,
    asset_location_id,
    file_name,
    s3_key,
    local_path,
    capture_method,
    caption,
    frame_number,
    timecode,
    approved
  )
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

try {
  db.exec('BEGIN IMMEDIATE');

  for (const x of creates) {
    insert.run(
      x.id,
      x.asset_location_id,
      x.file_name,
      x.s3_key,
      x.local_path,
      x.capture_method,
      x.caption,
      x.frame_number,
      x.timecode,
      x.approved
    );
  }

  db.exec('COMMIT');
} catch (err) {
  try { db.exec('ROLLBACK'); } catch {}
  db.close();
  throw err;
}

console.log(JSON.stringify({
  ok: true,
  dryRun: false,
  structure: args.structure ?? 'ALL',
  summary,
  planToken,
  backupPath
}, null, 2));

db.close();

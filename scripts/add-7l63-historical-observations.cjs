const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { DatabaseSync } = require('node:sqlite');
const { parse } = require('csv-parse/sync');

const ROOT = path.resolve('.');
const DB_PATH = path.join(ROOT, 'data', 'poc.sqlite');
const CSV_PATH = path.join(ROOT, 'data', 'atco', '7L63', 'historical_observations.csv');
const BACKUP_ROOT = path.join(ROOT, 'data', 'atco-backups');

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const apply = args.includes('--apply');

const confirmIndex = args.indexOf('--confirm-plan');
const confirmPlan = confirmIndex >= 0 ? args[confirmIndex + 1] : null;

if ((!dryRun && !apply) || (dryRun && apply)) {
  console.error('Use exactly one of: --dry-run OR --apply');
  process.exit(1);
}

function normalize(value) {
  return value == null ? '' : String(value).trim();
}

function tableExists(db, name) {
  return Boolean(
    db.prepare(`
      SELECT name
      FROM sqlite_master
      WHERE type = 'table' AND name = ?
    `).get(name)
  );
}

function desiredRecord(row) {
  return {
    id: normalize(row.historical_anomaly_id),
    asset_location_id: `ATCO-${normalize(row.structure_id)}`,
    observation_date: normalize(row.inspection_date),
    record_type: 'Historical Observation',
    severity: normalize(row.severity),
    physical_category: normalize(row.physical_category),
    description: normalize(row.description),
    failure_class: normalize(row.failure_class),
    component: normalize(row.component),
    problem: normalize(row.problem),
    cause: normalize(row.cause),
    remedy: normalize(row.remedy),
    default_priority: normalize(row.default_priority),
    recommended_priority: normalize(row.recommended_priority),
    fire_ignition_flag: normalize(row.fire_ignition_flag),
    status: 'Historical',
    source: normalize(row.source)
  };
}

function sameObservation(a, b) {
  const fields = [
    'asset_location_id',
    'observation_date',
    'record_type',
    'severity',
    'physical_category',
    'description',
    'failure_class',
    'component',
    'problem',
    'cause',
    'remedy',
    'default_priority',
    'recommended_priority',
    'fire_ignition_flag',
    'status',
    'source'
  ];

  return fields.every(field =>
    normalize(a[field]) === normalize(b[field])
  );
}

const csvText = fs.readFileSync(CSV_PATH, 'utf8');

const rows = parse(csvText, {
  columns: true,
  skip_empty_lines: true,
  bom: true
});

const records = rows.map(desiredRecord);

const db = new DatabaseSync(DB_PATH, { readOnly: dryRun });

const observationsExist = tableExists(db, 'asset_observations');

const getAsset = db.prepare(`
  SELECT id
  FROM asset_locations
  WHERE id = ?
`);

const getObservation = observationsExist
  ? db.prepare(`
      SELECT *
      FROM asset_observations
      WHERE id = ?
    `)
  : null;

const errors = [];
const changes = [];
let unchanged = 0;

const seenIds = new Set();

for (const record of records) {
  if (!record.id) {
    errors.push({
      structure: record.asset_location_id,
      reason: 'Missing historical_anomaly_id'
    });
    continue;
  }

  if (seenIds.has(record.id)) {
    errors.push({
      id: record.id,
      reason: 'Duplicate historical anomaly ID in CSV'
    });
    continue;
  }

  seenIds.add(record.id);

  if (!getAsset.get(record.asset_location_id)) {
    errors.push({
      id: record.id,
      reason: `Asset does not exist: ${record.asset_location_id}`
    });
    continue;
  }

  const existing = getObservation
    ? getObservation.get(record.id)
    : null;

  if (!existing) {
    changes.push({
      action: 'created',
      ...record
    });
    continue;
  }

  if (sameObservation(existing, record)) {
    unchanged++;
    continue;
  }

  errors.push({
    id: record.id,
    reason: 'Existing historical observation has different values'
  });
}

const summary = {
  selected: records.length,
  created: changes.length,
  unchanged,
  rejected: errors.length
};

const planPayload = JSON.stringify({
  records,
  summary,
  changes,
  errors
});

const planToken = crypto
  .createHash('sha256')
  .update(planPayload)
  .digest('hex');

if (dryRun) {
  console.log(JSON.stringify({
    ok: errors.length === 0,
    dryRun: true,
    summary,
    errors,
    planToken,
    changes
  }, null, 2));

  db.close();
  process.exit(errors.length ? 1 : 0);
}

if (errors.length) {
  console.error(JSON.stringify({
    ok: false,
    dryRun: false,
    summary,
    errors
  }, null, 2));

  db.close();
  process.exit(1);
}

if (!confirmPlan || confirmPlan !== planToken) {
  console.error(JSON.stringify({
    ok: false,
    reason: 'Plan token does not match. Run --dry-run again.',
    expectedPlanToken: planToken
  }, null, 2));

  db.close();
  process.exit(1);
}

db.close();

/* Backup before mutation */
const timestamp = new Date()
  .toISOString()
  .replace(/[:.]/g, '-');

const backupDir = path.join(
  BACKUP_ROOT,
  `${timestamp}-7L63-historical`
);

fs.mkdirSync(backupDir, { recursive: true });

fs.copyFileSync(
  DB_PATH,
  path.join(backupDir, 'poc.sqlite')
);

for (const suffix of ['-wal', '-shm']) {
  const source = `${DB_PATH}${suffix}`;

  if (fs.existsSync(source)) {
    fs.copyFileSync(
      source,
      path.join(backupDir, `poc.sqlite${suffix}`)
    );
  }
}

/* Apply */
const writeDb = new DatabaseSync(DB_PATH);

writeDb.exec('BEGIN IMMEDIATE');

try {
  writeDb.exec(`
    CREATE TABLE IF NOT EXISTS asset_observations (
      id TEXT PRIMARY KEY,
      asset_location_id TEXT NOT NULL,
      observation_date TEXT NOT NULL,
      record_type TEXT NOT NULL,
      severity TEXT,
      physical_category TEXT,
      description TEXT,
      failure_class TEXT,
      component TEXT,
      problem TEXT,
      cause TEXT,
      remedy TEXT,
      default_priority TEXT,
      recommended_priority TEXT,
      fire_ignition_flag TEXT,
      status TEXT NOT NULL,
      source TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (asset_location_id)
        REFERENCES asset_locations(id)
    )
  `);

  const insert = writeDb.prepare(`
    INSERT INTO asset_observations (
      id,
      asset_location_id,
      observation_date,
      record_type,
      severity,
      physical_category,
      description,
      failure_class,
      component,
      problem,
      cause,
      remedy,
      default_priority,
      recommended_priority,
      fire_ignition_flag,
      status,
      source
    ) VALUES (
      @id,
      @asset_location_id,
      @observation_date,
      @record_type,
      @severity,
      @physical_category,
      @description,
      @failure_class,
      @component,
      @problem,
      @cause,
      @remedy,
      @default_priority,
      @recommended_priority,
      @fire_ignition_flag,
      @status,
      @source
    )
  `);

  for (const change of changes) {
    const { action, ...record } = change;
    insert.run(record);
  }

  writeDb.exec('COMMIT');
} catch (error) {
  writeDb.exec('ROLLBACK');
  throw error;
} finally {
  writeDb.close();
}

console.log(JSON.stringify({
  ok: true,
  dryRun: false,
  summary,
  planToken,
  backupPath: path.join(backupDir, 'poc.sqlite')
}, null, 2));

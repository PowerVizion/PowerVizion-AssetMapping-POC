const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const root = path.resolve(__dirname, '..');
const dbPath = path.join(root, 'data', 'poc.sqlite');
const sourcePath = path.join(
  root,
  'data',
  'atco',
  '7L63',
  'historical_records_detailed.json'
);

const APPLY = process.argv.includes('--apply');

const SOURCE_FILE =
  'PowerViz_ATCO_Crosswalk_Historical_Aug31_2026_CLIENT_READY_TO_SEND.xlsx';

const ASSETS = [
  'ATCO-7L63-514',
  'ATCO-7L63-519',
  'ATCO-7L63-525',
  'ATCO-7L63-543',
  'ATCO-7L63-546',
  'ATCO-7L63-547'
];

const records = JSON.parse(
  fs.readFileSync(sourcePath, 'utf8').replace(/^\uFEFF/, '')
);

const db = new DatabaseSync(dbPath);

function placeholders(count) {
  return new Array(count).fill('?').join(',');
}

function countByAsset(rows) {
  const counts = Object.fromEntries(ASSETS.map(id => [id, 0]));

  for (const row of rows) {
    counts[row.asset_id] = (counts[row.asset_id] || 0) + 1;
  }

  return counts;
}

const desiredCounts = countByAsset(records);

const existing = db.prepare(`
  SELECT id, asset_location_id, description
  FROM asset_observations
  WHERE asset_location_id IN (${placeholders(ASSETS.length)})
    AND record_type = 'Historical Observation'
`).all(...ASSETS);

console.log('');
console.log('7L63 HISTORICAL RECORD INDEX PLAN');
console.log('=================================');
console.log('Existing historical observation rows:', existing.length);
console.log('Desired detailed historical rows:', records.length);
console.log('');

for (const assetId of ASSETS) {
  console.log(
    assetId,
    '->',
    desiredCounts[assetId] || 0,
    'historical deficiencies'
  );
}

console.log('');
console.log(
  'STR547 will be explicitly indexed with 0 historical deficiency records.'
);

if (!APPLY) {
  console.log('');
  console.log('DRY RUN ONLY - no database changes made.');
  console.log('Run again with --apply after reviewing this plan.');
  db.close();
  process.exit(0);
}

const backupDir = path.join(root, 'data', 'backups');
fs.mkdirSync(backupDir, { recursive: true });

const stamp = new Date()
  .toISOString()
  .replace(/[:.]/g, '-');

const backupPath = path.join(
  backupDir,
  `poc-before-7L63-history-${stamp}.sqlite`
);

fs.copyFileSync(dbPath, backupPath);

console.log('');
console.log('Database backup:', backupPath);

db.exec('BEGIN IMMEDIATE');

try {
  const columns = db
    .prepare(`PRAGMA table_info(asset_observations)`)
    .all()
    .map(row => row.name);

  if (!columns.includes('inspection_type')) {
    db.exec(
      `ALTER TABLE asset_observations ADD COLUMN inspection_type TEXT`
    );
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS asset_history_indexes (
      id TEXT PRIMARY KEY,
      asset_location_id TEXT NOT NULL,
      source_file TEXT NOT NULL,
      inspection_date TEXT,
      record_count INTEGER NOT NULL DEFAULT 0,
      index_status TEXT NOT NULL DEFAULT 'Indexed',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(asset_location_id, source_file, inspection_date)
    )
  `);

  const deleteHistorical = db.prepare(`
    DELETE FROM asset_observations
    WHERE asset_location_id IN (${placeholders(ASSETS.length)})
      AND record_type = 'Historical Observation'
      AND id LIKE 'HIST-7L63-%'
  `);

  const deleted = deleteHistorical.run(...ASSETS);

  const insertObservation = db.prepare(`
    INSERT INTO asset_observations (
      id,
      asset_location_id,
      observation_date,
      inspection_type,
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
    )
    VALUES (
      ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
    )
  `);

  for (const row of records) {
    insertObservation.run(
      `HIST-7L63-${row.asset_id.split('-').pop()}-${row.anomaly_number}`,
      row.asset_id,
      row.inspection_date,
      row.inspection_type,
      'Historical Observation',
      row.severity,
      row.physical_category,
      row.description,
      row.failure_class || null,
      row.component || null,
      row.problem || null,
      row.cause || null,
      row.remedy || null,
      row.default_priority || null,
      row.recommended_priority || null,
      row.fire_ignition_flag || null,
      'Historical',
      SOURCE_FILE
    );
  }

  const deleteIndex = db.prepare(`
    DELETE FROM asset_history_indexes
    WHERE asset_location_id = ?
      AND source_file = ?
      AND inspection_date = ?
  `);

  const insertIndex = db.prepare(`
    INSERT INTO asset_history_indexes (
      id,
      asset_location_id,
      source_file,
      inspection_date,
      record_count,
      index_status
    )
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  for (const assetId of ASSETS) {
    deleteIndex.run(
      assetId,
      SOURCE_FILE,
      '2025-10-26'
    );

    insertIndex.run(
      `HISTIDX-${assetId}-20251026`,
      assetId,
      SOURCE_FILE,
      '2025-10-26',
      desiredCounts[assetId] || 0,
      'Indexed'
    );
  }

  db.exec('COMMIT');

  console.log('');
  console.log('Historical indexing applied successfully.');
  console.log('Rows removed:', deleted.changes);
  console.log('Rows inserted:', records.length);
  console.log('');

  const verification = db.prepare(`
    SELECT
      asset_location_id,
      COUNT(*) AS historical_records,
      MAX(
        CASE severity
          WHEN 'Major' THEN 2
          WHEN 'Minor' THEN 1
          ELSE 0
        END
      ) AS severity_rank
    FROM asset_observations
    WHERE asset_location_id IN (${placeholders(ASSETS.length)})
      AND record_type = 'Historical Observation'
    GROUP BY asset_location_id
    ORDER BY asset_location_id
  `).all(...ASSETS);

  console.table(verification);

  const indexed = db.prepare(`
    SELECT
      asset_location_id,
      inspection_date,
      record_count,
      index_status
    FROM asset_history_indexes
    WHERE asset_location_id IN (${placeholders(ASSETS.length)})
    ORDER BY asset_location_id
  `).all(...ASSETS);

  console.table(indexed);

} catch (error) {
  db.exec('ROLLBACK');
  console.error('');
  console.error('Historical indexing failed. Database rolled back.');
  console.error(error);
  process.exitCode = 1;
} finally {
  db.close();
}

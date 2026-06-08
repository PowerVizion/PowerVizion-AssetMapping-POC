import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { parse } from 'csv-parse/sync';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';

dotenv.config();

const mode = process.argv[2] || 'local';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const localDataDir = path.join(root, 'data');
const databasePath = process.env.DATABASE_PATH || './data/poc.sqlite';

const requiredFiles = [
  'manifest.json',
  'asset_locations.csv',
  'asset_media.csv',
  'ai_detections_demo.json',
  'component_dropdowns.csv',
  'data_quality_exception_types.csv'
];

const s3 = new S3Client({ region: process.env.AWS_REGION || 'ca-central-1' });

async function streamToString(stream) {
  const chunks = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString('utf8');
}

async function readFile(name) {
  if (mode === 's3') {
    if (!process.env.AWS_ACCESS_KEY_ID || !process.env.AWS_SECRET_ACCESS_KEY || !process.env.S3_BUCKET) {
      throw new Error('S3 ingest requires AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, and S3_BUCKET in .env.');
    }
    const prefix = process.env.S3_PREFIX || 'asset-mapping-poc/demo-utility/';
    const response = await s3.send(new GetObjectCommand({ Bucket: process.env.S3_BUCKET, Key: `${prefix}${name}` }));
    return stripBom(await streamToString(response.Body));
  }

  const filePath = path.join(localDataDir, name);
  if (!fs.existsSync(filePath)) throw new Error(`Missing local data file: ${filePath}`);
  return stripBom(fs.readFileSync(filePath, 'utf8'));
}

function stripBom(text) {
  return text.replace(/^\uFEFF/, '');
}

function csv(text, name) {
  try {
    return parse(text, { columns: true, skip_empty_lines: true, trim: true });
  } catch (error) {
    throw new Error(`Malformed CSV in ${name}: ${error.message}`);
  }
}

function json(text, name) {
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`Malformed JSON in ${name}: ${error.message}`);
  }
}

function reset(db) {
  db.exec(`
    DELETE FROM review_events;
    DELETE FROM data_quality_exceptions;
    DELETE FROM components;
    DELETE FROM ai_detections;
    DELETE FROM asset_media;
    DELETE FROM asset_locations;
    DELETE FROM dropdown_options;
    DELETE FROM projects;
  `);
}

function categoryName(fieldName) {
  const map = {
    component_type: 'Component Type',
    phase: 'Phase',
    condition_rating: 'Condition Rating',
    verified_status: 'Verified Status',
    nameplate_visible: 'Nameplate Visible'
  };
  return map[fieldName] || fieldName;
}

function mediaLocalPath(item) {
  const prefix = process.env.S3_PREFIX || 'asset-mapping-poc/demo-utility/';
  if (item.s3_key?.startsWith(prefix)) return item.s3_key.slice(prefix.length);
  if (item.s3_key?.includes('/demo-utility/')) return item.s3_key.split('/demo-utility/').pop();
  if (item.s3_key?.includes('/')) return item.s3_key.split('/').slice(-2).join('/');
  return item.file_name;
}

function detectionStatus(status) {
  const map = {
    PENDING_REVIEW: 'AI Candidate',
    APPROVED: 'Human Verified',
    REJECTED: 'Rejected',
    NEEDS_CLIENT_REVIEW: 'Needs Client Review'
  };
  return map[status] || status || 'AI Candidate';
}

async function ingest() {
  console.log(`Starting ${mode} ingest...`);
  const files = {};
  for (const file of requiredFiles) files[file] = await readFile(file);

  if (mode === 'local') {
    const resolvedDatabasePath = path.resolve(root, databasePath);
    if (fs.existsSync(resolvedDatabasePath)) fs.rmSync(resolvedDatabasePath, { force: true });
  }

  const { db } = await import('../server/db.js');

  const manifest = json(files['manifest.json'], 'manifest.json');
  const assets = csv(files['asset_locations.csv'], 'asset_locations.csv');
  const media = csv(files['asset_media.csv'], 'asset_media.csv');
  const detections = json(files['ai_detections_demo.json'], 'ai_detections_demo.json');
  const dropdowns = csv(files['component_dropdowns.csv'], 'component_dropdowns.csv');
  const exceptionTypes = csv(files['data_quality_exception_types.csv'], 'data_quality_exception_types.csv');

  reset(db);

  db.exec('BEGIN');
  try {
    db.prepare('INSERT INTO projects (id, name, description) VALUES (?, ?, ?)').run(
      manifest.projectId || manifest.project_id || 'pvz_asset_mapping_poc',
      manifest.projectName || manifest.project_name || 'PowerVizion Visual Asset Data Quality POC',
      manifest.description || ''
    );

    const assetInsert = db.prepare(`INSERT INTO asset_locations (
      id, project_id, asset_type, structure_number, client_asset_tag, latitude, longitude, review_status, notes
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    for (const asset of assets) {
      assetInsert.run(
        asset.asset_location_id || asset.id,
        asset.project_id || manifest.projectId || manifest.project_id || 'pvz_asset_mapping_poc',
        asset.asset_location_type || asset.asset_type,
        asset.structure_or_pole_number || asset.structure_number || asset.display_name,
        asset.client_asset_tag || '',
        Number.parseFloat(asset.latitude) || null,
        Number.parseFloat(asset.longitude) || null,
        asset.review_status || 'Imported',
        asset.notes || ''
      );
    }

    const mediaInsert = db.prepare(`INSERT INTO asset_media (
      id, asset_location_id, file_name, s3_key, local_path, capture_method, caption, frame_number, timecode, approved
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    for (const item of media) {
      mediaInsert.run(
        item.media_id || item.id,
        item.asset_location_id,
        item.file_name,
        item.s3_key || '',
        mediaLocalPath(item),
        item.capture_method || item.media_type || '',
        item.caption || '',
        item.frame_number || '',
        item.timecode || '',
        1
      );
    }

    const detectionInsert = db.prepare(`INSERT INTO ai_detections (
      id, asset_location_id, media_id, component_type, component_subtype, confidence, bbox_json, status, notes
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    for (const detection of detections.detections || detections) {
      detectionInsert.run(
        detection.detectionId || detection.id,
        detection.assetLocationId || detection.asset_location_id,
        detection.mediaId || detection.media_id,
        detection.detectionType || detection.component_type,
        detection.componentSubtype || detection.component_subtype || '',
        Number(detection.confidence || 0),
        JSON.stringify(detection.boundingBox || detection.bbox || detection.bbox_json || null),
        detectionStatus(detection.status),
        detection.notes || ''
      );
    }

    const optionInsert = db.prepare('INSERT OR IGNORE INTO dropdown_options (category, value) VALUES (?, ?)');
    for (const row of dropdowns) optionInsert.run(categoryName(row.field_name || row.category), row.option_value || row.value);
    for (const status of ['Imported', 'Pending Review', 'Field Review Started', 'Field Verified', 'Data Exception Found', 'Client Review Required', 'Export Ready']) {
      optionInsert.run('Asset Review Status', status);
    }
    for (const row of exceptionTypes) optionInsert.run('Exception Type', row.exception_type || row.value);
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }

  const counts = {
    assets: db.prepare('SELECT COUNT(*) AS count FROM asset_locations').get().count,
    media: db.prepare('SELECT COUNT(*) AS count FROM asset_media').get().count,
    detections: db.prepare('SELECT COUNT(*) AS count FROM ai_detections').get().count,
    dropdownOptions: db.prepare('SELECT COUNT(*) AS count FROM dropdown_options').get().count
  };

  console.log('Ingest complete.');
  console.table(counts);
}

ingest().catch(error => {
  console.error(error.message);
  process.exit(1);
});

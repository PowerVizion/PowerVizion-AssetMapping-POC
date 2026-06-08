import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import dotenv from 'dotenv';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { stringify } from 'csv-stringify/sync';
import { all, db, get, id, run } from './db.js';

dotenv.config();

const app = express();
const port = Number(process.env.PORT || 4000);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const mediaRoot = path.join(root, 'data');

app.use(express.json({ limit: '2mb' }));
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', 'http://127.0.0.1:5173');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  res.header('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});
app.use('/media', express.static(mediaRoot));

const hasS3 = Boolean(process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY && process.env.S3_BUCKET);
const s3 = hasS3 ? new S3Client({ region: process.env.AWS_REGION || 'ca-central-1' }) : null;

function withCounts(asset) {
  return {
    ...asset,
    media_count: get('SELECT COUNT(*) AS count FROM asset_media WHERE asset_location_id = ?', [asset.id]).count,
    candidate_count: get('SELECT COUNT(*) AS count FROM ai_detections WHERE asset_location_id = ?', [asset.id]).count,
    component_count: get('SELECT COUNT(*) AS count FROM components WHERE asset_location_id = ?', [asset.id]).count,
    exception_count: get('SELECT COUNT(*) AS count FROM data_quality_exceptions WHERE asset_location_id = ?', [asset.id]).count
  };
}

async function mediaUrl(media) {
  if (hasS3 && media.s3_key) {
    return getSignedUrl(s3, new GetObjectCommand({ Bucket: process.env.S3_BUCKET, Key: media.s3_key }), { expiresIn: 900 });
  }
  const localPath = media.local_path || media.file_name;
  return `http://127.0.0.1:${port}/media/${localPath.split(/[\\/]/).map(encodeURIComponent).join('/')}`;
}

app.get('/api/health', (req, res) => {
  res.json({ ok: true, mode: hasS3 ? 's3' : 'local' });
});

app.get('/api/summary', (req, res) => {
  const summary = {
    assets: get('SELECT COUNT(*) AS count FROM asset_locations').count,
    media: get('SELECT COUNT(*) AS count FROM asset_media').count,
    candidates: get('SELECT COUNT(*) AS count FROM ai_detections').count,
    components: get('SELECT COUNT(*) AS count FROM components').count,
    exceptions: get('SELECT COUNT(*) AS count FROM data_quality_exceptions').count,
    clientReview: get("SELECT COUNT(*) AS count FROM asset_locations WHERE review_status = 'Client Review Required'").count
  };
  res.json(summary);
});

app.get('/api/options', (req, res) => {
  const rows = all('SELECT category, value FROM dropdown_options ORDER BY category, value');
  const grouped = rows.reduce((acc, row) => {
    acc[row.category] ||= [];
    acc[row.category].push(row.value);
    return acc;
  }, {});
  res.json(grouped);
});

app.get('/api/assets', (req, res) => {
  const assets = all('SELECT * FROM asset_locations ORDER BY asset_type, structure_number').map(withCounts);
  res.json(assets);
});

app.get('/api/assets/:id', async (req, res) => {
  const asset = get('SELECT * FROM asset_locations WHERE id = ?', [req.params.id]);
  if (!asset) return res.status(404).json({ error: 'Asset not found' });

  const mediaRows = all('SELECT * FROM asset_media WHERE asset_location_id = ? ORDER BY id', [asset.id]);
  const media = await Promise.all(mediaRows.map(async row => ({ ...row, url: await mediaUrl(row) })));
  const detections = all('SELECT * FROM ai_detections WHERE asset_location_id = ? ORDER BY confidence DESC', [asset.id]);
  const components = all('SELECT * FROM components WHERE asset_location_id = ? ORDER BY created_at DESC', [asset.id]);
  const exceptions = all('SELECT * FROM data_quality_exceptions WHERE asset_location_id = ? ORDER BY created_at DESC', [asset.id]);
  res.json({ asset: withCounts(asset), media, detections, components, exceptions });
});

app.patch('/api/assets/:id/status', (req, res) => {
  run('UPDATE asset_locations SET review_status = ? WHERE id = ?', [req.body.review_status, req.params.id]);
  run('INSERT INTO review_events (id, asset_location_id, event_type, event_note) VALUES (?, ?, ?, ?)', [
    id('evt'), req.params.id, 'status', `Review status changed to ${req.body.review_status}`
  ]);
  res.json(get('SELECT * FROM asset_locations WHERE id = ?', [req.params.id]));
});

app.patch('/api/detections/:id', (req, res) => {
  const allowed = ['component_type', 'component_subtype', 'status', 'notes'];
  const updates = allowed.filter(key => key in req.body);
  if (!updates.length) return res.status(400).json({ error: 'No supported fields provided' });
  const setSql = updates.map(key => `${key} = @${key}`).join(', ');
  run(`UPDATE ai_detections SET ${setSql} WHERE id = @id`, { ...req.body, id: req.params.id });
  res.json(get('SELECT * FROM ai_detections WHERE id = ?', [req.params.id]));
});

app.post('/api/components', (req, res) => {
  const component = {
    id: id('cmp'),
    quantity: 1,
    verified_status: 'Human Verified',
    ...req.body
  };
  run(`INSERT INTO components (
    id, asset_location_id, detection_id, component_type, component_subtype, quantity, phase, material,
    manufacturer, model, serial_number, install_year, asset_tag, nameplate_visible, condition_rating,
    verified_status, source_media, reviewer_notes
  ) VALUES (
    @id, @asset_location_id, @detection_id, @component_type, @component_subtype, @quantity, @phase, @material,
    @manufacturer, @model, @serial_number, @install_year, @asset_tag, @nameplate_visible, @condition_rating,
    @verified_status, @source_media, @reviewer_notes
  )`, component);
  if (component.detection_id) {
    run("UPDATE ai_detections SET status = 'Human Verified' WHERE id = ?", [component.detection_id]);
  }
  res.status(201).json(get('SELECT * FROM components WHERE id = ?', [component.id]));
});

app.put('/api/components/:id', (req, res) => {
  run(`UPDATE components SET
    component_type=@component_type, component_subtype=@component_subtype, quantity=@quantity, phase=@phase,
    material=@material, manufacturer=@manufacturer, model=@model, serial_number=@serial_number,
    install_year=@install_year, asset_tag=@asset_tag, nameplate_visible=@nameplate_visible,
    condition_rating=@condition_rating, verified_status=@verified_status, source_media=@source_media,
    reviewer_notes=@reviewer_notes, updated_at=CURRENT_TIMESTAMP
    WHERE id=@id`, { ...req.body, id: req.params.id });
  res.json(get('SELECT * FROM components WHERE id = ?', [req.params.id]));
});

app.post('/api/exceptions', (req, res) => {
  const exception = { id: id('ex'), export_status: 'Open', ...req.body };
  run(`INSERT INTO data_quality_exceptions (
    id, asset_location_id, component_id, exception_type, recommended_action, reviewer_notes, export_status
  ) VALUES (@id, @asset_location_id, @component_id, @exception_type, @recommended_action, @reviewer_notes, @export_status)`, exception);
  res.status(201).json(get('SELECT * FROM data_quality_exceptions WHERE id = ?', [exception.id]));
});

app.get('/api/client/assets/:id', async (req, res) => {
  const asset = get('SELECT * FROM asset_locations WHERE id = ?', [req.params.id]);
  if (!asset) return res.status(404).json({ error: 'Asset not found' });
  const mediaRows = all('SELECT * FROM asset_media WHERE asset_location_id = ? AND approved = 1', [asset.id]);
  const media = await Promise.all(mediaRows.map(async row => ({ ...row, url: await mediaUrl(row) })));
  const components = all("SELECT * FROM components WHERE asset_location_id = ? AND verified_status != 'Rejected'", [asset.id]);
  const exceptions = all('SELECT * FROM data_quality_exceptions WHERE asset_location_id = ?', [asset.id]);
  res.json({ asset, media, components, exceptions });
});

app.get('/api/export/data-quality-register.csv', (req, res) => {
  const rows = all(`
    SELECT
      p.name AS "Project Name",
      a.id AS "Asset Location ID",
      a.asset_type AS "Asset Type",
      a.structure_number AS "Structure/Pole Number",
      a.client_asset_tag AS "Client Asset Tag",
      a.latitude AS "Latitude",
      a.longitude AS "Longitude",
      c.component_type AS "Component Type",
      c.component_subtype AS "Component Subtype",
      c.quantity AS "Quantity",
      c.phase AS "Phase",
      c.material AS "Material",
      c.manufacturer AS "Manufacturer",
      c.model AS "Model",
      c.serial_number AS "Serial Number",
      c.install_year AS "Install Year",
      c.nameplate_visible AS "Nameplate Visible",
      c.condition_rating AS "Condition Rating",
      c.verified_status AS "Verified Status",
      c.source_media AS "Source Media",
      e.exception_type AS "Exception Type",
      e.recommended_action AS "Recommended Action",
      COALESCE(e.reviewer_notes, c.reviewer_notes) AS "Reviewer Notes",
      a.review_status AS "Review Status",
      COALESCE(e.export_status, 'Ready') AS "Export Status"
    FROM asset_locations a
    JOIN projects p ON p.id = a.project_id
    LEFT JOIN components c ON c.asset_location_id = a.id
    LEFT JOIN data_quality_exceptions e ON e.asset_location_id = a.id AND (e.component_id = c.id OR e.component_id IS NULL)
    ORDER BY a.id, c.component_type, e.exception_type
  `);
  res.header('Content-Type', 'text/csv');
  res.attachment('powervizion-data-quality-register.csv');
  res.send(stringify(rows, { header: true }));
});

app.get('/api/export/preview', (req, res) => {
  const rows = all(`
    SELECT a.id AS asset_location_id, a.asset_type, a.structure_number, c.component_type, c.verified_status,
      e.exception_type, e.recommended_action, a.review_status
    FROM asset_locations a
    LEFT JOIN components c ON c.asset_location_id = a.id
    LEFT JOIN data_quality_exceptions e ON e.asset_location_id = a.id
    ORDER BY a.id
    LIMIT 50
  `);
  res.json(rows);
});

app.listen(port, '127.0.0.1', () => {
  console.log(`PowerVizion Asset Mapping POC API running at http://127.0.0.1:${port}`);
});

import { parse } from 'csv-parse/sync';

export const assetColumns = ['circuit', 'structure_id', 'latitude', 'longitude', 'asset_type',
  'approved_for_import', 'coordinate_source', 'coordinate_reference', 'condition_family', 'poc_role',
  'source_clip', 'source_inspection_date', 'uis_start_frame', 'uis_end_frame', 'image_count',
  'historical_observation_count', 'major_historical_deficiency'];
export const mediaColumns = ['circuit', 'structure_id', 'inspection_date', 'clip', 'frame', 'image_file',
  'source_path', 'uis_start_frame', 'uis_end_frame', 'uis_confidence', 'qc_status', 'qc_notes',
  'approved_for_demo', 'future_s3_key', 'future_media_id', 'source_identity', 'source_manifest', 'source_row'];
export const historicalColumns = ['circuit', 'structure_id', 'historical_anomaly_id', 'inspection_date',
  'severity', 'physical_category', 'description', 'failure_class', 'component', 'problem', 'cause',
  'remedy', 'default_priority', 'recommended_priority', 'fire_ignition_flag', 'source'];

export function readCsv(text, required) {
  let headers;
  const rows = parse(text, { bom: true, skip_empty_lines: true, trim: true, columns: values => {
    headers = values;
    if (new Set(values).size !== values.length || values.some(value => !value)) throw Error('Duplicate or blank CSV header');
    const missing = required.filter(value => !values.includes(value));
    if (missing.length) throw Error(`Missing CSV columns: ${missing.join(', ')}`);
    return values;
  } });
  if (!headers) throw Error('CSV header is required');
  return rows;
}

export function validateAssets(text) {
  let rows;
  try { rows = readCsv(text, assetColumns.slice(0, 8)); }
  catch (error) { return { assets: [], errors: [{ row: 1, errors: [error.message] }], rejected: 1 }; }
  const seen = new Set(), errors = [], assets = [];
  for (const [index, row] of rows.entries()) {
    const issues = [];
    if (row.circuit !== '7L63') issues.push('circuit must be 7L63');
    if (!/^7L63-[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*$/.test(row.structure_id)) issues.push('structure_id must identify a 7L63 structure');
    if (seen.has(row.structure_id.toUpperCase())) issues.push('duplicate structure_id');
    seen.add(row.structure_id.toUpperCase());
    for (const [key, limit] of [['latitude', 90], ['longitude', 180]]) {
      if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(row[key]) || !Number.isFinite(Number(row[key])) || Math.abs(Number(row[key])) > limit) {
        issues.push(`${key} requires a decimal coordinate within +/-${limit}`);
      }
    }
    if (!row.asset_type) issues.push('asset_type is required');
    if (row.approved_for_import !== 'true') issues.push('approved_for_import must explicitly be true');
    if (!['atco_structure_registry', 'kml', 'kmz'].includes(row.coordinate_source)) issues.push('coordinate_source must be atco_structure_registry, kml or kmz');
    if (!row.coordinate_reference) issues.push('coordinate_reference is required (authoritative source file/record)');
    if (issues.length) errors.push({ row: index + 2, structure_id: row.structure_id, errors: issues });
    assets.push({ ...row, latitude: Number(row.latitude), longitude: Number(row.longitude) });
  }
  return { assets, errors, rejected: errors.length };
}

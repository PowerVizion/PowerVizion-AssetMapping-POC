export const schema = `
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS asset_locations (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  asset_type TEXT,
  structure_number TEXT,
  client_asset_tag TEXT,
  latitude REAL,
  longitude REAL,
  review_status TEXT DEFAULT 'Imported',
  notes TEXT,
  FOREIGN KEY(project_id) REFERENCES projects(id)
);

CREATE TABLE IF NOT EXISTS asset_media (
  id TEXT PRIMARY KEY,
  asset_location_id TEXT NOT NULL,
  file_name TEXT NOT NULL,
  s3_key TEXT,
  local_path TEXT,
  capture_method TEXT,
  caption TEXT,
  frame_number TEXT,
  timecode TEXT,
  approved INTEGER DEFAULT 1,
  FOREIGN KEY(asset_location_id) REFERENCES asset_locations(id)
);

CREATE TABLE IF NOT EXISTS ai_detections (
  id TEXT PRIMARY KEY,
  asset_location_id TEXT NOT NULL,
  media_id TEXT,
  component_type TEXT,
  component_subtype TEXT,
  confidence REAL,
  bbox_json TEXT,
  status TEXT DEFAULT 'AI Candidate',
  notes TEXT,
  FOREIGN KEY(asset_location_id) REFERENCES asset_locations(id),
  FOREIGN KEY(media_id) REFERENCES asset_media(id)
);

CREATE TABLE IF NOT EXISTS components (
  id TEXT PRIMARY KEY,
  asset_location_id TEXT NOT NULL,
  detection_id TEXT,
  component_type TEXT,
  component_subtype TEXT,
  quantity INTEGER DEFAULT 1,
  phase TEXT,
  material TEXT,
  manufacturer TEXT,
  model TEXT,
  serial_number TEXT,
  install_year TEXT,
  asset_tag TEXT,
  nameplate_visible TEXT,
  condition_rating TEXT,
  verified_status TEXT DEFAULT 'Human Verified',
  source_media TEXT,
  reviewer_notes TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(asset_location_id) REFERENCES asset_locations(id),
  FOREIGN KEY(detection_id) REFERENCES ai_detections(id)
);

CREATE TABLE IF NOT EXISTS data_quality_exceptions (
  id TEXT PRIMARY KEY,
  asset_location_id TEXT NOT NULL,
  component_id TEXT,
  exception_type TEXT NOT NULL,
  recommended_action TEXT,
  reviewer_notes TEXT,
  export_status TEXT DEFAULT 'Open',
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(asset_location_id) REFERENCES asset_locations(id),
  FOREIGN KEY(component_id) REFERENCES components(id)
);

CREATE TABLE IF NOT EXISTS review_events (
  id TEXT PRIMARY KEY,
  asset_location_id TEXT NOT NULL,
  event_type TEXT,
  event_note TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(asset_location_id) REFERENCES asset_locations(id)
);

CREATE TABLE IF NOT EXISTS dropdown_options (
  category TEXT NOT NULL,
  value TEXT NOT NULL,
  PRIMARY KEY(category, value)
);
`;

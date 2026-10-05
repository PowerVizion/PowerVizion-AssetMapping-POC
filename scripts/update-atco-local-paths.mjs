import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { parse } from "csv-parse/sync";

const manifestPath = path.resolve("data/atco/7L63/media_manifest.csv");
const dbPath = path.resolve("data/poc.sqlite");
const baseLocal = "atco-media/7L63/2025-11-03";

const csvText = fs.readFileSync(manifestPath, "utf8");
const rows = parse(csvText, {
  columns: true,
  skip_empty_lines: true,
  bom: true
}).filter((row) => String(row.approved_for_demo).toLowerCase() === "true");

const db = new DatabaseSync(dbPath);

const getAsset = db.prepare(`
  SELECT id
  FROM asset_locations
  WHERE project_id = ? AND structure_number = ?
`);

const updateMedia = db.prepare(`
  UPDATE asset_media
  SET local_path = ?
  WHERE asset_location_id = ? AND file_name = ?
`);

db.exec("BEGIN");

try {
  let updated = 0;

  for (const row of rows) {
    const asset = getAsset.get("ATCO-7L63", row.structure_id);

    if (!asset) {
      throw new Error(`Missing asset_location for ${row.structure_id}`);
    }

    const localPath = `${baseLocal}/${row.structure_id}/${row.image_file}`;
    const result = updateMedia.run(localPath, asset.id, row.image_file);

    if (result.changes !== 1) {
      throw new Error(
        `Expected exactly 1 media row for ${row.structure_id} / ${row.image_file}, got ${result.changes}`
      );
    }

    updated++;
  }

  db.exec("COMMIT");
  console.log(`Updated ${updated} media rows.`);
} catch (error) {
  db.exec("ROLLBACK");
  throw error;
} finally {
  db.close();
}

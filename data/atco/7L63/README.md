# ATCO 7L63 staging and additive asset import

This milestone is staging only. **Do not run a production ATCO import yet.**
The three CSVs are header-only templates. No coordinates, approved assets, media,
or historical observations have been invented or imported.

**Never run `npm run ingest:local` or `npm.cmd run ingest:local`.** That existing
script resets POC tables. These ATCO tools do not call it or `server/db.js`.

## Inputs and ownership

- Raw package: `E:\ATCO_POC_STRUCTURE_EXPORTS\7L63` (read-only).
- Source manifests: `POC_Image_Manifest.csv` and `POC_Image_Manifest_A019_C002_1103NP.csv`.
- Source summaries are reference material; they are not asset registries.
- QC package: `E:\ATCO_POC_STRUCTURE_EXPORTS\7L63_DEMO_APPROVED` (owned by the
  separate manual QC workflow). The tools never create or modify this folder.
- Future media eligibility is limited to JPGs directly under an approved
  `7L63-<structure>` subfolder of that QC root. The original manifests remain
  the provenance source; folder membership alone is not provenance or an import.
- The user reports 293 raw JPGs and 11 assigned structures: 514, 519, 525, 543,
  545, 546, 547, 548, 549, 550, 551, plus UNASSIGNED. These are expectations,
  not importer constraints. Live counts must be checked when the drive is mounted.
- No images are copied, moved, uploaded, or served by these tools. Do not add
  imagery to Git. Report files and database backups stay local and are ignored.

## assets.csv

Each row requires `circuit`, `structure_id`, `latitude`, `longitude`, `asset_type`.
Only circuit `7L63` is supported. Structure IDs must start with `7L63-`; there
is no fixed list or count. Coordinates must be decimal degrees in valid ranges.
Blank, nonnumeric, and out-of-range coordinates are errors, not zero defaults.

The following safety fields are also required:

| Field | Meaning |
| --- | --- |
| approved_for_import | Literal `true`, set only after a human approves the asset row |
| coordinate_source | `atco_structure_registry`, `kml`, or `kmz` |
| coordinate_reference | Source file/record reference supporting those coordinates |

**Inspection-manifest Latitude/Longitude must not be copied into asset coordinates.**
Verify the ATCO registry/KML/KMZ and its CRS before preparing decimal lat/lon.
The importer validates the declaration; it cannot independently certify the
coordinate authority or convert projected coordinates. Resolve missing/uncertain
coordinates before approving rows. Draft or unapproved rows cause the entire batch
to fail; remove them from the approved input rather than silently skipping them.

Optional columns (may be absent or empty): `condition_family`, `poc_role`,
`source_clip`, `source_inspection_date`, `uis_start_frame`, `uis_end_frame`,
`image_count`, `historical_observation_count`, `major_historical_deficiency`.
These remain staging metadata and are not written into unrelated SQLite fields.
Use proper CSV quoting for commas, quotes and multiline text; preserve identifiers
and frame numbers as strings, including leading zeros.

## media_manifest.csv

Columns: `circuit`, `structure_id`, `inspection_date`, `clip`, `frame`, `image_file`,
`source_path`, `uis_start_frame`, `uis_end_frame`, `uis_confidence`, `qc_status`,
`qc_notes`, `approved_for_demo`, `future_s3_key`, `future_media_id`,
`source_identity`, `source_manifest`, `source_row`.

This is a template for a later reviewed media-staging step, not a media importer.
`source_path` refers to the original raw source image, not the approved copy.
Use the approved root only for selecting QC-approved bytes. Retain the original
manifest path and CSV record number for provenance. Blank inspection dates remain
unknown; do not infer them from filenames. Future S3/media IDs remain empty until
assigned. No uploads or media records are created in this milestone.

## Read-only manifest and QC report

From the repository root, when E: is available:

```powershell
node scripts/stage-7l63-manifests.js
# Optional new local JSON output; never overwrites an existing report:
node scripts/stage-7l63-manifests.js --out data/atco/7L63/combined-manifest.local.json
```

Override roots with `--raw-root PATH` and `--approved-root PATH`. To use additional
source manifests, repeat `--manifest PATH` for every input (explicit options replace
the two defaults). Inputs are never edited. Reports cannot be written inside raw
or QC roots, and output parents must already exist. Missing raw inputs produce an
explicit error. Missing QC folder is normal: **QC approved package not yet available.**

Combined JSON contains assigned `records`, separate `unassigned`, and `report`:

- Stable identity is the JSON tuple circuit + structure + clip + frame + filename
  (filename comparison is case-insensitive). Leading zeros are preserved.
- Exact duplicate source rows consolidate, retaining every original manifest/row.
- Conflicting duplicates retain all source row values and list differing fields.
  The first normalized projection is for inspection only; `conflicted: true`
  prevents automatic unique QC matching. Exit code 1 flags invalid/conflicting rows.
- All original fields are retained in `source_rows[].values`; UIS, clip/frame,
  inspection coordinates, and reference anomalies also have explicit projections.
  Inspection coordinates are named `inspection_latitude/longitude`, never asset
  `latitude/longitude`. Anomaly fields are reference data, not current findings.
- Reports include missing source images, unlisted on-disk JPGs, discovered structure
  IDs, JPG count, invalid paths, duplicates/conflicts, and UNASSIGNED files.
- Current images always resolve as raw root + validated Structure + ImageFile,
  including the separate UNASSIGNED folder. ImageFile must be a single JPG filename;
  traversal, absolute/drive/UNC filenames and escaping junctions are rejected.
  Existing files must be regular files with a matching physical basename (Windows
  case-insensitive comparison is supported). Missing files remain in the missing-file
  report with current_file_exists=false; they are not assumed to exist.
- StructureImagePath is historical provenance, never a filesystem lookup instruction.
  Its basename must still agree with ImageFile, but a different parent or drive is
  accepted. Normalized records retain original_structure_image_path,
  current_resolved_path, current_file_exists and informational source_path_relocated.
  source_path remains the current package-relative path. report.relocatedPathCount
  counts accepted input rows whose historical path differs from the current path;
  validNormalizedRecords includes assigned and UNASSIGNED deduplicated records.
  Every original field is also preserved in source_rows; original CSVs are untouched.
- QC reports counts by folder, matching/nonmatching filenames, duplicate filenames,
  and missing/ambiguous provenance. Matching uses structure + filename and requires
  exactly one nonconflicting source identity. Same filename across clip/frame
  identities requires manual resolution. UNASSIGNED is never eligible.

The scanner does not generate approvals or overwrite `media_manifest.csv`.

## Safe asset import workflow

Uses the existing schema, with `project_id = ATCO-7L63`. New asset IDs are
`ATCO-<structure_id>` (for example `ATCO-7L63-514`); `structure_number` retains
the original ID. Matching existing ATCO structure IDs retain their existing asset
ID and all linked records. Ambiguous matches and cross-project ID collisions reject
the entire batch. POC-001 and other projects are never updated or deleted.

Dry-run (safe to run now on the empty template):

```powershell
node scripts/add-7l63-poc.js --dry-run
```

Default invocation is also dry-run. It parses the actual CSV and opens the existing
database read-only, without migrations or backup creation. It reports the target
project, per-asset planned changes, `created`, `updated`, `unchanged`, `rejected`,
and a `planToken`. Counts in dry-run are predictions. Empty templates create nothing.
Malformed rows reject the whole batch before the DB is opened; no silent skipping.

**Future production command — documented only; do not execute in this milestone:**

```powershell
# After authoritative coordinates and asset rows are approved, review a fresh dry-run.
node scripts/add-7l63-poc.js --apply --confirm-plan "<planToken from that dry-run>"
```

`--assets PATH`, `--db PATH`, and `--backup-dir PATH` are supported. Defaults are
repository-relative, independent of shell location. The tools intentionally ignore
`.env`/`DATABASE_PATH`; supply `--db` explicitly for a different database. They never
create a missing DB. Use Node 24+ with built-in `node:sqlite` and its backup API.

Apply checks the input and plans again under `BEGIN IMMEDIATE`. The token binds the
CSV bytes, resolved DB path and current project/asset rows, so changed input or
asset state requires another reviewed dry-run. The write reservation prevents
concurrent changes during backup/import. Stop the development server before a real
import to avoid contention. Busy-lock failure is safe; rerun dry-run when resolved.

Before changes, the SQLite backup API writes a complete pre-import backup including
committed WAL content into `data/atco-backups/<UTC timestamp>-<UUID>/poc.sqlite`.
An exclusive directory prevents overwriting existing backups. Integrity is checked
and the backup path is printed before writes. Backup failure aborts the import;
an incomplete backup may remain for diagnosis and must not be used for restoration.
Unexpected SQL errors roll back all project/asset changes; a successful backup is
retained even if the transaction later fails. No schema normalization occurs.

Only missing assets are inserted. Existing matching ATCO assets may update
`asset_type`, `latitude`, `longitude`. Review status, notes, client tags, media,
annotations, components, findings and history remain untouched. Existing project
metadata is preserved. Missing CSV assets are never deleted. An identical rerun
reports zero created/updated and N unchanged. All apply runs require a new matching
dry-run token and a backup, including no-change runs.

## historical_observations.csv and future record out

Template columns: `circuit`, `structure_id`, `historical_anomaly_id`, `inspection_date`,
`severity`, `physical_category`, `description`, `failure_class`, `component`, `problem`,
`cause`, `remedy`, `default_priority`, `recommended_priority`, `fire_ignition_flag`, `source`.

No historical import is implemented. Future historical records must be immutable
reference/history. Source anomalies must not automatically become current observations,
AI candidates, approved components, or current deficiencies.

Stable structure/asset IDs and source identity/manifest/row references preserve joins
for future record out. Client is ATCO; line/circuit is 7L63. Future inspection IDs/types,
media IDs, current observation source, candidate flags/groups/reasons/confidence,
creator and audit timestamps need their own future workflow; do not fabricate them
or overload historical fields. No final export or UI feature is added here. The
existing Line / Project filter derives projects from assets and will expose ATCO-7L63
after an eventual approved import. Terrestrial workflows remain separate and frozen.

## Verification

```powershell
npm.cmd run build
node --test
```

All ATCO write tests create isolated temporary databases/files. They cover validation,
provenance declarations, insert/update/idempotence, unrelated record preservation,
read-only dry-run, stale plan rejection, backup failure/WAL completeness, SQL rollback,
manifest conflicts/inventory, and absent/matched/ambiguous QC packages. They never run
the production ATCO import. Real external manifests still require a review when mounted.

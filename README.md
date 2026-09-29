# PowerVizion Visual Asset Data Quality POC

Standalone proof-of-concept app for reviewing visual utility asset evidence, approving visible components, logging data-quality exceptions, and exporting a CSV register.

This project is intentionally separate from any existing PowerVizion production, staging, ATCO, CNRL, database, server, deployment, or domain.

## Local Real Dataset

The app currently runs from the real local dataset under `./data/`. No AWS credentials are required for local demo use.

Expected local files and folders:

- `data/manifest.json`
- `data/asset_locations.csv`
- `data/asset_media.csv`
- `data/ai_detections_demo.json`
- `data/component_dropdowns.csv`
- `data/data_quality_exception_types.csv`
- `data/8k_DEMO_1/`
- `data/8k_DEMO_2/`
- `data/8k_DEMO_3/`
- `data/8k_DEMO_4/`
- `data/8k_DEMO_5/`
- `data/Alley_DEMO_1/`
- `data/Alley_DEMO_2/`

## Run Locally

```bash
npm install
npm run ingest:local
npm run dev
```

The API runs on `http://127.0.0.1:4000` and the Vite app runs on `http://127.0.0.1:5173`.

## Local Ingest

The local ingest command deletes and recreates `data/poc.sqlite`, strips metadata BOMs in memory, reads the local CSV/JSON metadata, and maps real headers such as `asset_location_id`, `media_id`, `asset_location_type`, and `structure_or_pole_number` into the local SQLite schema.

```bash
npm run ingest:local
```

The real local dataset should load 7 or 8 asset locations, approximately 48 media records, and seeded candidate detections from `ai_detections_demo.json`.

## Included Workflow

- Dashboard summary with asset, media, candidate, component, exception, and client-review counts.
- Admin Review asset selection, media viewer, candidate approval/rejection, component form, exception form, and review status controls.
- Client View read-only asset profile with approved media, verified components, and visible data-quality status.
- Export page with preview and CSV download for the data-quality register.

## Environment

See `.env.example` for supported local settings:

- `PORT`
- `DATABASE_PATH`

## Known Limitations

- Candidate bounding boxes are stored but not overlaid on images yet.
- Authentication and deployment are intentionally out of scope for this standalone local POC.

## Suggested Next Phase

Add image overlays for detections, richer zoom/pan controls, component edit history, user roles, and a packaged deployment target once the client-demo workflow is accepted.

## Terrestrial Dataset Availability

Set `POWERVIZ_TERRESTRIAL_ROOT=C:\MH_SUB\EXPORT` in the ignored local `.env`.
`GET /api/terrestrial-datasets` reads `data/terrestrial_datasets.json` on each
request and returns an array of dataset metadata, with a `local` object for
root, point-cloud, and panorama-directory availability and status.

The metadata's `point_count`, `setup_count`, and `panorama_count` are declared
values, not measurements. `local.panorama_count` counts regular files directly
inside the configured panorama directory matching `panorama_pattern`
(case insensitive, each `#` means one digit). Other files and subdirectories
are excluded. The count is `null` when the directory cannot be inspected,
and zero when it is readable but has no matching files.
`local.panorama_count_matches_expected` compares the observed and declared
counts, or is `null` when the comparison is unavailable.

An unset root, missing local data, wrong file type, or unreadable local data
is reported as availability status with HTTP 200. Missing, malformed, or
invalid dataset configuration produces a JSON error with HTTP 500.
Dataset file/directory paths must be relative and stay within the configured
root. Availability checks do not validate E57/JPEG contents or count points.
The discovery endpoint does not serve terrestrial files, ingest data, read associations,
or write to SQLite. No ingest step is needed for this integration.

Windows verification: `npm.cmd run build`, then `npm.cmd run dev` and
`Invoke-RestMethod http://127.0.0.1:4000/api/terrestrial-datasets`.

## Terrestrial Data Tab and Panorama Browser

Open **Terrestrial Data** to see dataset metadata, local availability, and
the pending association state. **Browse Panoramas** opens Setup 001. Use
Previous/Next or the setup selector to browse the configured setup range.
Zoom In/Out supports 100–400% of the fitted image; drag when zoomed and
use Reset Zoom to restore the fitted view. Each setup starts at 100%.
The viewer displays the original JPEG as a flat image, not a spherical view.
Missing/unreadable images show a retry message; setup navigation stays available.

Read-only routes:
- `GET /api/terrestrial-datasets/:datasetId/panoramas`: expected setup numbers
  and filenames derived from the dataset's pattern and setup count.
- `GET /api/terrestrial-datasets/:datasetId/panoramas/:filename`: a single
  configured JPEG. Unknown datasets, unexpected filenames, missing files,
  invalid JPEG signatures and paths outside the dataset return JSON errors.
  Filenames must exactly match the allowlist, including case. No generic
  external static directory is exposed. Resolved paths are checked and
  image symlinks are rejected.

The catalog lists expected setups even if files are missing. Declared counts
remain separate from observed local panorama counts. Asset association count
is zero and the status is Pending for this milestone; the header-only
`data/terrestrial_evidence.csv` is not modified or populated by this UI.
No SQLite schema, ingestion, annotation or existing review behavior is changed.

Run focused route tests with `node --test server/terrestrial-panoramas.test.js`.

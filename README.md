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

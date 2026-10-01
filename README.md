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
the current association state. **Browse Panoramas** opens Setup 001. Use
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
remain separate from observed local panorama counts. Association counts come from data/terrestrial_evidence.csv. The admin association workflow below maintains this file.
No SQLite schema, ingestion, annotation or existing review behavior is changed.

Run focused route tests with `node --test server/terrestrial-panoramas.test.js`.

## Manual Terrestrial Evidence Associations

In **Terrestrial Data**, browse a setup and choose an existing asset in
**Asset Association**, optionally add notes, then select **Associate to Asset**.
Saved records show **Manual Verified** with Change Association and Remove
Association controls. Exactly one asset association is supported per dataset/setup.
Change Association replaces the existing record atomically, without a delete gap.

**Admin Review** includes a separate **Terrestrial Evidence** section with metadata,
notes, preview and **Open Panorama**, which opens that dataset/setup directly.
Existing aerial/8K media remains separate. No terrestrial evidence is displayed
in Client View or added to exports. Export is the final navigation tab.

CSV source of truth: `data/terrestrial_evidence.csv`. Columns remain:
`asset_location_id,dataset_id,setup_id,panorama_file,association_method,notes`.
Setup IDs are three-digit strings (`001`–`057` for MH_SUB_1); method is always
`manual_verified`. Notes are optional text up to 2000 characters. No SQLite
writes, schema changes, ingestion, or automatic asset associations are performed.

Routes:
- `GET /api/terrestrial-evidence`: all CSV records.
- `GET /api/terrestrial-evidence/assets/:assetId`: records for an existing asset.
- `POST /api/terrestrial-evidence`: create using the six CSV fields.
- `PUT /api/terrestrial-evidence/:datasetId/:setupId`: replace the asset/notes,
  supplying the six new fields plus `expected` containing the full previously read record.
- `DELETE /api/terrestrial-evidence/:datasetId/:setupId`: remove a record,
  with JSON body `{ "expected": <full previously read record> }`.

Create/change validates the existing asset with a read-only query, dataset,
setup/filename match, real file containment and JPEG signature. Invalid requests
return 400; unknown read/delete records return 404; duplicate, busy or stale
writes return 409. Delete can remove an obsolete association even when its image
is no longer present. Notes with commas, quotes and line breaks are CSV-escaped.

Writes hold an exclusive sibling `.lock`, parse the existing CSV strictly,
write and flush a unique same-directory temporary file, then rename it atomically.
The original header, BOM and newline style are preserved. Malformed CSV is never
silently overwritten. Do not manually edit the CSV while the server is writing.
An abnormal process termination can leave a lock: after verifying all POC servers
are stopped, inspect the CSV and remove only its stale `.lock` before retrying.
The UI reports save errors and offers refresh; stale tabs cannot overwrite newer
records. This remains a local admin POC, not an authenticated multi-user service.

Tests: `node --test server/terrestrial-evidence.test.js server/terrestrial-panoramas.test.js`.

## 3D Terrestrial Point Cloud

**Terrestrial Data → Open 3D Point Cloud** opens the configured Manitoba Hydro
Potree 2.0 test cloud. The original E57 and panorama workflows are unchanged.
The viewer uses pinned local npm dependencies (`potree-core` 2.0.15 and
`three` 0.154.0); rendering and decoder workers are bundled by Vite, with no CDN.
Potree Core is MIT licensed: https://github.com/tentone/potree-core.

Set `POWERVIZ_WEB_POINTCLOUD_ROOT` in the local ignored `.env` to the approved
external web-cloud root. `data/terrestrial_datasets.json` declares a relative
`web_point_cloud.directory`, name, format and point-count metadata per dataset.
For MH_SUB_1, the directory is `MH_SUB_TEST_1M_POTREE`; it must contain
`metadata.json`, `hierarchy.bin` and `octree.bin`. Keep binary cloud data external;
these filenames are ignored by Git. Restart the API after changing the environment.

Read-only route (also supports HEAD and byte ranges):
`GET /api/terrestrial-datasets/:datasetId/point-cloud/:filename`.
Only the three exact filenames above are served for configured datasets. Paths
are checked both lexically and after resolving junctions; file symlinks and
paths outside the approved root are rejected. Missing data returns JSON 404,
invalid ranges return 416. No generic external static directory is exposed.
Responses disable caching to avoid stale/overlapping partial-response caches.

Controls: left drag to orbit, right drag or arrow keys to pan, scroll or toolbar
buttons to zoom. Fit to Cloud recenters while retaining the viewing direction;
Reset View restores the initial direction. Point size and RGB/elevation modes
are available. The viewer rebases survey coordinates near the origin for GPU
precision and loads visible Potree nodes progressively, up to a 2M point budget
(1M for Fast Preview). The displayed visible-point count varies with the view.
The material shares decoded RGBA bytes as normalized RGB and preserves their
source color encoding; it does not rewrite the external dataset.

Requires a browser/GPU supporting WebGL and the bundled Potree shaders.
Missing files, failed requests, decoder errors and graphics-context loss display
an error with Retry/Back controls. This milestone renders the 1M and 10M test clouds,
not the full 1.26B-point E57. No scan markers, measurements or panorama positioning
are included. SQLite, association CSV, Client View and Export are not modified.

Tests: `node --test server/terrestrial-pointcloud.test.js server/terrestrial-panoramas.test.js server/terrestrial-evidence.test.js`.

### Selectable point-cloud detail

MH_SUB_1 declares `point_cloud_variants` with approved IDs, labels, names,
relative directories and exact point counts:

- `preview_1m`: Fast Preview, `MH_SUB_TEST_1M_POTREE`, 1,000,000 points.
- `detail_10m`: Detailed, `MH_SUB_TEST_10M_POTREE`, 10,000,000 points.

Both directories resolve under `POWERVIZ_WEB_POINTCLOUD_ROOT`. The new route is
`GET /api/terrestrial-datasets/:datasetId/point-cloud/:variantId/:filename`.
It uses the same three-file allowlist, containment checks, HEAD and byte-range
streaming as the original route. Unknown variants cannot select arbitrary folders.
The original URL without a variant remains an alias for the configured 1M cloud.

The Point Cloud Detail selector stays available while loading or after errors.
Switching aborts pending requests, terminates decoder workers, disposes geometry,
materials, controls and renderer, then fits the new cloud. Point size and color
mode persist; camera position resets to fit the selected dataset's own bounds.
Retry reloads the current selection. First-point loading has a 45-second timeout.

`default_point_cloud_variant` is `detail_10m` after successful local browser tests.
Both variants reached approximately 60 fps over the initial five-second samples;
first points appeared in approximately 0.05–0.07 seconds on this machine with
local files. These are initial progressive-render samples, not full dataset
transfer timings or guarantees for other hardware. Detailed rendering remained
responsive during navigation and repeated switching and visibly filled in more
structure, ground and vegetation. Development builds log first-point timing and
one initial frame-rate sample per load to help reproduce this comparison.

The visible-point budget is capped at 2M (1M for the preview); finer nodes are
streamed from the full 10M dataset as the view changes. The header shows total
dataset points; the footer shows currently visible points. GPU speed, viewport,
point size and view position affect performance. No external binary files,
SQLite records, association CSV records, Client View or Export changes are needed.

## Terrestrial Survey on Asset Map

The Real Map View reads enabled polygon footprints from each terrestrial dataset's
`map` configuration. Coordinates use Leaflet latitude/longitude order. MH_SUB_1
uses the four supplied Manitoba Hydro corners; its amber dashed polygon is a
separate Terrestrial Survey entity, not an asset marker or SQLite row.

The survey popup displays source/web point counts, panorama count, and association
count read from the evidence API (refreshed whenever the popup opens). Failed
association reads display Unavailable rather than a fabricated zero. Open 3D
uses the dataset's default detail; Browse Panoramas starts its panorama browser;
View Dataset opens the terrestrial summary. Survey interaction does not change
the selected pole/structure. A Survey shortcut fits the footprint; Fit all assets
includes both filtered asset coordinates and enabled survey polygons. Zoom to
selected still focuses the selected normal asset. Asset filters do not hide the
independent survey layer; QA Canvas and Register Table remain asset-only.

The footprint is provisional for POC visualization. The original coordinates are
consistent with UTM Zone 14N, the E57 coordinateMetadata is blank, and the datum
has not been authoritatively verified. The UI does not claim survey certification.
Basemap tiles still require the existing OpenStreetMap connection; polygon and
asset overlays remain usable if tiles are unavailable. Admin Review and Client
View receive no survey layer. Export remains the final tab and its data is unchanged.

Map configuration tests: `node --test src/surveyMap.test.js`.

## Manual Scan / Panorama Stations

The 3D viewer's Scan Stations panel places individual setups on actual visible
cloud points. Choose an unplaced setup, select Place Scan Station, click a rendered
surface, inspect the temporary marker/native XYZ, and explicitly Save Station or
Cancel. Dragging still orbits; empty-space clicks do not invent a depth. Edit Position
requires a new pick and explicit save. Delete Station asks for confirmation.
Saved markers are labeled by setup; selecting one opens its detail card. The Saved
Station selector focuses markers that are outside the current view.

CSV source: `data/terrestrial_stations.csv`, initially header only:
`dataset_id,setup_id,panorama_file,x,y,z,placement_method,orientation_status,notes`.
Every row is `manual_3d` / `unknown`. No station positions are seeded or inferred.
This is separate from asset associations and never writes to SQLite.

Routes:
- `GET /api/terrestrial-stations`: all saved stations.
- `GET /api/terrestrial-stations/:datasetId`: saved stations for a configured dataset.
- `POST /api/terrestrial-stations`: create one station with the CSV fields (XYZ JSON numbers).
- `PUT /api/terrestrial-stations/:datasetId/:setupId`: replace coordinates/notes,
  with all fields and `expected` containing the full previously read station.
- `DELETE /api/terrestrial-stations/:datasetId/:setupId`: body `{ "expected": <previous station> }`.

Creates/edits validate the configured dataset, exact setup/filename, real JPEG,
finite numeric XYZ, fixed placement/orientation statuses and notes up to 2000 chars.
Duplicates, stale updates and active locks return 409; invalid input returns 400.
Reads of unknown datasets return 404. Obsolete stations can be deleted even when
their panorama is no longer available. Same local UI origin and JSON are required
for browser mutations. This remains the existing local admin POC, not a new auth system.

Writes take an exclusive sibling lock, strictly parse the CSV, preserve header/BOM/
newlines, quote notes, fsync a complete temporary file, save previous valid bytes
atomically to `.bak`, then rename the new CSV in place. Invalid CSV is never replaced.
Transaction/backup files are ignored by Git. After a crash, stop all POC API processes
before inspecting the CSV, its `.bak`, and any stale `.lock`; restore only a verified
backup and clear a stale lock manually. Do not edit CSV while the API is writing it.

Picking examines decoded visible nodes once per click, within ten CSS pixels of the
pointer, choosing the front point. Each node's world transform is applied; the
viewer's survey-coordinate center is then added back. CSV stores the native/global
XYZ at full decoded precision, not display pixels. Markers subtract the selected
variant's center when drawn, so switching between 1M and 10M preserves coordinates.
Point picking depends on current level of detail. The picked surface is only a manual
proxy for a station location; it does not recover the Leica optical/scanner origin,
scanner height, orientation, or an authoritative datum. Orientation stays unknown.
Markers are projected overlay labels and may be visible through intervening cloud
geometry. Their screen position is never persisted.

Open Panorama selects the saved setup directly. Return to 3D Station is offered only
for saved stations, opens the default detail, focuses about 20 native units from the
station and highlights its label. There is no panorama yaw synchronization. Nearby
Stations lists up to three saved neighbors by approximate Euclidean XYZ distance
(in metres for this dataset); unsaved stations are never included.

Tests: `node --test server/terrestrial-stations.test.js src/stationGeometry.test.js`.
The first station milestone was delivered with a header-only CSV; subsequent manual placements belong to the user.


### Saved-station spatial navigation

Nearby Stations derives up to three same-dataset neighbors dynamically from saved finite native XYZ using Euclidean distance. Results are sorted by distance (setup ID only breaks ties). No relationship file is created. Unplaced panoramas show "No 3D station position assigned." A placed panorama with no other saved stations shows an empty-neighbor message.

Panorama Go changes the current setup and its evidence/image controls; station data reloads for each setup. Return to 3D always uses that current saved row, including after multiple nearby hops. Failed station reads offer Retry Stations.

The 3D selected-station card provides Focus Station and nearby buttons. Focusing interpolates camera/target over 650 ms, highlights the destination and keeps the panorama closed. Orbit input, zoom and fit/reset interrupt travel. Reduced-motion preferences use immediate focus. Show Station Connections defaults off and draws at most three native-coordinate line segments from the selected station, rebased with the cloud. Geometry/materials are disposed with the viewer and rebuilt after edits/deletions. Connections are straight spatial relationships, not safe walking routes, and may be obscured by cloud geometry.

All positions/distances remain manual/provisional; units assume the dataset's metre-based native coordinates. No compass arrows, yaw synchronization, scanner-origin recovery or survey certification is implied. Other-window edits appear after Refresh Stations or the next panorama hop; there is no live push synchronization.

Navigation regression tests: `node --test src/stationNeighbors.test.js src/stationGeometry.test.js`. Browser verification uses the existing Setup 001 plus two temporary placements picked from the real cloud; temporary records are removed afterward.


### Walk / Fly and panorama context

Navigation Mode retains Orbit and adds free flight. Enter Walk / Fly (or Resume Walk) explicitly focuses the canvas. WASD move relative to camera look, Q/E move along native Z, Shift temporarily triples speed. Slow/Normal/Fast are 1/5/20 native metres per second, using elapsed frame time and normalized combined movement. Long frames are capped at 100 ms to avoid a jump after suspension.

Mouse look uses left-button drag with temporary pointer capture, not pointer lock. Release the button to release capture; Escape pauses movement. Canvas/window blur and page hiding clear held keys and capture. Clicking a UI control pauses flight; Resume Walk reactivates it. Keyboard events are confined to the canvas, so forms remain usable. Drag-to-look clamps pitch near the poles and uses the survey Z-up axis. No gravity, collision, eye height, walking paths or pose inference is added.

Point Cloud / View Panorama switching keeps an in-memory per-dataset React snapshot of native camera position/target, variant, color, point size, navigation mode, speed, selected station and connection toggle. Returning to the same station restores the prior camera without fitting; returning from a different nearby panorama highlights/focuses that current station while preserving display/navigation settings. Flight always resumes paused until an explicit Resume Walk. Snapshots are not written to CSV, SQLite or browser storage, and are lost on page reload or leaving the terrestrial workspace. Source station coordinates remain in terrestrial_stations.csv. Panorama heading is independent; orientation remains unknown.

Regression tests include `node --test src/flyNavigation.test.js` for movement, elapsed-time independence, look, native camera restoration and input release.

Station placement/edit mode switches to Orbit so the existing placement navigation stays available. Releasing a mouse-look drag keeps any held movement keys active; Escape or focus loss clears both.


### Local 360-degree panorama viewer

360 View is the default; Flat Image retains the original zoom/pan inspection viewer. The existing restricted JPEG routes supply the original 4096x2048 image; nothing is copied into Git. Three.js renders one sRGB texture inside an inverted sphere using a centered perspective camera. Drag or arrow keys look around, wheel/buttons change vertical FOV (35–100 degrees), Reset View returns to yaw/pitch zero and 75-degree FOV. Yaw wraps; pitch clamps to ±85 degrees. Zero is an arbitrary image direction, never north or Leica-derived orientation.

Per-image yaw/pitch/FOV stays in a React ref owned by the terrestrial workspace, including a point-cloud round trip, with no disk/SQLite/browser-storage writes. Existing 3D snapshots and current-panorama station selection are retained. Enter Fullscreen uses the browser API on the panorama experience container so setup navigation, saved-neighbor links, Point Cloud and Flat Image remain available. Escape exits normally; unsupported/denied fullscreen shows a message. Unplaced setups are labelled Not assigned. Saved station positions remain Manual / Provisional, orientation Unknown.

Only the current JPEG is fetched. Requests abort on changes; late decoded bitmaps close without rendering. Geometry, texture, material, bitmap, renderer, observers, capture and event listeners are cleaned up on setup changes or exit. Rendering is on demand (drag, zoom, resize, load), avoiding continuous idle GPU work. Point-cloud rendering is unmounted while viewing panoramas. Prefetch is intentionally omitted. Missing/invalid images and WebGL errors offer Retry 360 View and Flat Image. Devices unable to accept the full 4096-wide texture use the fallback instead of silently downscaling it.

Local development CORS and terrestrial mutation origin checks share the exact allowlist http://127.0.0.1:5173 and http://localhost:5173. Responses vary by Origin; no wildcard or credential access is added. Existing same-origin range streaming remains available.

Additional tests: `node --test src/panoramaView.test.js server/dev-origin.test.js`. Fullscreen/browser GPU behavior requires a manual check on the target device.

### Ground Walk and Real World
The point-cloud navigation modes are Orbit, Ground Walk and Fly. Ground Walk uses horizontal WASD movement, drag-look, Shift acceleration and a manual level plane. Set Ground Here treats the current camera's native Z as ground and raises the eye by 1.5/1.7/1.9 m (default 1.7). Fly to a suitable reference elevation before setting it. Return to Ground retains X/Y and look direction and returns to that saved plane. Fit/Reset switches Ground Walk to Orbit for a useful overview; the walking reference remains available. This is not terrain detection, gravity, collision handling or survey-certified positioning.

POINT CLOUD / REAL WORLD switches between Potree and captured Leica panorama imagery. The spatial Real World action uses selected saved XYZ only; nearest saved station distance is full Euclidean XYZ, recomputed four times per second from the native camera position. A marker within 10 m receives a subtle highlight. No panorama opens or camera moves automatically. Unplaced panoramas remain browsable without spatial claims.

Native camera state, mode, speed, ground Z, eye height, cloud detail, color, point size and connection setting remain in memory within Terrestrial Data. Returning from a different placed panorama selects that current station; Ground Walk/Fly repositions nearby while retaining look direction, with Ground Walk constrained to its saved plane. Resume Ground Walk explicitly enters that mode. Orientation remains unknown and independent of the photograph. Real-world station records are not filtered by placement method, allowing future Leica-derived positions; no orientation support is inferred. No SQLite or CSV changes are made by navigation.

If Resume Ground Walk is chosen from a saved panorama before any walking plane exists, its saved provisional station Z is used as the initial manual reference. This is disclosed beside the action; it is not a detected or certified ground surface.

### Scan Station Placement Workbench
Open Station Placement from the Terrestrial Data dataset card. The desktop workbench keeps one Potree renderer mounted alongside the existing 360/Flat Image viewer while the setup queue changes. 10M remains default; detail, color, point size and camera stay in place when moving between setups. Both viewers use the existing secure local data routes.

Select an unplaced setup and choose Place Setup. Clicking a rendered cloud point creates a magenta, unsaved candidate. Review native XYZ and optional notes, then Save or Save & Next. Save & Next advances forward through the active All/Placed/Unplaced queue only after the API succeeds; at the end it stays on the saved setup. Cancel drops the candidate; Reposition asks for a new point. Queue progress counts configured setups only and is not a registration-quality score.

Saved positions require Edit Position before replacement and a second confirmation before PUT. Delete also requires confirmation. Existing optimistic-concurrency checks prevent stale overwrite/deletion. Candidates and notes survive failed saves. Setup/queue changes, dataset exit and application tabs prompt Discard / Stay while a draft exists; browser reload/close uses the standard unsaved-page warning. Requests in flight block workbench navigation. Only explicit save/delete actions write the station CSV; SQLite, evidence associations and panorama orientation are untouched. Normal viewer navigation reloads the same CSV-backed API automatically on entry.

Manual placements remain Manual / Provisional with unknown orientation. Picking finds a visible source point, not an automatically recovered scanner pose. No compass, registration, pose import, collision or matching algorithm is added. Fullscreen remains available in the normal panorama browser. Workbench views run together; panorama rendering is on demand and the existing point-cloud budget remains bounded.

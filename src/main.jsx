import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import L from 'leaflet';
import { MapContainer, Marker, Polyline, Popup, TileLayer, Tooltip, useMap } from 'react-leaflet';
import { ArrowLeft, ArrowRight, BarChart3, CheckCircle2, Download, Eye, FileWarning, Gauge, Layers, ListFilter, LocateFixed, Map, MapPin, Maximize2, Minus, PlayCircle, Plus, RotateCcw, Save, ShieldCheck, SlidersHorizontal, Table2 } from 'lucide-react';
import 'leaflet/dist/leaflet.css';
import './styles.css';

const emptyForm = {
  component_type: 'Transformer',
  component_subtype: '',
  quantity: 1,
  phase: 'Unknown',
  material: '',
  manufacturer: '',
  model: '',
  serial_number: '',
  install_year: '',
  asset_tag: '',
  nameplate_visible: 'Not Applicable',
  condition_rating: 'Unknown',
  verified_status: 'Human Verified',
  source_media: '',
  reviewer_notes: ''
};

function api(path, options) {
  return fetch(`http://127.0.0.1:4000/api${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
    body: options?.body ? JSON.stringify(options.body) : undefined
  }).then(async response => {
    if (!response.ok) throw new Error((await response.json()).error || 'Request failed');
    return response.json();
  });
}

function Badge({ value }) {
  const tone = {
    'Field Verified': 'good',
    'Export Ready': 'good',
    'Human Verified': 'good',
    'Local Ready': 'good',
    Clear: 'good',
    'Data Exception Found': 'warn',
    'Client Review Required': 'warn',
    'Needs Client Review': 'warn',
    'Data Concern': 'warn',
    'Not Export Ready': 'warn',
    'AI Candidate': 'info',
    'Pending Review': 'info',
    Imported: 'neutral',
    Rejected: 'bad',
    Critical: 'bad'
  }[value] || 'neutral';
  return <span className={`badge ${tone}`}>{value || 'Unknown'}</span>;
}

function Header({ page, setPage }) {
  const items = ['Dashboard', 'Asset Map', 'Admin Review', 'Client View', 'Export'];
  return (
    <header className="topbar">
      <div>
        <div className="brand">PowerVizion</div>
        <div className="subtitle">Visual Asset Data Quality POC</div>
      </div>
      <nav>
        {items.map(item => (
          <button key={item} className={page === item ? 'active' : ''} onClick={() => setPage(item)}>{item}</button>
        ))}
      </nav>
    </header>
  );
}

function assetDerivedState(asset) {
  const reviewStatus = asset.review_status || 'Imported';
  const hasMedia = Number(asset.media_count || 0) > 0;
  const hasCandidates = Number(asset.candidate_count || 0) > 0;
  const hasComponents = Number(asset.component_count || 0) > 0;
  const hasExceptions = Number(asset.exception_count || 0) > 0;
  const text = `${asset.notes || ''} ${reviewStatus}`.toLowerCase();
  const locationIssue = text.includes('location') || text.includes('discrepancy');
  const needsReview = ['Imported', 'Pending Review', 'Field Review Started', 'Client Review Required', 'Data Exception Found'].includes(reviewStatus);
  const reviewed = ['Field Verified', 'Export Ready'].includes(reviewStatus) || hasComponents;
  const exportReady = reviewStatus === 'Export Ready' || (reviewed && !hasExceptions && !locationIssue);
  const dataQuality = hasExceptions || reviewStatus === 'Data Exception Found' || reviewStatus === 'Client Review Required' || locationIssue ? 'Concern' : 'Clear';
  let markerState = 'known';
  if (locationIssue || dataQuality === 'Concern') markerState = 'concern';
  else if (exportReady || reviewed) markerState = 'ready';
  else if (needsReview) markerState = 'needsReview';
  else if (hasCandidates) markerState = 'candidate';
  else if (hasMedia) markerState = 'media';
  return {
    hasMedia,
    hasCandidates,
    hasComponents,
    hasExceptions,
    locationIssue,
    needsReview,
    reviewed,
    exportReady,
    dataQuality,
    markerState,
    locationConfidence: Number.isFinite(asset.latitude) && Number.isFinite(asset.longitude) ? (locationIssue ? 'Needs validation' : 'Coordinate available') : 'No coordinate'
  };
}

function markerLabel(state) {
  return {
    known: 'Known asset',
    media: 'Media available',
    candidate: 'Candidate finding',
    needsReview: 'Needs review',
    ready: 'Reviewed / export ready',
    concern: 'Data-quality concern'
  }[state] || 'Known asset';
}

function unique(values) {
  return [...new Set(values.filter(value => value !== undefined && value !== null && value !== ''))];
}

function AssetMapPage({ assets, selectedId, setSelectedId, detail }) {
  const [view, setView] = useState('real');
  const [filters, setFilters] = useState({
    project: 'All',
    type: 'All',
    status: 'All',
    media: 'All',
    candidates: 'All',
    dataQuality: 'All',
    exportReady: 'All',
    quick: 'All Assets'
  });

  const enrichedAssets = useMemo(() => assets.map(asset => ({ ...asset, state: assetDerivedState(asset) })), [assets]);
  const projects = unique(enrichedAssets.map(asset => asset.project_id));
  const assetTypes = unique(enrichedAssets.map(asset => asset.asset_type));
  const statuses = unique(enrichedAssets.map(asset => asset.review_status));

  const filteredAssets = useMemo(() => enrichedAssets.filter(asset => {
    const state = asset.state;
    if (filters.project !== 'All' && asset.project_id !== filters.project) return false;
    if (filters.type !== 'All' && asset.asset_type !== filters.type) return false;
    if (filters.status !== 'All' && asset.review_status !== filters.status) return false;
    if (filters.media === 'With Media' && !state.hasMedia) return false;
    if (filters.media === 'Missing Media' && state.hasMedia) return false;
    if (filters.candidates === 'With Candidates' && !state.hasCandidates) return false;
    if (filters.candidates === 'No Candidates' && state.hasCandidates) return false;
    if (filters.dataQuality === 'Concerns' && state.dataQuality !== 'Concern') return false;
    if (filters.dataQuality === 'Clear' && state.dataQuality !== 'Clear') return false;
    if (filters.exportReady === 'Ready' && !state.exportReady) return false;
    if (filters.exportReady === 'Not Ready' && state.exportReady) return false;
    return true;
  }), [enrichedAssets, filters]);

  const selectedAsset = enrichedAssets.find(asset => asset.id === selectedId) || filteredAssets[0] || enrichedAssets[0];
  const selectedState = selectedAsset ? selectedAsset.state : null;

  useEffect(() => {
    if (filteredAssets.length && !filteredAssets.some(asset => asset.id === selectedId)) {
      setSelectedId(filteredAssets[0].id);
    }
  }, [filteredAssets, selectedId, setSelectedId]);

  function applyQuick(label) {
    const next = {
      project: 'All',
      type: 'All',
      status: 'All',
      media: 'All',
      candidates: 'All',
      dataQuality: 'All',
      exportReady: 'All',
      quick: label
    };
    if (label === 'Assets With Media') next.media = 'With Media';
    if (label === 'Assets Missing Media') next.media = 'Missing Media';
    if (label === 'Candidate Findings') next.candidates = 'With Candidates';
    if (label === 'Needs Review') next.status = 'Pending Review';
    if (label === 'Reviewed') next.status = 'Field Verified';
    if (label === 'Export Ready') next.exportReady = 'Ready';
    if (label === 'Location Issues') next.dataQuality = 'Concerns';
    setFilters(next);
  }

  const coordinates = filteredAssets
    .filter(asset => Number.isFinite(asset.latitude) && Number.isFinite(asset.longitude))
    .map(asset => ({ asset, lat: Number(asset.latitude), lon: Number(asset.longitude) }));
  const bounds = coordinates.reduce((acc, point) => ({
    minLat: Math.min(acc.minLat, point.lat),
    maxLat: Math.max(acc.maxLat, point.lat),
    minLon: Math.min(acc.minLon, point.lon),
    maxLon: Math.max(acc.maxLon, point.lon)
  }), { minLat: Infinity, maxLat: -Infinity, minLon: Infinity, maxLon: -Infinity });
  const latSpan = Math.max(bounds.maxLat - bounds.minLat, 1);
  const lonSpan = Math.max(bounds.maxLon - bounds.minLon, 1);
  const duplicateCounts = {};
  const plotted = coordinates.map((point, index) => {
    const key = `${point.lat}:${point.lon}`;
    const duplicateIndex = duplicateCounts[key] || 0;
    duplicateCounts[key] = duplicateIndex + 1;
    const offsetAngle = duplicateIndex * 1.35;
    const offsetRadius = duplicateIndex ? 4.5 + duplicateIndex * 2.5 : 0;
    return {
      ...point,
      x: 8 + ((point.lon - bounds.minLon) / lonSpan) * 84 + Math.cos(offsetAngle) * offsetRadius,
      y: 92 - ((point.lat - bounds.minLat) / latSpan) * 84 + Math.sin(offsetAngle) * offsetRadius,
      order: index
    };
  });
  const pathPoints = plotted
    .slice()
    .sort((a, b) => (a.asset.structure_number || a.asset.id).localeCompare(b.asset.structure_number || b.asset.id))
    .map(point => `${point.x},${point.y}`)
    .join(' ');
  const quickChips = ['All Assets', 'Assets With Media', 'Assets Missing Media', 'Candidate Findings', 'Needs Review', 'Reviewed', 'Export Ready', 'Location Issues'];
  const selectedIndex = Math.max(0, filteredAssets.findIndex(asset => asset.id === selectedId));
  const goRelative = direction => {
    if (!filteredAssets.length) return;
    const nextIndex = (selectedIndex + direction + filteredAssets.length) % filteredAssets.length;
    setSelectedId(filteredAssets[nextIndex].id);
  };

  return (
    <main className="assetMapPage">
      <section className="mapExplanation panel">
        <div>
          <p className="eyebrow">Geospatial asset register</p>
          <h1>Asset Map</h1>
          <p>Use the Asset Map to review where assets are located, confirm media coverage, inspect candidate findings, and identify which records are ready for client export.</p>
        </div>
        <Badge value="Local Ready" />
      </section>

      <section className="mapWorkspace">
        <aside className="mapFilters panel">
          <div className="panelHead">
            <div><h2>Register Controls</h2><p>Filter the same asset set used by the map and table</p></div>
            <ListFilter size={20} />
          </div>
          <div className="quickChips">
            {quickChips.map(label => (
              <button key={label} className={filters.quick === label ? 'chip activeChip' : 'chip'} onClick={() => applyQuick(label)}>{label}</button>
            ))}
          </div>
          <div className="filterGrid">
            <Select label="Line / Project" value={filters.project} options={['All', ...projects]} onChange={value => setFilters({ ...filters, project: value, quick: 'Custom' })} />
            <Select label="Asset Type" value={filters.type} options={['All', ...assetTypes]} onChange={value => setFilters({ ...filters, type: value, quick: 'Custom' })} />
            <Select label="Review Status" value={filters.status} options={['All', ...statuses]} onChange={value => setFilters({ ...filters, status: value, quick: 'Custom' })} />
            <Select label="Media Availability" value={filters.media} options={['All', 'With Media', 'Missing Media']} onChange={value => setFilters({ ...filters, media: value, quick: 'Custom' })} />
            <Select label="Candidate Finding Status" value={filters.candidates} options={['All', 'With Candidates', 'No Candidates']} onChange={value => setFilters({ ...filters, candidates: value, quick: 'Custom' })} />
            <Select label="Data Quality Status" value={filters.dataQuality} options={['All', 'Clear', 'Concerns']} onChange={value => setFilters({ ...filters, dataQuality: value, quick: 'Custom' })} />
            <Select label="Export Readiness" value={filters.exportReady} options={['All', 'Ready', 'Not Ready']} onChange={value => setFilters({ ...filters, exportReady: value, quick: 'Custom' })} />
          </div>
        </aside>

        <section className="mapCenter panel">
          <div className="panelHead">
            <div><h2>Visual QA Map Workspace</h2><p>{filteredAssets.length} of {assets.length} assets visible</p></div>
            <div className="viewToggle">
              <button className={view === 'real' ? 'activeToggle' : ''} onClick={() => setView('real')}><Map size={16} /> Real Map View</button>
              <button className={view === 'canvas' ? 'activeToggle' : ''} onClick={() => setView('canvas')}><Layers size={16} /> QA Canvas View</button>
              <button className={view === 'table' ? 'activeToggle' : ''} onClick={() => setView('table')}><Table2 size={16} /> Register Table View</button>
            </div>
          </div>
          <div className="viewHelp">
            <span>Real Map View uses stored GPS coordinates.</span>
            <span>QA Canvas View provides an offline local layout for review.</span>
            <span>Register Table View shows the same filtered asset set as structured data.</span>
          </div>

          {view === 'real' ? (
            <RealMapView plotted={plotted} selectedId={selectedId} setSelectedId={setSelectedId} />
          ) : view === 'canvas' ? (
            <div className="geoCanvas">
              {plotted.length ? (
                <svg viewBox="0 0 100 100" role="img" aria-label="Local asset map canvas">
                  <defs>
                    <pattern id="mapGrid" width="10" height="10" patternUnits="userSpaceOnUse">
                      <path d="M 10 0 L 0 0 0 10" fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="0.3" />
                    </pattern>
                  </defs>
                  <rect width="100" height="100" fill="url(#mapGrid)" />
                  {pathPoints && <polyline points={pathPoints} fill="none" stroke="rgba(56,214,189,0.32)" strokeWidth="0.9" strokeDasharray="2 2" />}
                  {plotted.map(point => {
                    const isSelected = point.asset.id === selectedId;
                    return (
                      <g
                        key={point.asset.id}
                        className={`geoMarker marker-${point.asset.state.markerState} ${isSelected ? 'selectedGeoMarker' : ''}`}
                        onClick={() => setSelectedId(point.asset.id)}
                        onKeyDown={event => {
                          if (event.key === 'Enter' || event.key === ' ') setSelectedId(point.asset.id);
                        }}
                        tabIndex="0"
                        role="button"
                        aria-label={`Select ${point.asset.id}`}
                      >
                        <circle className="markerHalo" cx={point.x} cy={point.y} r={isSelected ? 5.8 : 4.2} />
                        <circle className="markerCore" cx={point.x} cy={point.y} r={isSelected ? 2.6 : 2.1} />
                        <text x={point.x + 3.4} y={point.y - 2.4}>{point.asset.structure_number || point.asset.id}</text>
                      </g>
                    );
                  })}
                </svg>
              ) : (
                <div className="empty mapEmpty">No asset coordinates are available for the current filter.</div>
              )}
              <div className="mapLegend">
                {['known', 'media', 'candidate', 'needsReview', 'ready', 'concern'].map(state => (
                  <span key={state}><i className={`legendDot marker-${state}`} />{markerLabel(state)}</span>
                ))}
              </div>
            </div>
          ) : (
            <RegisterTable assets={filteredAssets} selectedId={selectedId} setSelectedId={setSelectedId} />
          )}
        </section>

        <AssetMapDetail detail={detail} selectedAsset={selectedAsset} selectedState={selectedState} onPrevious={() => goRelative(-1)} onNext={() => goRelative(1)} />
      </section>
    </main>
  );
}

function RealMapView({ plotted, selectedId, setSelectedId }) {
  return <InteractiveAssetMap assets={plotted.map(point => point.asset)} selectedId={selectedId} setSelectedId={setSelectedId} className="realMapCanvas" />;
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  }[char]));
}

function reviewStatusClass(status) {
  const normalized = String(status || '').toLowerCase();
  if (normalized.includes('export')) return 'pv-map-marker--export';
  if (normalized.includes('field verified')) return 'pv-map-marker--verified';
  if (normalized.includes('data exception')) return 'pv-map-marker--exception';
  if (normalized.includes('client review')) return 'pv-map-marker--client-review';
  if (normalized.includes('pending')) return 'pv-map-marker--pending';
  return 'pv-map-marker--imported';
}

function assetTypeClass(assetType) {
  return String(assetType || '').toLowerCase().includes('distribution') ? 'pv-map-marker--distribution' : 'pv-map-marker--structure';
}

function makeAssetIcon(asset, selectedId) {
  const selected = asset.id === selectedId ? 'pv-map-marker--selected' : '';
  const shape = assetTypeClass(asset.asset_type);
  const status = reviewStatusClass(asset.review_status);
  const label = escapeHtml(asset.structure_number || asset.id);
  return L.divIcon({
    className: `pv-map-marker ${shape} ${status} ${selected}`,
    html: `<span class="pv-map-marker__dot"></span><span class="pv-map-marker__label">${label}</span>`,
    iconSize: [22, 22],
    iconAnchor: [11, 11],
    popupAnchor: [0, -18]
  });
}

function validMapAssets(assets) {
  return assets.filter(asset => Number.isFinite(Number(asset.latitude)) && Number.isFinite(Number(asset.longitude)));
}

function MapSync({ assets, selectedId, focusSignal, fitSignal }) {
  const map = useMap();
  const boundsKey = assets.map(asset => `${asset.id}:${asset.latitude}:${asset.longitude}`).join('|');
  const selectedAsset = assets.find(asset => asset.id === selectedId);

  useEffect(() => {
    if (!assets.length) return;
    const bounds = L.latLngBounds(assets.map(asset => [Number(asset.latitude), Number(asset.longitude)]));
    if (bounds.isValid()) map.fitBounds(bounds, { padding: [46, 46], maxZoom: 15 });
  }, [map, boundsKey, fitSignal]);

  useEffect(() => {
    if (!selectedAsset) return;
    map.flyTo([Number(selectedAsset.latitude), Number(selectedAsset.longitude)], Math.max(map.getZoom(), 15), { duration: 0.45 });
  }, [map, selectedAsset?.id, focusSignal]);

  return null;
}

function LeafletControlButtons({ onFitAll, onZoomSelected, tileError }) {
  const map = useMap();
  return (
    <div className="leafletControlPanel">
      <button type="button" onClick={() => map.zoomIn()} aria-label="Zoom in"><Plus size={15} /></button>
      <button type="button" onClick={() => map.zoomOut()} aria-label="Zoom out"><Minus size={15} /></button>
      <button type="button" onClick={onZoomSelected}><LocateFixed size={15} /> Zoom to selected</button>
      <button type="button" onClick={onFitAll}><Maximize2 size={15} /> Fit all assets</button>
      {tileError && <span>Basemap tiles unavailable; markers remain interactive.</span>}
    </div>
  );
}

function InteractiveAssetMap({ assets, selectedId, setSelectedId, className = '', readOnly = false }) {
  const [tileError, setTileError] = useState(false);
  const [focusSignal, setFocusSignal] = useState(0);
  const [fitSignal, setFitSignal] = useState(0);
  const mapAssets = validMapAssets(assets);
  const centerAsset = mapAssets.find(asset => asset.id === selectedId) || mapAssets[0];
  const routePositions = mapAssets
    .slice()
    .sort((a, b) => (a.structure_number || a.id).localeCompare(b.structure_number || b.id))
    .map(asset => [Number(asset.latitude), Number(asset.longitude)]);

  useEffect(() => setTileError(false), [mapAssets.map(asset => asset.id).join('|')]);

  if (!mapAssets.length) return <div className="empty mapEmpty">No GPS coordinates are available for the current filter.</div>;

  return (
    <div className={`interactiveMapShell ${className}`}>
      {tileError && (
        <div className="tileFallback">
          Basemap tiles are unavailable in this environment. Markers remain interactive; use QA Canvas View for a fully offline layout.
        </div>
      )}
      <MapContainer
        center={[Number(centerAsset.latitude), Number(centerAsset.longitude)]}
        zoom={14}
        scrollWheelZoom
        zoomControl={false}
        className="leafletMap"
      >
        <TileLayer
          attribution="&copy; OpenStreetMap contributors"
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          eventHandlers={{ tileerror: () => setTileError(true) }}
        />
        <MapSync assets={mapAssets} selectedId={selectedId} focusSignal={focusSignal} fitSignal={fitSignal} />
        <LeafletControlButtons
          tileError={tileError}
          onFitAll={() => setFitSignal(value => value + 1)}
          onZoomSelected={() => setFocusSignal(value => value + 1)}
        />
        {routePositions.length > 1 && <Polyline positions={routePositions} pathOptions={{ color: '#38d6bd', weight: 3, opacity: 0.65, dashArray: '8 8' }} />}
        {mapAssets.map(asset => (
          <Marker
            key={asset.id}
            position={[Number(asset.latitude), Number(asset.longitude)]}
            icon={makeAssetIcon(asset, selectedId)}
            eventHandlers={{ click: () => setSelectedId(asset.id) }}
            keyboard
          >
            <Tooltip direction="top" offset={[0, -18]} opacity={0.95}>{asset.id}</Tooltip>
            <Popup>
              <div className="assetPopup">
                <strong>{asset.id}</strong>
                <span>{asset.structure_number || asset.id}</span>
                <span>{asset.asset_type}</span>
                <span>{asset.media_count || 0} media | {asset.candidate_count || 0} candidates</span>
                <Badge value={asset.review_status} />
              </div>
            </Popup>
          </Marker>
        ))}
      </MapContainer>
      <div className="gpsMapMeta">
        <span>GPS Coordinates</span>
        <strong>{readOnly ? 'Read-only' : 'Interactive'}</strong>
        <span>{mapAssets.length} assets plotted from stored latitude/longitude</span>
      </div>
      <div className="mapLegend realLegend">
        {[
          ['pv-map-marker--pending', 'Pending Review'],
          ['pv-map-marker--verified', 'Field Verified'],
          ['pv-map-marker--exception', 'Data Exception Found'],
          ['pv-map-marker--client-review', 'Client Review Required'],
          ['pv-map-marker--export', 'Export Ready']
        ].map(([className, label]) => (
          <span key={className}><i className={`legendDot ${className}`} />{label}</span>
        ))}
        <span><i className="legendShape pv-map-marker--structure" />8K structure</span>
        <span><i className="legendShape pv-map-marker--distribution" />Alley pole</span>
      </div>
    </div>
  );
}

function RegisterTable({ assets, selectedId, setSelectedId }) {
  if (!assets.length) return <div className="empty">No assets match the current filters.</div>;
  return (
    <div className="tableWrap registerTable">
      <table>
        <thead>
          <tr>
            <th>Asset ID</th>
            <th>Asset Type</th>
            <th>Line / Project</th>
            <th>Latitude</th>
            <th>Longitude</th>
            <th>Media Count</th>
            <th>Candidate Count</th>
            <th>Review Status</th>
            <th>Data Quality Status</th>
            <th>Export Ready</th>
          </tr>
        </thead>
        <tbody>
          {assets.map(asset => (
            <tr key={asset.id} className={asset.id === selectedId ? 'selectedRow' : ''} onClick={() => setSelectedId(asset.id)}>
              <td>{asset.id}</td>
              <td>{asset.asset_type}</td>
              <td>{asset.project_id || 'Local POC'}</td>
              <td>{asset.latitude ?? '-'}</td>
              <td>{asset.longitude ?? '-'}</td>
              <td>{asset.media_count || 0}</td>
              <td>{asset.candidate_count || 0}</td>
              <td><Badge value={asset.review_status} /></td>
              <td><Badge value={asset.state.dataQuality === 'Concern' ? 'Data Concern' : 'Clear'} /></td>
              <td>{asset.state.exportReady ? 'Yes' : 'Not yet'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function AssetMapDetail({ detail, selectedAsset, selectedState, onPrevious, onNext }) {
  const media = detail?.asset?.id === selectedAsset?.id ? detail.media || [] : [];
  const detections = detail?.asset?.id === selectedAsset?.id ? detail.detections || [] : [];
  const asset = detail?.asset?.id === selectedAsset?.id ? detail.asset : selectedAsset;
  if (!asset || !selectedState) {
    return <aside className="assetMapDetail panel"><div className="empty">Select an asset to review its visual QA profile.</div></aside>;
  }
  return (
    <aside className="assetMapDetail panel">
      <div className="panelHead">
        <div><h2>Selected Asset Detail</h2><p>Client-ready record status</p></div>
        <div className="detailNav">
          <button onClick={onPrevious} aria-label="Previous asset"><ArrowLeft size={16} /></button>
          <button onClick={onNext} aria-label="Next asset"><ArrowRight size={16} /></button>
        </div>
      </div>
      <div className="detailIdentity">
        <p className="eyebrow">{asset.id}</p>
        <h3>{asset.structure_number || asset.id}</h3>
        <span>{asset.asset_type}</span>
      </div>
      <div className="detailStats">
        <div><strong>{asset.latitude ?? '-'}</strong><span>Latitude</span></div>
        <div><strong>{asset.longitude ?? '-'}</strong><span>Longitude</span></div>
        <div><strong>{asset.project_id || 'Local POC'}</strong><span>Line / Project</span></div>
        <div><strong>{asset.media_count || media.length || 0}</strong><span>Media Coverage</span></div>
        <div><strong>{asset.candidate_count || detections.length || 0}</strong><span>Candidate Finding</span></div>
        <div><strong>{selectedState.locationConfidence}</strong><span>Location Confidence</span></div>
      </div>
      <div className="statusStack">
        <div><span>Review Status</span><Badge value={asset.review_status} /></div>
        <div><span>Data Quality</span><Badge value={selectedState.dataQuality === 'Concern' ? 'Data Concern' : 'Clear'} /></div>
        <div><span>Client-Ready Record</span><Badge value={selectedState.exportReady ? 'Export Ready' : 'Not Export Ready'} /></div>
      </div>
      <section className="detailSection">
        <h3>Visual Evidence</h3>
        {media.length ? (
          <div className="evidenceStrip">
            {media.slice(0, 6).map(item => (
              <a key={item.id} href={item.url} target="_blank" rel="noreferrer">
                <img src={item.url} alt={item.caption || item.file_name} />
                <span>{item.caption || item.file_name}</span>
              </a>
            ))}
          </div>
        ) : (
          <div className="empty">Visual evidence loads when the selected asset detail is ready.</div>
        )}
      </section>
      <section className="detailSection">
        <h3>Candidate Findings</h3>
        {detections.length ? (
          <div className="findingList">
            {detections.slice(0, 5).map(detection => (
              <div key={detection.id}>
                <strong>{detection.component_type}</strong>
                <span>{detection.component_subtype || 'Candidate finding'} | {(detection.confidence * 100).toFixed(0)}%</span>
              </div>
            ))}
          </div>
        ) : (
          <div className="empty">No candidate findings for this asset.</div>
        )}
      </section>
    </aside>
  );
}

function Dashboard({ summary, assets, setPage, setSelectedId }) {
  const cards = [
    ['Assets', summary.assets, MapPin, 'field locations'],
    ['Media', summary.media, Eye, '8K frames + pole photos'],
    ['Candidates', summary.candidates, SlidersHorizontal, 'seeded detections'],
    ['Approved', summary.components, ShieldCheck, 'component records'],
    ['Exceptions', summary.exceptions, FileWarning, 'data-quality flags'],
    ['Client review', summary.clientReview, Gauge, 'requires signoff']
  ];
  const demoSteps = [
    ['Open Admin Review', 'Start the reviewer workflow'],
    ['Click DEMO-STR-001', 'Select the first 8K structure'],
    ['Review 8K media', 'Move through linked evidence'],
    ['Approve component', 'Promote a candidate to a record'],
    ['Add missing data exception', 'Flag nameplate or install-year gaps'],
    ['Open alley pole', 'Switch to an alley distribution asset'],
    ['Show Client View', 'Present approved records only'],
    ['Export register', 'Download the CSV data-quality register']
  ];
  const openDemoReview = () => {
    const demoAsset = assets.find(asset => asset.id === 'DEMO-STR-001') || assets[0];
    if (demoAsset) setSelectedId(demoAsset.id);
    setPage('Admin Review');
  };
  const mapPositions = assets.map((asset, index) => ({
    asset,
    left: 14 + ((index * 19) % 72),
    top: 24 + ((index * 13) % 52)
  }));
  return (
    <main className="page">
      <section className="intro">
        <div>
          <p className="eyebrow">Standalone meeting demo</p>
          <h1>Field-verified visual asset data quality workflow</h1>
          <p>Connect 8K inspection frames and pole photos to asset locations, convert visible components into structured records, and export a client-ready data-quality register.</p>
        </div>
        <div className="introActions">
          <button onClick={openDemoReview}><SlidersHorizontal size={17} /> Admin Review</button>
          <button onClick={() => setPage('Client View')}><Eye size={17} /> Client View</button>
        </div>
      </section>
      <section className="metricGrid">
        {cards.map(([label, value, Icon, helper]) => (
          <div className="metric" key={label}>
            <div className="metricIcon"><Icon size={20} /></div>
            <span>{label}</span>
            <strong>{value ?? 0}</strong>
            <small>{helper}</small>
          </div>
        ))}
      </section>
      <div className="dashboardGrid">
        <section className="mapPanel">
          <div className="panelHead">
            <div><h2>Asset Location Register</h2><p>Local demo dataset loaded from workspace files</p></div>
            <Badge value="Local Ready" />
          </div>
          <div className="assetMap">
            {mapPositions.map(({ asset, left, top }) => (
              <button className="mapAsset" key={asset.id} style={{ left: `${left}%`, top: `${top}%` }} onClick={() => { setSelectedId(asset.id); setPage('Admin Review'); }}>
                <span />
                <small>{asset.structure_number}</small>
              </button>
            ))}
          </div>
          <div className="mapPanelFooter">
            <button onClick={openDemoReview}><MapPin size={17} /> Open Admin Review Map</button>
          </div>
        </section>
        <section className="panel demoFlow">
          <div className="panelHead">
            <div><h2>Meeting Demo Flow</h2><p>Use this sequence for the live walkthrough</p></div>
            <PlayCircle size={22} />
          </div>
          <ol>
            {demoSteps.map(([title, detail], index) => (
              <li key={title}>
                <span>{index + 1}</span>
                <div><strong>{title}</strong><small>{detail}</small></div>
              </li>
            ))}
          </ol>
          <div className="demoActions">
            <button onClick={openDemoReview}><SlidersHorizontal size={17} /> Start Review</button>
            <button onClick={() => setPage('Export')}><Download size={17} /> Export</button>
          </div>
        </section>
      </div>
    </main>
  );
}

function AssetList({ assets, selectedId, setSelectedId }) {
  return (
    <aside className="assetList">
      <div className="panelHead"><div><h2>Assets</h2><p>Click a structure or alley pole</p></div><span>{assets.length}</span></div>
      {assets.map(asset => (
        <button key={asset.id} className={selectedId === asset.id ? 'selected assetButton' : 'assetButton'} onClick={() => setSelectedId(asset.id)}>
          <div className="assetButtonTop"><strong>{asset.structure_number}</strong><Badge value={asset.review_status} /></div>
          <code>{asset.id}</code>
          <span>{asset.asset_type}</span>
          <small>{asset.media_count || 0} media | {asset.candidate_count || 0} candidates | {asset.component_count || 0} approved</small>
        </button>
      ))}
    </aside>
  );
}

function MediaViewer({ detail, mediaIndex, setMediaIndex }) {
  const media = detail?.media || [];
  const current = media[mediaIndex] || media[0];
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [dragStart, setDragStart] = useState(null);
  useEffect(() => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
    setDragStart(null);
  }, [current?.id]);
  if (!current) return <section className="panel mediaViewer">No linked media</section>;
  const next = () => setMediaIndex((mediaIndex + 1) % media.length);
  const previous = () => setMediaIndex((mediaIndex - 1 + media.length) % media.length);
  const resetZoom = () => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
    setDragStart(null);
  };
  const changeZoom = amount => {
    setZoom(value => {
      const nextZoom = Math.max(1, Math.min(4, Number((value + amount).toFixed(1))));
      if (nextZoom === 1) setPan({ x: 0, y: 0 });
      return nextZoom;
    });
  };
  return (
    <section className="panel mediaViewer">
      <div className="panelHead">
        <div><h2>Linked Media</h2><p>{mediaIndex + 1} of {media.length} evidence files</p></div>
        <div className="mediaControls">
          <button type="button" onClick={previous} aria-label="Previous media"><ArrowLeft size={16} /></button>
          <button type="button" onClick={next} aria-label="Next media"><ArrowRight size={16} /></button>
          <button type="button" onClick={() => changeZoom(0.25)} aria-label="Zoom in"><Plus size={16} /></button>
          <button type="button" onClick={() => changeZoom(-0.25)} aria-label="Zoom out"><Minus size={16} /></button>
          <button type="button" onClick={resetZoom} aria-label="Reset zoom"><RotateCcw size={16} /></button>
          <Badge value={current.capture_method} />
        </div>
      </div>
      <div
        className={zoom > 1 ? 'imageShell zoomedImageShell' : 'imageShell'}
        onMouseDown={event => {
          if (zoom <= 1) return;
          setDragStart({ mouseX: event.clientX, mouseY: event.clientY, panX: pan.x, panY: pan.y });
        }}
        onMouseMove={event => {
          if (!dragStart) return;
          setPan({
            x: dragStart.panX + event.clientX - dragStart.mouseX,
            y: dragStart.panY + event.clientY - dragStart.mouseY
          });
        }}
        onMouseUp={() => setDragStart(null)}
        onMouseLeave={() => setDragStart(null)}
      >
        <img src={current.url} alt={current.caption} style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})` }} draggable="false" />
        <span className="zoomReadout">{Math.round(zoom * 100)}%</span>
      </div>
      <div className="mediaMeta">
        <span>{current.id}</span>
        <strong>{current.file_name}</strong>
        <span>{current.caption}</span>
        <span>Frame {current.frame_number || 'n/a'} {current.timecode ? `| ${current.timecode}` : ''}</span>
      </div>
      <div className="thumbs">
        {media.map((item, index) => (
          <button key={item.id} className={index === mediaIndex ? 'activeThumb' : ''} onClick={() => setMediaIndex(index)}>
            <span>{index + 1}</span>
            <small>{item.caption || item.file_name}</small>
          </button>
        ))}
      </div>
    </section>
  );
}

function AdminReview({ assets, selectedId, setSelectedId, detail, reload, options }) {
  const [mediaIndex, setMediaIndex] = useState(0);
  const [form, setForm] = useState(emptyForm);
  const [exception, setException] = useState({ exception_type: 'Missing nameplate data', recommended_action: '', reviewer_notes: '' });

  useEffect(() => setMediaIndex(0), [selectedId]);
  useEffect(() => {
    const firstMedia = detail?.media?.[0]?.id || '';
    setForm(prev => ({ ...emptyForm, source_media: firstMedia, component_type: options['Component Type']?.[0] || prev.component_type }));
  }, [detail?.asset?.id, options]);

  async function approveDetection(detection) {
    await api('/components', {
      method: 'POST',
      body: {
        ...emptyForm,
        asset_location_id: detail.asset.id,
        detection_id: detection.id,
        component_type: detection.component_type,
        component_subtype: detection.component_subtype,
        source_media: detection.media_id,
        reviewer_notes: detection.notes
      }
    });
    await reload();
  }

  async function saveComponent(event) {
    event.preventDefault();
    await api('/components', { method: 'POST', body: { ...form, asset_location_id: detail.asset.id } });
    await reload();
  }

  async function saveException(event) {
    event.preventDefault();
    await api('/exceptions', { method: 'POST', body: { ...exception, asset_location_id: detail.asset.id, component_id: null, export_status: 'Open' } });
    await reload();
  }

  async function setStatus(review_status) {
    await api(`/assets/${detail.asset.id}/status`, { method: 'PATCH', body: { review_status } });
    await reload();
  }

  return (
    <main className="reviewLayout">
      <AssetList assets={assets} selectedId={selectedId} setSelectedId={setSelectedId} />
      <div className="reviewMain">
        {detail && (
          <>
            <section className="assetHeader panel">
              <div>
                <p className="eyebrow">{detail.asset.id}</p>
                <h1>{detail.asset.structure_number}</h1>
                <span>{detail.asset.asset_type} | {detail.asset.client_asset_tag} | {detail.asset.latitude}, {detail.asset.longitude}</span>
                <div className="debugStatus">
                  <span>Selected asset ID: <strong>{detail.asset.id}</strong></span>
                  <span>Media count: <strong>{detail.media.length}</strong></span>
                  <span>Candidate count: <strong>{detail.detections.length}</strong></span>
                </div>
              </div>
              <select value={detail.asset.review_status} onChange={event => setStatus(event.target.value)}>
                {(options['Asset Review Status'] || []).map(item => <option key={item}>{item}</option>)}
              </select>
            </section>
            <section className="panel reviewMapPanel">
              <div className="panelHead">
                <div><h2>Interactive Asset Map</h2><p>Click a marker or asset card to focus the review workspace</p></div>
                <Badge value="GPS Coordinates" />
              </div>
              <InteractiveAssetMap assets={assets} selectedId={selectedId} setSelectedId={setSelectedId} className="reviewLeafletMap" />
            </section>
            <div className="twoCol">
              <MediaViewer detail={detail} mediaIndex={mediaIndex} setMediaIndex={setMediaIndex} />
              <section className="panel">
                <div className="panelHead"><div><h2>AI / Manual Candidates</h2><p>Approve visible components into structured records</p></div><span>{detail.detections.length}</span></div>
                <div className="candidateList">
                  {detail.detections.map(detection => (
                    <div className="candidate" key={detection.id}>
                      <div>
                        <strong>{detection.component_type}</strong>
                        <span>{detection.component_subtype} | {(detection.confidence * 100).toFixed(0)}%</span>
                      </div>
                      <Badge value={detection.status} />
                      <button onClick={() => approveDetection(detection)}><ShieldCheck size={16} /> Approve</button>
                      <button onClick={async () => { await api(`/detections/${detection.id}`, { method: 'PATCH', body: { status: 'Rejected' } }); await reload(); }}>Reject</button>
                    </div>
                  ))}
                </div>
              </section>
            </div>
            <div className="twoCol">
              <form className="panel formGrid" onSubmit={saveComponent}>
                <div className="panelHead wide"><div><h2>Component Record</h2><p>Complete structured asset fields for export</p></div><button><Save size={16} /> Save</button></div>
                <Select label="Component Type" value={form.component_type} options={options['Component Type']} onChange={v => setForm({ ...form, component_type: v })} />
                <Input label="Component Subtype" value={form.component_subtype} onChange={v => setForm({ ...form, component_subtype: v })} />
                <Input label="Quantity" type="number" value={form.quantity} onChange={v => setForm({ ...form, quantity: Number(v) })} />
                <Select label="Phase" value={form.phase} options={options.Phase} onChange={v => setForm({ ...form, phase: v })} />
                <Input label="Material" value={form.material} onChange={v => setForm({ ...form, material: v })} />
                <Input label="Manufacturer" value={form.manufacturer} onChange={v => setForm({ ...form, manufacturer: v })} />
                <Input label="Model" value={form.model} onChange={v => setForm({ ...form, model: v })} />
                <Input label="Serial Number" value={form.serial_number} onChange={v => setForm({ ...form, serial_number: v })} />
                <Input label="Install Year" value={form.install_year} onChange={v => setForm({ ...form, install_year: v })} />
                <Input label="Asset Tag" value={form.asset_tag} onChange={v => setForm({ ...form, asset_tag: v })} />
                <Select label="Nameplate Visible" value={form.nameplate_visible} options={options['Nameplate Visible']} onChange={v => setForm({ ...form, nameplate_visible: v })} />
                <Select label="Condition Rating" value={form.condition_rating} options={options['Condition Rating']} onChange={v => setForm({ ...form, condition_rating: v })} />
                <Select label="Verified Status" value={form.verified_status} options={options['Verified Status']} onChange={v => setForm({ ...form, verified_status: v })} />
                <Select label="Source Media" value={form.source_media} options={(detail.media || []).map(m => m.id)} onChange={v => setForm({ ...form, source_media: v })} />
                <label className="wide">Reviewer Notes<textarea value={form.reviewer_notes} onChange={event => setForm({ ...form, reviewer_notes: event.target.value })} /></label>
              </form>
              <section className="panel">
                <form className="formGrid" onSubmit={saveException}>
                  <div className="panelHead wide"><div><h2>Data Quality Exception</h2><p>Capture missing or conflicting source data</p></div><button><FileWarning size={16} /> Add</button></div>
                  <Select label="Exception Type" value={exception.exception_type} options={options['Exception Type']} onChange={v => setException({ ...exception, exception_type: v })} />
                  <Input label="Recommended Action" value={exception.recommended_action} onChange={v => setException({ ...exception, recommended_action: v })} />
                  <label className="wide">Reviewer Notes<textarea value={exception.reviewer_notes} onChange={event => setException({ ...exception, reviewer_notes: event.target.value })} /></label>
                </form>
                <h3>Approved Components</h3>
                <CompactTable rows={detail.components} fields={['component_type', 'phase', 'condition_rating', 'verified_status']} />
                <h3>Exceptions</h3>
                <CompactTable rows={detail.exceptions} fields={['exception_type', 'recommended_action', 'export_status']} />
              </section>
            </div>
          </>
        )}
      </div>
    </main>
  );
}

function ClientView({ assets, selectedId, setSelectedId, detail }) {
  const [mediaIndex, setMediaIndex] = useState(0);
  useEffect(() => setMediaIndex(0), [selectedId]);
  return (
    <main className="reviewLayout">
      <AssetList assets={assets} selectedId={selectedId} setSelectedId={setSelectedId} />
      <div className="reviewMain">
        {detail && (
          <>
            <section className="assetHeader panel">
              <div><p className="eyebrow">Client asset profile</p><h1>{detail.asset.structure_number}</h1><span>{detail.asset.asset_type} | {detail.asset.client_asset_tag || detail.asset.id}</span></div>
              <Badge value={detail.asset.review_status} />
            </section>
            <section className="clientSummary">
              <div><strong>{detail.media.length}</strong><span>Approved media</span></div>
              <div><strong>{detail.components.length}</strong><span>Verified components</span></div>
              <div><strong>{detail.exceptions.length}</strong><span>Visible data flags</span></div>
            </section>
            <section className="panel reviewMapPanel">
              <div className="panelHead">
                <div><h2>Client Asset Map</h2><p>Read-only geographic view of the same asset register</p></div>
                <Badge value="Read Only" />
              </div>
              <InteractiveAssetMap assets={assets} selectedId={selectedId} setSelectedId={setSelectedId} className="reviewLeafletMap" readOnly />
            </section>
            <div className="twoCol">
              <MediaViewer detail={detail} mediaIndex={mediaIndex} setMediaIndex={setMediaIndex} />
              <section className="panel">
                <div className="panelHead"><div><h2>Verified Components</h2><p>Internal candidates and rejected detections are hidden</p></div><Badge value="Read Only" /></div>
                <CompactTable rows={detail.components} fields={['component_type', 'component_subtype', 'phase', 'condition_rating', 'verified_status']} />
                <div className="panelHead"><h2>Data Quality Status</h2></div>
                <CompactTable rows={detail.exceptions} fields={['exception_type', 'recommended_action', 'export_status']} />
              </section>
            </div>
          </>
        )}
      </div>
    </main>
  );
}

function ExportPage({ preview }) {
  const readyRows = preview.filter(row => row.component_type || row.exception_type).length;
  return (
    <main className="page">
      <section className="intro compact">
        <div><p className="eyebrow">CSV export</p><h1>Data-quality register</h1><p>Export the structured review register for client review, remediation planning, or upload into downstream asset systems.</p></div>
        <a className="download" href="http://127.0.0.1:4000/api/export/data-quality-register.csv"><Download size={17} /> Download CSV</a>
      </section>
      <section className="exportStrip">
        <div><CheckCircle2 size={18} /><strong>{preview.length}</strong><span>preview rows</span></div>
        <div><BarChart3 size={18} /><strong>{readyRows}</strong><span>rows with review content</span></div>
        <div><Download size={18} /><strong>CSV</strong><span>register format</span></div>
      </section>
      <section className="panel">
        <div className="panelHead"><div><h2>Register Preview</h2><p>First rows from the export endpoint</p></div><span>{preview.length} rows</span></div>
        <CompactTable rows={preview} fields={['asset_location_id', 'asset_type', 'structure_number', 'component_type', 'verified_status', 'exception_type', 'review_status']} />
      </section>
    </main>
  );
}

function Input({ label, value, onChange, type = 'text' }) {
  return <label>{label}<input type={type} value={value ?? ''} onChange={event => onChange(event.target.value)} /></label>;
}

function Select({ label, value, options = [], onChange }) {
  return <label>{label}<select value={value ?? ''} onChange={event => onChange(event.target.value)}>{options.map(option => <option key={option}>{option}</option>)}</select></label>;
}

function CompactTable({ rows, fields }) {
  if (!rows?.length) return <div className="empty">No records yet</div>;
  return (
    <div className="tableWrap">
      <table>
        <thead><tr>{fields.map(field => <th key={field}>{field.replaceAll('_', ' ')}</th>)}</tr></thead>
        <tbody>{rows.map((row, index) => <tr key={row.id || index}>{fields.map(field => <td key={field}>{row[field] || '-'}</td>)}</tr>)}</tbody>
      </table>
    </div>
  );
}

function App() {
  const [page, setPage] = useState('Dashboard');
  const [summary, setSummary] = useState({});
  const [assets, setAssets] = useState([]);
  const [options, setOptions] = useState({});
  const [selectedId, setSelectedId] = useState('');
  const [detail, setDetail] = useState(null);
  const [preview, setPreview] = useState([]);

  async function loadBase() {
    const [summaryData, assetData, optionData, previewData] = await Promise.all([
      api('/summary'), api('/assets'), api('/options'), api('/export/preview')
    ]);
    setSummary(summaryData);
    setAssets(assetData);
    setOptions(optionData);
    setPreview(previewData);
    if (!selectedId && assetData[0]) setSelectedId(assetData[0].id);
  }

  async function loadDetail() {
    if (!selectedId) return;
    const path = page === 'Client View' ? `/client/assets/${selectedId}` : `/assets/${selectedId}`;
    setDetail(await api(path));
  }

  useEffect(() => { loadBase(); }, []);
  useEffect(() => { loadDetail(); }, [selectedId, page]);

  const reload = async () => {
    await loadBase();
    await loadDetail();
  };

  const content = useMemo(() => {
    if (page === 'Asset Map') return <AssetMapPage assets={assets} selectedId={selectedId} setSelectedId={setSelectedId} detail={detail} />;
    if (page === 'Admin Review') return <AdminReview assets={assets} selectedId={selectedId} setSelectedId={setSelectedId} detail={detail} reload={reload} options={options} />;
    if (page === 'Client View') return <ClientView assets={assets} selectedId={selectedId} setSelectedId={setSelectedId} detail={detail} />;
    if (page === 'Export') return <ExportPage preview={preview} />;
    return <Dashboard summary={summary} assets={assets} setPage={setPage} setSelectedId={setSelectedId} />;
  }, [page, assets, selectedId, detail, summary, preview, options]);

  return <><Header page={page} setPage={setPage} />{content}</>;
}

createRoot(document.getElementById('root')).render(<App />);

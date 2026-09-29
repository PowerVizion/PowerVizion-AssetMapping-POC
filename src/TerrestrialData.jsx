import React, { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Images, Minus, Plus, RotateCcw } from 'lucide-react';
import './terrestrial.css';
import { AssetAssociation, evidenceRequest } from './TerrestrialEvidence.jsx';

const PointCloudViewer = lazy(() => import('./PointCloudViewer.jsx'));

const API = 'http://127.0.0.1:4000/api/terrestrial-datasets';
async function getJson(url, signal) {
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error('Terrestrial data could not be loaded. Please try again.');
  return response.json();
}

export default function TerrestrialData({ initialTarget }) {
  const [datasets, setDatasets] = useState(null);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [selected, setSelected] = useState(null);
  const [cloudDataset, setCloudDataset] = useState(null);
  const [associations, setAssociations] = useState(null);
  const [associationError, setAssociationError] = useState('');
  const [associationVersion, setAssociationVersion] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setAssociationError('');
    evidenceRequest('/terrestrial-evidence', { signal: controller.signal }).then(setAssociations).catch(error => {
      if (error.name !== 'AbortError') { setAssociations(null); setAssociationError(error.message); }
    });
    return () => controller.abort();
  }, [associationVersion]);
  useEffect(() => {
    const controller = new AbortController();
    setError('');
    setDatasets(null);
    getJson(API, controller.signal).then(rows => {
      setDatasets(rows);
      if (initialTarget) {
        const dataset = rows.find(row => row.dataset_id === initialTarget.dataset_id);
        if (dataset) setSelected(dataset);
        else setError('The associated dataset is no longer configured.');
      }
    }).catch(error => {
      if (error.name !== 'AbortError') setError(error.message);
    });
    return () => controller.abort();
  }, [attempt]);
  if (cloudDataset) return <Suspense fallback={<main className="page"><p role="status">Loading 3D viewer…</p></main>}><PointCloudViewer dataset={cloudDataset} onBack={() => setCloudDataset(null)} /></Suspense>;
  if (selected) return <PanoramaBrowser dataset={selected} initialSetup={initialTarget?.dataset_id === selected.dataset_id ? initialTarget.setup_id : null} onChanged={() => setAssociationVersion(value => value + 1)} onBack={() => { setSelected(null); setAssociationVersion(value => value + 1); }} />;
  return <main className="page terrestrialPage">
    <section className="intro compact"><div><p className="eyebrow">Terrestrial evidence</p><h1>Terrestrial Data</h1><p>Explore scan datasets and high-resolution panoramas before associating evidence with assets.</p></div><span className="badge neutral">Admin Validation</span></section>
    {associationError && <div role="alert"><p>{associationError}</p><button onClick={() => setAssociationVersion(value => value + 1)}>Refresh Associations</button></div>}
    {error ? <section className="panel" role="alert"><p>{error}</p><button onClick={() => setAttempt(value => value + 1)}>Retry</button></section> : !datasets ? <p role="status">Loading datasets…</p> : datasets.length === 0 ? <div className="empty">No terrestrial datasets configured.</div> : datasets.map(dataset => {
      const local = dataset.local || {};
      const available = local.point_cloud_available && local.panorama_directory_available && local.panorama_count > 0;
      const fields = [
        ['Source', dataset.source_vendor], ['Evidence Type', dataset.source_type === 'terrestrial_lidar' ? 'Terrestrial LiDAR' : dataset.source_type],
        ['Point Cloud', dataset.point_cloud_file], ['Point Count', Number(dataset.point_count) >= 1e9 ? `${(dataset.point_count / 1e9).toFixed(2)}B` : Number(dataset.point_count).toLocaleString()],
        ['Panoramas', dataset.panorama_count], ['Setups', dataset.setup_count], ['Asset Associations', associations === null ? 'Unavailable' : associations.filter(row => row.dataset_id === dataset.dataset_id).length], ['Association Status', associations === null ? 'Unavailable' : associations.some(row => row.dataset_id === dataset.dataset_id) ? 'Manual Verified' : 'Pending'],
        ['Point Cloud Availability', local.point_cloud_available ? 'Available' : 'Missing'],
        ['Panorama Availability', local.panorama_directory_available && local.panorama_count > 0 ? `Available · ${local.panorama_count} local` : 'Missing']
      ];
      return <section className="panel terrestrialCard" key={dataset.dataset_id}>
        <div className="terrestrialHeading"><div><p className="eyebrow">{dataset.dataset_id}</p><h2>{dataset.display_name}</h2></div><span className={`badge ${available ? 'good' : 'warn'}`}>Status: {available ? 'Available' : 'Missing'}</span></div>
        <dl className="terrestrialFacts">{fields.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value ?? 'Unknown'}</dd></div>)}</dl>
        {local.panorama_count_matches_expected === false && <p role="status">Some expected panoramas are missing. Available images can still be browsed.</p>}
        <div className="terrestrialFooter"><p>Manual associations are for admin validation. Point and setup counts are dataset metadata.</p>{(dataset.web_point_cloud || dataset.point_cloud_variants?.length) && <button onClick={() => setCloudDataset(dataset)}>Open 3D Point Cloud</button>}<button onClick={() => setSelected(dataset)}><Images size={18} />Browse Panoramas</button></div>
      </section>;
    })}
  </main>;
}

function PanoramaBrowser({ dataset, initialSetup, onChanged, onBack }) {
  const [items, setItems] = useState(null);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [index, setIndex] = useState(initialSetup ? Number(initialSetup) - 1 : 0);
  useEffect(() => {
    const controller = new AbortController();
    setError('');
    getJson(`${API}/${encodeURIComponent(dataset.dataset_id)}/panoramas`, controller.signal).then(rows => {
      if (initialSetup && !rows.some(row => String(row.setup_number).padStart(3, '0') === initialSetup)) throw new Error('The associated setup is no longer configured.');
      setItems(rows);
    }).catch(error => {
      if (error.name !== 'AbortError') setError(error.message);
    });
    return () => controller.abort();
  }, [dataset.dataset_id, attempt]);
  const current = items?.[index];
  return <main className="page terrestrialPage">
    <div className="terrestrialHeading"><button onClick={onBack}><ArrowLeft size={16} />Back to Dataset</button><span className="badge neutral">Admin Validation · Panoramas</span></div>
    <section className="panel terrestrialCard">
      <p className="eyebrow">{dataset.display_name}</p>
      {error ? <div role="alert"><p>{error}</p><button onClick={() => setAttempt(value => value + 1)}>Retry</button></div> : !current ? <p role="status">Loading panoramas…</p> : <>
        <div className="terrestrialHeading"><div><h1>Setup {String(current.setup_number).padStart(3, '0')}</h1><p className="terrestrialFilename">{current.filename}</p></div></div>
        <div className="terrestrialNavigation">
          <button disabled={index === 0} onClick={() => setIndex(value => value - 1)}><ArrowLeft size={16} />Previous</button>
          <label>Setup<select value={index} onChange={event => setIndex(Number(event.target.value))}>{items.map((item, i) => <option key={item.filename} value={i}>Setup {String(item.setup_number).padStart(3, '0')} — {item.filename}</option>)}</select></label>
          <button disabled={index === items.length - 1} onClick={() => setIndex(value => value + 1)}>Next<ArrowRight size={16} /></button>
        </div>
        <AssetAssociation key={`${dataset.dataset_id}:${current.filename}`} datasetId={dataset.dataset_id} panorama={current} onChanged={onChanged} />
        <PanoramaImage key={current.filename} filename={current.filename} src={`${API}/${encodeURIComponent(dataset.dataset_id)}/panoramas/${encodeURIComponent(current.filename)}`} />
      </>}
    </section>
  </main>;
}

function PanoramaImage({ src, filename }) {
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [status, setStatus] = useState('loading');
  const [attempt, setAttempt] = useState(0);
  const viewport = useRef(null);
  const drag = useRef(null);
  function clampOffset(next, scale = zoom) {
    const rect = viewport.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    const limitX = rect.width * (scale - 1) / 2;
    const limitY = rect.height * (scale - 1) / 2;
    return { x: Math.max(-limitX, Math.min(limitX, next.x)), y: Math.max(-limitY, Math.min(limitY, next.y)) };
  }
  function changeZoom(next) {
    setZoom(next);
    setOffset(value => clampOffset(value, next));
  }
  return <>
    <div className="terrestrialZoom"><button disabled={status !== 'ready' || zoom >= 4} onClick={() => changeZoom(Math.min(4, zoom + 0.5))}><Plus size={16} />Zoom In</button><button disabled={status !== 'ready' || zoom <= 1} onClick={() => changeZoom(Math.max(1, zoom - 0.5))}><Minus size={16} />Zoom Out</button><button disabled={status !== 'ready'} onClick={() => { setZoom(1); setOffset({ x: 0, y: 0 }); }}><RotateCcw size={16} />Reset Zoom</button><output aria-label="Zoom level">{Math.round(zoom * 100)}%</output></div>
    <div ref={viewport} className={`terrestrialViewport ${zoom > 1 && status === 'ready' ? 'canPan' : ''}`} aria-label="Panorama image viewer"
      onPointerDown={event => {
        if (event.button !== 0 || zoom <= 1 || status !== 'ready') return;
        event.preventDefault();
        drag.current = { id: event.pointerId, x: event.clientX, y: event.clientY, offset };
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={event => {
        const start = drag.current;
        if (!start || start.id !== event.pointerId) return;
        setOffset(clampOffset({ x: start.offset.x + event.clientX - start.x, y: start.offset.y + event.clientY - start.y }));
      }}
      onPointerUp={event => { drag.current = null; if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); }}
      onPointerCancel={() => { drag.current = null; }} onLostPointerCapture={() => { drag.current = null; }}>
      {status === 'error' ? <div className="terrestrialImageMessage" role="alert"><h2>Panorama unavailable</h2><p>This image is missing or could not be read. Choose another setup or try again.</p><button onClick={() => { setStatus('loading'); setAttempt(value => value + 1); }}>Retry Image</button></div> : <>
        {status === 'loading' && <div className="terrestrialImageMessage" role="status">Loading panorama…</div>}
        <img key={attempt} src={`${src}?retry=${attempt}`} alt={filename} draggable={false} onLoad={() => setStatus('ready')} onError={() => setStatus('error')} style={{ visibility: status === 'ready' ? 'visible' : 'hidden', transform: `translate(${offset.x}px, ${offset.y}px) scale(${zoom})` }} />
      </>}
    </div>
    <p className="terrestrialHint">4096 × 2048 equirectangular panorama · Flat image view. Zoom in, then drag to pan. Changing setup resets the view.</p>
  </>;
}

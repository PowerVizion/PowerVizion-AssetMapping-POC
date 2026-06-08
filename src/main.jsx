import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ArrowLeft, ArrowRight, BarChart3, CheckCircle2, Download, Eye, FileWarning, Gauge, MapPin, PlayCircle, Save, ShieldCheck, SlidersHorizontal } from 'lucide-react';
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
    'Data Exception Found': 'warn',
    'Client Review Required': 'warn',
    'Needs Client Review': 'warn',
    'AI Candidate': 'info',
    'Pending Review': 'info',
    Imported: 'neutral',
    Rejected: 'bad',
    Critical: 'bad'
  }[value] || 'neutral';
  return <span className={`badge ${tone}`}>{value || 'Unknown'}</span>;
}

function Header({ page, setPage }) {
  const items = ['Dashboard', 'Admin Review', 'Client View', 'Export'];
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
  if (!current) return <section className="panel mediaViewer">No linked media</section>;
  const next = () => setMediaIndex((mediaIndex + 1) % media.length);
  const previous = () => setMediaIndex((mediaIndex - 1 + media.length) % media.length);
  return (
    <section className="panel mediaViewer">
      <div className="panelHead">
        <div><h2>Linked Media</h2><p>{mediaIndex + 1} of {media.length} evidence files</p></div>
        <div className="mediaControls">
          <button type="button" onClick={previous} aria-label="Previous media"><ArrowLeft size={16} /></button>
          <button type="button" onClick={next} aria-label="Next media"><ArrowRight size={16} /></button>
          <Badge value={current.capture_method} />
        </div>
      </div>
      <div className="imageShell">
        <img src={current.url} alt={current.caption} />
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
    if (page === 'Admin Review') return <AdminReview assets={assets} selectedId={selectedId} setSelectedId={setSelectedId} detail={detail} reload={reload} options={options} />;
    if (page === 'Client View') return <ClientView assets={assets} selectedId={selectedId} setSelectedId={setSelectedId} detail={detail} />;
    if (page === 'Export') return <ExportPage preview={preview} />;
    return <Dashboard summary={summary} assets={assets} setPage={setPage} setSelectedId={setSelectedId} />;
  }, [page, assets, selectedId, detail, summary, preview, options]);

  return <><Header page={page} setPage={setPage} />{content}</>;
}

createRoot(document.getElementById('root')).render(<App />);

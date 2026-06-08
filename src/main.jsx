import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { BarChart3, Download, Eye, FileWarning, Gauge, MapPin, Save, ShieldCheck, SlidersHorizontal } from 'lucide-react';
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
    'Data Exception Found': 'warn',
    'Client Review Required': 'warn',
    'Needs Client Review': 'warn',
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

function Dashboard({ summary, assets, setPage }) {
  const cards = [
    ['Asset count', summary.assets, MapPin],
    ['Media count', summary.media, Eye],
    ['Candidate count', summary.candidates, SlidersHorizontal],
    ['Approved components', summary.components, ShieldCheck],
    ['Data exceptions', summary.exceptions, FileWarning],
    ['Client review required', summary.clientReview, Gauge]
  ];
  return (
    <main className="page">
      <section className="intro">
        <div>
          <p className="eyebrow">Standalone meeting demo</p>
          <h1>Field-verified visual asset data quality workflow</h1>
          <p>Connect 8K inspection frames and pole photos to asset locations, convert visible components into structured records, and export a client-ready data-quality register.</p>
        </div>
        <div className="introActions">
          <button onClick={() => setPage('Admin Review')}><SlidersHorizontal size={17} /> Admin Review</button>
          <button onClick={() => setPage('Client View')}><Eye size={17} /> Client View</button>
        </div>
      </section>
      <section className="metricGrid">
        {cards.map(([label, value, Icon]) => (
          <div className="metric" key={label}>
            <Icon size={20} />
            <span>{label}</span>
            <strong>{value ?? 0}</strong>
          </div>
        ))}
      </section>
      <section className="mapPanel">
        <div className="panelHead">
          <h2>Asset Location Register</h2>
          <Badge value="Local/S3 Ready" />
        </div>
        <div className="assetMap">
          {assets.map(asset => (
            <div className="mapAsset" key={asset.id} style={{ left: `${12 + Math.random() * 72}%`, top: `${18 + Math.random() * 58}%` }}>
              <span />
              <small>{asset.structure_number}</small>
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}

function AssetList({ assets, selectedId, setSelectedId }) {
  return (
    <aside className="assetList">
      <div className="panelHead"><h2>Assets</h2><span>{assets.length}</span></div>
      {assets.map(asset => (
        <button key={asset.id} className={selectedId === asset.id ? 'selected assetButton' : 'assetButton'} onClick={() => setSelectedId(asset.id)}>
          <strong>{asset.structure_number}</strong>
          <code>{asset.id}</code>
          <span>{asset.asset_type}</span>
          <Badge value={asset.review_status} />
        </button>
      ))}
    </aside>
  );
}

function MediaViewer({ detail, mediaIndex, setMediaIndex }) {
  const media = detail?.media || [];
  const current = media[mediaIndex] || media[0];
  if (!current) return <section className="panel mediaViewer">No linked media</section>;
  return (
    <section className="panel mediaViewer">
      <div className="panelHead">
        <h2>Linked Media</h2>
        <Badge value={current.capture_method} />
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
          <button key={item.id} className={index === mediaIndex ? 'activeThumb' : ''} onClick={() => setMediaIndex(index)}>{item.frame_number || index + 1}</button>
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
                <div className="panelHead"><h2>AI / Manual Candidates</h2><span>{detail.detections.length}</span></div>
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
                <div className="panelHead"><h2>Component Record</h2><button><Save size={16} /> Save</button></div>
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
                  <div className="panelHead wide"><h2>Data Quality Exception</h2><button><FileWarning size={16} /> Add</button></div>
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
  return (
    <main className="reviewLayout">
      <AssetList assets={assets} selectedId={selectedId} setSelectedId={setSelectedId} />
      <div className="reviewMain">
        {detail && (
          <>
            <section className="assetHeader panel">
              <div><p className="eyebrow">Client asset profile</p><h1>{detail.asset.structure_number}</h1><span>{detail.asset.asset_type} | {detail.asset.client_asset_tag}</span></div>
              <Badge value={detail.asset.review_status} />
            </section>
            <div className="twoCol">
              <MediaViewer detail={detail} mediaIndex={0} setMediaIndex={() => {}} />
              <section className="panel">
                <div className="panelHead"><h2>Verified Components</h2><Badge value="Read Only" /></div>
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
  return (
    <main className="page">
      <section className="intro compact">
        <div><p className="eyebrow">CSV export</p><h1>Data-quality register</h1><p>Export the structured review register for client review, remediation planning, or upload into downstream asset systems.</p></div>
        <a className="download" href="http://127.0.0.1:4000/api/export/data-quality-register.csv"><Download size={17} /> Download CSV</a>
      </section>
      <section className="panel">
        <div className="panelHead"><h2>Preview</h2><span>{preview.length} rows</span></div>
        <CompactTable rows={preview} fields={['asset_location_id', 'asset_type', 'structure_number', 'component_type', 'exception_type', 'review_status']} />
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
    return <Dashboard summary={summary} assets={assets} setPage={setPage} />;
  }, [page, assets, selectedId, detail, summary, preview, options]);

  return <><Header page={page} setPage={setPage} />{content}</>;
}

createRoot(document.getElementById('root')).render(<App />);

import React, { useEffect, useState } from 'react';

const API = 'http://127.0.0.1:4000/api';
export async function evidenceRequest(path, options = {}) {
  const response = await fetch(`${API}${path}`, { ...options, headers: { 'Content-Type': 'application/json' }, body: options.body ? JSON.stringify(options.body) : undefined });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Unable to load terrestrial evidence');
  return result;
}
export const panoramaUrl = row => `${API}/terrestrial-datasets/${encodeURIComponent(row.dataset_id)}/panoramas/${encodeURIComponent(row.panorama_file)}`;

export function AssetAssociation({ datasetId, panorama, onChanged }) {
  const [assets, setAssets] = useState([]);
  const [association, setAssociation] = useState(null);
  const [assetId, setAssetId] = useState('');
  const [notes, setNotes] = useState('');
  const [editing, setEditing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [attempt, setAttempt] = useState(0);
  const setupId = String(panorama.setup_number).padStart(3, '0');
  function apply(row) {
    setAssociation(row);
    setAssetId(row?.asset_location_id || '');
    setNotes(row?.notes || '');
    setEditing(false);
  }
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError(''); setMessage('');
    Promise.all([evidenceRequest('/assets', { signal: controller.signal }), evidenceRequest('/terrestrial-evidence', { signal: controller.signal })])
      .then(([assets, rows]) => { setAssets(assets); apply(rows.find(row => row.dataset_id === datasetId && row.setup_id === setupId) || null); setLoading(false); })
      .catch(error => { if (error.name !== 'AbortError') { setError(error.message); setLoading(false); } });
    return () => controller.abort();
  }, [datasetId, setupId, attempt]);
  async function save(event) {
    event.preventDefault();
    if (busy || !assetId) return;
    setBusy(true); setError(''); setMessage('');
    try {
      const body = { asset_location_id: assetId, dataset_id: datasetId, setup_id: setupId, panorama_file: panorama.filename, association_method: 'manual_verified', notes, ...(association ? { expected: association } : {}) };
      const suffix = association ? `/${encodeURIComponent(datasetId)}/${setupId}` : '';
      const row = await evidenceRequest(`/terrestrial-evidence${suffix}`, { method: association ? 'PUT' : 'POST', body });
      apply(row); setMessage('Association saved.'); onChanged();
    } catch (error) { setError(error.message); }
    finally { setBusy(false); }
  }
  async function remove() {
    if (busy) return;
    setBusy(true); setError(''); setMessage('');
    try {
      await evidenceRequest(`/terrestrial-evidence/${encodeURIComponent(datasetId)}/${setupId}`, { method: 'DELETE', body: { expected: association } });
      apply(null); setMessage('Association removed.'); onChanged();
    } catch (error) { setError(error.message); }
    finally { setBusy(false); }
  }
  return <section className="terrestrialAssociation" aria-label="Asset Association">
    <h2>Asset Association</h2>
    {loading ? <p role="status">Loading association…</p> : <>
      {association ? <dl className="terrestrialFacts"><div><dt>Associated Asset</dt><dd>{association.asset_location_id}</dd></div><div><dt>Association Method</dt><dd>Manual Verified</dd></div><div className="evidenceNotes"><dt>Notes</dt><dd>{association.notes || 'None'}</dd></div></dl> : !error && <p>Not Assigned</p>}
      {association && !editing ? <div className="terrestrialZoom"><button disabled={busy} onClick={() => { setEditing(true); setMessage(''); }}>Change Association</button><button disabled={busy} onClick={remove}>Remove Association</button></div> : <form onSubmit={save}>
        <fieldset disabled={busy || loading || assets.length === 0} className="terrestrialAssociationForm">
          <label>Asset<select required value={assetId} onChange={event => setAssetId(event.target.value)}><option value="">Select an asset</option>{assets.map(asset => <option key={asset.id} value={asset.id}>{asset.id} — {asset.structure_number || asset.asset_type}</option>)}</select></label>
          <label>Association Notes (optional)<textarea maxLength={2000} value={notes} onChange={event => setNotes(event.target.value)} /></label>
          <div className="terrestrialZoom"><button type="submit" disabled={!assetId || busy}>{busy ? 'Saving…' : association ? 'Save Association' : 'Associate to Asset'}</button>{association && <button type="button" onClick={() => apply(association)}>Cancel</button>}</div>
        </fieldset>
      </form>}
    </>}
    {error && <div role="alert"><p>{error}</p><button disabled={busy} onClick={() => setAttempt(value => value + 1)}>Refresh Association</button></div>}
    {message && <p role="status">{message}</p>}
    <p className="terrestrialHint">Admin validation only. Associations are not shown in Client View.</p>
  </section>;
}

export function AdminTerrestrialEvidence({ assetId, onOpen }) {
  const [rows, setRows] = useState(null);
  const [datasets, setDatasets] = useState([]);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setRows(null); setError('');
    Promise.all([evidenceRequest(`/terrestrial-evidence/assets/${encodeURIComponent(assetId)}`, { signal: controller.signal }), evidenceRequest('/terrestrial-datasets', { signal: controller.signal })])
      .then(([rows, datasets]) => { setRows(rows); setDatasets(datasets); })
      .catch(error => { if (error.name !== 'AbortError') setError(error.message); });
    return () => controller.abort();
  }, [assetId, attempt]);
  return <section className="panel terrestrialCard" aria-label="Terrestrial Evidence">
    <h2>Terrestrial Evidence</h2>
    {error ? <div role="alert"><p>{error}</p><button onClick={() => setAttempt(value => value + 1)}>Retry Evidence</button></div> : rows === null ? <p role="status">Loading terrestrial evidence…</p> : rows.length === 0 ? <p>No terrestrial evidence associated.</p> : rows.map(row => <article key={`${row.dataset_id}:${row.setup_id}`} className="terrestrialEvidenceRow">
      <EvidencePreview row={row} />
      <div><dl><dt>Dataset</dt><dd>{datasets.find(dataset => dataset.dataset_id === row.dataset_id)?.display_name || row.dataset_id}</dd><dt>Setup ID</dt><dd>{row.setup_id}</dd><dt>Panorama filename</dt><dd>{row.panorama_file}</dd><dt>Association method</dt><dd>Manual Verified</dd><dt>Notes</dt><dd className="evidenceNotes">{row.notes || 'None'}</dd></dl><button onClick={() => onOpen(row)}>Open Panorama</button></div>
    </article>)}
  </section>;
}
function EvidencePreview({ row }) {
  const [failed, setFailed] = useState(false);
  return failed ? <div className="empty">Preview unavailable</div> : <img src={panoramaUrl(row)} alt={`Setup ${row.setup_id} panorama preview`} loading="lazy" onError={() => setFailed(true)} />;
}

import React, { useEffect, useRef, useState } from 'react';
import { Polygon, Popup, Tooltip } from 'react-leaflet';
import { mappedSurveys } from './surveyMap.js';
import './surveyMap.css';
const API = 'http://127.0.0.1:4000/api';

export function useMappedSurveys() {
  const [surveys, setSurveys] = useState([]);
  const [surveyError, setError] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    fetch(`${API}/terrestrial-datasets`, { signal: controller.signal }).then(response => {
      if (!response.ok) throw new Error('Survey layer unavailable. Existing asset markers remain available.');
      return response.json();
    }).then(rows => setSurveys(mappedSurveys(rows))).catch(error => {
      if (error.name !== 'AbortError') setError('Survey layer unavailable. Existing asset markers remain available.');
    });
    return () => controller.abort();
  }, []);
  return { surveys, surveyError };
}

export function SurveyPolygon({ dataset, onOpen }) {
  const polygon = useRef(null);
  const [opened, setOpened] = useState(0);
  const [count, setCount] = useState(null);
  useEffect(() => {
    const controller = new AbortController();
    setCount(null);
    fetch(`${API}/terrestrial-evidence`, { signal: controller.signal }).then(response => {
      if (!response.ok) throw new Error('Associations unavailable');
      return response.json();
    }).then(rows => setCount(rows.filter(row => row.dataset_id === dataset.dataset_id).length)).catch(error => {
      if (error.name !== 'AbortError') setCount(null);
    });
    return () => controller.abort();
  }, [dataset.dataset_id, opened]);
  useEffect(() => {
    const layer = polygon.current, element = layer?.getElement();
    if (!element) return;
    element.setAttribute('tabindex', '0');
    element.setAttribute('role', 'button');
    element.setAttribute('aria-label', `Terrestrial Survey: ${dataset.map.label || dataset.display_name}`);
    const activate = event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); layer.openPopup(); } };
    element.addEventListener('keydown', activate);
    return () => element.removeEventListener('keydown', activate);
  }, [dataset]);
  const variant = dataset.point_cloud_variants?.find(item => item.id === dataset.default_point_cloud_variant) || dataset.point_cloud_variants?.[0];
  return <Polygon ref={polygon} positions={dataset.map.footprint} pathOptions={{ color: '#f3bc63', weight: 3, dashArray: '7 4', fillColor: '#f3bc63', fillOpacity: 0.22, className: 'terrestrialSurveyPolygon' }} eventHandlers={{ popupopen: () => setOpened(value => value + 1) }}>
    <Tooltip direction="top" sticky>{dataset.map.label || dataset.display_name}<br />Terrestrial LiDAR Survey</Tooltip>
    <Popup maxWidth={340} minWidth={260} autoPanPaddingTopLeft={[12, 125]} autoPanPaddingBottomRight={[12, 12]}>
      <div className="surveyPopup">
        <strong>{dataset.display_name}</strong>
        <span className="surveyEntity">Terrestrial Survey</span>
        <dl>
          <dt>Evidence</dt><dd>Terrestrial LiDAR</dd>
          <dt>Source Points</dt><dd>{(Math.floor(dataset.point_count / 1e6) / 1000).toFixed(3)}B</dd>
          <dt>Web Detail</dt><dd>{((variant?.points || dataset.web_point_cloud?.point_count || 0) / 1e6).toFixed(0)}M</dd>
          <dt>Panoramas</dt><dd>{dataset.panorama_count}</dd>
          <dt>Asset Associations</dt><dd>{count === null ? 'Unavailable' : count}</dd>
          <dt>CRS</dt><dd>{dataset.map.crs_status === 'provisional' ? 'Provisional ' : ''}{dataset.map.source_crs}</dd>
        </dl>
        <p>{dataset.map.crs_notes}</p>
        <div className="surveyActions"><button onClick={() => onOpen(dataset, '3d')}>Open 3D</button><button onClick={() => onOpen(dataset, 'panoramas')}>Browse Panoramas</button><button onClick={() => onOpen(dataset, 'summary')}>View Dataset</button></div>
      </div>
    </Popup>
  </Polygon>;
}

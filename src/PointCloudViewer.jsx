import { createPortal } from 'react-dom';
import { StationTools } from './StationTools.jsx';
import { pickStationPoint, stationLocal } from './stationGeometry.js';
import React, { useEffect, useRef, useState } from 'react';
import { Box3, Vector3, PerspectiveCamera, Scene, WebGLRenderer, Color, Sphere, InterleavedBuffer, InterleavedBufferAttribute } from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { Potree, PointColorType, PointSizeType, PointShape, PointCloudMaterial } from 'potree-core';
import './pointcloud.css';

export default function PointCloudViewer({ dataset, onBack, onOpenPanorama, focusSetup }) {
  const variants = dataset.point_cloud_variants || [{ id: 'preview_1m', label: 'Fast Preview', name: dataset.web_point_cloud.name, points: dataset.web_point_cloud.point_count }];
  const [variantId, setVariantId] = useState(dataset.default_point_cloud_variant || variants[0].id);
  const variant = variants.find(item => item.id === variantId) || variants[0];
  const settings = useRef({ size: 2, color: 'RGB' });
  const stationBridge = useRef(null);
  const [markerHost, setMarkerHost] = useState(null);
  const [stationEditing, setStationEditing] = useState(false);
  const host = useRef(null);
  const viewer = useRef(null);
  const [attempt, setAttempt] = useState(0);
  const [status, setStatus] = useState('Loading point-cloud metadata…');
  const [error, setError] = useState('');
  const [ready, setReady] = useState(false);
  const [size, setSize] = useState(2);
  const [color, setColor] = useState('RGB');
  useEffect(() => {
    let active = true, frameId, cloud, renderer, controls, observer, timeout, removePicking;
    const controller = new AbortController();
    const workers = new Set();
    const container = host.current;
    setError(''); setReady(false); setStatus('Loading point-cloud metadata…');
    const started = performance.now();
    const base = `http://127.0.0.1:4000/api/terrestrial-datasets/${encodeURIComponent(dataset.dataset_id)}/point-cloud/${dataset.point_cloud_variants ? encodeURIComponent(variant.id) + '/' : ''}`;
    function failed(error) {
      if (!active || controller.signal.aborted) return;
      setError(error.message || 'The point cloud could not be rendered.'); setReady(false);
      cancelAnimationFrame(frameId); clearTimeout(timeout); controller.abort();
    }
    async function request(input, init = {}) {
      const url = new URL(String(input), base);
      if (!['metadata.json', 'hierarchy.bin', 'octree.bin'].some(name => url.href === base + name)) throw new Error('Unexpected point-cloud file request.');
      try {
        const headers = new Headers(init.headers);
        headers.delete('content-type');
        const response = await fetch(url, { ...init, headers, cache: 'no-store', signal: controller.signal });
        if (!response.ok) throw new Error('Point-cloud data is missing or unreadable. Check the configured web point-cloud folder and retry.');
        if (init.headers?.Range && response.status !== 206) throw new Error('The point-cloud server did not provide the requested byte range.');
        return response;
      } catch (error) {
        if (error.name !== 'AbortError') { console.error('Point-cloud request failed', url.href, init.headers?.Range || init.method || 'GET', error.message); failed(error); }
        throw error;
      }
    }
    async function start() {
      try {
        const data = await (await request('metadata.json')).json();
        if (data.version !== '2.0' || !Number.isFinite(data.points) || !data.attributes?.some(attribute => attribute.name === 'rgb')) throw new Error('This viewer requires Potree 2.0 metadata with RGB attributes.');
        if (data.points !== variant.points) throw new Error('The point count does not match the selected detail level. Check the dataset configuration.');
        await Promise.all(['hierarchy.bin', 'octree.bin'].map(name => request(name, { method: 'HEAD' })));
        if (!active || controller.signal.aborted) return;
        setStatus('Loading and decoding point-cloud geometry…');
        renderer = new WebGLRenderer({ antialias: false, powerPreference: 'high-performance', preserveDrawingBuffer: true });
        renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
        renderer.setClearColor(new Color('#070f14'));
        renderer.domElement.setAttribute('aria-label', 'Interactive 3D point cloud');
        renderer.domElement.tabIndex = 0;
        renderer.domElement.addEventListener('webglcontextlost', event => { event.preventDefault(); failed(new Error('The graphics context was lost. Retry to reopen the viewer.')); });
        renderer.debug.onShaderError = () => failed(new Error('The graphics driver could not compile the point-cloud shader.'));
        container.appendChild(renderer.domElement);
        const scene = new Scene();
        const camera = new PerspectiveCamera(55, 1, 0.05, 10000);
        camera.up.set(0, 0, 1);
        controls = new OrbitControls(camera, renderer.domElement);
        controls.enableDamping = true; controls.dampingFactor = 0.12;
        controls.screenSpacePanning = true;
        controls.listenToKeyEvents(renderer.domElement);
        const potree = new Potree();
        // Stream finer nodes from the full dataset while bounding interactive GPU load.
        potree.pointBudget = Math.min(2000000, data.points);
        potree.maxNumNodesLoading = 4;
        cloud = await potree.loadPointCloud('metadata.json', { getUrl: async url => new URL(url, base).href, fetch: request });
        if (!active || controller.signal.aborted) { cloud.dispose(); return; }
        // Rebase the cloud near the origin to retain float precision at survey coordinates.
        const origin = new Vector3(...data.boundingBox.min);
        const position = data.attributes.find(attribute => attribute.name === 'position');
        const bounds = new Box3(new Vector3(...(position?.min || data.boundingBox.min)), new Vector3(...(position?.max || data.boundingBox.max)));
        const center = bounds.getCenter(new Vector3());
        cloud.position.copy(origin).sub(center);
        bounds.translate(center.clone().negate());
        // Use the standard material on native Potree 2.0 decoded geometry.
        // The library's new-format shader bypasses color-mode selection.
        cloud.material.dispose();
        cloud.material = new PointCloudMaterial({ newFormat: false, minSize: 1 });
        // Keep the source sRGB encoding unchanged.
        cloud.material.outputColorEncoding = cloud.material.inputColorEncoding;
        cloud.material.pointColorType = settings.current.color === 'RGB' ? PointColorType.RGB : PointColorType.HEIGHT;
        cloud.material.pointSizeType = PointSizeType.FIXED;
        cloud.material.shape = PointShape.CIRCLE;
        cloud.material.size = settings.current.size;
        cloud.material.heightMin = bounds.min.z; cloud.material.heightMax = bounds.max.z;
        cloud.minNodePixelSize = 20;
        scene.add(cloud); cloud.updateMatrixWorld(true);
        // Potree Core's decoder workers are embedded in the local bundle. Track them
        // for cleanup because its worker pool does not expose a dispose method.
        const pool = cloud.pcoGeometry.loader.workerPool;
        const getWorker = pool.getWorker.bind(pool);
        pool.getWorker = type => {
          const worker = getWorker(type);
          if (!workers.has(worker)) {
            workers.add(worker);
            worker.addEventListener('error', () => failed(new Error('Point-cloud decoding failed. Retry the dataset.')));
          }
          return worker;
        };
        Object.values(pool.workers).flat().forEach(worker => workers.add(worker));
        const radius = Math.max(bounds.getBoundingSphere(new Sphere()).radius, 1);
        function fit(reset = false) {
          const direction = reset ? new Vector3(0.9, -1, 0.75).normalize() : camera.position.clone().sub(controls.target).normalize();
          if (direction.lengthSq() === 0) direction.set(0.9, -1, 0.75).normalize();
          const vertical = camera.fov * Math.PI / 360;
          const horizontal = Math.atan(Math.tan(vertical) * camera.aspect);
          const distance = radius / Math.sin(Math.min(vertical, horizontal)) * 1.08;
          controls.target.set(0, 0, 0); camera.position.copy(direction.multiplyScalar(distance));
          camera.near = 0.05; camera.far = Math.max(distance * 10, radius * 100); camera.updateProjectionMatrix();
          controls.minDistance = 0.2; controls.maxDistance = radius * 40;
          controls.update();
        }
        function resize() {
          const width = Math.max(container.clientWidth, 1), height = Math.max(container.clientHeight, 1);
          renderer.setSize(width, height); camera.aspect = width / height; camera.updateProjectionMatrix();
        }
        observer = new ResizeObserver(resize); observer.observe(container); resize(); fit(true);
        function zoom(factor) {
          const direction = camera.position.clone().sub(controls.target);
          const distance = Math.max(controls.minDistance, Math.min(controls.maxDistance, direction.length() * factor));
          camera.position.copy(controls.target).add(direction.setLength(distance));
          controls.update();
        }
        function focusStation(row) {
          const point = stationLocal(row, center);
          const direction = camera.position.clone().sub(controls.target).normalize();
          if (!direction.lengthSq()) direction.set(0.9,-1,0.75).normalize();
          controls.target.copy(point); camera.position.copy(point).addScaledVector(direction, 20); controls.update();
        }
        let pointerStart;
        const down = event => { if(event.button===0) pointerStart={x:event.clientX,y:event.clientY}; };
        const up = event => {
          const start=pointerStart; pointerStart=null;
          if(!start || event.button!==0 || !stationBridge.current?.placing || Math.hypot(start.x-event.clientX,start.y-event.clientY)>5)return;
          const rect=renderer.domElement.getBoundingClientRect();
          camera.updateMatrixWorld(true); scene.updateMatrixWorld(true);
          stationBridge.current.pick(pickStationPoint(cloud,camera,center,{x:event.clientX-rect.left,y:event.clientY-rect.top},rect.width,rect.height));
        };
        const cancel = () => { pointerStart=null; };
        renderer.domElement.addEventListener('pointerdown',down);
        renderer.domElement.addEventListener('pointerup',up);
        renderer.domElement.addEventListener('pointercancel',cancel);
        removePicking=()=>{renderer.domElement.removeEventListener('pointerdown',down);renderer.domElement.removeEventListener('pointerup',up);renderer.domElement.removeEventListener('pointercancel',cancel);};
        viewer.current = { cloud, fit, zoom, camera, controls, focusStation };
        let lastStatus = 0, shown = false, readyAt = 0, sampledFrames = 0, reported = false;
        function render(now) {
          if (!active || controller.signal.aborted) return;
          try {
            controls.update(); scene.updateMatrixWorld(true); camera.updateMatrixWorld(true);
            const update = potree.updatePointClouds([cloud], camera, renderer);
            if (update.nodeLoadFailed) throw new Error('A point-cloud node failed to load. Retry the dataset.');
            for (const node of cloud.visibleNodes) {
              const geometry = node.sceneNode.geometry;
              const rgba = geometry.getAttribute('rgba');
              if (rgba && !geometry.getAttribute('color')) {
                // Share the decoded RGBA bytes as normalized RGB, without copying data.
                geometry.setAttribute('color', new InterleavedBufferAttribute(new InterleavedBuffer(rgba.array, 4), 3, 0, true));
              }
            }
            renderer.render(scene, camera);
            stationBridge.current?.project(camera, center, container.clientWidth, container.clientHeight);
            const count = cloud.visibleNodes.reduce((sum, node) => sum + (node.sceneNode.geometry.getAttribute('position')?.count || 0), 0);
            if (count > 0 && !shown) { shown = true; readyAt = now; clearTimeout(timeout); setReady(true);
              if (import.meta.env.DEV) console.info('Point cloud ready', variant.id, `${((performance.now() - started) / 1000).toFixed(2)}s to first points`); }
            if (shown && now - lastStatus > 500) { setStatus(`${count.toLocaleString()} points in view · ${data.points.toLocaleString()} in dataset`); lastStatus = now; }
            if (shown && !reported) {
              sampledFrames++;
              if (now - readyAt >= 5000) {
                reported = true;
                if (import.meta.env.DEV) console.info('Point cloud render sample', variant.id, `${Math.round(sampledFrames * 1000 / (now - readyAt))} fps over first 5s`, `${count} visible points`);
              }
            }
            frameId = requestAnimationFrame(render);
          } catch (error) { failed(error); }
        }
        frameId = requestAnimationFrame(render);
      } catch (error) { if (error.name !== 'AbortError') failed(error); }
    }
    timeout = setTimeout(() => failed(new Error('Point-cloud loading timed out. Check the files and graphics support, then retry.')), 45000);
    start();
    return () => {
      active = false; controller.abort(); cancelAnimationFrame(frameId); clearTimeout(timeout);
      removePicking?.(); observer?.disconnect(); controls?.dispose(); workers.forEach(worker => worker.terminate());
      // Potree's root node has no parent and is skipped by its node dispose helper.
      cloud?.pcoGeometry.root.geometry?.dispose();
      cloud?.dispose(); renderer?.dispose(); renderer?.forceContextLoss(); container.replaceChildren(); viewer.current = null;
    };
  }, [dataset.dataset_id, variant.id, attempt]);
  function pointSize(value) { settings.current.size = value; setSize(value); if (viewer.current) viewer.current.cloud.material.size = value; }
  function colorMode(value) { settings.current.color = value; setColor(value); if (viewer.current) viewer.current.cloud.material.pointColorType = value === 'RGB' ? PointColorType.RGB : PointColorType.HEIGHT; }
  return <main className="page pointCloudPage">
    <div className="terrestrialHeading"><button onClick={onBack}>← Back to Terrestrial Data</button><span className="badge info">3D Terrestrial Point Cloud</span></div>
    <section className="panel pointCloudPanel">
      <div className="terrestrialHeading"><div><p className="eyebrow">{dataset.display_name}</p><h1>{variant.name || variant.label}</h1></div><span className="badge neutral">Points: {(variant.points / 1e6).toFixed(1)}M</span></div>
      <div className="pointCloudToolbar"><label>Point Cloud Detail<select disabled={stationEditing} value={variant.id} onChange={event => { setReady(false); setVariantId(event.target.value); }}>{variants.map(item => <option key={item.id} value={item.id}>{item.label} — {item.points / 1e6}M</option>)}</select></label><button disabled={!ready} onClick={() => viewer.current?.zoom(0.75)}>Zoom In</button><button disabled={!ready} onClick={() => viewer.current?.zoom(1.333333)}>Zoom Out</button><button disabled={!ready} onClick={() => viewer.current?.fit()}>Fit to Cloud</button><button disabled={!ready} onClick={() => viewer.current?.fit(true)}>Reset View</button><label>Point size<input aria-label="Point size" type="range" min="1" max="6" step="0.5" value={size} onChange={event => pointSize(Number(event.target.value))} disabled={!ready} /></label><output>{size}px</output><label>Color mode<select value={color} onChange={event => colorMode(event.target.value)} disabled={!ready}><option>RGB</option><option>Elevation</option></select></label></div>
      <StationTools dataset={dataset} viewer={viewer} bridge={stationBridge} ready={ready} focusSetup={focusSetup} onOpenPanorama={onOpenPanorama} onEditing={setStationEditing} overlay={markers => markerHost ? createPortal(markers, markerHost) : null} />
      <div className="pointCloudSurface"><div className="pointCloudCanvas" ref={host} /><div ref={setMarkerHost} />{!ready && !error && <div className="pointCloudOverlay" role="status">{status}</div>}{error && <div className="pointCloudOverlay" role="alert"><h2>Point cloud unavailable</h2><p>{error}</p><button onClick={() => setAttempt(value => value + 1)}>Retry Point Cloud</button></div>}</div>
      <div className="pointCloudFooter"><p>Left drag: orbit · Right drag / arrow keys: pan · Scroll or buttons: zoom · Touch: one finger orbit, two fingers pan/zoom</p><p role="status">{error ? 'Unable to load' : status}</p></div>
    </section>
  </main>;
}

import { WorkbenchMarkers } from './WorkbenchMarkers.jsx';
import { groundState, applyGround } from './groundNavigation.js';
import { installFlyNavigation, cameraSnapshot, restoreCamera } from './flyNavigation.js';
import { createPortal } from 'react-dom';
import { StationTools } from './StationTools.jsx';
import { pickStationPoint, stationLocal } from './stationGeometry.js';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { BufferGeometry, LineBasicMaterial, LineSegments, Box3, Vector3, PerspectiveCamera, Scene, WebGLRenderer, Color, Sphere, InterleavedBuffer, InterleavedBufferAttribute } from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { Potree, PointColorType, PointSizeType, PointShape, PointCloudMaterial } from 'potree-core';
import './pointcloud.css';

export default function PointCloudViewer({ dataset, onBack, onOpenPanorama, focusSetup, resumeState, onSaveState, workbench }) {
  const variants = dataset.point_cloud_variants || [{ id: 'preview_1m', label: 'Fast Preview', name: dataset.web_point_cloud.name, points: dataset.web_point_cloud.point_count }];
  const [variantId, setVariantId] = useState(resumeState?.variantId || dataset.default_point_cloud_variant || variants[0].id);
  const variant = variants.find(item => item.id === variantId) || variants[0];
  const settings = useRef({ size: resumeState?.size || 2, color: resumeState?.color || 'RGB' });
  const stationBridge = useRef(null);
  const resumeGroundRequest=useRef(Boolean(resumeState?.resumeGround));
  const cameraMemory=useRef(resumeState?.camera);
  const stationMemory=useRef({selected:focusSetup||resumeState?.selected||'',connections:resumeState?.connections||false});
  const [mode,setMode]=useState(resumeState?.mode==='Walk / Fly'?'Fly':resumeState?.mode||'Orbit');
  const [speed,setSpeed]=useState(resumeState?.speed||'Normal');
  const [flyActive,setFlyActive]=useState(false);
  const [ground,setGround]=useState(()=>({eyeHeight:resumeState?.eyeHeight||1.7,groundZ:resumeState?.groundZ}));
  const navigation=useRef({mode,speed,...ground});navigation.current={mode,speed,...ground};
  function establishGround(reset=false){const state=groundState(navigation.current,viewer.current?.snapshot().position[2]||0,reset);navigation.current={...navigation.current,...state};setGround(state);return state;}
  function enterGround(reset=false){if(!viewer.current)return;viewer.current.fly.pause();establishGround(reset);navigation.current.mode='Ground Walk';setMode('Ground Walk');viewer.current.ground();viewer.current.controls.enabled=false;viewer.current.fly.resume();setFlyActive(true);}
  function eyeHeightChanged(value){const state={...ground,eyeHeight:Number(value)};setGround(state);navigation.current={...navigation.current,...state};if(mode==='Ground Walk')viewer.current?.ground();}
  function saveState(){const camera=viewer.current?.snapshot()||cameraMemory.current;onSaveState?.({...stationMemory.current,cameraSetup:stationMemory.current.selected,camera,variantId,size:settings.current.size,color:settings.current.color,...navigation.current});}
  function openPanorama(row){saveState();onOpenPanorama(row);}
  function changeMode(value){if(value==='Ground Walk'){enterGround();return;}viewer.current?.fly.pause();viewer.current?.cancelFocus();navigation.current.mode=value;setMode(value);if(viewer.current)viewer.current.controls.enabled=value==='Orbit';}
  function resumeFly(value=mode==='Ground Walk'?'Ground Walk':'Fly'){if(value==='Ground Walk'){enterGround();return;}navigation.current.mode='Fly';setMode('Fly');if(viewer.current){viewer.current.cancelFocus();viewer.current.controls.enabled=false;viewer.current.fly.resume();setFlyActive(true);}}

  const [markerHost, setMarkerHost] = useState(null);
  const [stationEditing, setStationEditing] = useState(false);
  const editingChanged=useCallback(value=>{setStationEditing(value);if(value){viewer.current?.fly.pause();setMode('Orbit');if(viewer.current)viewer.current.controls.enabled=true;}},[]);
  const host = useRef(null);
  const viewer = useRef(null);
  const [attempt, setAttempt] = useState(0);
  const [status, setStatus] = useState('Loading point-cloud metadata…');
  const [error, setError] = useState('');
  const [ready, setReady] = useState(false);
  const [size, setSize] = useState(settings.current.size);
  const [color, setColor] = useState(settings.current.color);
  useEffect(() => {
    let active = true, frameId, cloud, renderer, controls, observer, timeout, removePicking, connectionLines, fly;
    let flight=null;
    const controller = new AbortController();
    const workers = new Set();
    const container = host.current;
    setError(''); setReady(false); setFlyActive(false); setStatus('Loading point-cloud metadata…');
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
          if(navigation.current.mode==='Ground Walk'&&viewer.current){fly?.pause();navigation.current.mode='Orbit';setMode('Orbit');controls.enabled=true;}
          flight=null;
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
        const restored=restoreCamera(camera,controls.target,center,cameraMemory.current);
        function groundCamera(){flight=null;applyGround(camera,controls.target,center,navigation.current);camera.lookAt(controls.target);}
        if(navigation.current.mode==='Ground Walk'){
          const state=groundState(navigation.current,camera.position.z+center.z);Object.assign(navigation.current,state);setGround(state);groundCamera();
        }
        controls.enabled=navigation.current.mode==='Orbit';
        fly=installFlyNavigation({canvas:renderer.domElement,camera,controls,getSettings:()=>navigation.current,onPaused:()=>setFlyActive(false),onInput:()=>{flight=null;}});
        function zoom(factor) {
          flight=null;
          const direction = camera.position.clone().sub(controls.target);
          const distance = Math.max(controls.minDistance, Math.min(controls.maxDistance, direction.length() * factor));
          camera.position.copy(controls.target).add(direction.setLength(distance));
          controls.update();
        }
        function focusStation(row) {
          const point = stationLocal(row, center);
          if(navigation.current.mode!=='Orbit'){
            flight=null;const direction=camera.getWorldDirection(new Vector3());
            // Preserve look direction; no assumption about panorama heading or ground at station XYZ.
            camera.position.set(point.x-direction.x*3,point.y-direction.y*3,point.z+1.7);
            controls.target.copy(camera.position).addScaledVector(direction,20);
            if(navigation.current.mode==='Ground Walk')groundCamera();else camera.lookAt(controls.target);
            return;
          }
          const direction = camera.position.clone().sub(controls.target).normalize();
          if (!direction.lengthSq()) direction.set(0.9,-1,0.75).normalize();
          flight={started:performance.now(),from:camera.position.clone(),targetFrom:controls.target.clone(),to:point.clone().addScaledVector(direction,20),target:point};
          if(window.matchMedia('(prefers-reduced-motion: reduce)').matches){controls.target.copy(point);camera.position.copy(flight.to);flight=null;controls.update();}
        }
        connectionLines=new LineSegments(new BufferGeometry(),new LineBasicMaterial({color:0x73b7ce,transparent:true,opacity:0.5,depthWrite:false}));
        scene.add(connectionLines);
        function setStationConnections(row,neighbors) {
          const points=row?neighbors.flatMap(other=>[stationLocal(row,center),stationLocal(other,center)]):[];
          connectionLines.geometry.dispose();connectionLines.geometry=new BufferGeometry().setFromPoints(points);connectionLines.visible=points.length>0;
        }
        controls.addEventListener('start',()=>{flight=null;});
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
        viewer.current = { cancelFocus:()=>{flight=null;}, ground:groundCamera, cloud, fit, zoom, camera, controls, focusStation, setStationConnections, fly, restored, snapshot:()=>cameraSnapshot(camera,controls.target,center) };
        let lastStatus = 0, shown = false, readyAt = 0, sampledFrames = 0, reported = false;
        function render(now) {
          if (!active || controller.signal.aborted) return;
          try {
            if(flight){const t=Math.min(1,(now-flight.started)/650),ease=t*t*(3-2*t);camera.position.lerpVectors(flight.from,flight.to,ease);controls.target.lerpVectors(flight.targetFrom,flight.target,ease);if(t===1)flight=null;}
            if(navigation.current.mode==='Orbit')controls.update();else {fly.update(now);camera.lookAt(controls.target);}
            if(navigation.current.mode==='Ground Walk')groundCamera();
            scene.updateMatrixWorld(true); camera.updateMatrixWorld(true);
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
              if(resumeGroundRequest.current){resumeGroundRequest.current=false;fly.resume();setFlyActive(true);}
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
      cameraMemory.current=viewer.current?.snapshot()||cameraMemory.current;fly?.dispose();
      active = false; controller.abort(); cancelAnimationFrame(frameId); clearTimeout(timeout);
      connectionLines?.geometry.dispose();connectionLines?.material.dispose();
      removePicking?.(); observer?.disconnect(); controls?.dispose(); workers.forEach(worker => worker.terminate());
      // Potree's root node has no parent and is skipped by its node dispose helper.
      cloud?.pcoGeometry.root.geometry?.dispose();
      cloud?.dispose(); renderer?.dispose(); renderer?.forceContextLoss(); container.replaceChildren(); viewer.current = null;
    };
  }, [dataset.dataset_id, variant.id, attempt]);
  function pointSize(value) { settings.current.size = value; setSize(value); if (viewer.current) viewer.current.cloud.material.size = value; }
  function colorMode(value) { settings.current.color = value; setColor(value); if (viewer.current) viewer.current.cloud.material.pointColorType = value === 'RGB' ? PointColorType.RGB : PointColorType.HEIGHT; }
  return <main className={workbench?"pointCloudPage workbenchCloud":"page pointCloudPage"}>
    {!workbench&&<div className="terrestrialHeading"><button onClick={()=>{saveState();onBack();}}>← Back to Terrestrial Data</button><span className="badge info">3D Terrestrial Point Cloud</span></div>}
    <section className="panel pointCloudPanel">
      <div className="terrestrialHeading"><div><p className="eyebrow">{dataset.display_name}</p><h1>{variant.name || variant.label}</h1></div><span className="badge neutral">Points: {(variant.points / 1e6).toFixed(1)}M</span></div>
      <div className="pointCloudToolbar"><label>Point Cloud Detail<select disabled={stationEditing} value={variant.id} onChange={event => { setReady(false); setVariantId(event.target.value); }}>{variants.map(item => <option key={item.id} value={item.id}>{item.label} — {item.points / 1e6}M</option>)}</select></label><button disabled={!ready} onClick={() => viewer.current?.zoom(0.75)}>Zoom In</button><button disabled={!ready} onClick={() => viewer.current?.zoom(1.333333)}>Zoom Out</button><button disabled={!ready} onClick={() => viewer.current?.fit()}>Fit to Cloud</button><button disabled={!ready} onClick={() => viewer.current?.fit(true)}>Reset View</button><label>Point size<input aria-label="Point size" type="range" min="1" max="6" step="0.5" value={size} onChange={event => pointSize(Number(event.target.value))} disabled={!ready} /></label><output>{size}px</output><label>Color mode<select value={color} onChange={event => colorMode(event.target.value)} disabled={!ready}><option>RGB</option><option>Elevation</option></select></label></div>
      <div className="pointCloudToolbar flyToolbar"><label>Navigation Mode<select value={mode} disabled={!ready||stationEditing} onChange={e=>changeMode(e.target.value)}><option>Orbit</option>{!workbench&&<option>Ground Walk</option>}<option>Fly</option></select></label><label>Movement speed<select value={speed} onChange={e=>setSpeed(e.target.value)}><option>Slow</option><option>Normal</option><option>Fast</option></select></label>{!workbench&&<button disabled={!ready||stationEditing} onClick={()=>enterGround()}>Ground Walk</button>}<button disabled={!ready||stationEditing} onClick={()=>resumeFly('Fly')}>Fly</button>{mode!=='Orbit'&&<button disabled={!ready||stationEditing} onClick={()=>resumeFly()}>Resume {mode}</button>}{!workbench&&<><label>Eye Height<select value={ground.eyeHeight} onChange={e=>eyeHeightChanged(e.target.value)} disabled={!ready||stationEditing}>{[1.5,1.7,1.9].map(h=><option key={h} value={h}>{h.toFixed(1)} m</option>)}</select></label><button disabled={!ready||stationEditing} onClick={()=>enterGround(true)}>Set Ground Here</button><button disabled={!ready||stationEditing||!Number.isFinite(ground.groundZ)} onClick={()=>enterGround()}>Return to Ground</button></>}<span>{mode==='Orbit'?'Orbit navigation':flyActive?'Movement active':'Paused · Resume to move'}</span></div>
      {!workbench&&<p className="groundNote">Set Ground Here uses the current camera elevation as a manual ground reference, then raises the viewpoint by eye height. {Number.isFinite(ground.groundZ)?'Saved walking elevation: '+ground.groundZ.toFixed(2)+' m (native Z).':'No walking reference set.'} Level plane only; no terrain following or collisions.</p>}
      {workbench?<WorkbenchMarkers workbench={workbench} viewer={viewer} bridge={stationBridge} ready={ready} onEditing={editingChanged} overlay={markers=>markerHost?createPortal(markers,markerHost):null}/>:<StationTools resumeState={resumeState} stationMemory={stationMemory} dataset={dataset} viewer={viewer} bridge={stationBridge} ready={ready} focusSetup={focusSetup} onOpenPanorama={openPanorama} onEditing={editingChanged} overlay={markers => markerHost ? createPortal(markers, markerHost) : null} />}
      <div className="pointCloudSurface">{workbench?.draft&&<div className="placementActive">PLACE SETUP {workbench.setup} · Click a rendered point · Save required</div>}<div className="pointCloudCanvas" ref={host} /><div ref={setMarkerHost} />{ready&&mode!=='Orbit'&&<div className="flyHud"><strong>{mode.toUpperCase()} · {speed}</strong><span>WASD Move · {mode==='Ground Walk'?'Shift Fast Walk':'Q / E Down / Up · Shift Faster'}</span><span>Drag mouse Look · Esc Pause</span>{mode==='Ground Walk'&&<span>Eye Height: {ground.eyeHeight.toFixed(1)} m · Fly to leave Ground Walk</span>}<span>{flyActive?'Movement active':'Paused — use Resume '+mode}</span></div>}{!ready && !error && <div className="pointCloudOverlay" role="status">{status}</div>}{error && <div className="pointCloudOverlay" role="alert"><h2>Point cloud unavailable</h2><p>{error}</p><button onClick={() => setAttempt(value => value + 1)}>Retry Point Cloud</button></div>}</div>
      <div className="pointCloudFooter"><p>{mode==='Orbit'?'Left drag: orbit · Right drag / arrow keys: pan · Scroll or buttons: zoom · Touch: one finger orbit, two fingers pan/zoom':mode==='Ground Walk'?'Level walking plane · No collision or slope detection · Esc or leaving the canvas pauses movement.':'Free flight · No gravity, collision or ground following · Drag to look; Esc or leaving the canvas pauses movement.'}</p><p role="status">{error ? 'Unable to load' : status}</p></div>
    </section>
  </main>;
}

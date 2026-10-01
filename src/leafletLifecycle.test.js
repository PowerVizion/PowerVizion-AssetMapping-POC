import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { prepareLeafletLifecycle } from './leafletLifecycle.js';

// Exercise the installed Leaflet transition callback, including its early-out,
// so this regression test must be revisited if the dependency changes.
const source = readFileSync(new URL('../node_modules/leaflet/src/map/Map.js', import.meta.url), 'utf8');
const body = source.match(/_onZoomTransitionEnd: function \(\) \{([\s\S]*?)\n\t\}/)[1];
const transitionEnd = new Function('DomUtil', `return function () {${body}}`)({ removeClass() {} });
function fixture() {
  let unload;
  const map = {
    _animatingZoom: true, _mapPane: {}, moves: 0,
    once(event, callback) { assert.equal(event, 'unload'); unload = callback; },
    _move() { if (!this._mapPane) throw new TypeError("Cannot read properties of undefined (reading '_leaflet_pos')"); this.moves++; },
    fire() {}, _moveEnd() {},
    remove() { unload?.(); delete this._mapPane; }
  };
  return map;
}
test('queued Leaflet zoom completion reproduces teardown error without protection', () => {
  const map = fixture(); map.remove();
  assert.throws(() => transitionEnd.call(map), /_leaflet_pos/);
});
test('unload makes late zoom completions harmless across repeated map lifecycles', () => {
  for (let i = 0; i < 30; i++) {
    const map = fixture(); prepareLeafletLifecycle({ target: map });
    const queuedCompletion = transitionEnd.bind(map);
    map.remove(); queuedCompletion(); queuedCompletion();
    assert.equal(map.moves, 0);
  }
});
test('live zoom completion retains normal behavior', () => {
  const map = fixture(); prepareLeafletLifecycle({ target: map });
  transitionEnd.call(map);
  assert.equal(map.moves, 1);
  assert.equal(map._animatingZoom, false);
});
test('unload cancels pending debounced size event', async () => {
  const map = fixture(); let fired = false;
  map._sizeTimer = setTimeout(() => { fired = true; }, 5);
  prepareLeafletLifecycle({ target: map }); map.remove();
  await new Promise(resolve => setTimeout(resolve, 15));
  assert.equal(fired, false);
});

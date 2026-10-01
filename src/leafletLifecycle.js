// Leaflet 1.9.x does not retain/cancel its 250 ms zoom-transition fallback.
// remove() deletes the pane but leaves the animation flag set. Clear it on
// unload so an already queued transition callback returns without touching DOM.
// Keep React-Leaflet responsible for map removal, layers, handlers and frames.
export function prepareLeafletLifecycle({ target: map }) {
  map.once('unload', () => {
    map._animatingZoom = false;
    clearTimeout(map._sizeTimer);
  });
}

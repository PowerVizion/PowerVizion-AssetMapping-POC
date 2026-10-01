// Derive links only from saved positions in the same dataset; never from setup order.
export function nearestStations(current, stations) {
  const valid = row => row && ['x','y','z'].every(axis => Number.isFinite(row[axis]));
  const saved = stations.find(row => row.dataset_id === current?.dataset_id && row.setup_id === current?.setup_id);
  if (!valid(saved)) return [];
  return stations.filter(row => row.dataset_id === saved.dataset_id && row.setup_id !== saved.setup_id && valid(row))
    .map(row => ({...row, distance: Math.hypot(row.x-saved.x, row.y-saved.y, row.z-saved.z)}))
    .sort((a,b) => a.distance-b.distance || a.setup_id.localeCompare(b.setup_id)).slice(0,3);
}

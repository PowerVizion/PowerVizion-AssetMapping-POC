export function mappedSurveys(datasets) {
  return datasets.filter(dataset => {
    const map = dataset.map;
    return map?.enabled === true && map.geometry_type === 'polygon' && Array.isArray(map.footprint) && map.footprint.length >= 3 &&
      map.footprint.every(point => Array.isArray(point) && point.length === 2 && Number.isFinite(point[0]) && Math.abs(point[0]) <= 90 && Number.isFinite(point[1]) && Math.abs(point[1]) <= 180) &&
      new Set(map.footprint.map(point => point.join(','))).size >= 3;
  });
}
export function mapPositions(assets, surveys = []) {
  return [...assets.map(asset => [Number(asset.latitude), Number(asset.longitude)]), ...surveys.flatMap(dataset => dataset.map.footprint)];
}

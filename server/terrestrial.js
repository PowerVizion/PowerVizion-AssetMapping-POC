import { readFile, stat, readdir } from 'node:fs/promises';
import path from 'node:path';

function localPath(root, relativePath) {
  if (typeof relativePath !== 'string' || !relativePath.trim() || path.isAbsolute(relativePath)) {
    throw new Error('Dataset paths must be non-empty relative paths');
  }
  const resolved = path.resolve(root, relativePath);
  const relative = path.relative(root, resolved);
  if (relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) {
    throw new Error('Dataset paths must stay within the terrestrial root');
  }
  return resolved;
}

async function availability(filePath, directory = false) {
  try {
    const info = await stat(filePath);
    const available = directory ? info.isDirectory() : info.isFile();
    return { available, status: available ? 'available' : 'wrong_type' };
  } catch (error) {
    return { available: false, status: ['ENOENT', 'ENOTDIR'].includes(error.code) ? 'missing' : 'unreadable' };
  }
}

function panoramaMatcher(pattern) {
  if (typeof pattern !== 'string' || !pattern) throw new Error('Dataset requires a panorama_pattern');
  // Each # represents one digit; all other characters are literal.
  const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/#/g, '[0-9]');
  return new RegExp('^' + escaped + '$', 'i');
}

export async function readTerrestrialDatasets(configPath, configuredRoot) {
  // Windows PowerShell can write UTF-8 JSON with a BOM.
  const datasets = JSON.parse((await readFile(configPath, 'utf8')).replace(/^\uFEFF/, ''));
  if (!Array.isArray(datasets)) throw new Error('Terrestrial dataset configuration must be an array');
  const rootConfigured = typeof configuredRoot === 'string' && Boolean(configuredRoot.trim());
  const root = rootConfigured ? path.resolve(configuredRoot.trim()) : null;
  const rootStatus = root ? await availability(root, true) : { available: false, status: 'not_configured' };
  return Promise.all(datasets.map(async dataset => {
    if (!dataset || typeof dataset !== 'object' || Array.isArray(dataset) || !dataset.dataset_id) {
      throw new Error('Invalid terrestrial dataset definition');
    }
    const matcher = panoramaMatcher(dataset.panorama_pattern);
    // Validate paths even when the machine's data root has not been configured.
    const pointCloudPath = localPath(root || path.resolve('.'), dataset.point_cloud_file);
    const panoramaPath = localPath(root || path.resolve('.'), dataset.panorama_directory);
    const pointCloud = rootStatus.available ? await availability(pointCloudPath) : { ...rootStatus };
    const panoramas = rootStatus.available ? await availability(panoramaPath, true) : { ...rootStatus };
    let panoramaCount = null;
    if (panoramas.available) {
      try {
        const entries = await readdir(panoramaPath, { withFileTypes: true });
        panoramaCount = entries.filter(entry => entry.isFile() && matcher.test(entry.name)).length;
      } catch {
        panoramas.available = false;
        panoramas.status = 'unreadable';
      }
    }
    return {
      ...dataset,
      local: {
        root_configured: rootConfigured,
        root_available: rootStatus.available,
        root_status: rootStatus.status,
        point_cloud_available: pointCloud.available,
        point_cloud_status: pointCloud.status,
        panorama_directory_available: panoramas.available,
        panorama_directory_status: panoramas.status,
        panorama_count: panoramaCount,
        panorama_count_matches_expected: panoramaCount !== null && Number.isInteger(dataset.panorama_count)
          ? panoramaCount === dataset.panorama_count : null
      }
    };
  }));
}

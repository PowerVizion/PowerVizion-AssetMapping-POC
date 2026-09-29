import express from 'express';
import path from 'node:path';
import { readFile, realpath, lstat, open } from 'node:fs/promises';

function fail(status, message) {
  return Object.assign(new Error(message), { status });
}

function within(parent, child) {
  const relative = path.relative(parent, child);
  return relative && relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative);
}

export function expectedPanoramas(dataset) {
  const pattern = dataset.panorama_pattern;
  const digits = typeof pattern === 'string' && pattern.match(/#+/g);
  const count = dataset.setup_count;
  if (!digits || digits.length !== 1 || !/\.jpe?g$/i.test(pattern) || /[\\/:\x00]/.test(pattern) ||
      !Number.isInteger(count) || count < 1 || count > 10000 || String(count).length > digits[0].length) {
    throw fail(500, 'Invalid panorama configuration');
  }
  return Array.from({ length: count }, (_, index) => ({
    setup_number: index + 1,
    filename: pattern.replace(digits[0], String(index + 1).padStart(digits[0].length, '0'))
  }));
}

// This router has no database dependency and never mounts an external static directory.
export function terrestrialPanoramaRouter({ configPath, getRoot }) {
  const router = express.Router();
  async function datasetById(id) {
    const datasets = JSON.parse((await readFile(configPath, 'utf8')).replace(/^\uFEFF/, ''));
    if (!Array.isArray(datasets)) throw fail(500, 'Invalid dataset configuration');
    const dataset = datasets.find(item => item?.dataset_id === id);
    if (!dataset) throw fail(404, 'Terrestrial dataset not found');
    return dataset;
  }
  router.get('/:datasetId/panoramas', async (req, res, next) => {
    try {
      const dataset = await datasetById(req.params.datasetId);
      res.json(expectedPanoramas(dataset));
    } catch (error) { next(error); }
  });
  router.get('/:datasetId/panoramas/:filename', async (req, res, next) => {
    try {
      const dataset = await datasetById(req.params.datasetId);
      const filename = req.params.filename;
      if (/[\\/:\x00]/.test(filename) || !expectedPanoramas(dataset).some(item => item.filename === filename)) {
        throw fail(404, 'Panorama not found');
      }
      const configuredRoot = getRoot()?.trim();
      if (!configuredRoot) throw fail(404, 'Terrestrial data is unavailable');
      const root = await realpath(configuredRoot);
      const directory = dataset.panorama_directory;
      if (typeof directory !== 'string' || !directory || path.isAbsolute(directory)) {
        throw fail(500, 'Invalid panorama directory configuration');
      }
      const candidate = path.resolve(root, directory);
      if (!within(root, candidate)) throw fail(404, 'Panorama not found');
      const panoramaRoot = await realpath(candidate);
      if (!within(root, panoramaRoot)) throw fail(404, 'Panorama not found');
      const file = path.join(panoramaRoot, filename);
      // Reject symlinks, directories and other non-regular files.
      if (!(await lstat(file)).isFile()) throw fail(404, 'Panorama not found');
      const resolved = await realpath(file);
      if (!within(panoramaRoot, resolved)) throw fail(404, 'Panorama not found');
      const handle = await open(resolved, 'r');
      try {
        const signature = Buffer.alloc(3);
        const { bytesRead } = await handle.read(signature, 0, 3, 0);
        if (bytesRead !== 3 || !signature.equals(Buffer.from([0xff, 0xd8, 0xff]))) {
          throw fail(404, 'Panorama is unavailable or is not a JPEG');
        }
      } finally { await handle.close(); }
      res.set('X-Content-Type-Options', 'nosniff');
      res.type('jpeg');
      res.sendFile(resolved, { dotfiles: 'deny', cacheControl: false }, error => {
        if (error && !res.headersSent) next(error);
      });
    } catch (error) { next(error); }
  });
  router.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    const missing = ['ENOENT', 'ENOTDIR', 'EACCES', 'EPERM'].includes(error.code);
    const status = missing ? 404 : error.status || 500;
    res.status(status).json({ error: status === 404 ? 'Panorama or dataset is unavailable' : 'Unable to load terrestrial panoramas' });
  });
  return router;
}

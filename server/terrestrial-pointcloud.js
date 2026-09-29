import express from 'express';
import path from 'node:path';
import { readFile, realpath, lstat } from 'node:fs/promises';

const files = new Set(['metadata.json', 'hierarchy.bin', 'octree.bin']);
const fail = (status, message) => Object.assign(new Error(message), { status });
function contained(root, target) {
  const relative = path.relative(root, target);
  return relative && relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative);
}
export function terrestrialPointCloudRouter({ configPath, getRoot }) {
  const router = express.Router();
  router.get(['/:datasetId/point-cloud/:variantId/:filename', '/:datasetId/point-cloud/:filename'], async (req, res, next) => {
    try {
      if (!files.has(req.params.filename)) throw fail(404, 'Point-cloud file not found');
      const datasets = JSON.parse((await readFile(configPath, 'utf8')).replace(/^\uFEFF/, ''));
      if (!Array.isArray(datasets)) throw fail(500, 'Invalid dataset configuration');
      const dataset = datasets.find(item => item?.dataset_id === req.params.datasetId);
      if (!dataset) throw fail(404, 'Dataset is unavailable');
      // The legacy URL remains a 1M alias; variant URLs resolve only approved IDs.
      const variantId = req.params.variantId;
      if (variantId && !/^[a-z0-9_-]+$/.test(variantId)) throw fail(404, 'Invalid point-cloud variant');
      const variant = variantId
        ? dataset.point_cloud_variants?.find(item => item.id === variantId)
        : dataset.web_point_cloud;
      if (!variant) throw fail(404, 'Point-cloud variant is unavailable');
      const directory = variant.directory;
      if (typeof directory !== 'string' || !directory.trim() || path.isAbsolute(directory) || /[:\x00]/.test(directory)) throw fail(404, 'Invalid point-cloud directory');
      const configuredRoot = getRoot()?.trim();
      if (!configuredRoot) throw fail(404, 'Web point-cloud data is unavailable');
      const root = await realpath(configuredRoot);
      const candidate = path.resolve(root, directory);
      if (!contained(root, candidate)) throw fail(404, 'Point-cloud directory is outside the approved root');
      const folder = await realpath(candidate);
      if (!contained(root, folder)) throw fail(404, 'Point-cloud directory is outside the approved root');
      const candidateFile = path.join(folder, req.params.filename);
      if (!(await lstat(candidateFile)).isFile()) throw fail(404, 'Point-cloud file is unavailable');
      const file = await realpath(candidateFile);
      if (!contained(folder, file)) throw fail(404, 'Point-cloud file is outside the approved directory');
      res.set('X-Content-Type-Options', 'nosniff');
      res.set('Cache-Control', 'no-store');
      res.set('Access-Control-Expose-Headers', 'Accept-Ranges, Content-Range, Content-Length');
      res.type(req.params.filename === 'metadata.json' ? 'application/json' : 'application/octet-stream');
      // Express sendFile implements streaming, HEAD, single byte ranges and 416 errors.
      res.sendFile(file, { dotfiles: 'deny', acceptRanges: true, cacheControl: false }, error => {
        if (error && !res.headersSent) next(error);
      });
    } catch (error) { next(error); }
  });
  router.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    const status = ['ENOENT', 'ENOTDIR', 'EACCES', 'EPERM'].includes(error.code) ? 404 : error.status || 500;
    res.status(status).json({ error: status === 416 ? 'Requested byte range is unavailable' : status === 404 ? 'Point-cloud file or dataset is unavailable' : 'Unable to load point-cloud configuration' });
  });
  return router;
}

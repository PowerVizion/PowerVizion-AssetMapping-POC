import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import express from 'express';
import { terrestrialPanoramaRouter } from './terrestrial-panoramas.js';

test('panorama routes expose only expected JPEGs inside the dataset', async t => {
  const temporary = await mkdtemp(path.join(tmpdir(), 'powervizion-panorama-test-'));
  const root = path.join(temporary, 'root');
  const directory = path.join(root, 'Panoramas');
  const outside = path.join(temporary, 'outside');
  await mkdir(directory, { recursive: true });
  await mkdir(outside);
  const configPath = path.join(temporary, 'datasets.json');
  const dataset = { dataset_id: 'MH_SUB_1', panorama_directory: 'Panoramas', panorama_pattern: 'WINNIPEG- Setup ###.jpg', setup_count: 57 };
  const filename = number => `WINNIPEG- Setup ${String(number).padStart(3, '0')}.jpg`;
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0xff, 0xd9]);
  await writeFile(configPath, '\uFEFF' + JSON.stringify([dataset]));
  for (const number of [1, 57, 58]) await writeFile(path.join(directory, filename(number)), jpeg);
  await writeFile(path.join(directory, filename(3)), 'not a jpeg');
  await mkdir(path.join(directory, filename(4)));
  await writeFile(path.join(outside, filename(1)), jpeg);
  await symlink(outside, path.join(root, 'LinkedPanoramas'), 'junction');
  let configuredRoot = root;
  const app = express();
  app.use('/api/terrestrial-datasets', terrestrialPanoramaRouter({ configPath, getRoot: () => configuredRoot }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(async () => {
    await new Promise(resolve => server.close(resolve));
    // Only remove this test's generated temporary directory.
    assert.equal(path.dirname(temporary), path.resolve(tmpdir()));
    assert.ok(path.basename(temporary).startsWith('powervizion-panorama-test-'));
    await rm(temporary, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${server.address().port}/api/terrestrial-datasets`;
  const url = name => `${base}/MH_SUB_1/panoramas/${encodeURIComponent(name)}`;
  await t.test('catalog includes Setup 001 through 057 without filesystem paths', async () => {
    const response = await fetch(`${base}/MH_SUB_1/panoramas`);
    assert.equal(response.status, 200);
    const items = await response.json();
    assert.equal(items.length, 57);
    assert.deepEqual(items[0], { setup_number: 1, filename: filename(1) });
    assert.deepEqual(items[56], { setup_number: 57, filename: filename(57) });
    assert.equal(JSON.stringify(items).includes(root), false);
  });
  await t.test('valid first and last JPEGs are served with nosniff', async () => {
    for (const number of [1, 57]) {
      const response = await fetch(url(filename(number)));
      assert.equal(response.status, 200);
      assert.match(response.headers.get('content-type'), /^image\/jpeg/);
      assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
      assert.deepEqual(Buffer.from(await response.arrayBuffer()), jpeg);
    }
  });
  await t.test('unknown dataset and out-of-range existing JPEG are denied', async () => {
    assert.equal((await fetch(`${base}/unknown/panoramas`)).status, 404);
    assert.equal((await fetch(`${base}/unknown/panoramas/${encodeURIComponent(filename(1))}`)).status, 404);
    assert.equal((await fetch(url(filename(58)))).status, 404);
  });
  await t.test('missing, non-JPEG, directory and unexpected files fail safely', async () => {
    for (const name of [filename(2), filename(3), filename(4), 'MH SUB 1.e57', '.env', 'WINNIPEG- Setup 01.jpg']) {
      const response = await fetch(url(name));
      assert.equal(response.status, 404);
      const body = await response.json();
      assert.equal(typeof body.error, 'string');
      assert.equal(JSON.stringify(body).includes(temporary), false);
    }
  });
  await t.test('encoded traversal, backslashes, NUL and drive paths are denied', async () => {
    for (const name of ['../datasets.json', '..\\datasets.json', 'C:\\secret.jpg', filename(1) + ':stream', '\0.jpg', '%2e%2e%2fsecret.jpg']) {
      assert.equal((await fetch(url(name))).status, 404);
    }
  });
  await t.test('missing root is handled without exposing paths', async () => {
    configuredRoot = undefined;
    assert.equal((await fetch(url(filename(1)))).status, 404);
    configuredRoot = path.join(temporary, 'missing');
    assert.equal((await fetch(url(filename(1)))).status, 404);
    configuredRoot = root;
  });
  await t.test('directory traversal and junction escape in configuration are denied', async () => {
    for (const directory of ['../outside', 'LinkedPanoramas']) {
      await writeFile(configPath, JSON.stringify([{ ...dataset, panorama_directory: directory }]));
      assert.equal((await fetch(url(filename(1)))).status, 404);
    }
  });
  await t.test('malformed configuration returns a generic JSON error', async () => {
    await writeFile(configPath, '{bad');
    const response = await fetch(url(filename(1)));
    assert.equal(response.status, 500);
    assert.deepEqual(await response.json(), { error: 'Unable to load terrestrial panoramas' });
  });
});

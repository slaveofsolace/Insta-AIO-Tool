import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { get } from 'node:http';

import {
  isAllowedAssetPath,
  isAllowedLoopbackHost,
} from '../scripts/static-asset-policy.mjs';
import { createAppServer } from '../scripts/serve.mjs';

test('development server exposes only application runtime assets', () => {
  for (const asset of [
    'index.html',
    'assets/icon-192.png',
    'src/app-loader.js',
    'src/app.parts/part-04.jsfrag',
    'src/core/storage.js',
    'src/adapters/reviewed-dm-adapter.js',
    'src/migrations/follower-checker.js',
    'src/workers/zip-import-worker.js',
  ]) {
    assert.equal(isAllowedAssetPath(asset), true, asset);
  }

  for (const privatePath of [
    '.git/config',
    'package.json',
    'pnpm-lock.yaml',
    'docs/SECURITY_REVIEW.md',
    'tests/core.test.js',
    'extension/background.js',
    '../README.md',
    'src/../package.json',
  ]) {
    assert.equal(isAllowedAssetPath(privatePath), false, privatePath);
  }
});

test('development server rejects non-loopback Host headers', () => {
  assert.equal(isAllowedLoopbackHost('127.0.0.1:4173'), true);
  assert.equal(isAllowedLoopbackHost('localhost:4173'), true);
  assert.equal(isAllowedLoopbackHost('attacker.example'), false);
  assert.equal(isAllowedLoopbackHost('attacker@127.0.0.1:4173'), false);
  assert.equal(isAllowedLoopbackHost('127.0.0.1:4173/private'), false);
  assert.equal(isAllowedLoopbackHost(''), false);
});

test('browser-delivered framing policy uses response headers instead of an ignored meta directive', async () => {
  const index = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  const metaPolicy = index.match(/<meta http-equiv="Content-Security-Policy" content="([^"]+)"/)?.[1];
  assert.ok(metaPolicy, 'index.html must retain its restrictive meta CSP');
  assert.doesNotMatch(metaPolicy, /frame-ancestors/);

  const server = createAppServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  try {
    const response = await new Promise((resolve, reject) => {
      get(`http://127.0.0.1:${server.address().port}/`, resolve).once('error', reject);
    });
    response.resume();
    assert.equal(response.headers['content-security-policy'], "frame-ancestors 'none'");
    assert.equal(response.headers['x-frame-options'], 'DENY');
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  }
});

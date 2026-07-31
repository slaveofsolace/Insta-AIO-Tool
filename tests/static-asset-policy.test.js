import test from 'node:test';
import assert from 'node:assert/strict';

import {
  isAllowedAssetPath,
  isAllowedLoopbackHost,
} from '../scripts/static-asset-policy.mjs';

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

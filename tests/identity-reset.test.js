import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

const packageMetadata = JSON.parse(await read('package.json'));
const extensionManifest = JSON.parse(await read('extension/manifest.json'));
const webManifest = JSON.parse(await read('manifest.webmanifest'));
const userscriptMetadata = await read('userscripts/src/metadata.txt');
const generatedUserscript = await read('userscripts/insta-toolbox.user.js');
const serviceWorker = await read('sw.js');
const desktop = await read('desktop/main.mjs');
const storage = await read('src/core/storage.js');
const background = await read('extension/background.js');
const popup = await read('extension/popup.js');
const readme = await read('README.md');
const extensionDomSources = await Promise.all([
  'extension/instagram-overlay.js',
  'extension/overlay/accessibility.js',
  'extension/overlay/batch.js',
  'extension/overlay/layout.js',
  'extension/overlay/shell.js',
  'extension/overlay/views/capture.js',
  'extension/overlay/views/messages.js',
  'extension/overlay/views/now.js',
  'extension/overlay/views/queue.js',
  'extension/overlay/views/workspace.js',
].map(read));

test('all public surfaces share the 3.1.9 Insta Toolbox identity', () => {
  assert.equal(packageMetadata.name, 'insta-toolbox');
  assert.equal(packageMetadata.version, '3.1.9');
  assert.equal(packageMetadata.build.productName, 'Insta Toolbox');
  assert.equal(packageMetadata.build.appId, 'com.slaveofsolace.instatoolbox');
  assert.equal(extensionManifest.name, 'Insta Toolbox');
  assert.equal(extensionManifest.version, '3.1.9');
  assert.equal(webManifest.name, 'Insta Toolbox');
  assert.match(userscriptMetadata, /@name\s+Insta Toolbox/);
  assert.match(userscriptMetadata, /@version\s+3\.1\.9/);
  assert.match(serviceWorker, /const CACHE_NAME = 'insta-toolbox-v319'/);
});

test('v3 uses a clean protocol and storage namespace without reading v2 keys', () => {
  assert.match(desktop, /const SCHEME = 'insta-toolbox'/);
  assert.match(storage, /const DB_NAME = 'insta-toolbox'/);
  assert.match(storage, /localStorage\.getItem\('insta-toolbox-state'\)/);
  assert.match(background, /bridgePairings: 'instaToolboxBridgePairings'/);
  assert.match(popup, /const BRIDGE_PAIRINGS_KEY = 'instaToolboxBridgePairings'/);
  for (const source of [desktop, storage, background, popup]) {
    assert.doesNotMatch(source, /insta-aio|instaAio|Insta AIO/);
  }
  assert.doesNotMatch(popup, /['"]bridgePairings['"]/);
});

test('Tampermonkey metadata uses the stable release channel', () => {
  const stableUrl = 'https://github.com/slaveofsolace/Insta-Toolbox/releases/latest/download/insta-toolbox.user.js';
  assert.match(userscriptMetadata, new RegExp(`@downloadURL\\s+${stableUrl.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&')}`));
  assert.match(userscriptMetadata, new RegExp(`@updateURL\\s+${stableUrl.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&')}`));
  assert.match(generatedUserscript, /@version\s+3\.1\.9/);
  assert.match(readme, /releases\/latest\/download\/insta-toolbox\.user\.js/);
});

test('release artifact names and supported runtime are version-aligned', () => {
  assert.equal(packageMetadata.engines.node, '>=24.0.0');
  assert.equal(packageMetadata.build.win.artifactName, 'Insta-Toolbox-Setup-${version}.${ext}');
  assert.equal(packageMetadata.build.mac.artifactName, 'Insta-Toolbox-${version}-${arch}.${ext}');
  assert.equal(packageMetadata.build.nsis.differentialPackage, false);
  assert.equal(packageMetadata.homepage, 'https://slaveofsolace.github.io/Insta-Toolbox/');
});

test('the extension DOM uses only the v3 Insta Toolbox prefix', () => {
  for (const source of extensionDomSources) {
    assert.doesNotMatch(source, /\bia-/);
    assert.doesNotMatch(source, /dataset\??\.ia[A-Z]/);
  }
  assert.match(extensionDomSources[0], /data-insta-toolbox-role/);
  assert.match(extensionDomSources[4], /\.insta-toolbox-panel/);
  assert.match(extensionDomSources[4], /--insta-toolbox-surface/);
});

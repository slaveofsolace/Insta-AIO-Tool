import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';

import { assertPngDimensions, readPngDimensions } from '../scripts/png-dimensions.mjs';

const harness = await readFile(new URL('../scripts/browser-qa.mjs', import.meta.url), 'utf8');
const runner = await readFile(new URL('../scripts/run-browser-qa.mjs', import.meta.url), 'utf8');
const server = await readFile(new URL('../scripts/serve.mjs', import.meta.url), 'utf8');
const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
const pwaBaseline = JSON.parse(await readFile(new URL('./baselines/pwa/win32/manifest.json', import.meta.url), 'utf8'));
const pwaCiBaseline = JSON.parse(await readFile(
  new URL('./baselines/pwa/win32/github-actions-windows-2025-vs2026/manifest.json', import.meta.url),
  'utf8',
));

test('browser QA covers every PWA view at deterministic responsive sizes without live actions', () => {
  assert.equal(
    packageJson.scripts['qa:browser:update'],
    'node scripts/assemble-app.mjs && node scripts/run-browser-qa.mjs --update',
  );
  assert.equal(
    packageJson.scripts['qa:browser:check'],
    'node scripts/assemble-app.mjs && node scripts/run-browser-qa.mjs --check',
  );
  for (const viewport of [
    "{ id: 'desktop', width: 1134, height: 700 }",
    "{ id: 'tablet', width: 820, height: 900 }",
    "{ id: 'mobile', width: 390, height: 844 }",
  ]) {
    assert.match(harness, new RegExp(viewport.replace(/[{}]/g, '\\$&')));
  }
  for (const view of ['overview', 'relationships', 'queue', 'messages', 'imports', 'settings', 'activity']) {
    assert.match(harness, new RegExp(`\\['${view}',`), view);
  }
  assert.match(harness, /screenshotViews = new Set\(\['overview', 'messages', 'settings'\]\)/);
  assert.match(harness, /liveActionEnabled, null/);
  assert.match(harness, /liveDmEnabled, null/);
  assert.doesNotMatch(harness, /executeReviewedActionJob|createReviewedActionJob|requestExtensionBridge/);
});

test('browser QA uses an isolated renderer, denied permissions, and bounded loopback server', () => {
  assert.match(harness, /show: false/);
  assert.match(harness, /contextIsolation: true/);
  assert.match(harness, /nodeIntegration: false/);
  assert.match(harness, /offscreen: true/);
  assert.match(harness, /sandbox: true/);
  assert.match(harness, /webSecurity: true/);
  assert.match(harness, /setPermissionCheckHandler\(\(\) => false\)/);
  assert.match(harness, /setPermissionRequestHandler/);
  assert.match(harness, /createAppServer\(\)/);
  assert.match(runner, /spawn\(electronPath/);
  assert.match(runner, /windowsHide: true/);
  assert.match(runner, /INSTA_TOOLBOX_BROWSER_QA_USER_DATA/);
  assert.match(server, /export function createAppServer/);
  assert.match(server, /isAllowedLoopbackHost/);
  assert.match(server, /isAllowedAssetPath/);
});

test('browser QA hashes tracked platform baselines and keeps actual output disposable', () => {
  assert.match(harness, /Emulation\.setDeviceMetricsOverride/);
  assert.match(harness, /Page\.captureScreenshot/);
  assert.match(harness, /captureBeyondViewport: false/);
  assert.match(harness, /assertPngDimensions\(png, viewport, label\)/);
  assert.match(harness, /screenshot did not stabilize after four full repaints/);
  assert.match(harness, /const candidates = \[\]/);
  assert.match(harness, /assertPngDimensions\(actual, capture/);
  assert.match(harness, /assertPngDimensions\(baseline, expectedCapture/);
  assert.match(harness, /webContents\.once\('paint', resolve\)/);
  assert.match(harness, /createHash\('sha256'\)/);
  assert.match(harness, /'test-results', 'browser-qa'/);
  assert.match(harness, /userDataRoot\.startsWith/);
  assert.match(runner, /userDataRoot\.startsWith/);
  assert.match(runner, /await rm\(userDataRoot/);
  assert.match(harness, /'tests', 'baselines', 'pwa', process\.platform/);
  assert.match(harness, /screenshot regression detected/);
  assert.match(harness, /documentWidth <= metrics\.innerWidth \+ 1/);
  assert.match(harness, /headingFocused, true/);
  assert.match(harness, /metrics\.innerWidth,[\s\S]*viewport\.width/);
  assert.match(harness, /metrics\.innerHeight,[\s\S]*viewport\.height/);
});

test('PNG dimension reader rejects malformed and incorrectly sized captures', async () => {
  const desktop = await readFile(new URL('./baselines/pwa/win32/desktop-overview.png', import.meta.url));
  assert.deepEqual(readPngDimensions(desktop), { width: 1134, height: 700 });
  assert.deepEqual(
    assertPngDimensions(desktop, { width: 1134, height: 700 }, 'desktop fixture'),
    { width: 1134, height: 700 },
  );
  assert.throws(
    () => assertPngDimensions(desktop, { width: 1024, height: 700 }, 'clipped fixture'),
    /clipped fixture: PNG is 1134x700; expected exactly 1024x700/,
  );
  assert.throws(() => readPngDimensions(Buffer.from('not a png')), /not a readable PNG/);
  assert.throws(() => readPngDimensions(desktop.subarray(0, 24)), /not a readable PNG/);
});

test('every tracked PWA baseline PNG matches its manifest viewport', async () => {
  const baselineCases = [
    [pwaBaseline, new URL('./baselines/pwa/win32/', import.meta.url)],
    [pwaCiBaseline, new URL('./baselines/pwa/win32/github-actions-windows-2025-vs2026/', import.meta.url)],
  ];
  for (const [manifest, directory] of baselineCases) {
    const viewportById = new Map(manifest.viewports.map((viewport) => [viewport.id, viewport]));
    const expectedFiles = manifest.captures.map(({ file }) => file).sort();
    assert.equal(new Set(expectedFiles).size, expectedFiles.length, 'baseline capture filenames must be unique');
    const trackedFiles = (await readdir(directory)).filter((file) => file.endsWith('.png')).sort();
    assert.deepEqual(trackedFiles, expectedFiles, 'baseline PNG files must exactly match the manifest');
    for (const capture of manifest.captures) {
      const viewport = viewportById.get(capture.viewport);
      assert.ok(viewport, `${capture.file}: viewport ${capture.viewport} is not declared`);
      assert.deepEqual(
        { width: capture.width, height: capture.height },
        { width: viewport.width, height: viewport.height },
        `${capture.file}: capture metadata differs from its viewport`,
      );
      const png = await readFile(new URL(capture.file, directory));
      assertPngDimensions(png, capture, capture.file);
    }
  }
});

test('browser QA manifests bind captures to the current product version and release timestamp', () => {
  assert.match(harness, /readFile\(path\.join\(repositoryRoot, 'package\.json'\), 'utf8'\)/);
  assert.match(harness, /readFile\(path\.join\(repositoryRoot, 'CHANGELOG\.md'\), 'utf8'\)/);
  assert.match(harness, /captureTimestamp: `\$\{releaseDate\}T00:00:00\.000Z`/);
  assert.match(harness, /schemaVersion: 2/);
  assert.match(harness, /baseline product version changed/);
  assert.match(harness, /baseline capture timestamp changed/);
  for (const manifest of [pwaBaseline, pwaCiBaseline]) {
    assert.equal(manifest.schemaVersion, 2);
    assert.equal(manifest.kind, 'insta-toolbox-pwa-screenshot-baseline');
    assert.equal(manifest.productVersion, packageJson.version);
    assert.equal(manifest.captureTimestamp, '2026-09-07T00:00:00.000Z');
  }
});

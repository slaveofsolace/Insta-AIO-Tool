import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const harness = await readFile(new URL('../scripts/browser-qa.mjs', import.meta.url), 'utf8');
const runner = await readFile(new URL('../scripts/run-browser-qa.mjs', import.meta.url), 'utf8');
const server = await readFile(new URL('../scripts/serve.mjs', import.meta.url), 'utf8');
const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));

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
  assert.match(harness, /liveActionEnabled, false/);
  assert.match(harness, /liveDmEnabled, false/);
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
  assert.match(runner, /INSTA_AIO_BROWSER_QA_USER_DATA/);
  assert.match(server, /export function createAppServer/);
  assert.match(server, /isAllowedLoopbackHost/);
  assert.match(server, /isAllowedAssetPath/);
});

test('browser QA hashes tracked platform baselines and keeps actual output disposable', () => {
  assert.match(harness, /capturePage\(\)/);
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
});

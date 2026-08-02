import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { app, BrowserWindow, session } from 'electron';

import { createAppServer } from './serve.mjs';

const mode = process.argv.includes('--update')
  ? 'update'
  : process.argv.includes('--check')
    ? 'check'
    : '';

if (!mode) {
  throw new Error('Choose exactly one browser QA mode: --update or --check.');
}
if (process.argv.includes('--update') && process.argv.includes('--check')) {
  throw new Error('Browser QA cannot update and check baselines in the same run.');
}

const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(moduleDirectory, '..');
const resultsRoot = path.join(repositoryRoot, 'test-results', 'browser-qa');
const actualRoot = path.join(resultsRoot, process.platform);
const userDataRoot = path.resolve(
  process.env.INSTA_AIO_BROWSER_QA_USER_DATA
    || path.join(resultsRoot, 'user-data', String(process.pid)),
);
const baselineRoot = path.join(repositoryRoot, 'tests', 'baselines', 'pwa', process.platform);
const manifestPath = path.join(baselineRoot, 'manifest.json');
const runnerLogPath = path.join(resultsRoot, 'runner.log');

if (!userDataRoot.startsWith(`${path.resolve(resultsRoot)}${path.sep}`)) {
  throw new Error('Browser QA user data must stay inside test-results/browser-qa.');
}

const deviceScaleFactor = 1;
const viewports = [
  { id: 'desktop', width: 1134, height: 700 },
  { id: 'tablet', width: 820, height: 900 },
  { id: 'mobile', width: 390, height: 844 },
];
const views = [
  ['overview', 'Overview'],
  ['relationships', 'Relationships'],
  ['queue', 'Action Queue'],
  ['messages', 'Messages'],
  ['imports', 'Import / Export'],
  ['settings', 'Settings'],
  ['activity', 'Activity'],
];
const screenshotViews = new Set(['overview', 'messages', 'settings']);

mkdirSync(userDataRoot, { recursive: true });
writeFileSync(runnerLogPath, '', 'utf8');
app.disableHardwareAcceleration();
app.commandLine.appendSwitch('force-device-scale-factor', String(deviceScaleFactor));
app.setPath('userData', userDataRoot);
app.on('window-all-closed', () => {});

function report(message) {
  const line = String(message);
  console.log(line);
  appendFileSync(runnerLogPath, `${line}\n`, 'utf8');
}

function withTimeout(promise, label, timeout = 15_000) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} timed out after ${timeout}ms.`)), timeout);
    }),
  ]).finally(() => clearTimeout(timer));
}

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      resolve(server.address());
    });
  });
}

function close(server) {
  return new Promise((resolve, reject) => {
    if (!server?.listening) {
      resolve();
      return;
    }
    server.close((error) => error ? reject(error) : resolve());
  });
}

async function waitForHeading(webContents, expectedHeading) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const heading = await webContents.executeJavaScript(
      "document.querySelector('[data-page-heading]')?.textContent || ''",
      true,
    );
    if (heading === expectedHeading) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Timed out waiting for the ${expectedHeading} view.`);
}

async function waitForPaint(webContents, label) {
  await withTimeout(webContents.executeJavaScript(
    'new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))',
    true,
  ), `${label}: animation frames`, 5_000);
  await withTimeout(new Promise((resolve) => {
    webContents.once('paint', resolve);
    webContents.invalidate();
  }), `${label}: fresh paint`, 5_000);
}

function recordConsoleProblem(problems, detailsOrLevel, legacyMessage) {
  const details = typeof detailsOrLevel === 'object' && detailsOrLevel !== null
    ? detailsOrLevel
    : { level: detailsOrLevel, message: legacyMessage };
  const level = details.level;
  if (level === 'warning' || level === 'error' || Number(level) >= 2) {
    problems.push(`${String(level)}: ${details.message || ''}`);
  }
}

async function inspectView(webContents, viewId, expectedHeading, viewport) {
  const selector = `[data-action="navigate"][data-view="${viewId}"]`;
  const found = await webContents.executeJavaScript(
    `Boolean(document.querySelector(${JSON.stringify(selector)}))`,
    true,
  );
  assert.equal(found, true, `${viewId}: navigation control is missing`);
  await webContents.executeJavaScript(
    `document.querySelector(${JSON.stringify(selector)}).click()`,
    true,
  );
  await waitForHeading(webContents, expectedHeading);
  await waitForPaint(webContents, `${viewport.id}/${viewId} navigation`);

  const metrics = await webContents.executeJavaScript(`(() => {
    const heading = document.querySelector('[data-page-heading]');
    const active = document.querySelector('[data-action="navigate"].active');
    const sidebar = document.querySelector('.sidebar');
    const main = document.querySelector('.main');
    const bounds = (element) => {
      if (!element) return null;
      const rect = element.getBoundingClientRect();
      return {
        display: getComputedStyle(element).display,
        left: rect.left,
        right: rect.right,
        width: rect.width,
      };
    };
    return {
      heading: heading?.textContent || '',
      activeView: active?.dataset.view || '',
      headingFocused: document.activeElement === heading,
      innerWidth,
      documentWidth: document.documentElement.scrollWidth,
      bodyWidth: document.body.scrollWidth,
      sidebar: bounds(sidebar),
      main: bounds(main),
      malformedClosingTag: /<\\s*\\/\\s*section\\s*>/i.test(document.body.textContent || ''),
      liveActionEnabled: document.querySelector('#live-action-enabled')?.checked ?? null,
      liveDmEnabled: document.querySelector('#live-dm-enabled')?.checked ?? null,
    };
  })()`, true);

  assert.equal(metrics.heading, expectedHeading, `${viewId}: heading mismatch`);
  assert.equal(metrics.activeView, viewId, `${viewId}: active navigation mismatch`);
  assert.equal(metrics.headingFocused, true, `${viewId}: focus did not move to the page heading`);
  assert.ok(
    metrics.documentWidth <= metrics.innerWidth + 1,
    `${viewId}: document overflows ${metrics.documentWidth}px into a ${metrics.innerWidth}px viewport`,
  );
  assert.ok(
    metrics.bodyWidth <= metrics.innerWidth + 1,
    `${viewId}: body overflows ${metrics.bodyWidth}px into a ${metrics.innerWidth}px viewport`,
  );
  for (const [name, bounds] of [['sidebar', metrics.sidebar], ['main', metrics.main]]) {
    assert.ok(bounds, `${viewId}: ${name} is missing`);
    assert.notEqual(bounds.display, 'none', `${viewId}: ${name} is hidden`);
    assert.ok(bounds.width > 0, `${viewId}: ${name} has no width`);
    assert.ok(bounds.left >= -1, `${viewId}: ${name} starts outside the viewport`);
    assert.ok(
      bounds.right <= viewport.width + 1,
      `${viewId}: ${name} extends beyond the ${viewport.width}px viewport`,
    );
  }
  assert.equal(metrics.malformedClosingTag, false, `${viewId}: malformed closing tag is visible`);
  if (viewId === 'settings') {
    assert.equal(metrics.liveActionEnabled, false, 'settings: live account actions must default off');
    assert.equal(metrics.liveDmEnabled, false, 'settings: live DM actions must default off');
  }
}

async function captureViewport(baseUrl, viewport) {
  const partition = `insta-aio-browser-qa-${process.pid}-${viewport.id}`;
  const qaSession = session.fromPartition(partition);
  qaSession.setPermissionCheckHandler(() => false);
  qaSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));

  const browserWindow = new BrowserWindow({
    show: false,
    frame: false,
    useContentSize: true,
    width: viewport.width,
    height: viewport.height,
    backgroundColor: '#f5f5f2',
    webPreferences: {
      backgroundThrottling: false,
      contextIsolation: true,
      nodeIntegration: false,
      offscreen: true,
      sandbox: true,
      webSecurity: true,
      partition,
    },
  });
  const problems = [];
  browserWindow.webContents.on('console-message', (event) => {
    recordConsoleProblem(problems, event);
  });
  browserWindow.webContents.on('render-process-gone', (_event, details) => {
    problems.push(`renderer gone: ${details.reason}`);
  });
  browserWindow.webContents.on('did-fail-load', (_event, code, description, url, isMainFrame) => {
    if (isMainFrame !== false) problems.push(`load failed ${code}: ${description} (${url})`);
  });

  const captures = [];
  try {
    await withTimeout(browserWindow.loadURL(baseUrl), `${viewport.id}: page load`);
    await waitForHeading(browserWindow.webContents, 'Overview');
    await browserWindow.webContents.executeJavaScript(`(() => {
      const style = document.createElement('style');
      style.dataset.browserQa = 'true';
      style.textContent = '*,'
        + '*::before,'
        + '*::after{animation:none!important;transition:none!important;caret-color:transparent!important}'
        + 'html{scroll-behavior:auto!important}';
      document.head.append(style);
      return document.fonts?.ready || true;
    })()`, true);

    for (const [viewId, expectedHeading] of views) {
      await inspectView(browserWindow.webContents, viewId, expectedHeading, viewport);
      if (!screenshotViews.has(viewId)) continue;
      await browserWindow.webContents.executeJavaScript('window.scrollTo(0, 0)', true);
      await waitForPaint(browserWindow.webContents, `${viewport.id}/${viewId}`);
      const image = await browserWindow.webContents.capturePage();
      const png = image.toPNG();
      const file = `${viewport.id}-${viewId}.png`;
      await mkdir(actualRoot, { recursive: true });
      await writeFile(path.join(actualRoot, file), png);
      captures.push({
        file,
        viewport: viewport.id,
        width: viewport.width,
        height: viewport.height,
        view: viewId,
        sha256: sha256(png),
      });
    }

    assert.deepEqual(problems, [], `${viewport.id}: browser console or renderer problems`);
    return captures;
  } finally {
    if (!browserWindow.isDestroyed()) browserWindow.destroy();
    await withTimeout(qaSession.clearStorageData(), `${viewport.id}: storage cleanup`, 5_000);
    await withTimeout(qaSession.clearCache(), `${viewport.id}: cache cleanup`, 5_000);
  }
}

async function updateBaselines(captures, manifest) {
  await mkdir(baselineRoot, { recursive: true });
  for (const capture of captures) {
    const png = await readFile(path.join(actualRoot, capture.file));
    await writeFile(path.join(baselineRoot, capture.file), png);
  }
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
}

async function checkBaselines(captures, manifest) {
  let expected;
  try {
    expected = JSON.parse(await readFile(manifestPath, 'utf8'));
  } catch (error) {
    throw new Error(
      `No readable ${process.platform} browser baseline manifest. Run pnpm qa:browser:update on this platform.`,
      { cause: error },
    );
  }
  assert.equal(expected.schemaVersion, manifest.schemaVersion, 'baseline schema changed');
  assert.equal(expected.kind, manifest.kind, 'baseline kind changed');
  assert.equal(expected.platform, manifest.platform, 'baseline platform changed');
  assert.equal(expected.electron, manifest.electron, 'baseline Electron version changed');
  assert.equal(expected.deviceScaleFactor, manifest.deviceScaleFactor, 'baseline scale changed');
  assert.deepEqual(expected.viewports, manifest.viewports, 'baseline viewport contract changed');
  assert.deepEqual(
    expected.captures.map(({ file, viewport, width, height, view }) => ({ file, viewport, width, height, view })),
    manifest.captures.map(({ file, viewport, width, height, view }) => ({ file, viewport, width, height, view })),
    'baseline capture contract changed',
  );

  for (const capture of captures) {
    const expectedCapture = expected.captures.find(({ file }) => file === capture.file);
    assert.ok(expectedCapture, `${capture.file}: missing from baseline manifest`);
    const baseline = await readFile(path.join(baselineRoot, capture.file));
    assert.equal(sha256(baseline), expectedCapture.sha256, `${capture.file}: baseline hash is corrupt`);
    assert.equal(capture.sha256, expectedCapture.sha256, `${capture.file}: screenshot regression detected`);
  }
}

async function runBrowserQa() {
  const server = createAppServer();
  let exitCode = 0;
  try {
  report('Electron is ready.');
    await rm(actualRoot, { recursive: true, force: true });
    const address = await listen(server);
    const baseUrl = `http://127.0.0.1:${address.port}/`;
    const captures = [];
    for (const viewport of viewports) {
      report(`Checking ${viewport.id} at ${viewport.width}x${viewport.height}.`);
      captures.push(...await captureViewport(baseUrl, viewport));
    }
    const manifest = {
      schemaVersion: 1,
      kind: 'insta-aio-pwa-screenshot-baseline',
      platform: process.platform,
      electron: process.versions.electron,
      deviceScaleFactor,
      viewports,
      captures,
    };
    if (mode === 'update') {
      await updateBaselines(captures, manifest);
      report(`Updated ${captures.length} ${process.platform} PWA screenshot baselines.`);
    } else {
      await checkBaselines(captures, manifest);
      report(`Verified ${captures.length} ${process.platform} PWA screenshot baselines.`);
    }
  } catch (error) {
    exitCode = 1;
    report(error?.stack || error);
    console.error(error);
  } finally {
    await close(server);
    app.exit(exitCode);
  }
}

report(`Starting ${mode} browser QA with Electron ${process.versions.electron}.`);
const readinessTimer = setTimeout(() => {
  report('Error: Electron readiness timed out after 15000ms.');
  app.exit(1);
}, 15_000);
app.whenReady().then(() => {
  clearTimeout(readinessTimer);
  return runBrowserQa();
});

import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { app, BrowserWindow, session } from 'electron';

import { createAppServer } from './serve.mjs';

const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(moduleDirectory, '..');
const resultsRoot = path.resolve(repositoryRoot, 'test-results', 'extension-acceptance');
const userDataRoot = path.resolve(
  process.env.INSTA_AIO_EXTENSION_ACCEPTANCE_USER_DATA
    || path.join(resultsRoot, 'user-data', String(process.pid)),
);
const fixtureAssets = new Map([
  ['/fixture.html', path.join(repositoryRoot, 'tests', 'fixtures', 'overlay-preview.html')],
  ['/extension/content-instagram.js', path.join(repositoryRoot, 'extension', 'content-instagram.js')],
  ['/extension/instagram-overlay.js', path.join(repositoryRoot, 'extension', 'instagram-overlay.js')],
]);

if (!userDataRoot.startsWith(`${resultsRoot}${path.sep}`)) {
  throw new Error('Extension acceptance user data must stay inside test-results.');
}

app.disableHardwareAcceleration();
app.setPath('userData', userDataRoot);
app.on('window-all-closed', () => {});

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

function fixtureServer() {
  return createServer(async (request, response) => {
    const host = String(request.headers.host || '').split(':')[0].toLowerCase();
    if (!['127.0.0.1', 'localhost'].includes(host)) {
      response.writeHead(421).end('Misdirected request');
      return;
    }
    const url = new URL(request.url || '/', 'http://127.0.0.1');
    const target = fixtureAssets.get(url.pathname);
    if (!target || !['GET', 'HEAD'].includes(request.method || '')) {
      response.writeHead(404).end('Not found');
      return;
    }
    try {
      const body = request.method === 'HEAD' ? null : await readFile(target);
      response.writeHead(200, {
        'Cache-Control': 'no-store',
        'Content-Security-Policy': [
          "default-src 'none'",
          "script-src 'self' 'unsafe-inline'",
          "style-src 'self' 'unsafe-inline'",
          "img-src 'self' data:",
          "connect-src 'none'",
          "object-src 'none'",
          "base-uri 'none'",
          "frame-ancestors 'none'",
          "form-action 'none'",
        ].join('; '),
        'Content-Type': target.endsWith('.html')
          ? 'text/html; charset=utf-8'
          : 'text/javascript; charset=utf-8',
        'X-Content-Type-Options': 'nosniff',
        'X-Frame-Options': 'DENY',
      });
      response.end(body);
    } catch {
      response.writeHead(404).end('Not found');
    }
  });
}

function withTimeout(promise, label, timeoutMs = 15_000) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms.`)), timeoutMs);
    }),
  ]).finally(() => clearTimeout(timer));
}

function createIsolatedWindow(partition) {
  const isolatedSession = session.fromPartition(partition);
  isolatedSession.setPermissionCheckHandler(() => false);
  isolatedSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  const problems = [];
  const window = new BrowserWindow({
    show: false,
    frame: false,
    width: 1200,
    height: 800,
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
  window.webContents.on('console-message', (event) => {
    const level = event.level;
    if (level === 'warning' || level === 'error' || Number(level) >= 2) {
      problems.push(`${String(level)}: ${event.message || ''}`);
    }
  });
  window.webContents.on('render-process-gone', (_event, details) => {
    problems.push(`renderer gone: ${details.reason}`);
  });
  window.webContents.on('did-fail-load', (_event, code, description, url, isMainFrame) => {
    if (isMainFrame !== false) problems.push(`load failed ${code}: ${description} (${url})`);
  });
  return { isolatedSession, problems, window };
}

async function waitForPageValue(webContents, expression, label, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await webContents.executeJavaScript(expression, true);
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Timed out waiting for ${label}.`);
}

async function loadFixture(webContents, baseUrl, mode) {
  const url = `${baseUrl}/fixture.html?mode=${encodeURIComponent(mode)}&shadow=open`;
  await withTimeout(webContents.loadURL(url), `${mode}: fixture load`);
  await waitForPageValue(
    webContents,
    `Boolean(globalThis.fixtureSendContentMessage
      && globalThis.InstaAioInstagramInspector
      && document.querySelector('#insta-aio-sidecar-root')?.shadowRoot)`,
    `${mode}: production content scripts`,
  );
}

async function sendContentMessage(webContents, request) {
  return webContents.executeJavaScript(
    `globalThis.fixtureSendContentMessage(${JSON.stringify(request)})`,
    true,
  );
}

async function acceptProfileAction(webContents, baseUrl, scenario) {
  await loadFixture(webContents, baseUrl, `live-${scenario.action}`);
  const observed = await sendContentMessage(webContents, {
    kind: 'insta-aio-inspect-profile',
    username: 'demo_creator',
  });
  assert.equal(observed.username, 'demo_creator');
  assert.equal(observed.relationship, scenario.before);
  assert.equal(observed.profileIdentityVerified, true);
  assert.equal(observed.ambiguous, false);
  assert.equal(typeof observed.resolutionToken, 'string');
  assert.equal(await webContents.executeJavaScript('globalThis.fixtureClickCount', true), 0);

  const item = {
    action: scenario.action,
    expectedRelationship: scenario.before,
    resolutionToken: observed.resolutionToken,
    username: 'demo_creator',
  };
  const result = await sendContentMessage(webContents, {
    kind: 'insta-aio-perform-reviewed-profile-action',
    item,
  });
  assert.ok(result.result, `${scenario.action}: no completion result`);
  assert.equal(result.relationship, scenario.after);
  assert.equal(
    await webContents.executeJavaScript('globalThis.fixtureClickCount', true),
    scenario.clicks,
  );

  const replay = await sendContentMessage(webContents, {
    kind: 'insta-aio-perform-reviewed-profile-action',
    item,
  });
  assert.equal(replay.ambiguous, true);
  assert.equal(replay.reason, 'profile-resolution-expired-or-changed');
  assert.equal(
    await webContents.executeJavaScript('globalThis.fixtureClickCount', true),
    scenario.clicks,
  );
  console.log(`Accepted production ${scenario.action} DOM chain in isolated Chromium (${scenario.clicks} bounded fixture clicks).`);
}

async function acceptDmUnsend(webContents, baseUrl) {
  await loadFixture(webContents, baseUrl, 'messages-live');
  const item = await webContents.executeJavaScript('globalThis.fixtureDmItem', true);
  assert.ok(item?.contentDigest);
  const observed = await sendContentMessage(webContents, {
    kind: 'insta-aio-inspect-reviewed-dm-item',
    item,
  });
  assert.equal(observed.conversationId, item.conversationId);
  assert.equal(observed.messageId, item.messageId);
  assert.equal(observed.sentByMe, true);
  assert.equal(observed.exactIdentityAvailable, true);
  assert.equal(observed.ownershipAvailable, true);
  assert.equal(typeof observed.resolutionToken, 'string');
  assert.equal(await webContents.executeJavaScript('globalThis.fixtureDmClickCount', true), 0);

  const liveItem = { ...item, resolutionToken: observed.resolutionToken };
  const result = await sendContentMessage(webContents, {
    kind: 'insta-aio-perform-reviewed-dm-unsend',
    item: liveItem,
  });
  assert.equal(result.result, 'unsent');
  assert.equal(result.messageId, item.messageId);
  assert.equal(result.postcondition?.exactCandidateAbsent, true);
  assert.equal(result.postcondition?.exactThread, true);
  assert.equal(result.postcondition?.retainedIdentityNodeDisconnected, true);
  assert.equal(result.postcondition?.retainedRowDisconnected, true);
  assert.equal(await webContents.executeJavaScript('globalThis.fixtureDmClickCount', true), 3);
  assert.deepEqual(
    await webContents.executeJavaScript(`({
      removed: !document.querySelector('[data-message-id="sent-1"]'),
      retainedStableIdentities: document.querySelectorAll('[data-message-id]').length,
    })`, true),
    { removed: true, retainedStableIdentities: 2 },
  );

  const replay = await sendContentMessage(webContents, {
    kind: 'insta-aio-perform-reviewed-dm-unsend',
    item: liveItem,
  });
  assert.equal(replay.ambiguous, true);
  assert.equal(replay.reason, 'dm-resolution-expired-or-changed');
  assert.equal(await webContents.executeJavaScript('globalThis.fixtureDmClickCount', true), 3);
  console.log('Accepted production one-message Unsend DOM chain in isolated Chromium (three exact fixture clicks).');
}

async function acceptOverlayAccessibility(webContents, baseUrl) {
  await loadFixture(webContents, baseUrl, 'messages-exact');
  await waitForPageValue(
    webContents,
    `document.querySelector('#insta-aio-sidecar-root')?.shadowRoot?.activeElement?.dataset?.iaSection === 'now'`,
    'sidecar initial keyboard focus',
  );
  const metrics = await webContents.executeJavaScript(`(() => {
    const shadow = document.querySelector('#insta-aio-sidecar-root').shadowRoot;
    return {
      nav: [...shadow.querySelectorAll('[data-ia-section]')].map((button) => ({
        label: button.textContent.trim(),
        selected: button.getAttribute('aria-selected'),
      })),
      panelLabel: shadow.querySelector('.ia-panel')?.getAttribute('aria-label'),
      statusLive: shadow.querySelector('[data-ia-role="status"]')?.getAttribute('aria-live'),
      closeLabel: shadow.querySelector('[data-ia-action="close"]')?.getAttribute('aria-label'),
    };
  })()`, true);
  assert.deepEqual(metrics.nav.map(({ label }) => label), [
    'Now', 'Capture', 'Queue', 'Messages', 'Workspace',
  ]);
  assert.equal(metrics.nav[0].selected, 'true');
  assert.equal(metrics.panelLabel, 'Insta AIO Instagram sidecar');
  assert.equal(metrics.statusLive, 'polite');
  assert.equal(metrics.closeLabel, 'Collapse Insta AIO sidecar');

  await webContents.executeJavaScript(`(() => {
    const shadow = document.querySelector('#insta-aio-sidecar-root').shadowRoot;
    shadow.querySelector('[data-ia-action="close"]').click();
  })()`, true);
  await waitForPageValue(
    webContents,
    `(() => {
      const shadow = document.querySelector('#insta-aio-sidecar-root')?.shadowRoot;
      return shadow?.querySelector('.ia-panel')?.hidden
        && !shadow?.querySelector('.ia-launcher')?.hidden
        && shadow.activeElement === shadow.querySelector('.ia-launcher');
    })()`,
    'sidecar collapse and focus restoration',
  );

  await webContents.executeJavaScript(`(() => {
    document.querySelector('#insta-aio-sidecar-root').shadowRoot.querySelector('.ia-launcher').click();
  })()`, true);
  await waitForPageValue(
    webContents,
    `document.querySelector('#insta-aio-sidecar-root')?.shadowRoot?.activeElement?.dataset?.iaSection === 'now'`,
    'sidecar reopen focus',
  );

  app.setAccessibilitySupportEnabled(true);
  webContents.debugger.attach('1.3');
  try {
    await webContents.debugger.sendCommand('Accessibility.enable');
    const tree = await webContents.debugger.sendCommand('Accessibility.getFullAXTree');
    const names = new Set((tree.nodes || []).map((node) => node.name?.value).filter(Boolean));
    for (const expected of [
      'Insta AIO Instagram sidecar',
      'Collapse Insta AIO sidecar',
      'Now',
      'Capture',
      'Queue',
      'Messages',
      'Workspace',
    ]) {
      assert.equal(names.has(expected), true, `accessibility tree is missing ${expected}`);
    }
  } finally {
    if (webContents.debugger.isAttached()) webContents.debugger.detach();
  }
  console.log('Accepted overlay keyboard focus and Chromium accessibility-tree contract.');
}

async function acceptPwaInstallability(webContents, baseUrl) {
  await withTimeout(webContents.loadURL(baseUrl), 'PWA load');
  await waitForPageValue(
    webContents,
    `document.querySelector('[data-page-heading]')?.textContent === 'Overview'`,
    'PWA overview',
  );
  const installability = await withTimeout(webContents.executeJavaScript(`(async () => {
    const manifestLink = document.querySelector('link[rel="manifest"]');
    const response = await fetch(manifestLink.href, { cache: 'no-store' });
    const manifest = await response.json();
    const registration = await navigator.serviceWorker.ready;
    return {
      display: manifest.display,
      icons: manifest.icons.map((icon) => icon.sizes),
      manifestOk: response.ok,
      scope: registration.scope,
      serviceWorkerActive: Boolean(registration.active),
      startUrl: manifest.start_url,
    };
  })()`, true), 'PWA manifest and service worker');
  assert.equal(installability.manifestOk, true);
  assert.equal(installability.display, 'standalone');
  assert.equal(installability.startUrl, './');
  assert.deepEqual(installability.icons, ['192x192', '512x512', 'any']);
  assert.equal(installability.serviceWorkerActive, true);
  assert.equal(installability.scope, baseUrl);

  await webContents.executeJavaScript(
    `document.querySelector('[data-action="navigate"][data-view="settings"]').click()`,
    true,
  );
  await waitForPageValue(
    webContents,
    `document.querySelector('[data-page-heading]')?.textContent === 'Settings'`,
    'PWA settings',
  );
  const defaults = await webContents.executeJavaScript(`({
    actionPermission: document.querySelector('#bridge-action-permission')?.checked,
    liveAccount: document.querySelector('#live-action-enabled')?.checked,
    liveDm: document.querySelector('#live-dm-enabled')?.checked,
  })`, true);
  assert.deepEqual(defaults, { actionPermission: false, liveAccount: false, liveDm: false });
  await webContents.executeJavaScript(
    `document.querySelector('[data-action="create-extension-pairing"]').click()`,
    true,
  );
  await waitForPageValue(
    webContents,
    `Boolean(document.querySelector('#bridge-pairing-code')?.value)`,
    'read-only pairing code',
  );
  const pairing = await webContents.executeJavaScript(`(() => {
    const code = document.querySelector('#bridge-pairing-code');
    const permissions = [...document.querySelectorAll('.field')]
      .find((field) => field.querySelector('label')?.textContent === 'Permissions')
      ?.querySelector('input')?.value;
    return { codeLength: code.value.length, permissions };
  })()`, true);
  assert.ok(pairing.codeLength > 40);
  assert.equal(pairing.permissions, 'read');
  console.log('Accepted PWA manifest, active service worker, and default read-only pairing flow in isolated Chromium.');
}

async function run() {
  const overlayServer = fixtureServer();
  const pwaServer = createAppServer();
  const overlay = createIsolatedWindow(`insta-aio-extension-acceptance-${process.pid}`);
  const pwa = createIsolatedWindow(`insta-aio-pwa-installability-${process.pid}`);
  let exitCode = 0;
  try {
    const overlayAddress = await listen(overlayServer);
    const pwaAddress = await listen(pwaServer);
    const overlayBaseUrl = `http://127.0.0.1:${overlayAddress.port}`;
    const pwaBaseUrl = `http://127.0.0.1:${pwaAddress.port}/`;
    await acceptProfileAction(overlay.window.webContents, overlayBaseUrl, {
      action: 'follow', before: 'not-following', after: 'following', clicks: 1,
    });
    await acceptProfileAction(overlay.window.webContents, overlayBaseUrl, {
      action: 'unfollow', before: 'following', after: 'not-following', clicks: 2,
    });
    await acceptDmUnsend(overlay.window.webContents, overlayBaseUrl);
    await acceptOverlayAccessibility(overlay.window.webContents, overlayBaseUrl);
    await acceptPwaInstallability(pwa.window.webContents, pwaBaseUrl);
    assert.deepEqual(overlay.problems, [], 'extension fixture browser problems');
    assert.deepEqual(pwa.problems, [], 'PWA installability browser problems');
  } catch (error) {
    exitCode = 1;
    console.error(error?.stack || error);
  } finally {
    if (!overlay.window.isDestroyed()) overlay.window.destroy();
    if (!pwa.window.isDestroyed()) pwa.window.destroy();
    await overlay.isolatedSession.clearStorageData();
    await pwa.isolatedSession.clearStorageData();
    await close(overlayServer);
    await close(pwaServer);
    app.exit(exitCode);
  }
}

const readinessTimer = setTimeout(() => {
  console.error('Extension acceptance readiness timed out after 15 seconds.');
  app.exit(1);
}, 15_000);
app.whenReady().then(() => {
  clearTimeout(readinessTimer);
  return run();
});

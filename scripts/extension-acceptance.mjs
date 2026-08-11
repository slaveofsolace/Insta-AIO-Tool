import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { app, BrowserWindow, session } from 'electron';

import { createAppServer } from './serve.mjs';
import { instagramScriptOrder } from './instagram-script-order.mjs';

const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(moduleDirectory, '..');
const resultsRoot = path.resolve(repositoryRoot, 'test-results', 'extension-acceptance');
const userDataRoot = path.resolve(
  process.env.INSTA_AIO_EXTENSION_ACCEPTANCE_USER_DATA
    || path.join(resultsRoot, 'user-data', String(process.pid)),
);
const overlayScriptFiles = instagramScriptOrder;
const fixtureAssets = new Map([
  ['/fixture.html', path.join(repositoryRoot, 'tests', 'fixtures', 'overlay-preview.html')],
  ['/userscript-fixture.html', path.join(repositoryRoot, 'tests', 'fixtures', 'userscript-preview.html')],
  ['/direct/t/17800000000000001/', path.join(repositoryRoot, 'tests', 'fixtures', 'dm-thread-fixture.html')],
  ['/userscripts/insta-aio-companion.user.js', path.join(repositoryRoot, 'userscripts', 'insta-aio-companion.user.js')],
  ...overlayScriptFiles.map((file) => [
    `/extension/${file}`,
    path.join(repositoryRoot, 'extension', ...file.split('/')),
  ]),
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

async function resizeViewport(webContents, viewport) {
  await webContents.executeJavaScript(
    `(() => { globalThis.resizeTo?.(${viewport.width}, ${viewport.height}); return true; })()`,
    true,
  );
  await waitForPageValue(
    webContents,
    `innerWidth === ${viewport.width} && innerHeight === ${viewport.height}`,
    `${viewport.label}: viewport resize`,
  );
  // Native macOS window resizing can report the new inner bounds before the
  // next container-query layout is painted. Two frames make the assertion
  // sample the settled UI while keeping the containment boundary strict.
  await webContents.executeJavaScript(
    `(() => {
      globalThis.dispatchEvent(new Event('resize'));
      return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve(true))));
    })()`,
    true,
  );
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
  const initial = await webContents.executeJavaScript(`(() => {
    const shadow = document.querySelector('#insta-aio-sidecar-root').shadowRoot;
    return {
      launcherVisible: !shadow.querySelector('.ia-launcher').hidden,
      panelHidden: shadow.querySelector('.ia-panel').hidden,
    };
  })()`, true);
  assert.deepEqual(initial, { launcherVisible: true, panelHidden: true });
  await webContents.executeJavaScript(`(() => {
    const launcher = document.querySelector('#insta-aio-sidecar-root').shadowRoot.querySelector('.ia-launcher');
    launcher.focus();
    launcher.click();
  })()`, true);
  await waitForPageValue(
    webContents,
    `document.querySelector('#insta-aio-sidecar-root')?.shadowRoot?.activeElement?.dataset?.iaSection === 'now'`,
    'sidecar initial keyboard focus',
  );
  const metrics = await webContents.executeJavaScript(`(() => {
    const shadow = document.querySelector('#insta-aio-sidecar-root').shadowRoot;
    return {
      nav: [...shadow.querySelectorAll('[data-ia-section]')].map((button) => ({
        label: button.getAttribute('aria-label'),
        selected: button.getAttribute('aria-selected'),
      })),
      panelLabel: shadow.querySelector('.ia-panel')?.getAttribute('aria-label'),
      statusLive: shadow.querySelector('[data-ia-role="status"]')?.getAttribute('aria-live'),
      closeLabel: shadow.querySelector('[data-ia-action="close"]')?.getAttribute('aria-label'),
      moveLabel: shadow.querySelector('[data-ia-role="move-handle"]')?.getAttribute('aria-label'),
      resizeLabel: shadow.querySelector('[data-ia-role="resize-handle"]')?.getAttribute('aria-label'),
      opacity: shadow.querySelector('[data-ia-preference="opacity"]')?.value,
      panelBackground: getComputedStyle(shadow.querySelector('.ia-panel')).backgroundColor,
    };
  })()`, true);
  assert.deepEqual(metrics.nav.map(({ label }) => label), [
    'Toolbox', 'Follower checker', 'Follow / Unfollow', 'DM Unsend', 'Workspace',
  ]);
  assert.equal(metrics.nav[0].selected, 'true');
  assert.equal(metrics.panelLabel, 'Insta AIO Instagram sidecar');
  assert.equal(metrics.statusLive, 'polite');
  assert.equal(metrics.closeLabel, 'Collapse Insta AIO sidecar');
  assert.match(metrics.moveLabel, /Move sidecar/);
  assert.match(metrics.resizeLabel, /Resize sidecar/);
  assert.equal(metrics.opacity, '88');
  assert.match(metrics.panelBackground, /(rgba\(|color\()/);

  await webContents.executeJavaScript(`(() => {
    const shadow = document.querySelector('#insta-aio-sidecar-root').shadowRoot;
    const move = shadow.querySelector('[data-ia-role="move-handle"]');
    const resize = shadow.querySelector('[data-ia-role="resize-handle"]');
    const opacity = shadow.querySelector('[data-ia-preference="opacity"]');
    move.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
    resize.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    opacity.value = '76';
    opacity.dispatchEvent(new Event('input', { bubbles: true }));
    opacity.dispatchEvent(new Event('change', { bubbles: true }));
  })()`, true);
  const savedLayout = await waitForPageValue(
    webContents,
    `(() => {
      const value = globalThis.fixtureStorage.instaAioOverlayPreferencesV3;
      return value?.position && value?.panelWidth && value?.opacity === 0.76 ? value : null;
    })()`,
    'movable translucent V3 preferences',
  );
  assert.equal(savedLayout.schemaVersion, 3);
  assert.ok(savedLayout.position.x >= 0);
  assert.ok(savedLayout.panelWidth >= 320);

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

  await webContents.executeJavaScript(`(() => {
    const shadow = document.querySelector('#insta-aio-sidecar-root').shadowRoot;
    shadow.querySelector('[data-ia-section="messages"]').click();
    shadow.querySelector('[data-ia-action="mass-unsend"]').click();
  })()`, true);
  await waitForPageValue(
    webContents,
    `document.querySelector('#insta-aio-sidecar-root')?.shadowRoot
      ?.querySelector('[data-ia-role="arm-dialog"]')?.open === true`,
    'thread-wide Unsend arm dialog',
  );
  await webContents.executeJavaScript(`(() => {
    const shadow = document.querySelector('#insta-aio-sidecar-root').shadowRoot;
    shadow.querySelector('[data-ia-role="arm-input"]').value = 'UNSEND ALL DMS';
    shadow.querySelector('[data-ia-role="arm-dialog"]').close('confirm');
  })()`, true);
  const massArm = await waitForPageValue(
    webContents,
    `(() => {
      const shadow = document.querySelector('#insta-aio-sidecar-root')?.shadowRoot;
      const badge = shadow?.querySelector('[data-ia-role="unsend-badge"]')?.textContent;
      if (badge !== 'armed 15m') return null;
      return {
        badge,
        button: shadow.querySelector('[data-ia-action="mass-unsend"]')?.textContent,
        clicks: globalThis.fixtureDmClickCount,
      };
    })()`,
    'thread-wide Unsend no-click arm',
  );
  assert.equal(massArm.button, 'Unsend all DMs');
  assert.equal(massArm.clicks, 0, 'arming thread-wide Unsend opens no Instagram control');

  app.setAccessibilitySupportEnabled(true);
  webContents.debugger.attach('1.3');
  try {
    await webContents.debugger.sendCommand('Accessibility.enable');
    const tree = await webContents.debugger.sendCommand('Accessibility.getFullAXTree');
    const names = new Set((tree.nodes || []).map((node) => node.name?.value).filter(Boolean));
    for (const expected of [
      'Insta AIO Instagram sidecar',
      'Collapse Insta AIO sidecar',
      'Toolbox',
      'Follower checker',
      'Follow / Unfollow',
      'DM Unsend',
      'Workspace',
      'Move sidecar; use arrow keys for precise movement',
      'Resize sidecar; use arrow keys for precise sizing',
    ]) {
      assert.equal(names.has(expected), true, `accessibility tree is missing ${expected}`);
    }
  } finally {
    if (webContents.debugger.isAttached()) webContents.debugger.detach();
  }
  console.log('Accepted overlay keyboard focus, no-click thread Unsend arm, and Chromium accessibility-tree contract.');
}

// Drives the thread-wide unsend against a stand-in that reproduces the two
// shapes that previously broke it: a menu portalled outside the row with no
// role="menu", and rows that stay in place as an "unsent" note instead of
// being removed. Both of those made every message report as a failure.
async function acceptThreadUnsend(webContents, baseUrl) {
  await withTimeout(
    webContents.loadURL(`${baseUrl}/direct/t/17800000000000001/`),
    'thread unsend fixture load',
  );
  await waitForPageValue(
    webContents,
    'Boolean(globalThis.InstaAioDmThreadUnsender)',
    'thread unsend: engine ready',
  );

  const outcome = await webContents.executeJavaScript(`(async () => {
    const runner = globalThis.InstaAioDmThreadUnsender;
    const inspection = runner.inspect();
    const rejected = await runner.start({
      authorizationExpiresAt: Date.now() + 60_000,
      expectedThreadId: 'different-thread',
      minDelayMs: 0,
      maxDelayMs: 0,
    });
    const result = await runner.start({
      authorizationExpiresAt: Date.now() + 60_000,
      expectedThreadId: inspection.threadId,
      minDelayMs: 0,
      maxDelayMs: 0,
    });
    const rows = [...document.querySelectorAll('#thread .row')];
    return {
      result,
      rejected,
      fixtureCancelClicks: globalThis.fixtureCancelClicks,
      fixtureDecoyUnsendClicks: globalThis.fixtureDecoyUnsendClicks,
      fixtureUnsentCount: globalThis.fixtureUnsentCount,
      remainingSent: rows.filter((row) => row.classList.contains('mine')).length,
      leftoverDialogs: document.querySelectorAll('[role="dialog"]').length,
      status: runner.inspect?.().status ?? null,
    };
  })()`, true);

  // Six of the twelve fixture rows are sent by this account.
  assert.match(outcome.rejected?.message || '', /Thread-specific live authorization is required/);
  assert.equal(outcome.fixtureCancelClicks, 0, 'the unrelated Cancel control is never activated');
  assert.equal(outcome.fixtureDecoyUnsendClicks, 0, 'a stale document-global Unsend decoy is never activated');
  assert.equal(outcome.fixtureUnsentCount, 6, 'every sent message was actually unsent');
  assert.equal(outcome.remainingSent, 0, 'no sent message was left behind');
  assert.equal(outcome.leftoverDialogs, 0, 'no confirmation dialog was left open');
  assert.equal(outcome.result?.processed, 6);
  assert.equal(outcome.result?.failures ?? 0, 0, 'a working thread produces no failures');
  console.log(`Accepted thread-bound Unsend against a portalled menu (${outcome.fixtureUnsentCount} removed, stale decoy untouched).`);
}

async function acceptToolboxLayout(webContents, baseUrl) {
  await withTimeout(webContents.loadURL(baseUrl + "/userscript-fixture.html"), "audit load");
  await waitForPageValue(webContents, "Boolean(document.querySelector(\"#insta-aio-userscript-root\")?.shadowRoot)", "audit shell");
  const layoutAuditProbe = await readFile(path.join(repositoryRoot, "scripts", "probes", "layout-audit.js"), "utf8");
  const report = await webContents.executeJavaScript(layoutAuditProbe, true);
  const hitProbe = await readFile(path.join(repositoryRoot, "scripts", "probes", "hit-probe.js"), "utf8");
  const hits = await webContents.executeJavaScript(hitProbe, true);
  assert.deepEqual(hits.blocked, [], "controls must not be covered by another element");
  assert.deepEqual(hits.invisibleText, [], "control text must not match its own background");
  assert.deepEqual(report.overlaps, [], 'panel sections must not overlap');
  assert.deepEqual(report.escapes, [], 'no section may render outside the panel');
  assert.deepEqual(report.duplicateIds, [], 'duplicate ids break label and aria references');
  // A checkbox and a range track are legitimately smaller; their labels carry
  // the target. Anything else below 44px is a real regression.
  const undersized = report.undersizedTargets.filter((entry) => !/h=(4[4-9]|[5-9]d|d{3})/.test(entry));
  assert.ok(undersized.length <= 2, 'undersized hit targets: ' + JSON.stringify(undersized));
  // The brief's viewport matrix. A flex column should hold up at each, but
  // short and narrow windows are exactly where a panel starts clipping.
  const viewportMatrix = [
    { label: 'short laptop', width: 1280, height: 620 },
    { label: 'narrow tablet', width: 760, height: 900 },
    { label: 'mobile portrait', width: 390, height: 780 },
    { label: 'mobile landscape', width: 780, height: 390 },
    { label: '200% zoom', width: 640, height: 400 },
  ];
  const probe = await readFile(path.join(repositoryRoot, 'scripts', 'probes', 'layout-audit.js'), 'utf8');
  for (const viewport of viewportMatrix) {
    webContents.setZoomFactor(1);
    await resizeViewport(webContents, viewport);
    const sized = await webContents.executeJavaScript(probe, true);
    assert.deepEqual(sized.overlaps, [], `${viewport.label}: sections overlap`);
    assert.deepEqual(sized.duplicateIds, [], `${viewport.label}: duplicate ids`);
    const settingsBounds = await webContents.executeJavaScript(`new Promise((resolve) => {
      const shadow = document.querySelector('#insta-aio-userscript-root').shadowRoot;
      const details = shadow.querySelector('details.settings');
      details.open = true;
      requestAnimationFrame(() => requestAnimationFrame(() => {
        const settingsElement = shadow.querySelector('.settings-panel');
        const settings = settingsElement.getBoundingClientRect();
        const panel = shadow.querySelector('.panel').getBoundingClientRect();
        const computed = getComputedStyle(settingsElement);
        details.open = false;
        resolve({
          settings: { left: settings.left, top: settings.top, right: settings.right, bottom: settings.bottom },
          panel: { left: panel.left, top: panel.top, right: panel.right, bottom: panel.bottom },
          computed: {
            maxHeight: computed.maxHeight,
            boxSizing: computed.boxSizing,
            configuredMaxHeight: getComputedStyle(shadow.host).getPropertyValue('--aio-settings-max-height').trim(),
          },
        });
      }));
    })`, true);
    const settingsGeometry = JSON.stringify(settingsBounds);
    assert.ok(settingsBounds.settings.left >= settingsBounds.panel.left - 1, `${viewport.label}: settings escape left ${settingsGeometry}`);
    assert.ok(settingsBounds.settings.top >= settingsBounds.panel.top - 1, `${viewport.label}: settings escape top ${settingsGeometry}`);
    assert.ok(settingsBounds.settings.right <= settingsBounds.panel.right + 1, `${viewport.label}: settings escape right ${settingsGeometry}`);
    assert.ok(settingsBounds.settings.bottom <= settingsBounds.panel.bottom + 1, `${viewport.label}: settings escape bottom ${settingsGeometry}`);
  }
  console.log(`Accepted toolbox layout (${report.visibleChildren} sections, no overlap or overflow, ${viewportMatrix.length} viewports).`);
}

async function acceptUserscriptToolbox(webContents, baseUrl) {
  await withTimeout(
    webContents.loadURL(`${baseUrl}/userscript-fixture.html`),
    'userscript fixture load',
  );
  await waitForPageValue(
    webContents,
    `Boolean(document.querySelector('#insta-aio-userscript-root')?.shadowRoot)`,
    'Tampermonkey toolbox injection',
  );
  const initial = await webContents.executeJavaScript(`(() => {
    const shadow = document.querySelector('#insta-aio-userscript-root').shadowRoot;
    return {
      labels: [...shadow.querySelectorAll('[data-view]')].map((element) => element.textContent.trim()),
      tabs: [...shadow.querySelectorAll('[role="tab"]')].map((element) => ({
        controls: element.getAttribute('aria-controls'),
        selected: element.getAttribute('aria-selected'),
        tabIndex: element.tabIndex,
      })),
      panels: [...shadow.querySelectorAll('[role="tabpanel"]')].map((element) => ({
        id: element.id,
        labelledBy: element.getAttribute('aria-labelledby'),
      })),
      resizeCorners: [
        Boolean(shadow.querySelector('[data-role="resize"]')),
        Boolean(shadow.querySelector('[data-role="resize-tl"]')),
      ],
      move: shadow.querySelector('[data-role="move"]')?.getAttribute('aria-label'),
      open: !shadow.querySelector('.panel').hidden,
      opacity: shadow.querySelector('[data-preference="opacity"]')?.value,
      opacityMin: shadow.querySelector('[data-preference="opacity"]')?.min,
      resize: shadow.querySelector('[data-role="resize"]')?.getAttribute('aria-label'),
      mode: shadow.querySelector('.mode')?.textContent,
      liveToggle: {
        checked: shadow.querySelector('[data-role="live-actions"]')?.checked,
        disabled: shadow.querySelector('[data-role="live-actions"]')?.disabled,
      },
      liveControls: [
        'review-accounts', 'run-unsend', 'scan-following', 'scan-followers', 'scan-sent', 'stop-run',
      ].map((action) => Boolean(shadow.querySelector('[data-action="' + action + '"]'))),
      checkerScanLabels: [
        shadow.querySelector('[data-action="scan-following"]')?.textContent.trim(),
        shadow.querySelector('[data-action="scan-followers"]')?.textContent.trim(),
      ],
      reviewControl: {
        disabled: shadow.querySelector('[data-action="review-accounts"]')?.disabled,
        live: shadow.querySelector('[data-action="review-accounts"]')?.hasAttribute('data-live-action'),
      },
      destructiveDisabled: [...shadow.querySelectorAll('[data-live-action]')]
        .map((control) => control.disabled),
      hasContextStrip: Boolean(shadow.querySelector('[data-role="context"]')),
      context: {
        title: shadow.querySelector('[data-role="context-title"]')?.textContent,
        action: shadow.querySelector('[data-role="context-cta"]')?.dataset.ctaAction,
        label: shadow.querySelector('[data-role="context-cta"]')?.textContent,
      },
      introHidden: shadow.querySelector('[data-role="intro"]')?.hidden,
      unsendPrimaryVisible: shadow.querySelector('[data-role="unsend-primary"]')?.hidden === false,
      engineExecutors: [
        typeof globalThis.InstaAioInstagramInspector?.performReviewedProfileAction,
        typeof globalThis.InstaAioInstagramInspector?.performReviewedDmUnsend,
      ],
    };
  })()`, true);
  // Exactly the three tools, with no landing tab in front of them.
  assert.deepEqual(initial.labels, ['Checker', 'Follow', 'Unsend']);
  assert.deepEqual(initial.tabs, [
    { controls: 'aio-panel-checker', selected: 'true', tabIndex: 0 },
    { controls: 'aio-panel-account', selected: 'false', tabIndex: -1 },
    { controls: 'aio-panel-messages', selected: 'false', tabIndex: -1 },
  ]);
  assert.deepEqual(initial.panels, [
    { id: 'aio-panel-checker', labelledBy: 'aio-tab-checker' },
    { id: 'aio-panel-account', labelledBy: 'aio-tab-account' },
    { id: 'aio-panel-messages', labelledBy: 'aio-tab-messages' },
  ]);
  // Resizing lives on the conventional bottom-right corner only. A top-left
  // grip contended with the header for the same pixels, so one of the two was
  // always dead.
  assert.deepEqual(initial.resizeCorners, [true, false], 'resize is bottom-right only');
  assert.equal(initial.open, true);
  assert.equal(initial.opacity, '88');
  assert.equal(initial.opacityMin, '55');
  assert.match(initial.move, /Move toolbox/);
  assert.match(initial.resize, /Resize toolbox/);
  assert.match(initial.mode, /live actions locked/i);
  assert.deepEqual(initial.liveToggle, { checked: false, disabled: false });
  assert.deepEqual(initial.destructiveDisabled, [true, true]);
  assert.deepEqual(initial.reviewControl, { disabled: false, live: false });
  assert.equal(initial.introHidden, false);
  assert.deepEqual(initial.context, {
    title: 'Following list open',
    action: 'scan-following',
    label: 'Scan Following',
  });
  // The userscript exposes the same live tools as the extension, driven by the
  // shared engine rather than a private copy of the DOM logic.
  assert.deepEqual(initial.liveControls, [true, true, true, true, true, true]);
  assert.deepEqual(initial.checkerScanLabels, ['Scan Following', 'Scan Followers']);
  assert.equal(initial.hasContextStrip, true);
  // The unsend action is always reachable. It performs its own read of the
  // conversation and confirms before removing anything, so gating its
  // visibility behind a separate step removed the one-click path for no gain.
  assert.equal(initial.unsendPrimaryVisible, true);
  assert.deepEqual(initial.engineExecutors, ['function', 'function']);

  const darkTheme = await webContents.executeJavaScript(`(() => {
    const root = document.documentElement;
    const values = {
      '--ig-primary-background': '0 0 0',
      '--ig-elevated-background': '38 38 38',
      '--ig-secondary-background': '18 18 18',
      '--ig-primary-text': '245 245 245',
      '--ig-secondary-text': '168 168 168',
      '--ig-separator': '54 54 54',
      '--ig-primary-button': '0 149 246',
    };
    for (const [name, value] of Object.entries(values)) root.style.setProperty(name, value);
    const shadow = document.querySelector('#insta-aio-userscript-root').shadowRoot;
    const context = shadow.querySelector('[data-role="context"]');
    const title = shadow.querySelector('[data-role="context-title"]');
    const result = {
      contextBackground: getComputedStyle(context).backgroundColor,
      contextText: getComputedStyle(title).color,
      panelText: getComputedStyle(shadow.querySelector('.panel')).color,
    };
    for (const name of Object.keys(values)) root.style.removeProperty(name);
    return result;
  })()`, true);
  assert.deepEqual(darkTheme, {
    contextBackground: 'rgb(18, 18, 18)',
    contextText: 'rgb(245, 245, 245)',
    panelText: 'rgb(245, 245, 245)',
  });

  const introRoute = await webContents.executeJavaScript(`(() => {
    const shadow = document.querySelector('#insta-aio-userscript-root').shadowRoot;
    shadow.querySelector('[data-view="messages"]').click();
    shadow.querySelector('[data-action="intro-done"]').click();
    return {
      introHidden: shadow.querySelector('[data-role="intro"]')?.hidden,
      selected: [...shadow.querySelectorAll('[role="tab"]')]
        .find((tab) => tab.getAttribute('aria-selected') === 'true')?.dataset.view,
      visible: [...shadow.querySelectorAll('[role="tabpanel"]')]
        .find((panel) => !panel.hidden)?.dataset.panel,
    };
  })()`, true);
  assert.deepEqual(introRoute, { introHidden: true, selected: 'checker', visible: 'checker' });

  await webContents.executeJavaScript(`(() => {
    const dialog = document.querySelector('[role="dialog"]');
    dialog.remove();
    setTimeout(() => {
      dialog.setAttribute('aria-label', 'Followers');
      dialog.querySelector('h2').textContent = 'Followers';
      document.querySelector('main').append(dialog);
    }, 20);
  })()`, true);
  const refreshedContext = await waitForPageValue(
    webContents,
    `(() => {
      const shadow = document.querySelector('#insta-aio-userscript-root')?.shadowRoot;
      const cta = shadow?.querySelector('[data-role="context-cta"]');
      return shadow?.querySelector('[data-role="context-title"]')?.textContent === 'Followers list open'
        && cta?.dataset.ctaAction === 'scan-followers'
        ? { title: 'Followers list open', action: cta.dataset.ctaAction, label: cta.textContent }
        : null;
    })()`,
    'userscript follower-dialog context refresh',
  );
  assert.deepEqual(refreshedContext, {
    title: 'Followers list open', action: 'scan-followers', label: 'Scan Followers',
  });
  await webContents.executeJavaScript(`globalThis.fixtureSetList('following')`, true);

  const unlocked = await webContents.executeJavaScript(`(() => {
    globalThis.prompt = () => 'ENABLE LIVE ACTIONS';
    const shadow = document.querySelector('#insta-aio-userscript-root').shadowRoot;
    const toggle = shadow.querySelector('[data-role="live-actions"]');
    toggle.checked = true;
    toggle.dispatchEvent(new Event('change', { bubbles: true }));
    return {
      mode: shadow.querySelector('.mode')?.textContent,
      destructiveDisabled: [...shadow.querySelectorAll('[data-live-action]')]
        .map((control) => control.disabled),
      clicks: globalThis.fixtureProfileClickCount,
    };
  })()`, true);
  assert.match(unlocked.mode, /live actions unlocked/i);
  assert.deepEqual(unlocked.destructiveDisabled, [false, false]);
  assert.equal(unlocked.clicks, 0, 'unlocking authority performs no Instagram action');

  const relocked = await webContents.executeJavaScript(`(() => {
    const shadow = document.querySelector('#insta-aio-userscript-root').shadowRoot;
    const toggle = shadow.querySelector('[data-role="live-actions"]');
    toggle.checked = false;
    toggle.dispatchEvent(new Event('change', { bubbles: true }));
    return {
      mode: shadow.querySelector('.mode')?.textContent,
      destructiveDisabled: [...shadow.querySelectorAll('[data-live-action]')]
        .map((control) => control.disabled),
      clicks: globalThis.fixtureProfileClickCount,
    };
  })()`, true);
  assert.match(relocked.mode, /live actions locked/i);
  assert.deepEqual(relocked.destructiveDisabled, [true, true]);
  assert.equal(relocked.clicks, 0, 'relocking authority performs no Instagram action');

  await webContents.executeJavaScript(`(() => {
    const shadow = document.querySelector('#insta-aio-userscript-root').shadowRoot;
    shadow.querySelector('[data-role="move"]').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
    shadow.querySelector('[data-role="resize"]').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    const opacity = shadow.querySelector('[data-preference="opacity"]');
    opacity.value = '80';
    opacity.dispatchEvent(new Event('input', { bubbles: true }));
    opacity.dispatchEvent(new Event('change', { bubbles: true }));
    shadow.querySelector('[data-view="checker"]').click();
    shadow.querySelector('[data-action="capture"]').click();
    globalThis.fixtureSetList('followers');
    const listType = shadow.querySelector('[data-role="list-type"]');
    listType.value = 'followers';
    listType.dispatchEvent(new Event('change', { bubbles: true }));
    shadow.querySelector('[data-action="capture"]').click();
  })()`, true);
  const checker = await waitForPageValue(
    webContents,
    `(() => {
      const shadow = document.querySelector('#insta-aio-userscript-root')?.shadowRoot;
      const saved = globalThis.fixtureGmStore.instaAioUserscriptPreferencesV1;
      const text = shadow?.querySelector('[data-role="comparison"]')?.textContent || '';
      return saved?.position && saved?.width > 390 && saved?.opacity === 0.8
        && text.includes('1 mutual') && text.includes('1 not following me back')
        ? { saved, text } : null;
    })()`,
    'userscript layout and follower comparison',
  );
  assert.ok(checker.saved.position.x >= 0);

  await webContents.executeJavaScript(`(() => {
    const shadow = document.querySelector('#insta-aio-userscript-root').shadowRoot;
    shadow.querySelector('[data-view="account"]').click();
    shadow.querySelector('[data-action="account-dry-run"]').click();
  })()`, true);
  const account = await webContents.executeJavaScript(`(() => {
    const shadow = document.querySelector('#insta-aio-userscript-root').shadowRoot;
    return {
      clicks: globalThis.fixtureProfileClickCount,
      result: shadow.querySelector('[data-role="account-result"]')?.textContent,
    };
  })()`, true);
  assert.equal(account.clicks, 0);
  assert.match(account.result, /Exact no-click check passed/);

  await webContents.executeJavaScript(`(() => {
    globalThis.fixtureSetMessages();
  })()`, true);
  await waitForPageValue(
    webContents,
    `(() => {
      const stored = globalThis.fixtureGmStore.instaAioUserscriptStateV2;
      return location.pathname === '/direct/t/123/'
        && stored.messageEvidence === null
        && stored.dmCheck === null
        && stored.sentDms.length === 0;
    })()`,
    'userscript conversation route reset',
  );
  await webContents.executeJavaScript(`(() => {
    const shadow = document.querySelector('#insta-aio-userscript-root').shadowRoot;
    shadow.querySelector('[data-view="messages"]').click();
    shadow.querySelector('[data-action="read-messages"]').click();
    shadow.querySelector('[data-action="dm-dry-run"]').click();
  })()`, true);
  const messages = await webContents.executeJavaScript(`(() => {
    const shadow = document.querySelector('#insta-aio-userscript-root').shadowRoot;
    return {
      result: shadow.querySelector('[data-role="dm-result"]')?.textContent,
      rows: shadow.querySelectorAll('[data-role="message-list"] li').length,
      stored: globalThis.fixtureGmStore.instaAioUserscriptStateV2.dmCheck,
    };
  })()`, true);
  assert.match(messages.result, /Exact sent message resolved/);
  assert.ok(messages.rows >= 1);
  assert.equal(messages.stored.exact, true);

  await webContents.executeJavaScript(`(() => {
    history.replaceState({}, '', '/direct/inbox/');
    const routeMarker = document.createElement('span');
    routeMarker.hidden = true;
    document.body.append(routeMarker);
    routeMarker.remove();
  })()`, true);
  const routedAway = await waitForPageValue(
    webContents,
    `(() => {
      const shadow = document.querySelector('#insta-aio-userscript-root')?.shadowRoot;
      const result = shadow?.querySelector('[data-role="dm-result"]')?.textContent || '';
      const listText = shadow?.querySelector('[data-role="message-list"]')?.textContent || '';
      const stored = globalThis.fixtureGmStore.instaAioUserscriptStateV2;
      return result.includes('Open an Instagram conversation first.')
        && listText.includes('No visible thread evidence captured.')
        ? {
          cleared: stored.messageEvidence === null
            && stored.dmCheck === null
            && stored.sentDms.length === 0
            && stored.sentDmsComplete === false,
          result,
          rows: shadow.querySelectorAll('[data-role="message-list"] li').length,
          leaked: listText.includes('Yes — reviewing it now.'),
        }
        : null;
    })()`,
    'userscript DM evidence route binding',
  );
  assert.equal(routedAway.cleared, true);
  assert.equal(routedAway.rows, 1);
  assert.equal(routedAway.leaked, false);

  const inboxEvidence = await webContents.executeJavaScript(`(() => {
    const shadow = document.querySelector('#insta-aio-userscript-root').shadowRoot;
    shadow.querySelector('[data-action="read-messages"]').click();
    return globalThis.fixtureGmStore.instaAioUserscriptStateV2.messageEvidence;
  })()`, true);
  assert.equal(inboxEvidence.threadId, '');
  assert.equal(inboxEvidence.fragments.length, 0);
  assert.match(inboxEvidence.reason, /Open an Instagram conversation first/);
  console.log('Accepted the movable Tampermonkey toolbox, default live lock, local follower comparison, and account/DM no-click checks.');
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
    await acceptThreadUnsend(overlay.window.webContents, overlayBaseUrl);
    await acceptToolboxLayout(overlay.window.webContents, overlayBaseUrl);
    await acceptUserscriptToolbox(overlay.window.webContents, overlayBaseUrl);
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

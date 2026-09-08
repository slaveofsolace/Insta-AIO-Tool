import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { app, BrowserWindow, session } from 'electron';

import { createAppServer } from './serve.mjs';
import { instagramScriptOrder } from './instagram-script-order.mjs';

const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(moduleDirectory, '..');
const releaseVersion = JSON.parse(await readFile(path.join(repositoryRoot, 'package.json'), 'utf8')).version;
const resultsRoot = path.resolve(repositoryRoot, 'test-results', 'extension-acceptance');
const userDataRoot = path.resolve(
  process.env.INSTA_TOOLBOX_EXTENSION_ACCEPTANCE_USER_DATA
    || path.join(resultsRoot, 'user-data', String(process.pid)),
);
const overlayScriptFiles = instagramScriptOrder;
const fixtureAssets = new Map([
  ['/fixture.html', path.join(repositoryRoot, 'tests', 'fixtures', 'overlay-preview.html')],
  ['/userscript-fixture.html', path.join(repositoryRoot, 'tests', 'fixtures', 'userscript-preview.html')],
  ['/direct/t/17800000000000001/', path.join(repositoryRoot, 'tests', 'fixtures', 'dm-thread-fixture.html')],
  ['/userscripts/insta-toolbox.user.js', path.join(repositoryRoot, 'userscripts', 'insta-toolbox.user.js')],
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

async function trustedClick(webContents, elementExpression, label) {
  const point = await webContents.executeJavaScript(`(() => {
    const target = ${elementExpression};
    if (!(target instanceof HTMLElement) || target.hidden || target.disabled) return null;
    target.scrollIntoView({ block: 'center', inline: 'center' });
    const rectangle = target.getBoundingClientRect();
    if (rectangle.width <= 0 || rectangle.height <= 0) return null;
    return {
      x: Math.round(rectangle.left + (rectangle.width / 2)),
      y: Math.round(rectangle.top + (rectangle.height / 2)),
    };
  })()`, true);
  assert.ok(point, `${label} is not available for trusted browser input`);
  webContents.focus();
  webContents.sendInputEvent({ type: 'mouseMove', x: point.x, y: point.y });
  webContents.sendInputEvent({
    type: 'mouseDown', x: point.x, y: point.y, button: 'left', clickCount: 1,
  });
  webContents.sendInputEvent({
    type: 'mouseUp', x: point.x, y: point.y, button: 'left', clickCount: 1,
  });
  await new Promise((resolve) => setTimeout(resolve, 50));
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
      && globalThis.InstaToolboxInstagramInspector
      && document.querySelector('#insta-toolbox-sidecar-root')?.shadowRoot)`,
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
    kind: 'insta-toolbox-inspect-profile',
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
    kind: 'insta-toolbox-perform-reviewed-profile-action',
    item,
  });
  assert.ok(result.result, `${scenario.action}: no completion result`);
  assert.equal(result.relationship, scenario.after);
  assert.equal(
    await webContents.executeJavaScript('globalThis.fixtureClickCount', true),
    scenario.clicks,
  );

  const replay = await sendContentMessage(webContents, {
    kind: 'insta-toolbox-perform-reviewed-profile-action',
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
    kind: 'insta-toolbox-inspect-reviewed-dm-item',
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
    kind: 'insta-toolbox-perform-reviewed-dm-unsend',
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
    kind: 'insta-toolbox-perform-reviewed-dm-unsend',
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
    const shadow = document.querySelector('#insta-toolbox-sidecar-root').shadowRoot;
    return {
      launcherVisible: !shadow.querySelector('.insta-toolbox-launcher').hidden,
      panelHidden: shadow.querySelector('.insta-toolbox-panel').hidden,
    };
  })()`, true);
  assert.deepEqual(initial, { launcherVisible: true, panelHidden: true });
  await webContents.executeJavaScript(`(() => {
    const launcher = document.querySelector('#insta-toolbox-sidecar-root').shadowRoot.querySelector('.insta-toolbox-launcher');
    launcher.focus();
    launcher.click();
  })()`, true);
  await waitForPageValue(
    webContents,
    `document.querySelector('#insta-toolbox-sidecar-root')?.shadowRoot?.activeElement?.dataset?.instaToolboxSection === 'now'`,
    'sidecar initial keyboard focus',
  );
  const metrics = await webContents.executeJavaScript(`(() => {
    const shadow = document.querySelector('#insta-toolbox-sidecar-root').shadowRoot;
    return {
      nav: [...shadow.querySelectorAll('[data-insta-toolbox-section]')].map((button) => ({
        label: button.getAttribute('aria-label'),
        selected: button.getAttribute('aria-selected'),
      })),
      panelLabel: shadow.querySelector('.insta-toolbox-panel')?.getAttribute('aria-label'),
      statusLive: shadow.querySelector('[data-insta-toolbox-role="status"]')?.getAttribute('aria-live'),
      statusAtomic: shadow.querySelector('[data-insta-toolbox-role="status"]')?.getAttribute('aria-atomic'),
      headerHeight: shadow.querySelector('.insta-toolbox-header')?.getBoundingClientRect().height,
      headerText: shadow.querySelector('.insta-toolbox-header-copy')?.textContent.trim(),
      removedHeaderCopy: shadow.querySelectorAll('[data-insta-toolbox-role="view-context"], [data-insta-toolbox-role="view-subtitle"]').length,
      credit: {
        text: shadow.querySelector('.insta-toolbox-credit-link')?.textContent,
        href: shadow.querySelector('.insta-toolbox-credit-link')?.getAttribute('href'),
        target: shadow.querySelector('.insta-toolbox-credit-link')?.getAttribute('target'),
        rel: shadow.querySelector('.insta-toolbox-credit-link')?.getAttribute('rel'),
        height: shadow.querySelector('.insta-toolbox-credit')?.getBoundingClientRect().height,
      },
      moveSize: (() => {
        const rectangle = shadow.querySelector('[data-insta-toolbox-role="move-handle"]')?.getBoundingClientRect();
        return rectangle ? { height: rectangle.height, width: rectangle.width } : null;
      })(),
      closeLabel: shadow.querySelector('[data-insta-toolbox-action="close"]')?.getAttribute('aria-label'),
      moveLabel: shadow.querySelector('[data-insta-toolbox-role="move-handle"]')?.getAttribute('aria-label'),
      resizeLabels: [
        shadow.querySelector('[data-insta-toolbox-role="resize-handle-start"]')?.getAttribute('aria-label'),
        shadow.querySelector('[data-insta-toolbox-role="resize-handle-end"]')?.getAttribute('aria-label'),
      ],
      opacity: shadow.querySelector('[data-insta-toolbox-preference="opacity"]')?.value,
      panelBackground: getComputedStyle(shadow.querySelector('.insta-toolbox-panel')).backgroundColor,
    };
  })()`, true);
  assert.deepEqual(metrics.nav.map(({ label }) => label), [
    'Toolbox', 'Mutual Checker', 'Follow / Unfollow', 'DM Unsend', 'Workspace',
  ]);
  assert.equal(metrics.nav[0].selected, 'true');
  assert.equal(metrics.panelLabel, 'Insta Toolbox');
  assert.equal(metrics.statusLive, 'polite');
  assert.equal(metrics.statusAtomic, 'true');
  assert.ok(Math.abs(metrics.headerHeight - 52) <= 1, `compact header height changed: ${metrics.headerHeight}px`);
  assert.equal(metrics.headerText, 'Insta Toolbox');
  assert.equal(metrics.removedHeaderCopy, 0);
  assert.deepEqual({
    text: metrics.credit.text,
    href: metrics.credit.href,
    target: metrics.credit.target,
    rel: metrics.credit.rel,
  }, {
    text: 'created by @slaveofsolace',
    href: 'https://github.com/slaveofsolace',
    target: '_blank',
    rel: 'noopener noreferrer',
  });
  assert.ok(metrics.credit.height >= 26 && metrics.credit.height <= 28, `credit line height changed: ${metrics.credit.height}px`);
  assert.ok(Math.abs(metrics.moveSize.height - 44) <= 1, `move target height changed: ${metrics.moveSize.height}px`);
  assert.ok(Math.abs(metrics.moveSize.width - 44) <= 1, `move target width changed: ${metrics.moveSize.width}px`);
  assert.equal(metrics.closeLabel, 'Collapse Insta Toolbox');
  assert.match(metrics.moveLabel, /Move Insta Toolbox/);
  assert.deepEqual(metrics.resizeLabels, [
    'Resize Insta Toolbox from the lower-left corner; use arrow keys for precise sizing',
    'Resize Insta Toolbox from the lower-right corner; use arrow keys for precise sizing',
  ]);
  assert.equal(metrics.opacity, '88');
  assert.match(metrics.panelBackground, /(rgba\(|color\()/);

  await webContents.executeJavaScript(`(() => {
    const shadow = document.querySelector('#insta-toolbox-sidecar-root').shadowRoot;
    const move = shadow.querySelector('[data-insta-toolbox-role="move-handle"]');
    const resizeStart = shadow.querySelector('[data-insta-toolbox-role="resize-handle-start"]');
    const resizeEnd = shadow.querySelector('[data-insta-toolbox-role="resize-handle-end"]');
    const opacity = shadow.querySelector('[data-insta-toolbox-preference="opacity"]');
    move.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
    resizeStart.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
    resizeEnd.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    opacity.value = '76';
    opacity.dispatchEvent(new Event('input', { bubbles: true }));
    opacity.dispatchEvent(new Event('change', { bubbles: true }));
  })()`, true);
  const savedLayout = await waitForPageValue(
    webContents,
    `(() => {
      const value = globalThis.fixtureStorage.instaToolboxOverlayPreferencesV3;
      return value?.position && value?.panelWidth && value?.opacity === 0.76 ? value : null;
    })()`,
    'movable translucent V3 preferences',
  );
  assert.equal(savedLayout.schemaVersion, 3);
  assert.ok(savedLayout.position.x >= 0);
  assert.ok(savedLayout.panelWidth >= 320);

  await webContents.executeJavaScript(`(() => {
    const shadow = document.querySelector('#insta-toolbox-sidecar-root').shadowRoot;
    shadow.querySelector('[data-insta-toolbox-action="close"]').click();
  })()`, true);
  await waitForPageValue(
    webContents,
    `(() => {
      const shadow = document.querySelector('#insta-toolbox-sidecar-root')?.shadowRoot;
      return shadow?.querySelector('.insta-toolbox-panel')?.hidden
        && !shadow?.querySelector('.insta-toolbox-launcher')?.hidden
        && shadow.activeElement === shadow.querySelector('.insta-toolbox-launcher');
    })()`,
    'sidecar collapse and focus restoration',
  );

  await webContents.executeJavaScript(`(() => {
    document.querySelector('#insta-toolbox-sidecar-root').shadowRoot.querySelector('.insta-toolbox-launcher').click();
  })()`, true);
  await waitForPageValue(
    webContents,
    `document.querySelector('#insta-toolbox-sidecar-root')?.shadowRoot?.activeElement?.dataset?.instaToolboxSection === 'now'`,
    'sidecar reopen focus',
  );

  await webContents.executeJavaScript(`(() => {
    const shadow = document.querySelector('#insta-toolbox-sidecar-root').shadowRoot;
    shadow.querySelector('[data-insta-toolbox-section="messages"]').click();
    shadow.querySelector('[data-insta-toolbox-action="scan-sent-dms"]').click();
  })()`, true);
  const dmPreview = await waitForPageValue(
    webContents,
    `(() => {
      const shadow = document.querySelector('#insta-toolbox-sidecar-root')?.shadowRoot;
      const plan = shadow?.querySelector('[data-insta-toolbox-role="unsend-plan"]');
      const badge = shadow?.querySelector('[data-insta-toolbox-role="unsend-badge"]')?.textContent;
      if (!plan || plan.hidden || badge !== 'checked') return null;
      return {
        badge,
        button: shadow.querySelector('[data-insta-toolbox-action="mass-unsend"]')?.textContent,
        disabled: shadow.querySelector('[data-insta-toolbox-action="mass-unsend"]')?.disabled,
        eligible: shadow.querySelector('[data-insta-toolbox-role="unsend-eligible"]')?.textContent,
        clicks: globalThis.fixtureDmClickCount,
      };
    })()`,
    'thread-wide Unsend no-click preview',
  );
  assert.equal(dmPreview.button, 'Unsend DMs');
  assert.equal(dmPreview.disabled, false);
  assert.match(dmPreview.eligible, /^At least \d+ sent messages? detected$/);
  assert.equal(dmPreview.clicks, 0, 'checking the conversation opens no Instagram control');

  app.setAccessibilitySupportEnabled(true);
  webContents.debugger.attach('1.3');
  try {
    await webContents.debugger.sendCommand('Accessibility.enable');
    const tree = await webContents.debugger.sendCommand('Accessibility.getFullAXTree');
    const names = new Set((tree.nodes || []).map((node) => node.name?.value).filter(Boolean));
    for (const expected of [
      'Insta Toolbox',
      'Collapse Insta Toolbox',
      'Toolbox',
      'Mutual Checker',
      'Follow / Unfollow',
      'DM Unsend',
      'Workspace',
      'Move Insta Toolbox; use arrow keys for precise movement',
      'Resize Insta Toolbox from the lower-left corner; use arrow keys for precise sizing',
      'Resize Insta Toolbox from the lower-right corner; use arrow keys for precise sizing',
    ]) {
      assert.equal(names.has(expected), true, `accessibility tree is missing ${expected}`);
    }
  } finally {
    if (webContents.debugger.isAttached()) webContents.debugger.detach();
  }
  console.log('Accepted overlay keyboard focus, no-click thread Unsend preview, and Chromium accessibility-tree contract.');
}

async function acceptIncompleteComparison(webContents, baseUrl) {
  await loadFixture(webContents, baseUrl, 'qa-checker-partial');
  await webContents.executeJavaScript(`(() => {
    const shadow = document.querySelector('#insta-toolbox-sidecar-root').shadowRoot;
    shadow.querySelector('.insta-toolbox-launcher').click();
    shadow.querySelector('[data-insta-toolbox-section="capture"]').click();
  })()`, true);
  const result = await waitForPageValue(webContents, `(() => {
    const shadow = document.querySelector('#insta-toolbox-sidecar-root').shadowRoot;
    const title = shadow.querySelector('[data-insta-toolbox-role="capture-state-title"]').textContent;
    if (title !== 'Comparison withheld') return null;
    return {
      title,
      rows: shadow.querySelectorAll('[data-insta-toolbox-role="checker-filtered-list"] li').length,
      browser: Boolean(shadow.querySelector('[data-insta-toolbox-role="checker-browser"]')),
      report: shadow.querySelector('[data-insta-toolbox-role="comparison-report-download"]').getAttribute('href'),
      json: shadow.querySelector('[data-insta-toolbox-role="comparison-json-download"]').getAttribute('href'),
      raw: Boolean(shadow.querySelector('[data-insta-toolbox-role="capture-download"]').getAttribute('href')),
    };
  })()`, 'extension incomplete comparison');
  assert.deepEqual(result, { title: 'Comparison withheld', rows: 0, browser: false, report: null, json: null, raw: true });
  await webContents.executeJavaScript(`new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(resolve, 200))))`, true);
  await writeFile(path.join(resultsRoot, 'incomplete-comparison-extension.png'), (await webContents.capturePage()).toPNG());
  console.log('Accepted incomplete extension comparison: no inferred non-mutuals or comparison download; raw capture retained.');
}

async function acceptOverlayDmConfirmation(webContents, baseUrl) {
  await loadFixture(webContents, baseUrl, 'messages-live');
  await webContents.executeJavaScript(`(() => {
    globalThis.fixtureNativeConfirmCalls = 0;
    globalThis.confirm = () => {
      globalThis.fixtureNativeConfirmCalls += 1;
      throw new Error('Native confirm must not be used by the overlay.');
    };
    globalThis.fixtureRunnerStartCount = 0;
    const runner = globalThis.InstaToolboxDmThreadUnsender;
    let runnerWasActive = false;
    runner.subscribe((state) => {
      const active = state.operation === 'unsend'
        && ['preparing', 'running', 'waiting', 'stopping'].includes(state.status);
      if (active && !runnerWasActive) globalThis.fixtureRunnerStartCount += 1;
      runnerWasActive = active;
    });
    globalThis.fixtureBridgeRequests.length = 0;
    const shadow = document.querySelector('#insta-toolbox-sidecar-root').shadowRoot;
    globalThis.fixtureConfirmationTrustEvents = [];
    shadow.querySelector('[data-insta-toolbox-role="confirm-accept"]').addEventListener('click', (event) => {
      globalThis.fixtureConfirmationTrustEvents.push(event.isTrusted);
    });
    shadow.querySelector('.insta-toolbox-launcher').click();
    shadow.querySelector('[data-insta-toolbox-section="messages"]').click();
    shadow.querySelector('[data-insta-toolbox-action="mass-unsend"]').click();
  })()`, true);

  const firstReview = await waitForPageValue(
    webContents,
    `(() => {
      const shadow = document.querySelector('#insta-toolbox-sidecar-root')?.shadowRoot;
      const dialog = shadow?.querySelector('[data-insta-toolbox-role="action-confirmation"]');
      if (!dialog?.open) return null;
      return {
        title: shadow.querySelector('[data-insta-toolbox-role="confirm-title"]')?.textContent,
        message: shadow.querySelector('[data-insta-toolbox-role="confirm-message"]')?.textContent,
        detail: shadow.querySelector('[data-insta-toolbox-role="confirm-detail"]')?.textContent,
        confirmLabel: shadow.querySelector('[data-insta-toolbox-role="confirm-accept"]')?.textContent,
        facts: [...shadow.querySelectorAll('[data-insta-toolbox-role="confirm-facts"] dt')]
          .map((term) => [term.textContent, term.nextElementSibling?.textContent]),
        focusedRole: shadow.activeElement?.dataset?.instaToolboxRole,
        scope: shadow.querySelector('[data-insta-toolbox-role="unsend-scope"]')?.value,
        nativeConfirmCalls: globalThis.fixtureNativeConfirmCalls,
        reservations: globalThis.fixtureBridgeRequests.filter((request) => request.kind === 'insta-toolbox-reserve-thread-unsend').length,
        runnerStarts: globalThis.fixtureRunnerStartCount,
        unsent: globalThis.fixtureUnsentCount,
        clicks: globalThis.fixtureDmClickCount,
      };
    })()`,
    'extension in-overlay Unsend review',
  );
  assert.deepEqual(firstReview, {
    title: 'Unsend DMs?',
    message: 'Permanently unsend every message you sent in this conversation?',
    detail: 'This cannot be undone. Stop stays available while it runs.',
    confirmLabel: 'Unsend all my messages',
    facts: [
      ['Action', 'Permanently unsend messages'],
      ['Conversation', 'Thread 123'],
      ['Scope', 'All messages you sent'],
    ],
    focusedRole: 'confirm-cancel',
    scope: 'all',
    nativeConfirmCalls: 0,
    reservations: 0,
    runnerStarts: 0,
    unsent: 0,
    clicks: 0,
  });

  await webContents.executeJavaScript(`(() => {
    const shadow = document.querySelector('#insta-toolbox-sidecar-root').shadowRoot;
    const dialog = shadow.querySelector('[data-insta-toolbox-role="action-confirmation"]');
    dialog.dispatchEvent(new Event('cancel', { cancelable: true }));
  })()`, true);
  const escaped = await waitForPageValue(
    webContents,
    `(() => {
      const shadow = document.querySelector('#insta-toolbox-sidecar-root')?.shadowRoot;
      const dialog = shadow?.querySelector('[data-insta-toolbox-role="action-confirmation"]');
      const status = shadow?.querySelector('[data-insta-toolbox-role="status-text"]')?.textContent;
      return !dialog?.open && status === 'Canceled. Nothing was removed.' ? {
        nativeConfirmCalls: globalThis.fixtureNativeConfirmCalls,
        reservations: globalThis.fixtureBridgeRequests.filter((request) => request.kind === 'insta-toolbox-reserve-thread-unsend').length,
        runnerStarts: globalThis.fixtureRunnerStartCount,
        unsent: globalThis.fixtureUnsentCount,
        clicks: globalThis.fixtureDmClickCount,
      } : null;
    })()`,
    'extension Escape cancellation',
  );
  assert.deepEqual(escaped, {
    nativeConfirmCalls: 0, reservations: 0, runnerStarts: 0, unsent: 0, clicks: 0,
  });
  await webContents.executeJavaScript('new Promise((resolve) => setTimeout(resolve, 50))', true);

  await webContents.executeJavaScript(`(() => {
    const shadow = document.querySelector('#insta-toolbox-sidecar-root').shadowRoot;
    shadow.querySelector('[data-insta-toolbox-action="mass-unsend"]').click();
  })()`, true);
  await waitForPageValue(
    webContents,
    `document.querySelector('#insta-toolbox-sidecar-root')?.shadowRoot?.querySelector('[data-insta-toolbox-role="action-confirmation"]')?.open`,
    'extension cancel-button review',
  );
  await webContents.executeJavaScript(`(() => {
    const shadow = document.querySelector('#insta-toolbox-sidecar-root').shadowRoot;
    shadow.querySelector('[data-insta-toolbox-action="confirm-cancel"]').click();
  })()`, true);
  const canceled = await waitForPageValue(
    webContents,
    `(() => {
      const shadow = document.querySelector('#insta-toolbox-sidecar-root')?.shadowRoot;
      const status = shadow?.querySelector('[data-insta-toolbox-role="status-text"]')?.textContent;
      if (shadow?.querySelector('[data-insta-toolbox-role="action-confirmation"]')?.open
        || status !== 'Canceled. Nothing was removed.') return null;
      return {
        reservations: globalThis.fixtureBridgeRequests.filter((request) => request.kind === 'insta-toolbox-reserve-thread-unsend').length,
        runnerStarts: globalThis.fixtureRunnerStartCount,
        unsent: globalThis.fixtureUnsentCount,
      };
    })()`,
    'extension Cancel button cancellation',
  );
  assert.deepEqual(canceled, { reservations: 0, runnerStarts: 0, unsent: 0 });
  await webContents.executeJavaScript('new Promise((resolve) => setTimeout(resolve, 50))', true);

  await webContents.executeJavaScript(`(() => {
    globalThis.fixtureHoldThreadUnsendReservation = true;
    const shadow = document.querySelector('#insta-toolbox-sidecar-root').shadowRoot;
    shadow.querySelector('[data-insta-toolbox-action="mass-unsend"]').click();
  })()`, true);
  await waitForPageValue(
    webContents,
    `document.querySelector('#insta-toolbox-sidecar-root')?.shadowRoot?.querySelector('[data-insta-toolbox-role="action-confirmation"]')?.open`,
    'extension held-reservation review',
  );
  const rejectedSyntheticConfirmation = await webContents.executeJavaScript(`(() => {
    const shadow = document.querySelector('#insta-toolbox-sidecar-root').shadowRoot;
    const accept = shadow.querySelector('[data-insta-toolbox-action="confirm-accept"]');
    accept.click();
    accept.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    return Promise.resolve().then(() => ({
      dialogOpen: shadow.querySelector('[data-insta-toolbox-role="action-confirmation"]').open,
      trustEvents: [...globalThis.fixtureConfirmationTrustEvents],
      reservations: globalThis.fixtureBridgeRequests.filter((request) => request.kind === 'insta-toolbox-reserve-thread-unsend').length,
      runnerStarts: globalThis.fixtureRunnerStartCount,
      unsent: globalThis.fixtureUnsentCount,
      clicks: globalThis.fixtureDmClickCount,
    }));
  })()`, true);
  assert.deepEqual(rejectedSyntheticConfirmation, {
    dialogOpen: true,
    trustEvents: [false, false],
    reservations: 0,
    runnerStarts: 0,
    unsent: 0,
    clicks: 0,
  });
  await trustedClick(
    webContents,
    `document.querySelector('#insta-toolbox-sidecar-root').shadowRoot.querySelector('[data-insta-toolbox-action="confirm-accept"]')`,
    'extension Unsend confirmation',
  );
  const pendingReservation = await waitForPageValue(
    webContents,
    `(() => {
      const shadow = document.querySelector('#insta-toolbox-sidecar-root')?.shadowRoot;
      const reservations = globalThis.fixtureBridgeRequests.filter((request) => request.kind === 'insta-toolbox-reserve-thread-unsend');
      if (reservations.length !== 1) return null;
      const button = shadow?.querySelector('[data-insta-toolbox-action="mass-unsend"]');
      return {
        label: button?.textContent,
        disabled: button?.disabled,
        runnerStarts: globalThis.fixtureRunnerStartCount,
        unsent: globalThis.fixtureUnsentCount,
        confirmationTrusted: globalThis.fixtureConfirmationTrustEvents.at(-1),
        threadId: reservations[0].plan?.threadId,
        scope: reservations[0].plan?.scope,
      };
    })()`,
    'extension pending thread-Unsend reservation',
  );
  assert.deepEqual(pendingReservation, {
    label: 'Stop unsending',
    disabled: false,
    runnerStarts: 0,
    unsent: 0,
    confirmationTrusted: true,
    threadId: '123',
    scope: 'all',
  });

  await webContents.executeJavaScript(`(() => {
    const shadow = document.querySelector('#insta-toolbox-sidecar-root').shadowRoot;
    shadow.querySelector('[data-insta-toolbox-action="mass-unsend"]').click();
    globalThis.fixtureReleaseThreadUnsendReservations();
  })()`, true);
  const lateReservation = await waitForPageValue(
    webContents,
    `(() => {
      const shadow = document.querySelector('#insta-toolbox-sidecar-root')?.shadowRoot;
      const button = shadow?.querySelector('[data-insta-toolbox-action="mass-unsend"]');
      const status = shadow?.querySelector('[data-insta-toolbox-role="status-text"]')?.textContent;
      if (button?.textContent !== 'Unsend DMs'
        || button.disabled
        || status !== 'Stopped before Unsend began. Nothing was removed.') return null;
      return {
        runnerStarts: globalThis.fixtureRunnerStartCount,
        unsent: globalThis.fixtureUnsentCount,
        checkpoints: globalThis.fixtureBridgeRequests.filter((request) => request.kind === 'insta-toolbox-checkpoint-thread-unsend').length,
        finalization: (() => {
          const requests = globalThis.fixtureBridgeRequests.filter((request) => request.kind === 'insta-toolbox-finalize-thread-unsend');
          return requests.length === 1 ? {
            count: requests.length,
            processed: requests[0].processed,
            failed: requests[0].failed,
            status: requests[0].status,
          } : null;
        })(),
      };
    })()`,
    'extension late-reservation suppression',
  );
  assert.deepEqual(lateReservation, {
    runnerStarts: 0,
    unsent: 0,
    checkpoints: 0,
    finalization: { count: 1, processed: 0, failed: 0, status: 'stopped' },
  });

  await webContents.executeJavaScript(`new Promise((resolve) => setTimeout(() => {
    const shadow = document.querySelector('#insta-toolbox-sidecar-root').shadowRoot;
    shadow.querySelector('[data-insta-toolbox-action="mass-unsend"]').click();
    resolve(true);
  }, 50))`, true);
  await waitForPageValue(
    webContents,
    `document.querySelector('#insta-toolbox-sidecar-root')?.shadowRoot?.querySelector('[data-insta-toolbox-role="action-confirmation"]')?.open`,
    'extension final explicit review',
  );
  await trustedClick(
    webContents,
    `document.querySelector('#insta-toolbox-sidecar-root').shadowRoot.querySelector('[data-insta-toolbox-action="confirm-accept"]')`,
    'extension final Unsend confirmation',
  );
  const startedExecution = await waitForPageValue(
    webContents,
    `(() => {
      const snapshot = globalThis.InstaToolboxDmThreadUnsender?.snapshot?.();
      if (globalThis.fixtureRunnerStartCount !== 1) return null;
      return {
        status: snapshot?.status,
        message: snapshot?.message,
        processed: snapshot?.processed,
        failed: snapshot?.failed,
        unsent: globalThis.fixtureUnsentCount,
        clicks: globalThis.fixtureDmClickCount,
        stopLabel: document.querySelector('#insta-toolbox-sidecar-root')?.shadowRoot
          ?.querySelector('[data-insta-toolbox-action="mass-unsend"]')?.textContent,
        stopDisabled: document.querySelector('#insta-toolbox-sidecar-root')?.shadowRoot
          ?.querySelector('[data-insta-toolbox-action="mass-unsend"]')?.disabled,
      };
    })()`,
    'extension explicit second-click start',
  );
  assert.equal(['preparing', 'running', 'waiting'].includes(startedExecution.status), true, JSON.stringify(startedExecution));
  assert.equal(startedExecution.processed, 0);
  assert.equal(startedExecution.unsent, 0);
  assert.equal(startedExecution.clicks, 0);
  assert.equal(startedExecution.stopLabel, 'Stop unsending');
  assert.equal(startedExecution.stopDisabled, false);
  await webContents.executeJavaScript(`(() => {
    document.querySelector('#insta-toolbox-sidecar-root').shadowRoot
      .querySelector('[data-insta-toolbox-action="mass-unsend"]').click();
  })()`, true);
  const stoppedExecution = await waitForPageValue(
    webContents,
    `(() => {
      const snapshot = globalThis.InstaToolboxDmThreadUnsender?.snapshot?.();
      const finalizations = globalThis.fixtureBridgeRequests.filter((request) => request.kind === 'insta-toolbox-finalize-thread-unsend');
      if (snapshot?.status !== 'stopped' || finalizations.length !== 2) return null;
      return {
        nativeConfirmCalls: globalThis.fixtureNativeConfirmCalls,
        reservations: globalThis.fixtureBridgeRequests.filter((request) => request.kind === 'insta-toolbox-reserve-thread-unsend').length,
        runnerStarts: globalThis.fixtureRunnerStartCount,
        processed: snapshot.processed,
        failed: snapshot.failed,
        unsent: globalThis.fixtureUnsentCount,
        clicks: globalThis.fixtureDmClickCount,
        finalization: finalizations.at(-1) ? {
          processed: finalizations.at(-1).processed,
          failed: finalizations.at(-1).failed,
          status: finalizations.at(-1).status,
        } : null,
      };
    })()`,
    'extension explicit second-click start and Stop',
  );
  assert.deepEqual(stoppedExecution, {
    nativeConfirmCalls: 0,
    reservations: 2,
    runnerStarts: 1,
    processed: 0,
    failed: 0,
    unsent: 0,
    clicks: 0,
    finalization: { processed: 0, failed: 0, status: 'stopped' },
  });
  console.log('Accepted extension trusted-input Unsend confirmation: synthetic clicks stayed at zero actions, Cancel stayed safe, and Stop suppressed late reservations.');
}

// Drives the thread-wide unsend against a virtualized stand-in: only a small
// moving row window is mounted, every scroll replaces those nodes, and the
// menu is portalled outside the row without role="menu".
async function runThreadScope(webContents, baseUrl, scope, limit) {
  await withTimeout(
    webContents.loadURL(`${baseUrl}/direct/t/17800000000000001/`),
    `thread ${scope} fixture load`,
  );
  await waitForPageValue(
    webContents,
    'Boolean(globalThis.InstaToolboxDmThreadUnsender)',
    `thread ${scope}: engine ready`,
  );
  return webContents.executeJavaScript(`(async () => {
    const runner = globalThis.InstaToolboxDmThreadUnsender;
    const plan = runner.createPlan({
      threadId: '17800000000000001',
      scope: '${scope}',
      limit: ${limit},
      expiresAt: Date.now() + 60_000,
    });
    const result = await runner.start({ plan, minDelayMs: 0, maxDelayMs: 0 });
    return {
      result,
      openedIds: globalThis.fixtureOpenedIds,
      remainingSentIds: globalThis.fixtureRemainingSentIds(),
      oldestBoundaryExpandedAt: globalThis.fixtureOldestBoundaryExpandedAt,
      firstMenuOpenedAt: globalThis.fixtureFirstMenuOpenedAt,
      menuOpenedBeforeOldestExpansion: globalThis.fixtureMenuOpenedBeforeOldestExpansion,
    };
  })()`, true);
}

async function acceptThreadUnsendScopes(webContents, baseUrl) {
  const newest = await runThreadScope(webContents, baseUrl, 'newest', 2);
  assert.equal(newest.result.processed, 2);
  assert.deepEqual(newest.openedIds, ['fixture-message-40', 'fixture-message-32']);
  assert.equal(newest.remainingSentIds.length, 4);

  const oldest = await runThreadScope(webContents, baseUrl, 'oldest', 2);
  assert.equal(oldest.result.processed, 2);
  assert.equal(
    oldest.menuOpenedBeforeOldestExpansion,
    false,
    'finite oldest scope must not open a message menu before delayed history growth settles',
  );
  assert.ok(
    oldest.firstMenuOpenedAt >= oldest.oldestBoundaryExpandedAt + 1_500,
    'finite oldest scope must prove a stable oldest boundary before its first menu click',
  );
  assert.deepEqual(oldest.openedIds, ['fixture-message-2', 'fixture-message-9']);
  assert.equal(oldest.remainingSentIds.length, 4);
  console.log('Accepted newest and oldest finite Unsend ordering across virtualized rows.');
}

async function acceptThreadUnsendStop(webContents, baseUrl) {
  await withTimeout(
    webContents.loadURL(`${baseUrl}/direct/t/17800000000000001/`),
    'thread Stop fixture load',
  );
  await waitForPageValue(
    webContents,
    'Boolean(globalThis.InstaToolboxDmThreadUnsender)',
    'thread Stop: engine ready',
  );
  const stopped = await webContents.executeJavaScript(`(async () => {
    const runner = globalThis.InstaToolboxDmThreadUnsender;
    let stopRequested = false;
    const unsubscribe = runner.subscribe((state) => {
      if (!stopRequested && state.processed >= 1 && state.canStop) {
        stopRequested = true;
        runner.stop();
      }
    });
    const plan = runner.createPlan({
      threadId: '17800000000000001',
      scope: 'all',
      expiresAt: Date.now() + 60_000,
    });
    const result = await runner.start({ plan, minDelayMs: 0, maxDelayMs: 0 });
    unsubscribe();
    return {
      result,
      remainingSentIds: globalThis.fixtureRemainingSentIds(),
      stopRequested,
    };
  })()`, true);
  assert.equal(stopped.stopRequested, true);
  assert.equal(stopped.result.status, 'stopped');
  assert.equal(stopped.result.processed, 1);
  assert.equal(stopped.remainingSentIds.length, 5);
  console.log('Accepted Stop after one verified virtualized Unsend.');
}

async function acceptThreadUnsend(webContents, baseUrl) {
  await withTimeout(
    webContents.loadURL(`${baseUrl}/direct/t/17800000000000001/`),
    'thread unsend fixture load',
  );
  await waitForPageValue(
    webContents,
    'Boolean(globalThis.InstaToolboxDmThreadUnsender)',
    'thread unsend: engine ready',
  );

  const outcome = await webContents.executeJavaScript(`(async () => {
    const runner = globalThis.InstaToolboxDmThreadUnsender;
    const rejectedPlan = runner.createPlan({
      threadId: 'different-thread',
      scope: 'all',
      expiresAt: Date.now() + 60_000,
    });
    const rejected = await runner.start({
      plan: rejectedPlan,
      minDelayMs: 0,
      maxDelayMs: 0,
    });
    const plan = runner.createPlan({
      threadId: '17800000000000001',
      scope: 'all',
      detectedCount: globalThis.fixtureMountedSentHighWater,
      expiresAt: Date.now() + 60_000,
    });
    const result = await runner.start({
      plan,
      minDelayMs: 0,
      maxDelayMs: 0,
    });
    const replay = await runner.start({
      plan,
      minDelayMs: 0,
      maxDelayMs: 0,
    });
    return {
      result,
      replay,
      rejected,
      fixtureCancelClicks: globalThis.fixtureCancelClicks,
      fixtureDecoyUnsendClicks: globalThis.fixtureDecoyUnsendClicks,
      fixtureUnsentCount: globalThis.fixtureUnsentCount,
      logicalMessageCount: globalThis.fixtureLogicalMessageCount,
      delayedWindows: globalThis.fixtureDelayedWindows,
      newMessages: globalThis.fixtureNewMessages,
      scrollerReplacements: globalThis.fixtureScrollerReplacements,
      forcedRetryMisses: globalThis.fixtureForcedRetryMisses,
      initialScrollHeight: globalThis.fixtureInitialScrollHeight,
      finalScrollHeight: document.querySelector('#thread')?.scrollHeight,
      confirmedIds: globalThis.fixtureConfirmedIds,
      openedIds: globalThis.fixtureOpenedIds,
      mountedSentHighWater: globalThis.fixtureMountedSentHighWater,
      renderedWindows: globalThis.fixtureRenderedWindows,
      remainingSentIds: globalThis.fixtureRemainingSentIds(),
      leftoverDialogs: document.querySelectorAll('[role="dialog"]').length,
      status: result.status,
      retryAttempts: result.retryAttempts,
    };
  })()`, true);

  // Six of the 42 logical fixture messages are sent by this account, while
  // only four rows are mounted at a time.
  assert.match(outcome.rejected?.message || '', /Thread-specific live authorization is required/);
  assert.equal(outcome.fixtureCancelClicks, 0, 'the unrelated Cancel control is never activated');
  assert.ok(outcome.logicalMessageCount >= 40, 'the fixture must keep at least 40 logical messages');
  assert.ok(outcome.delayedWindows >= 1, 'the fixture must delay at least one virtual page');
  assert.equal(outcome.newMessages, 1, 'the run must survive a new received-message boundary');
  assert.ok(outcome.scrollerReplacements >= 1, 'the runner must survive a replaced scroller');
  assert.equal(outcome.forcedRetryMisses, 1, 'the replaced scroller must force one bounded transient miss');
  assert.ok(outcome.finalScrollHeight < outcome.initialScrollHeight, 'the virtual scroll range must shrink during removal');
  assert.equal(outcome.fixtureDecoyUnsendClicks, 0, 'a stale document-global Unsend decoy is never activated');
  assert.equal(
    outcome.fixtureUnsentCount,
    6,
    `every sent message was actually unsent; remaining=${outcome.remainingSentIds.join(',')} opened=${outcome.openedIds.join(',')}`,
  );
  assert.deepEqual(outcome.remainingSentIds, [], 'no logical sent message was left behind');
  assert.equal(new Set(outcome.confirmedIds).size, 6, 'each logical message is confirmed exactly once');
  assert.equal(new Set(outcome.openedIds).size, outcome.openedIds.length, 'no logical message menu is opened twice');
  assert.ok(outcome.mountedSentHighWater < 6, 'a mounted virtual window is smaller than the logical total');
  assert.ok(outcome.renderedWindows > 2, 'execution traverses more than one virtual window');
  assert.equal(outcome.leftoverDialogs, 0, 'no confirmation dialog was left open');
  assert.equal(outcome.result?.processed, 6);
  assert.equal(outcome.result?.failed, 0, 'a working thread produces no failures');
  assert.ok(
    outcome.retryAttempts >= outcome.forcedRetryMisses,
    'the replaced scroller must exercise bounded retry recovery',
  );
  assert.equal(outcome.status, 'completed');
  assert.equal(outcome.replay?.status, 'error');
  assert.match(outcome.replay?.message || '', /already used/);
  console.log(`Accepted thread-bound Unsend across virtualized rows (${outcome.fixtureUnsentCount} removed, stale decoy untouched).`);
}

function assertUserscriptConfirmationLayout(review, label) {
  const geometry = JSON.stringify({
    accept: review.accept,
    cancel: review.cancel,
    cssViewport: review.cssViewport,
    dialog: review.dialog,
  });
  assert.deepEqual({
    acceptLabel: review.acceptLabel,
    cancelLabel: review.cancelLabel,
    controlOrder: review.controlOrder,
    detail: review.detail,
    facts: review.facts,
    focusedRole: review.focusedRole,
    message: review.message,
    title: review.title,
  }, {
    acceptLabel: 'Unsend all my messages',
    cancelLabel: 'Cancel',
    controlOrder: ['confirm-cancel', 'confirm-accept'],
    detail: 'This cannot be undone. Stop stays available while it runs.',
    facts: [
      ['Action', 'Permanently unsend messages'],
      ['Conversation', 'Thread 123'],
      ['Scope', 'All messages you sent'],
    ],
    focusedRole: 'confirm-cancel',
    message: 'Permanently unsend every message you sent in this conversation?',
    title: 'Unsend DMs?',
  }, `${label}: exact confirmation semantics changed`);
  assert.ok(review.dialog.left >= -1, `${label}: confirmation escapes left; ${geometry}`);
  assert.ok(review.dialog.top >= -1, `${label}: confirmation escapes top; ${geometry}`);
  assert.ok(review.dialog.right <= review.cssViewport.width + 1, `${label}: confirmation escapes right; ${geometry}`);
  assert.ok(review.dialog.bottom <= review.cssViewport.height + 1, `${label}: confirmation escapes bottom; ${geometry}`);
  assert.ok(review.horizontalOverflow <= 1, `${label}: confirmation has horizontal overflow`);
  for (const [controlLabel, control] of [['Cancel', review.cancel], ['Confirm', review.accept]]) {
    assert.ok(control.width >= 43.5, `${label}: ${controlLabel} is narrower than 44px; ${geometry}`);
    assert.ok(control.height >= 43.5, `${label}: ${controlLabel} is shorter than 44px; ${geometry}`);
  }
  const cancelComesFirst = review.cancel.top < review.accept.top - 1
    || (Math.abs(review.cancel.top - review.accept.top) <= 1 && review.cancel.left < review.accept.left);
  assert.equal(cancelComesFirst, true, `${label}: Cancel is not visually before Confirm; ${geometry}`);
  assert.deepEqual({
    nativeConfirmCalls: review.nativeConfirmCalls,
    runnerStarts: review.runnerStarts,
    runnerStatus: review.runnerStatus,
    unsent: review.unsent,
  }, {
    nativeConfirmCalls: 0,
    runnerStarts: 0,
    runnerStatus: 'idle',
    unsent: 0,
  }, `${label}: opening the confirmation started destructive work`);
}

async function acceptToolboxLayout(webContents, baseUrl) {
  console.log('Checking userscript responsive layout matrix.');
  await withTimeout(webContents.loadURL(baseUrl + "/userscript-fixture.html"), "audit load");
  await waitForPageValue(webContents, "Boolean(document.querySelector(\"#insta-toolbox-userscript-root\")?.shadowRoot)", "audit shell");
  webContents.setZoomFactor(1);
  await resizeViewport(webContents, { label: 'userscript audit default', width: 1200, height: 800 });
  await webContents.executeJavaScript(`(() => {
    const shadow = document.querySelector('#insta-toolbox-userscript-root').shadowRoot;
    for (const details of shadow.querySelectorAll('details')) details.open = false;
    return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  })()`, true);
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
    { label: 'short laptop light', width: 1280, height: 620, zoom: 1, theme: 'light' },
    { label: '480px light', width: 480, height: 800, zoom: 1, theme: 'light' },
    { label: 'narrow custom panel dark', width: 900, height: 700, zoom: 1, theme: 'dark', panelWidth: 320 },
    { label: 'mobile portrait dark', width: 390, height: 780, zoom: 1, theme: 'dark' },
    { label: 'mobile landscape light', width: 780, height: 390, zoom: 1, theme: 'light' },
    { label: 'true 200% zoom dark', width: 1280, height: 800, zoom: 2, theme: 'dark' },
  ];
  const confirmationViewports = [
    {
      filename: 'confirmation-narrow-custom-panel-dark.png',
      height: 700,
      label: 'confirmation narrow custom panel dark',
      panelWidth: 320,
      theme: 'dark',
      width: 900,
      zoom: 1,
    },
    {
      filename: 'confirmation-true-200-zoom-dark.png',
      height: 800,
      label: 'confirmation true 200% zoom dark',
      theme: 'dark',
      width: 1280,
      zoom: 2,
    },
  ];
  const probe = await readFile(path.join(repositoryRoot, 'scripts', 'probes', 'layout-audit.js'), 'utf8');
  const screenshotRoot = path.join(resultsRoot, 'userscript-layout');
  const screenshotEntries = [];
  await mkdir(screenshotRoot, { recursive: true });
  webContents.debugger.attach('1.3');
  try {
    for (const viewport of viewportMatrix) {
      console.log(`  ${viewport.label}`);
      webContents.setZoomFactor(1);
      await withTimeout(resizeViewport(webContents, viewport), `${viewport.label}: resize`);
      await withTimeout(webContents.debugger.sendCommand('Emulation.setEmulatedMedia', {
        media: 'screen',
        features: [{ name: 'prefers-color-scheme', value: viewport.theme }],
      }), `${viewport.label}: emulate theme`);
      webContents.setZoomFactor(viewport.zoom);
      await withTimeout(webContents.executeJavaScript(`new Promise((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => {
          if (${Number.isFinite(viewport.panelWidth)}) {
            const shadow = document.querySelector('#insta-toolbox-userscript-root').shadowRoot;
            const resize = shadow.querySelector('[data-role="resize-end"]');
            for (let index = 0; index < 20; index += 1) {
              resize.dispatchEvent(new KeyboardEvent('keydown', {
                bubbles: true, cancelable: true, key: 'ArrowLeft',
              }));
            }
          }
          requestAnimationFrame(() => requestAnimationFrame(resolve));
        }));
      })`, true), `${viewport.label}: settle panel`);
      assert.equal(webContents.getZoomFactor(), viewport.zoom, `${viewport.label}: Chromium zoom factor changed`);
      const sized = await withTimeout(webContents.executeJavaScript(probe, true), `${viewport.label}: layout probe`);
      assert.deepEqual(sized.overlaps, [], `${viewport.label}: sections overlap`);
      assert.deepEqual(sized.duplicateIds, [], `${viewport.label}: duplicate ids`);
      const resolvedTheme = await withTimeout(webContents.executeJavaScript(`(() => {
        const shadow = document.querySelector('#insta-toolbox-userscript-root')?.shadowRoot;
        const panel = shadow?.querySelector('.panel');
        const context = shadow?.querySelector('[data-role="context"]');
        return panel && context ? {
          panelText: getComputedStyle(panel).color,
          contextBackground: getComputedStyle(context).backgroundColor,
        } : null;
      })()`, true), `${viewport.label}: theme probe`);
      const expectedTheme = viewport.theme === 'dark'
        ? { panelText: 'rgb(245, 245, 245)', contextBackground: 'rgb(18, 18, 18)' }
        : { panelText: 'rgb(0, 0, 0)', contextBackground: 'rgb(250, 250, 250)' };
      assert.deepEqual(resolvedTheme, expectedTheme, `${viewport.label}: resolved theme`);
      const settingsBounds = await withTimeout(webContents.executeJavaScript(`new Promise((resolve) => {
        const shadow = document.querySelector('#insta-toolbox-userscript-root').shadowRoot;
        shadow.querySelector('[data-action="open-settings"]').click();
        requestAnimationFrame(() => requestAnimationFrame(() => {
          const settingsElement = shadow.querySelector('.settings-dialog');
          const settings = settingsElement.getBoundingClientRect();
          const panel = shadow.querySelector('.panel').getBoundingClientRect();
          const move = shadow.querySelector('[data-role="move"]');
          const moveStyle = getComputedStyle(move);
          const moveRect = move.getBoundingClientRect();
          const computed = getComputedStyle(settingsElement);
          const title = shadow.querySelector('#insta-toolbox-settings-title')?.textContent;
          settingsElement.dispatchEvent(new MouseEvent('click', { bubbles: true }));
          resolve({
            cssViewport: { width: innerWidth, height: innerHeight },
            settings: { left: settings.left, top: settings.top, right: settings.right, bottom: settings.bottom },
            panel: { left: panel.left, top: panel.top, right: panel.right, bottom: panel.bottom, width: panel.width },
            move: { display: moveStyle.display, width: moveRect.width, height: moveRect.height },
            title,
            closedAfterOutsideClick: !settingsElement.open,
            computed: {
              maxHeight: computed.maxHeight,
              boxSizing: computed.boxSizing,
            },
          });
        }));
      })`, true), `${viewport.label}: settings geometry`);
      const settingsGeometry = JSON.stringify(settingsBounds);
      assert.ok(settingsBounds.settings.left >= -1, `${viewport.label}: settings escape left ${settingsGeometry}`);
      assert.ok(settingsBounds.settings.top >= -1, `${viewport.label}: settings escape top ${settingsGeometry}`);
      assert.ok(settingsBounds.settings.right <= settingsBounds.cssViewport.width + 1, `${viewport.label}: settings escape right ${settingsGeometry}`);
      assert.ok(settingsBounds.settings.bottom <= settingsBounds.cssViewport.height + 1, `${viewport.label}: settings escape bottom ${settingsGeometry}`);
      assert.equal(settingsBounds.title, 'Customize Insta Toolbox', `${viewport.label}: settings title`);
      assert.equal(settingsBounds.closedAfterOutsideClick, true, `${viewport.label}: settings outside click`);
      if (viewport.zoom === 2) {
        assert.ok(settingsBounds.cssViewport.width <= 650, `${viewport.label}: layout viewport did not shrink at 200% zoom`);
      }
      if (viewport.panelWidth) {
        assert.ok(settingsBounds.panel.width <= viewport.panelWidth + 1, `${viewport.label}: custom panel width was not applied ${settingsGeometry}`);
        assert.deepEqual(settingsBounds.move, { display: 'flex', width: 44, height: 44 }, `${viewport.label}: move handle must remain usable`);
      }
      const filename = `${viewport.label.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.png`;
      const capture = await withTimeout(webContents.capturePage(), `${viewport.label}: screenshot`);
      await writeFile(path.join(screenshotRoot, filename), capture.toPNG());
      screenshotEntries.push({ ...viewport, filename, cssViewport: settingsBounds.cssViewport });
    }

    await withTimeout(webContents.executeJavaScript(`(() => {
      globalThis.fixtureSetMessages();
      globalThis.fixtureNativeConfirmCalls = 0;
      globalThis.confirm = () => {
        globalThis.fixtureNativeConfirmCalls += 1;
        throw new Error('Native confirm must not be used by the userscript.');
      };
      globalThis.fixtureDmRunnerStarts = 0;
      const runner = globalThis.InstaToolboxDmThreadUnsender;
      let runnerWasActive = false;
      runner.subscribe((state) => {
        const active = state.operation === 'unsend'
          && ['preparing', 'running', 'waiting', 'stopping'].includes(state.status);
        if (active && !runnerWasActive) globalThis.fixtureDmRunnerStarts += 1;
        runnerWasActive = active;
      });
      return true;
    })()`, true), 'userscript confirmation fixture setup');
    await waitForPageValue(
      webContents,
      `location.pathname === '/direct/t/123/' && Boolean(document.querySelector('#insta-toolbox-userscript-root')?.shadowRoot)`,
      'userscript confirmation route',
    );

    for (const viewport of confirmationViewports) {
      console.log(`  ${viewport.label}`);
      webContents.setZoomFactor(1);
      await withTimeout(resizeViewport(webContents, viewport), `${viewport.label}: resize`);
      await withTimeout(webContents.debugger.sendCommand('Emulation.setEmulatedMedia', {
        media: 'screen',
        features: [{ name: 'prefers-color-scheme', value: viewport.theme }],
      }), `${viewport.label}: emulate theme`);
      webContents.setZoomFactor(viewport.zoom);
      await withTimeout(webContents.executeJavaScript(`new Promise((resolve) => {
        const host = document.querySelector('#insta-toolbox-userscript-root');
        const shadow = host.shadowRoot;
        if (${Number.isFinite(viewport.panelWidth)}) {
          host.style.setProperty('--insta-toolbox-width', '${viewport.panelWidth || 390}px');
        } else {
          host.style.removeProperty('--insta-toolbox-width');
        }
        for (const details of shadow.querySelectorAll('details')) details.open = false;
        shadow.querySelector('[data-view="messages"]').click();
        shadow.querySelector('[data-action="run-unsend"]').click();
        requestAnimationFrame(() => requestAnimationFrame(resolve));
      })`, true), `${viewport.label}: open confirmation`);
      assert.equal(webContents.getZoomFactor(), viewport.zoom, `${viewport.label}: Chromium zoom factor changed`);
      await waitForPageValue(
        webContents,
        `document.querySelector('#insta-toolbox-userscript-root')?.shadowRoot?.querySelector('[data-role="action-confirmation"]')?.open`,
        `${viewport.label}: confirmation open`,
      );
      const review = await withTimeout(webContents.executeJavaScript(`(() => {
        const shadow = document.querySelector('#insta-toolbox-userscript-root').shadowRoot;
        const dialog = shadow.querySelector('[data-role="action-confirmation"]');
        const cancel = shadow.querySelector('[data-role="confirm-cancel"]');
        const accept = shadow.querySelector('[data-role="confirm-accept"]');
        const rect = (element) => {
          const value = element.getBoundingClientRect();
          return {
            bottom: value.bottom,
            height: value.height,
            left: value.left,
            right: value.right,
            top: value.top,
            width: value.width,
          };
        };
        return {
          accept: rect(accept),
          acceptLabel: accept.textContent.trim(),
          cancel: rect(cancel),
          cancelLabel: cancel.textContent.trim(),
          controlOrder: [...dialog.querySelectorAll('[data-role="confirm-cancel"], [data-role="confirm-accept"]')]
            .map((element) => element.dataset.role),
          cssViewport: { height: innerHeight, width: innerWidth },
          detail: shadow.querySelector('[data-role="confirm-detail"]').textContent.trim(),
          dialog: rect(dialog),
          facts: [...shadow.querySelectorAll('[data-role="confirm-facts"] dt')]
            .map((term) => [term.textContent.trim(), term.nextElementSibling?.textContent.trim() || '']),
          focusedRole: shadow.activeElement?.dataset?.role || null,
          horizontalOverflow: dialog.scrollWidth - dialog.clientWidth,
          message: shadow.querySelector('[data-role="confirm-message"]').textContent.trim(),
          nativeConfirmCalls: globalThis.fixtureNativeConfirmCalls,
          runnerStarts: globalThis.fixtureDmRunnerStarts,
          runnerStatus: globalThis.InstaToolboxDmThreadUnsender.snapshot().status,
          title: shadow.querySelector('[data-role="confirm-title"]').textContent.trim(),
          unsent: globalThis.fixtureUnsentCount,
        };
      })()`, true), `${viewport.label}: confirmation geometry`);
      assertUserscriptConfirmationLayout(review, viewport.label);
      if (viewport.zoom === 2) {
        assert.ok(review.cssViewport.width <= 650, `${viewport.label}: layout viewport did not shrink at 200% zoom`);
      }
      const capture = await withTimeout(webContents.capturePage(), `${viewport.label}: screenshot`);
      await writeFile(path.join(screenshotRoot, viewport.filename), capture.toPNG());
      screenshotEntries.push({
        ...viewport,
        cssViewport: review.cssViewport,
        state: 'dm-confirmation-open',
      });

      await withTimeout(webContents.executeJavaScript(`(() => {
        document.querySelector('#insta-toolbox-userscript-root').shadowRoot
          .querySelector('[data-action="confirm-cancel"]').click();
        return true;
      })()`, true), `${viewport.label}: cancel confirmation`);
      const canceled = await waitForPageValue(
        webContents,
        `(() => {
          const shadow = document.querySelector('#insta-toolbox-userscript-root')?.shadowRoot;
          if (shadow?.querySelector('[data-role="action-confirmation"]')?.open) return null;
          return {
            nativeConfirmCalls: globalThis.fixtureNativeConfirmCalls,
            runnerStarts: globalThis.fixtureDmRunnerStarts,
            unsent: globalThis.fixtureUnsentCount,
          };
        })()`,
        `${viewport.label}: zero-action cancellation`,
      );
      assert.deepEqual(canceled, { nativeConfirmCalls: 0, runnerStarts: 0, unsent: 0 });
    }
  } finally {
    webContents.setZoomFactor(1);
    if (webContents.debugger.isAttached()) webContents.debugger.detach();
  }
  await writeFile(path.join(screenshotRoot, 'manifest.json'), `${JSON.stringify({ version: releaseVersion, screenshots: screenshotEntries }, null, 2)}\n`);
  console.log(`Accepted toolbox layout (${report.visibleChildren} sections, no overlap or overflow, ${viewportMatrix.length} base viewports, ${confirmationViewports.length} confirmation viewports).`);
}

async function acceptUserscriptToolbox(webContents, baseUrl) {
  await withTimeout(
    webContents.loadURL(`${baseUrl}/userscript-fixture.html`),
    'userscript fixture load',
  );
  await waitForPageValue(
    webContents,
    `Boolean(document.querySelector('#insta-toolbox-userscript-root')?.shadowRoot)`,
    'Tampermonkey toolbox injection',
  );
  const initial = await webContents.executeJavaScript(`(() => {
    const shadow = document.querySelector('#insta-toolbox-userscript-root').shadowRoot;
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
        Boolean(shadow.querySelector('[data-role="resize-start"]')),
        Boolean(shadow.querySelector('[data-role="resize-end"]')),
      ],
      move: shadow.querySelector('[data-role="move"]')?.getAttribute('aria-label'),
      open: !shadow.querySelector('.panel').hidden,
      opacity: shadow.querySelector('[data-preference="opacity"]')?.value,
      opacityMin: shadow.querySelector('[data-preference="opacity"]')?.min,
      resizeLabels: [
        shadow.querySelector('[data-role="resize-start"]')?.getAttribute('aria-label'),
        shadow.querySelector('[data-role="resize-end"]')?.getAttribute('aria-label'),
      ],
      header: shadow.querySelector('.header h1')?.textContent,
      credit: shadow.querySelector('.footer a')?.textContent,
      liveRegions: shadow.querySelectorAll('[aria-live]').length,
      hasGlobalUnlock: Boolean(shadow.querySelector('[data-role="live-actions"]')),
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
      unsendControl: {
        disabled: shadow.querySelector('[data-action="run-unsend"]')?.disabled,
        label: shadow.querySelector('[data-action="run-unsend"]')?.textContent.trim(),
      },
      ambientLiveControls: shadow.querySelectorAll('[data-live-action]').length,
      hasContextStrip: Boolean(shadow.querySelector('[data-role="context"]')),
      context: {
        title: shadow.querySelector('[data-role="context-title"]')?.textContent,
        action: shadow.querySelector('[data-role="context-cta"]')?.dataset.ctaAction,
        label: shadow.querySelector('[data-role="context-cta"]')?.textContent,
        hidden: shadow.querySelector('[data-role="context-cta"]')?.hidden,
      },
      hasIntro: Boolean(shadow.querySelector('[data-role="intro"]')),
      unsendPlanHidden: shadow.querySelector('[data-role="unsend-plan"]')?.hidden === true,
      engineExecutors: [
        typeof globalThis.InstaToolboxInstagramInspector?.performReviewedProfileAction,
        typeof globalThis.InstaToolboxInstagramInspector?.performReviewedDmUnsend,
      ],
      rootCount: document.querySelectorAll('#insta-toolbox-userscript-root').length,
      claimCount: document.querySelectorAll('#insta-toolbox-userscript-claim').length,
    };
  })()`, true);
  // Exactly the three tools, with no landing tab in front of them.
  assert.deepEqual(initial.labels, ['Mutual Checker', 'Follow / Unfollow', 'DM Unsend']);
  assert.deepEqual(initial.tabs, [
    { controls: 'insta-toolbox-panel-checker', selected: 'true', tabIndex: 0 },
    { controls: 'insta-toolbox-panel-account', selected: 'false', tabIndex: -1 },
    { controls: 'insta-toolbox-panel-messages', selected: 'false', tabIndex: -1 },
  ]);
  assert.deepEqual(initial.panels, [
    { id: 'insta-toolbox-panel-checker', labelledBy: 'insta-toolbox-tab-checker' },
    { id: 'insta-toolbox-panel-account', labelledBy: 'insta-toolbox-tab-account' },
    { id: 'insta-toolbox-panel-messages', labelledBy: 'insta-toolbox-tab-messages' },
  ]);
  assert.deepEqual(initial.resizeCorners, [true, true], 'both lower resize corners must be available');
  assert.equal(initial.open, true);
  assert.equal(initial.opacity, '88');
  assert.equal(initial.opacityMin, '55');
  assert.match(initial.move, /Move toolbox/);
  assert.deepEqual(initial.resizeLabels, [
    'Resize Insta Toolbox from the lower-left corner; use arrow keys for precise sizing',
    'Resize Insta Toolbox from the lower-right corner; use arrow keys for precise sizing',
  ]);
  assert.equal(initial.header, 'Insta Toolbox');
  assert.equal(initial.credit, 'created by @slaveofsolace');
  assert.equal(initial.liveRegions, 1);
  assert.equal(initial.hasGlobalUnlock, false);
  assert.equal(initial.ambientLiveControls, 0);
  assert.deepEqual(initial.reviewControl, { disabled: false, live: false });
  assert.deepEqual(initial.unsendControl, { disabled: true, label: 'Unsend DMs' });
  assert.equal(initial.hasIntro, false);
  assert.deepEqual(initial.context, {
    title: 'Following list open',
    action: undefined,
    label: '',
    hidden: true,
  });
  // The userscript exposes the same live tools as the extension, driven by the
  // shared engine rather than a private copy of the DOM logic.
  assert.deepEqual(initial.liveControls, [true, true, true, true, true, true]);
  assert.deepEqual(initial.checkerScanLabels, ['Scan Following', 'Scan Followers']);
  assert.equal(initial.hasContextStrip, true);
  // The action area stays visible so the workflow is discoverable. On this
  // non-conversation fixture it is disabled by route, not by a global unlock.
  assert.equal(initial.unsendPlanHidden, false);
  assert.deepEqual(initial.engineExecutors, ['function', 'function']);
  assert.equal(initial.rootCount, 1, 'loading the userscript twice must mount one toolbox');
  assert.equal(initial.claimCount, 0, 'the bootstrap claim must clear after the toolbox mounts');

  await waitForPageValue(
    webContents,
    `(() => {
      const shadow = document.querySelector('#insta-toolbox-userscript-root')?.shadowRoot;
      return shadow?.activeElement?.dataset?.view === 'checker';
    })()`,
    'userscript initial panel focus',
  );
  await webContents.executeJavaScript(`(() => {
    const shadow = document.querySelector('#insta-toolbox-userscript-root').shadowRoot;
    shadow.querySelector('[data-action="close"]').click();
  })()`, true);
  await waitForPageValue(
    webContents,
    `(() => {
      const shadow = document.querySelector('#insta-toolbox-userscript-root')?.shadowRoot;
      return shadow?.querySelector('.panel')?.hidden === true
        && shadow?.activeElement === shadow?.querySelector('.launcher');
    })()`,
    'userscript launcher focus restoration',
  );
  await webContents.executeJavaScript(`(() => {
    const shadow = document.querySelector('#insta-toolbox-userscript-root').shadowRoot;
    shadow.querySelector('.launcher').click();
  })()`, true);
  await waitForPageValue(
    webContents,
    `(() => {
      const shadow = document.querySelector('#insta-toolbox-userscript-root')?.shadowRoot;
      return shadow?.querySelector('.panel')?.hidden === false
        && shadow?.activeElement?.dataset?.view === 'checker';
    })()`,
    'userscript selected-tab focus after reopen',
  );

  await webContents.executeJavaScript(`(() => {
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
    return true;
  })()`, true);
  await waitForPageValue(webContents, `(() => {
    const shadow = document.querySelector('#insta-toolbox-userscript-root')?.shadowRoot;
    const context = shadow?.querySelector('[data-role="context"]');
    const title = shadow?.querySelector('[data-role="context-title"]');
    const panel = shadow?.querySelector('.panel');
    return context && title && panel
      && getComputedStyle(context).backgroundColor === 'rgb(18, 18, 18)'
      && getComputedStyle(title).color === 'rgb(245, 245, 245)'
      && getComputedStyle(panel).color === 'rgb(245, 245, 245)';
  })()`, 'settled userscript dark-theme tokens');
  const darkTheme = await webContents.executeJavaScript(`(() => {
    const root = document.documentElement;
    const shadow = document.querySelector('#insta-toolbox-userscript-root').shadowRoot;
    const context = shadow.querySelector('[data-role="context"]');
    const title = shadow.querySelector('[data-role="context-title"]');
    const result = {
      contextBackground: getComputedStyle(context).backgroundColor,
      contextText: getComputedStyle(title).color,
      panelText: getComputedStyle(shadow.querySelector('.panel')).color,
    };
    for (const name of [
      '--ig-primary-background',
      '--ig-elevated-background',
      '--ig-secondary-background',
      '--ig-primary-text',
      '--ig-secondary-text',
      '--ig-separator',
      '--ig-primary-button',
    ]) root.style.removeProperty(name);
    return result;
  })()`, true);
  assert.deepEqual(darkTheme, {
    contextBackground: 'rgb(18, 18, 18)',
    contextText: 'rgb(245, 245, 245)',
    panelText: 'rgb(245, 245, 245)',
  });

  const directToolRoutes = await webContents.executeJavaScript(`(() => {
    const shadow = document.querySelector('#insta-toolbox-userscript-root').shadowRoot;
    shadow.querySelector('[data-view="messages"]').click();
    const selected = () => ({
      selected: [...shadow.querySelectorAll('[role="tab"]')]
        .find((tab) => tab.getAttribute('aria-selected') === 'true')?.dataset.view,
      visible: [...shadow.querySelectorAll('[role="tabpanel"]')]
        .find((panel) => !panel.hidden)?.dataset.panel,
    });
    const messages = selected();
    shadow.querySelector('[data-view="checker"]').click();
    return { checker: selected(), messages };
  })()`, true);
  assert.deepEqual(directToolRoutes, {
    checker: { selected: 'checker', visible: 'checker' },
    messages: { selected: 'messages', visible: 'messages' },
  });

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
      const shadow = document.querySelector('#insta-toolbox-userscript-root')?.shadowRoot;
      const cta = shadow?.querySelector('[data-role="context-cta"]');
      return shadow?.querySelector('[data-role="context-title"]')?.textContent === 'Followers list open'
        && cta?.hidden === true
        ? { title: 'Followers list open', hidden: cta.hidden }
        : null;
    })()`,
    'userscript follower-dialog context refresh',
  );
  assert.deepEqual(refreshedContext, {
    title: 'Followers list open', hidden: true,
  });
  await webContents.executeJavaScript(`globalThis.fixtureSetList('following')`, true);

  const finiteAuthority = await webContents.executeJavaScript(`(() => {
    globalThis.prompt = () => { throw new Error('global phrase prompt must not be used'); };
    const shadow = document.querySelector('#insta-toolbox-userscript-root').shadowRoot;
    return {
      header: shadow.querySelector('.header h1')?.textContent,
      hasGlobalUnlock: Boolean(shadow.querySelector('[data-role="live-actions"]')),
      ambientLiveControls: shadow.querySelectorAll('[data-live-action]').length,
      clicks: globalThis.fixtureProfileClickCount,
    };
  })()`, true);
  assert.equal(finiteAuthority.header, 'Insta Toolbox');
  assert.equal(finiteAuthority.hasGlobalUnlock, false);
  assert.equal(finiteAuthority.ambientLiveControls, 0);
  assert.equal(finiteAuthority.clicks, 0, 'rendering finite controls performs no Instagram action');

  await webContents.executeJavaScript(`(() => {
    const shadow = document.querySelector('#insta-toolbox-userscript-root').shadowRoot;
    shadow.querySelector('[data-role="move"]').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
    shadow.querySelector('[data-role="resize-end"]').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
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
  const partialComparison = await webContents.executeJavaScript(`(() => {
    const shadow = document.querySelector('#insta-toolbox-userscript-root').shadowRoot;
    globalThis.fixtureDownloads.length = 0;
    shadow.querySelector('[data-action="download-comparison-json"]').click();
    return {
      hidden: shadow.querySelector('[data-role="comparison-browser"]').hidden,
      rows: shadow.querySelectorAll('[data-role="comparison-list"] strong').length,
      report: Boolean(shadow.querySelector('[data-role="comparison-report-download"]')),
      downloads: globalThis.fixtureDownloads.length,
      text: shadow.querySelector('[data-role="comparison"]').textContent,
    };
  })()`, true);
  assert.equal(partialComparison.hidden, true);
  assert.equal(partialComparison.rows, 0);
  assert.equal(partialComparison.report, false);
  assert.equal(partialComparison.downloads, 0);
  assert.match(partialComparison.text, /Comparison withheld to avoid false non-mutuals/);
  await writeFile(path.join(resultsRoot, 'incomplete-comparison-userscript.png'), (await webContents.capturePage()).toPNG());

  const scanFixtureList = async (listType, values = null) => {
    await webContents.executeJavaScript(`(() => {
      globalThis.fixtureSetList(${JSON.stringify(listType)}, ${JSON.stringify(values)});
      document.querySelector('#insta-toolbox-userscript-root').shadowRoot
        .querySelector('[data-action="scan-${listType}"]').click();
    })()`, true);
    await waitForPageValue(webContents,
      `globalThis.fixtureGmStore.instaToolboxUserscriptStateV2.capture.complete[${JSON.stringify(listType)}] === true`,
      `complete ${listType} scan`);
  };
  await scanFixtureList('following');
  await scanFixtureList('followers');
  const checker = await waitForPageValue(
    webContents,
    `(() => {
      const shadow = document.querySelector('#insta-toolbox-userscript-root')?.shadowRoot;
      const saved = globalThis.fixtureGmStore.instaToolboxUserscriptPreferencesV1;
      const text = shadow?.querySelector('[data-role="comparison"]')?.textContent || '';
      return saved?.position && saved?.width > 390 && saved?.opacity === 0.8
        && text.includes('1 mutual') && text.includes("1 don't follow you back")
        ? { saved, text } : null;
    })()`,
    'userscript layout and follower comparison',
  );
  assert.ok(checker.saved.position.x >= 0);

  const initialComparisonBrowser = await webContents.executeJavaScript(`(() => {
    const shadow = document.querySelector('#insta-toolbox-userscript-root').shadowRoot;
    return {
      browserHidden: shadow.querySelector('[data-role="comparison-browser"]')?.hidden,
      count: shadow.querySelector('[data-role="comparison-count"]')?.textContent,
      rows: [...shadow.querySelectorAll('[data-role="comparison-list"] strong')]
        .map((row) => row.textContent),
      report: shadow.querySelector('[data-role="comparison-report-download"]')?.textContent,
      json: shadow.querySelector('[data-action="download-comparison-json"]')?.textContent,
    };
  })()`, true);
  assert.deepEqual(initialComparisonBrowser, {
    browserHidden: false,
    count: 'Showing 1 of 1 account.',
    rows: ['@not_back'],
    report: 'Download comparison report',
    json: 'Download JSON',
  });

  const comparisonDownloads = await webContents.executeJavaScript(`(async () => {
    const shadow = document.querySelector('#insta-toolbox-userscript-root').shadowRoot;
    globalThis.fixtureDownloads.length = 0;
    shadow.querySelector('[data-role="comparison-report-download"]').click();
    shadow.querySelector('[data-action="download-comparison-json"]').click();
    await Promise.resolve();
    return Promise.all(globalThis.fixtureDownloads.map(async ({ blob, filename }) => ({
      filename,
      text: await blob.text(),
      type: blob.type,
    })));
  })()`, true);
  assert.equal(comparisonDownloads.length, 2);
  const reportDownload = comparisonDownloads.find(({ filename }) => filename.endsWith('.txt'));
  const jsonDownload = comparisonDownloads.find(({ filename }) => filename.endsWith('.json'));
  assert.match(reportDownload.filename, /^insta-toolbox-mutual-comparison-.+\.txt$/);
  assert.match(reportDownload.type, /^text\/plain/);
  assert.match(reportDownload.text, /NOT FOLLOWING YOU BACK/);
  assert.match(reportDownload.text, /YOU DO NOT FOLLOW BACK/);
  assert.match(reportDownload.text, /MUTUAL FOLLOWERS/);
  assert.match(reportDownload.text, /@not_back/);
  assert.match(reportDownload.text, /@follower_only/);
  assert.match(reportDownload.text, /@mutual_friend/);
  assert.match(jsonDownload.filename, /^insta-toolbox-mutual-comparison-.+\.json$/);
  assert.match(jsonDownload.type, /^application\/json/);
  const downloadedRecord = JSON.parse(jsonDownload.text);
  assert.equal(downloadedRecord.schemaVersion, 1);
  assert.equal(downloadedRecord.kind, 'insta-toolbox-comparison');
  assert.deepEqual(downloadedRecord.notFollowingMeBack.map(({ username }) => username), ['not_back']);
  assert.deepEqual(downloadedRecord.iDoNotFollowBack.map(({ username }) => username), ['follower_only']);
  assert.deepEqual(downloadedRecord.mutuals.map(({ username }) => username), ['mutual_friend']);

  await webContents.executeJavaScript(`document.querySelector('#insta-toolbox-userscript-root').shadowRoot
    .querySelector('[data-action="clear-capture"]').click()`, true);
  await scanFixtureList('following', [
    'mutual_friend',
    ...Array.from({ length: 30 }, (_, index) => ({
      displayName: index === 7 ? 'Studio Signal' : '',
      username: 'not_back_' + String(index).padStart(2, '0'),
    })),
  ]);
  await scanFixtureList('followers', ['mutual_friend', 'follower_only']);
  const firstComparisonPage = await webContents.executeJavaScript(`(() => {
    const shadow = document.querySelector('#insta-toolbox-userscript-root').shadowRoot;
    return {
      count: shadow.querySelector('[data-role="comparison-count"]')?.textContent,
      rows: shadow.querySelectorAll('[data-role="comparison-list"] strong').length,
      moreHidden: shadow.querySelector('[data-role="comparison-more"]')?.hidden,
      moreText: shadow.querySelector('[data-role="comparison-more"]')?.textContent,
    };
  })()`, true);
  assert.deepEqual(firstComparisonPage, {
    count: 'Showing 25 of 30 accounts.',
    rows: 25,
    moreHidden: false,
    moreText: 'Show 5 more',
  });

  await webContents.executeJavaScript(`(() => {
    const shadow = document.querySelector('#insta-toolbox-userscript-root').shadowRoot;
    const more = shadow.querySelector('[data-role="comparison-more"]');
    more.focus();
    more.click();
  })()`, true);
  const expandedComparison = await webContents.executeJavaScript(`(() => {
    const shadow = document.querySelector('#insta-toolbox-userscript-root').shadowRoot;
    const rows = [...shadow.querySelectorAll('[data-role="comparison-list"] strong')]
      .map((row) => row.textContent);
    return {
      count: shadow.querySelector('[data-role="comparison-count"]')?.textContent,
      rows: rows.length,
      last: rows.at(-1),
      moreHidden: shadow.querySelector('[data-role="comparison-more"]')?.hidden,
      focusedRole: shadow.activeElement?.dataset?.role,
    };
  })()`, true);
  assert.deepEqual(expandedComparison, {
    count: 'Showing 30 of 30 accounts.',
    rows: 30,
    last: '@not_back_29',
    moreHidden: true,
    focusedRole: 'comparison-count',
  });

  const filteredAndMutualViews = await webContents.executeJavaScript(`(() => {
    const shadow = document.querySelector('#insta-toolbox-userscript-root').shadowRoot;
    const search = shadow.querySelector('[data-role="result-filter"]');
    search.value = '@NOT_BACK_29';
    search.dispatchEvent(new Event('input', { bubbles: true }));
    const filtered = {
      count: shadow.querySelector('[data-role="comparison-count"]')?.textContent,
      rows: [...shadow.querySelectorAll('[data-role="comparison-list"] strong')]
        .map((row) => row.textContent),
    };
    search.value = 'studio signal';
    search.dispatchEvent(new Event('input', { bubbles: true }));
    const displayNameFiltered = {
      count: shadow.querySelector('[data-role="comparison-count"]')?.textContent,
      rows: [...shadow.querySelectorAll('[data-role="comparison-list"] strong')]
        .map((row) => row.textContent),
    };
    search.value = 'missing account';
    search.dispatchEvent(new Event('input', { bubbles: true }));
    const emptySearch = {
      count: shadow.querySelector('[data-role="comparison-count"]')?.textContent,
      text: shadow.querySelector('[data-role="comparison-list"]')?.textContent,
    };
    search.value = '';
    search.dispatchEvent(new Event('input', { bubbles: true }));
    const category = shadow.querySelector('[data-role="comparison-category"]');
    category.value = 'mutuals';
    category.dispatchEvent(new Event('change', { bubbles: true }));
    const mutuals = {
      count: shadow.querySelector('[data-role="comparison-count"]')?.textContent,
      rows: [...shadow.querySelectorAll('[data-role="comparison-list"] strong')]
        .map((row) => row.textContent),
    };
    category.value = 'i-do-not-follow-back';
    category.dispatchEvent(new Event('change', { bubbles: true }));
    const notFollowedBack = {
      count: shadow.querySelector('[data-role="comparison-count"]')?.textContent,
      rows: [...shadow.querySelectorAll('[data-role="comparison-list"] strong')]
        .map((row) => row.textContent),
    };
    return { filtered, displayNameFiltered, emptySearch, mutuals, notFollowedBack };
  })()`, true);
  assert.deepEqual(filteredAndMutualViews, {
    filtered: { count: 'Showing 1 of 1 account.', rows: ['@not_back_29'] },
    displayNameFiltered: { count: 'Showing 1 of 1 account.', rows: ['@not_back_07'] },
    emptySearch: { count: '0 accounts.', text: 'No captured account matches this search.' },
    mutuals: { count: 'Showing 1 of 1 account.', rows: ['@mutual_friend'] },
    notFollowedBack: { count: 'Showing 1 of 1 account.', rows: ['@follower_only'] },
  });

  await webContents.executeJavaScript(`(() => {
    const shadow = document.querySelector('#insta-toolbox-userscript-root').shadowRoot;
    shadow.querySelector('[data-view="account"]').click();
    shadow.querySelector('[data-action="account-dry-run"]').click();
  })()`, true);
  const account = await webContents.executeJavaScript(`(() => {
    const shadow = document.querySelector('#insta-toolbox-userscript-root').shadowRoot;
    return {
      clicks: globalThis.fixtureProfileClickCount,
      result: shadow.querySelector('[data-role="account-result"]')?.textContent,
    };
  })()`, true);
  assert.equal(account.clicks, 0);
  assert.match(account.result, /Profile status/);

  await webContents.executeJavaScript(`(() => {
    const shadow = document.querySelector('#insta-toolbox-userscript-root').shadowRoot;
    shadow.querySelector('[data-action="queue-complete"]').click();
    shadow.querySelector('[data-action="account-dry-run"]').click();
  })()`, true);
  const currentProfile = await webContents.executeJavaScript(`(() => {
    const shadow = document.querySelector('#insta-toolbox-userscript-root').shadowRoot;
    return {
      clicks: globalThis.fixtureProfileClickCount,
      current: shadow.querySelector('[data-role="queue-current"]')?.textContent,
      result: shadow.querySelector('[data-role="account-result"]')?.textContent,
    };
  })()`, true);
  assert.equal(currentProfile.clicks, 0);
  assert.match(currentProfile.current, /No queue item loaded/);
  assert.match(currentProfile.result, /Profile status/);
  assert.match(currentProfile.result, /Observed @demo_creator as following without clicking/);

  await webContents.executeJavaScript(`(() => {
    globalThis.fixtureSetMessages();
  })()`, true);
  await waitForPageValue(
    webContents,
    `(() => {
      const stored = globalThis.fixtureGmStore.instaToolboxUserscriptStateV2;
      return location.pathname === '/direct/t/123/'
        && stored.messageEvidence === null
        && stored.dmCheck === null
        && stored.sentDms.length === 0;
    })()`,
    'userscript conversation route reset',
  );
  await webContents.executeJavaScript(`(() => {
    const shadow = document.querySelector('#insta-toolbox-userscript-root').shadowRoot;
    shadow.querySelector('[data-view="messages"]').click();
    shadow.querySelector('[data-action="read-messages"]').click();
    shadow.querySelector('[data-action="dm-dry-run"]').click();
  })()`, true);
  const messages = await webContents.executeJavaScript(`(() => {
    const shadow = document.querySelector('#insta-toolbox-userscript-root').shadowRoot;
    return {
      result: shadow.querySelector('[data-role="dm-result"]')?.textContent,
      rows: shadow.querySelectorAll('[data-role="message-list"] li').length,
      stored: globalThis.fixtureGmStore.instaToolboxUserscriptStateV2.dmCheck,
    };
  })()`, true);
  assert.match(messages.result, /Exact sent message resolved/);
  assert.ok(messages.rows >= 1);
  assert.equal(messages.stored.exact, true);

  await webContents.executeJavaScript(`(() => {
    globalThis.fixtureNativeConfirmCalls = 0;
    globalThis.confirm = () => {
      globalThis.fixtureNativeConfirmCalls += 1;
      throw new Error('Native confirm must not be used by the userscript.');
    };
    globalThis.fixtureDmRunnerStarts = 0;
    const runner = globalThis.InstaToolboxDmThreadUnsender;
    let runnerWasActive = false;
    runner.subscribe((state) => {
      const active = state.operation === 'unsend'
        && ['preparing', 'running', 'waiting', 'stopping'].includes(state.status);
      if (active && !runnerWasActive) globalThis.fixtureDmRunnerStarts += 1;
      runnerWasActive = active;
    });
    const shadow = document.querySelector('#insta-toolbox-userscript-root').shadowRoot;
    globalThis.fixtureUserscriptConfirmationTrustEvents = [];
    shadow.querySelector('[data-role="confirm-accept"]').addEventListener('click', (event) => {
      globalThis.fixtureUserscriptConfirmationTrustEvents.push(event.isTrusted);
    });
    shadow.querySelector('[data-view="messages"]').click();
    shadow.querySelector('[data-action="run-unsend"]').click();
  })()`, true);
  const firstUnsendReview = await waitForPageValue(
    webContents,
    `(() => {
      const shadow = document.querySelector('#insta-toolbox-userscript-root')?.shadowRoot;
      const dialog = shadow?.querySelector('[data-role="action-confirmation"]');
      if (!dialog?.open) return null;
      return {
        title: shadow.querySelector('[data-role="confirm-title"]')?.textContent,
        message: shadow.querySelector('[data-role="confirm-message"]')?.textContent,
        detail: shadow.querySelector('[data-role="confirm-detail"]')?.textContent,
        confirmLabel: shadow.querySelector('[data-role="confirm-accept"]')?.textContent,
        facts: [...shadow.querySelectorAll('[data-role="confirm-facts"] dt')]
          .map((term) => [term.textContent, term.nextElementSibling?.textContent]),
        focusedRole: shadow.activeElement?.dataset?.role,
        scope: shadow.querySelector('[data-role="unsend-scope"]')?.value,
        nativeConfirmCalls: globalThis.fixtureNativeConfirmCalls,
        runnerStarts: globalThis.fixtureDmRunnerStarts,
        unsent: globalThis.fixtureUnsentCount,
      };
    })()`,
    'userscript in-overlay Unsend review',
  );
  assert.deepEqual(firstUnsendReview, {
    title: 'Unsend DMs?',
    message: 'Permanently unsend every message you sent in this conversation?',
    detail: 'This cannot be undone. Stop stays available while it runs.',
    confirmLabel: 'Unsend all my messages',
    facts: [
      ['Action', 'Permanently unsend messages'],
      ['Conversation', 'Thread 123'],
      ['Scope', 'All messages you sent'],
    ],
    focusedRole: 'confirm-cancel',
    scope: 'all',
    nativeConfirmCalls: 0,
    runnerStarts: 0,
    unsent: 0,
  });

  await webContents.executeJavaScript(`(() => {
    const shadow = document.querySelector('#insta-toolbox-userscript-root').shadowRoot;
    shadow.querySelector('[data-role="action-confirmation"]')
      .dispatchEvent(new Event('cancel', { cancelable: true }));
  })()`, true);
  const escapedUnsend = await waitForPageValue(
    webContents,
    `(() => {
      const shadow = document.querySelector('#insta-toolbox-userscript-root')?.shadowRoot;
      const status = shadow?.querySelector('[data-role="context-detail"]')?.textContent || '';
      return !shadow?.querySelector('[data-role="action-confirmation"]')?.open
        && status === 'Canceled. Nothing was removed.'
        ? {
          nativeConfirmCalls: globalThis.fixtureNativeConfirmCalls,
          runnerStarts: globalThis.fixtureDmRunnerStarts,
          unsent: globalThis.fixtureUnsentCount,
        }
        : null;
    })()`,
    'userscript Escape cancellation',
  );
  assert.deepEqual(escapedUnsend, { nativeConfirmCalls: 0, runnerStarts: 0, unsent: 0 });
  await webContents.executeJavaScript('new Promise((resolve) => setTimeout(resolve, 50))', true);

  await webContents.executeJavaScript(`(() => {
    const shadow = document.querySelector('#insta-toolbox-userscript-root').shadowRoot;
    shadow.querySelector('[data-action="run-unsend"]').click();
  })()`, true);
  await waitForPageValue(
    webContents,
    `document.querySelector('#insta-toolbox-userscript-root')?.shadowRoot?.querySelector('[data-role="action-confirmation"]')?.open`,
    'userscript cancel-button review',
  );
  await webContents.executeJavaScript(`(() => {
    document.querySelector('#insta-toolbox-userscript-root').shadowRoot
      .querySelector('[data-action="confirm-cancel"]').click();
  })()`, true);
  const canceledUnsend = await waitForPageValue(
    webContents,
    `(() => {
      const shadow = document.querySelector('#insta-toolbox-userscript-root')?.shadowRoot;
      const status = shadow?.querySelector('[data-role="context-detail"]')?.textContent || '';
      if (shadow?.querySelector('[data-role="action-confirmation"]')?.open
        || status !== 'Canceled. Nothing was removed.') return null;
      return {
        nativeConfirmCalls: globalThis.fixtureNativeConfirmCalls,
        runnerStarts: globalThis.fixtureDmRunnerStarts,
        unsent: globalThis.fixtureUnsentCount,
      };
    })()`,
    'userscript Cancel button cancellation',
  );
  assert.deepEqual(canceledUnsend, { nativeConfirmCalls: 0, runnerStarts: 0, unsent: 0 });
  await webContents.executeJavaScript('new Promise((resolve) => setTimeout(resolve, 50))', true);

  await webContents.executeJavaScript(`(() => {
    const shadow = document.querySelector('#insta-toolbox-userscript-root').shadowRoot;
    shadow.querySelector('[data-action="run-unsend"]').click();
  })()`, true);
  await waitForPageValue(
    webContents,
    `document.querySelector('#insta-toolbox-userscript-root')?.shadowRoot?.querySelector('[data-role="action-confirmation"]')?.open`,
    'userscript final explicit review',
  );
  const rejectedUserscriptSyntheticConfirmation = await webContents.executeJavaScript(`(() => {
    const shadow = document.querySelector('#insta-toolbox-userscript-root').shadowRoot;
    const accept = shadow.querySelector('[data-action="confirm-accept"]');
    accept.click();
    accept.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    return Promise.resolve().then(() => ({
      dialogOpen: shadow.querySelector('[data-role="action-confirmation"]').open,
      trustEvents: [...globalThis.fixtureUserscriptConfirmationTrustEvents],
      runnerStarts: globalThis.fixtureDmRunnerStarts,
      unsent: globalThis.fixtureUnsentCount,
      clicks: Number(globalThis.fixtureDmClickCount || 0),
    }));
  })()`, true);
  assert.deepEqual(rejectedUserscriptSyntheticConfirmation, {
    dialogOpen: true,
    trustEvents: [false, false],
    runnerStarts: 0,
    unsent: 0,
    clicks: 0,
  });
  await trustedClick(
    webContents,
    `document.querySelector('#insta-toolbox-userscript-root').shadowRoot.querySelector('[data-action="confirm-accept"]')`,
    'userscript Unsend confirmation',
  );
  const confirmedUnsend = await waitForPageValue(
    webContents,
    `(() => {
      const snapshot = globalThis.InstaToolboxDmThreadUnsender?.snapshot?.();
      if (snapshot?.status !== 'completed' || globalThis.fixtureUnsentCount !== 1) return null;
      const shadow = document.querySelector('#insta-toolbox-userscript-root')?.shadowRoot;
      return {
        nativeConfirmCalls: globalThis.fixtureNativeConfirmCalls,
        runnerStarts: globalThis.fixtureDmRunnerStarts,
        processed: snapshot.processed,
        failed: snapshot.failed,
        confirmationTrusted: globalThis.fixtureUserscriptConfirmationTrustEvents.at(-1),
        status: shadow?.querySelector('[data-role="context-detail"]')?.textContent,
      };
    })()`,
    'userscript confirmed thread Unsend',
  );
  assert.equal(confirmedUnsend.nativeConfirmCalls, 0);
  assert.equal(confirmedUnsend.runnerStarts, 1);
  assert.equal(confirmedUnsend.processed, 1);
  assert.equal(confirmedUnsend.failed, 0);
  assert.equal(confirmedUnsend.confirmationTrusted, true);
  assert.equal(confirmedUnsend.status, 'Done. 1 message unsent.');

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
      const shadow = document.querySelector('#insta-toolbox-userscript-root')?.shadowRoot;
      const resultNode = shadow?.querySelector('[data-role="dm-result"]');
      const list = shadow?.querySelector('[data-role="message-list"]');
      const listText = list?.textContent || '';
      const stored = globalThis.fixtureGmStore.instaToolboxUserscriptStateV2;
      return resultNode?.hidden
        && list?.hidden
        ? {
          cleared: stored.messageEvidence === null
            && stored.dmCheck === null
            && stored.sentDms.length === 0
            && stored.sentDmsComplete === false,
          result: resultNode.textContent,
          rows: list.querySelectorAll('li').length,
          leaked: listText.includes('Yes — reviewing it now.'),
        }
        : null;
    })()`,
    'userscript DM evidence route binding',
  );
  assert.equal(routedAway.cleared, true);
  assert.equal(routedAway.rows, 0);
  assert.equal(routedAway.leaked, false);

  const inboxEvidence = await webContents.executeJavaScript(`(() => {
    const shadow = document.querySelector('#insta-toolbox-userscript-root').shadowRoot;
    shadow.querySelector('[data-action="read-messages"]').click();
    return globalThis.fixtureGmStore.instaToolboxUserscriptStateV2.messageEvidence;
  })()`, true);
  assert.equal(inboxEvidence.threadId, '');
  assert.equal(inboxEvidence.fragments.length, 0);
  assert.match(inboxEvidence.reason, /Open an Instagram conversation first/);
  console.log('Accepted the movable Tampermonkey toolbox, trusted-input confirmation with synthetic-click rejection, local follower comparison, account/DM no-click checks, and fixture Unsend.');
}

async function acceptBackgroundComparison({ window, isolatedSession }) {
  const requests = [];
  await isolatedSession.protocol.handle('http', () => new Response('', { status: 403 }));
  await isolatedSession.protocol.handle('https', async (request) => {
    const url = new URL(request.url);
    if (url.origin !== 'https://www.instagram.com') return new Response('', { status: 403 });
    if (url.pathname.startsWith('/api/')) {
      requests.push(url.pathname);
      return new Response('No background API requests expected', { status: 500 });
    }
    const target = fixtureAssets.get(url.pathname);
    if (!target) return new Response('', { status: 404 });
    return new Response(await readFile(target), { headers: {
      'Content-Type': target.endsWith('.html') ? 'text/html' : 'text/javascript',
      'Content-Security-Policy': "default-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src data:; connect-src 'self'",
    } });
  });
  try {
    for (const userscript of [false, true]) {
      requests.length = 0;
      const webContents = window.webContents;
      const host = userscript ? '#insta-toolbox-userscript-root' : '#insta-toolbox-sidecar-root';
      const root = "document.querySelector('" + host + "').shadowRoot";
      const button = userscript ? '[data-action="check-account-relationships"]' : '[data-insta-toolbox-action="check-account-relationships"]';
      const input = userscript ? '[data-role="checker-username"]' : '[data-insta-toolbox-role="checker-username"]';
      const result = userscript ? '[data-role="comparison"]' : '[data-insta-toolbox-role="checker-result"]';
      const surface = userscript ? 'userscript' : 'extension';
      await webContents.loadURL('https://www.instagram.com/' + (userscript ? 'userscript-fixture.html' : 'fixture.html?mode=qa-profile-following&shadow=open'));
      await waitForPageValue(webContents, "Boolean(document.querySelector('" + host + "')?.shadowRoot)", surface + ' guided fixture');
      const setup = () => {
        document.querySelectorAll('[role="dialog"]').forEach(node => node.remove());
        history.replaceState({}, '', '/demo_creator/');
        const header = document.querySelector('header');
        header.querySelector('h1, h2').textContent = 'demo_creator';
        globalThis.guidedClicks = [];
        globalThis.guidedInterrupt = false;
        globalThis.guidedUnavailable = false;
        globalThis.guidedStalled = false;
        for (const type of ['followers', 'following']) {
          const link = document.createElement('a');
          link.setAttribute('role', 'link');
          link.href = '#';
          link.textContent = '45 ' + type;
          link.onclick = event => {
            event.preventDefault();
            globalThis.guidedClicks.push('open:' + type);
            const dialog = document.createElement('div');
            dialog.setAttribute('role', 'dialog');
            const title = document.createElement('h2');
            title.textContent = type === 'followers' ? 'Followers' : 'Following';
            const close = document.createElement('button');
            close.textContent = 'Close';
            close.onclick = () => { globalThis.guidedClicks.push('close:' + type); dialog.remove(); };
            const scroll = document.createElement('div');
            scroll.style.cssText = 'height:200px;overflow-y:auto;position:relative';
            const spacer = document.createElement('div');
            spacer.style.cssText = 'height:1800px;position:relative';
            scroll.append(spacer);
            const render = () => {
              spacer.replaceChildren();
              if (globalThis.guidedUnavailable) {
                const empty = document.createElement('span');
                empty.textContent = "You'll see all the people who follow you here.";
                spacer.append(empty);
                return;
              }
              const first = Math.max(0, Math.floor(scroll.scrollTop / 40) - 1);
              for (let i = first; i < Math.min(45, first + 7); i += 1) {
                const row = document.createElement('a');
                row.href = '/fixture_person' + i + '/';
                row.textContent = 'fixture_person' + i;
                row.style.cssText = 'position:absolute;left:0;height:40px;top:' + (i * 40) + 'px';
                spacer.append(row);
              }
            };
            scroll.addEventListener('scroll', render);
            render();
            const hiddenLoader = document.createElement('div');
            hiddenLoader.setAttribute('role', 'progressbar');
            hiddenLoader.style.display = 'none';
            const visibleLoader = document.createElement('div');
            visibleLoader.setAttribute('role', 'progressbar');
            visibleLoader.style.cssText = 'position:sticky;top:0;width:24px;height:24px';
            const recommendations = document.createElement('section');
            const suggestionTitle = document.createElement('span');
            suggestionTitle.textContent = 'Suggested for you';
            recommendations.append(suggestionTitle);
            for (let i = 0; i < 30; i += 1) {
              const suggestion = document.createElement('a');
              suggestion.href = '/fixture_suggestion' + i + '/';
              suggestion.textContent = 'fixture_suggestion' + i;
              recommendations.append(suggestion);
            }
            dialog.append(title, close, hiddenLoader, recommendations);
            document.body.append(dialog);
            if (globalThis.guidedUnavailable) {
              dialog.insertBefore(scroll, recommendations);
            } else {
              dialog.insertBefore(visibleLoader, recommendations);
              // The native dialog shell appears before the list, and its first
              // hidden indicator must not conceal a later visible loader.
              setTimeout(() => {
                if (!dialog.isConnected) return;
                scroll.prepend(visibleLoader);
                dialog.insertBefore(scroll, recommendations);
                render();
                if (!globalThis.guidedStalled) setTimeout(() => visibleLoader.remove(), 800);
              }, 900);
            }
            if (globalThis.guidedInterrupt) {
              const notice = document.createElement('p');
              notice.textContent = 'Please wait a few minutes';
              document.body.append(notice);
            }
          };
          header.append(link);
        }
      };
      await webContents.executeJavaScript('(' + setup.toString() + ')()', true);
      await webContents.executeJavaScript("(() => {const shadow = " + root + ";" +
        (userscript ? '' : "shadow.querySelector('.insta-toolbox-launcher').click(); shadow.querySelector('[data-insta-toolbox-section=\"capture\"]').click();") +
        "shadow.querySelector('" + input + "').value = 'demo_creator'; shadow.querySelector('" + button + "').click();})()", true);
      try {
        await waitForPageValue(webContents, "(" + root + ").querySelector('" + result + "').textContent.includes('Scanned-list comparison')", surface + ' guided comparison', 45_000);
      } catch (error) {
        console.error(await webContents.executeJavaScript("({result:(" + root + ").querySelector('" + result + "').textContent,clicks:globalThis.guidedClicks})", true));
        throw error;
      }
      const before = await webContents.executeJavaScript("({result:(" + root + ").querySelector('" + result + "').textContent,dialogs:document.querySelectorAll('[role=\"dialog\"]').length,clicks:globalThis.guidedClicks,notice:(" + root + ").textContent.includes('leave this tab open and untouched')})", true);
      assert.equal(before.dialogs, 0);
      assert.deepEqual(before.clicks, ['open:followers', 'close:followers', 'open:following', 'close:following']);
      assert.equal(before.notice, true);
      assert.match(before.result, /45/);
      assert.deepEqual(requests, [], 'only native list navigation, no direct API reader');
      await webContents.executeJavaScript("globalThis.guidedUnavailable=true; (" + root + ").querySelector('" + button + "').click()", true);
      await waitForPageValue(webContents, "(" + root + ").textContent.includes('Instagram did not load your followers')", surface + ' unavailable native list');
      assert.equal(await webContents.executeJavaScript("(" + root + ").querySelector('" + result + "').textContent", true), before.result);
      assert.deepEqual(await webContents.executeJavaScript('globalThis.guidedClicks', true), [...before.clicks, 'open:followers']);
      await webContents.executeJavaScript("document.querySelector('[role=dialog]').remove(); globalThis.guidedUnavailable=false; globalThis.guidedClicks=" + JSON.stringify(before.clicks), true);
      await webContents.executeJavaScript("globalThis.guidedStalled=true; (" + root + ").querySelector('" + button + "').click()", true);
      await waitForPageValue(webContents, "(" + root + ").textContent.includes('Instagram stopped loading your followers')", surface + ' stalled native loader', 15_000);
      assert.equal(await webContents.executeJavaScript("(" + root + ").querySelector('" + result + "').textContent", true), before.result);
      assert.deepEqual(await webContents.executeJavaScript('globalThis.guidedClicks', true), [...before.clicks, 'open:followers']);
      await webContents.executeJavaScript("document.querySelector('[role=dialog]').remove(); globalThis.guidedStalled=false; globalThis.guidedClicks=" + JSON.stringify(before.clicks), true);
      await webContents.executeJavaScript("globalThis.guidedInterrupt=true; (" + root + ").querySelector('" + button + "').click()", true);
      await waitForPageValue(webContents, "(" + root + ").querySelector('" + button + "').textContent.includes('Check Followers')", surface + ' interrupted guided capture');
      assert.equal(await webContents.executeJavaScript("(" + root + ").querySelector('" + result + "').textContent", true), before.result);
      assert.deepEqual(await webContents.executeJavaScript('globalThis.guidedClicks', true), [...before.clicks, 'open:followers']);
      console.log('Accepted ' + surface + ' guided primary-button flow: delayed initial rows, hidden-first loaders, 45 recycled rows per list, 30 suggestions excluded, exact open/close order, zero API calls, and saved-comparison preservation on unavailable, stalled, or interrupted lists.');
    }
  } finally {
    window.destroy();
    isolatedSession.protocol.unhandle('https');
    isolatedSession.protocol.unhandle('http');
  }
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
    globalLiveUnlocks: Boolean(
      document.querySelector('#live-action-enabled')
      || document.querySelector('#live-dm-enabled'),
    ),
  })`, true);
  assert.deepEqual(defaults, { actionPermission: false, globalLiveUnlocks: false });
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
  const overlay = createIsolatedWindow(`insta-toolbox-extension-acceptance-${process.pid}`);
  const pwa = createIsolatedWindow(`insta-toolbox-pwa-installability-${process.pid}`);
  const background = createIsolatedWindow(`insta-toolbox-background-comparison-${process.pid}`);
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
    await acceptIncompleteComparison(overlay.window.webContents, overlayBaseUrl);
    await acceptOverlayDmConfirmation(overlay.window.webContents, overlayBaseUrl);
    await acceptThreadUnsendScopes(overlay.window.webContents, overlayBaseUrl);
    await acceptThreadUnsendStop(overlay.window.webContents, overlayBaseUrl);
    await acceptThreadUnsend(overlay.window.webContents, overlayBaseUrl);
    await acceptToolboxLayout(overlay.window.webContents, overlayBaseUrl);
    await acceptUserscriptToolbox(overlay.window.webContents, overlayBaseUrl);
    await acceptBackgroundComparison(background);
    await acceptPwaInstallability(pwa.window.webContents, pwaBaseUrl);
    assert.deepEqual(overlay.problems, [], 'extension fixture browser problems');
    assert.deepEqual(pwa.problems, [], 'PWA installability browser problems');
  } catch (error) {
    exitCode = 1;
    console.error(error?.stack || error);
    if (overlay.problems.length) console.error(`Overlay fixture problems:\n${overlay.problems.join('\n')}`);
    if (pwa.problems.length) console.error(`PWA fixture problems:\n${pwa.problems.join('\n')}`);
  } finally {
    if (!overlay.window.isDestroyed()) overlay.window.destroy();
    if (!pwa.window.isDestroyed()) pwa.window.destroy();
    if (!background.window.isDestroyed()) background.window.destroy();
    await overlay.isolatedSession.clearStorageData();
    await pwa.isolatedSession.clearStorageData();
    await background.isolatedSession.clearStorageData();
    await close(overlayServer);
    await close(pwaServer);
    app.exit(exitCode);
  }
}

const readinessTimeoutMs = 60_000;
const readinessTimer = setTimeout(() => {
  console.error(`Extension acceptance readiness timed out after ${readinessTimeoutMs / 1_000} seconds.`);
  app.exit(1);
}, readinessTimeoutMs);
app.whenReady().then(() => {
  clearTimeout(readinessTimer);
  return run();
});

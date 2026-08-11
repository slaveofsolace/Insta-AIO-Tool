import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { app, BrowserWindow, nativeImage, session } from 'electron';

import { overlayQaScenarios, viewports } from './overlay-qa-scenarios.mjs';

const viewTitles = Object.freeze({
  capture: 'Follower checker',
  messages: 'DM Unsend',
  now: 'Instagram tools',
  queue: 'Follow / Unfollow',
  workspace: 'Workspace',
});

const update = process.argv.includes('--update');
const check = process.argv.includes('--check');
if (update === check) throw new Error('Choose exactly one overlay QA mode: --update or --check.');

const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(moduleDirectory, '..');
const builtExtensionRoot = path.join(repositoryRoot, 'dist', 'extension');
const fixturePath = path.join(repositoryRoot, 'tests', 'fixtures', 'overlay-preview.html');
const resultsRoot = path.resolve(repositoryRoot, 'test-results', 'overlay-qa');
const actualRoot = path.join(resultsRoot, 'actual', process.platform);
const evidenceRoot = path.join(
  repositoryRoot,
  'docs',
  'evidence',
  'overlay-ui-2026-08-02',
  'after',
  process.platform,
);
const manifestPath = path.join(evidenceRoot, 'manifest.json');
const fidelityPath = path.join(evidenceRoot, 'fidelity-ledger.json');
const runnerLogPath = path.join(resultsRoot, 'runner.log');
const rasterProblems = [];
const userDataRoot = path.resolve(
  process.env.INSTA_AIO_OVERLAY_QA_USER_DATA
    || path.join(resultsRoot, 'user-data', String(process.pid)),
);

if (!userDataRoot.startsWith(`${resultsRoot}${path.sep}`)) {
  throw new Error('Overlay QA user data must stay inside test-results/overlay-qa.');
}
if (!evidenceRoot.startsWith(`${repositoryRoot}${path.sep}`)) {
  throw new Error('Overlay QA evidence must stay inside the repository.');
}

const builtManifest = JSON.parse(await readFile(
  path.join(builtExtensionRoot, 'manifest.json'),
  'utf8',
));
const instagramEntry = builtManifest.content_scripts?.find((entry) => (
  entry.matches?.includes('https://www.instagram.com/*')
));
assert.ok(instagramEntry?.js?.length, 'Built extension has no Instagram content-script graph.');
const allowedAssets = new Map(instagramEntry.js.map((file) => [
  `/extension/${file}`,
  path.join(builtExtensionRoot, ...file.split('/')),
]));
allowedAssets.set('/fixture.html', fixturePath);

mkdirSync(userDataRoot, { recursive: true });
mkdirSync(actualRoot, { recursive: true });
writeFileSync(runnerLogPath, '', 'utf8');
app.disableHardwareAcceleration();
app.commandLine.appendSwitch('force-device-scale-factor', '1');
app.setPath('userData', userDataRoot);
app.on('window-all-closed', () => {});

function report(message) {
  const line = String(message);
  console.log(line);
  appendFileSync(runnerLogPath, `${line}\n`, 'utf8');
}

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

function rasterDifference(actualPng, expectedPng) {
  const actual = nativeImage.createFromBuffer(actualPng);
  const expected = nativeImage.createFromBuffer(expectedPng);
  assert.deepEqual(actual.getSize(), expected.getSize(), 'overlay screenshot dimensions changed');
  const actualBitmap = actual.toBitmap();
  const expectedBitmap = expected.toBitmap();
  assert.equal(actualBitmap.length, expectedBitmap.length, 'overlay screenshot bitmap length changed');
  let changedPixels = 0;
  let maxChannelDifference = 0;
  for (let offset = 0; offset < actualBitmap.length; offset += 4) {
    let pixelChanged = false;
    for (let channel = 0; channel < 4; channel += 1) {
      const difference = Math.abs(actualBitmap[offset + channel] - expectedBitmap[offset + channel]);
      if (difference > 0) pixelChanged = true;
      if (difference > maxChannelDifference) maxChannelDifference = difference;
    }
    if (pixelChanged) changedPixels += 1;
  }
  const totalPixels = actualBitmap.length / 4;
  return {
    changedPixelRatio: changedPixels / totalPixels,
    changedPixels,
    maxChannelDifference,
    totalPixels,
  };
}

function acceptableRasterDifference(difference) {
  // Native Windows text and scrollbar rasterization varies slightly between
  // otherwise identical hidden Electron sessions, not only on CI runners. Use
  // the same measured Windows cap locally so update -> check is reproducible;
  // semantics, geometry, accessibility, collision, and performance remain
  // exact and are evaluated before this pixel-only allowance.
  if (process.platform === 'win32') {
    // GitHub's Windows Server 2025 image produced 1,327 anti-aliased
    // text/scrollbar pixels on an otherwise identical reviewed capture.
    return difference.changedPixels <= 1_500
      && difference.changedPixelRatio <= 0.004;
  }
  return difference.changedPixels <= 4 && difference.maxChannelDifference <= 1;
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
    const target = allowedAssets.get(url.pathname);
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
          "script-src 'self' 'nonce-insta-aio-overlay-qa'",
          "style-src 'self' 'unsafe-inline'",
          "img-src 'self' data: blob:",
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

function isLoopbackFixtureUrl(value) {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(parsed.hostname);
  } catch {
    return false;
  }
}

async function waitForValue(webContents, expression, label, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await webContents.executeJavaScript(expression, true);
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
  throw new Error(`Timed out waiting for ${label}.`);
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
  if (details.level === 'warning' || details.level === 'error' || Number(details.level) >= 2) {
    problems.push(`${String(details.level)}: ${details.message || ''}`);
  }
}

function scenarioUrl(baseUrl, scenario) {
  const parameters = new URLSearchParams({
    density: scenario.density,
    dock: scenario.dock,
    mode: scenario.mode,
    open: String(scenario.open),
    pairing: scenario.pairing,
    queue: scenario.queue,
    section: scenario.section,
    shadow: 'open',
    theme: scenario.theme,
    width: scenario.width,
  });
  if (scenario.layout === 'floating') {
    parameters.set('layout', 'floating');
    parameters.set('opacity', String(scenario.opacity));
    parameters.set('panelHeight', String(scenario.panelHeight));
    parameters.set('panelWidth', String(scenario.panelWidth));
    parameters.set('positionX', String(scenario.position.x));
    parameters.set('positionY', String(scenario.position.y));
  }
  return `${baseUrl}/fixture.html?${parameters}`;
}

async function applyAfterState(webContents, scenario) {
  if (scenario.after === 'capture-visible' || scenario.after === 'inspect-messages') {
    const action = scenario.after;
    await webContents.executeJavaScript(`(() => {
      const shadow = document.querySelector('#insta-aio-sidecar-root').shadowRoot;
      const captureListType = ${JSON.stringify(scenario.captureListType)};
      if (${JSON.stringify(action)} === 'capture-visible' && captureListType) {
        const listType = shadow.querySelector('[data-ia-role="manual-list-type"]');
        if (!listType) throw new Error('Capture list-type control is missing.');
        listType.value = captureListType;
        listType.dispatchEvent(new Event('change', { bubbles: true }));
      }
      const control = shadow.querySelector('[data-ia-action=${JSON.stringify(action)}]');
      if (!control) throw new Error(${JSON.stringify(`${scenario.id}: ${action} control is missing`)});
      control.click();
    })()`, true);
    const role = action === 'capture-visible' ? 'capture-count' : 'message-count';
    await waitForValue(
      webContents,
      `Number(document.querySelector('#insta-aio-sidecar-root').shadowRoot.querySelector('[data-ia-role="${role}"]').textContent) > 0`,
      `${scenario.id}: ${action}`,
    );
  }
  if (scenario.after === 'bot-review') {
    await webContents.executeJavaScript(`(() => {
      const shadow = document.querySelector('#insta-aio-sidecar-root').shadowRoot;
      const disclosure = shadow.querySelector('[data-ia-role="bot-disclosure"]');
      const source = shadow.querySelector('[data-ia-role="bot-source"]');
      const control = shadow.querySelector('[data-ia-action="bot-review"]');
      if (!disclosure || !source || !control) throw new Error('Follow / Unfollow review controls are missing.');
      disclosure.open = true;
      source.value = 'queue';
      source.dispatchEvent(new Event('change', { bubbles: true }));
      control.click();
    })()`, true);
    await waitForValue(
      webContents,
      `document.querySelector('#insta-aio-sidecar-root').shadowRoot.querySelector('[data-ia-role="bot-review"]')?.hidden === false`,
      `${scenario.id}: read-only target review`,
    );
  }
  if (scenario.after === 'wait-account-expired') {
    await waitForValue(
      webContents,
      `document.querySelector('#insta-aio-sidecar-root').shadowRoot.querySelector('[data-ia-role="live-badge"]').textContent === 'expired'`,
      `${scenario.id}: immutable arm expiry`,
      5_000,
    );
  }
}

async function inspectScenario(webContents, scenario) {
  const semanticSelectors = scenario.semantics.map(({ selector }) => selector);
  return webContents.executeJavaScript(`(() => {
    const host = document.querySelector('#insta-aio-sidecar-root');
    const shadow = host.shadowRoot;
    const panel = shadow.querySelector('.ia-panel');
    const strip = shadow.querySelector('[data-ia-role="collision-strip"]');
    const launcher = shadow.querySelector('.ia-launcher');
    const selected = shadow.querySelector('[data-ia-view="${scenario.section}"]');
    const scroller = shadow.querySelector('.ia-scroll');
    const header = shadow.querySelector('.ia-header');
    const headerActions = shadow.querySelector('.ia-header-actions');
    const headerCopy = shadow.querySelector('.ia-header-copy');
    const footer = shadow.querySelector('[data-ia-role="status"]');
    const target = ${JSON.stringify(scenario.targetSelector)}
      ? document.querySelector(${JSON.stringify(scenario.targetSelector)})
      : null;
    const visible = (element) => {
      if (!element || element.hidden) return false;
      const style = getComputedStyle(element);
      const rectangle = element.getBoundingClientRect();
      return style.display !== 'none' && style.visibility !== 'hidden'
        && rectangle.width > 0 && rectangle.height > 0;
    };
    const rect = (element) => {
      if (!visible(element)) return null;
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
    const intersects = (first, second) => Boolean(
      first && second
      && first.left < second.right
      && first.right > second.left
      && first.top < second.bottom
      && first.bottom > second.top
    );
    const presentation = ${JSON.stringify(scenario.presentation)} === 'strip'
      ? strip
      : ${JSON.stringify(scenario.presentation)} === 'launcher'
        ? launcher
        : panel;
    const presentationRect = rect(presentation);
    const targetRect = rect(target);
    const semanticSelectors = ${JSON.stringify(semanticSelectors)};
    const colorChannels = (value) => {
      const match = String(value || '').match(/rgba?\\(([^)]+)\\)/i);
      if (!match) return null;
      const values = match[1].split(/[\\s,\\/]+/).filter(Boolean).map(Number);
      if (values.length < 3 || values.slice(0, 3).some((channel) => !Number.isFinite(channel))) return null;
      return { alpha: Number.isFinite(values[3]) ? values[3] : 1, channels: values.slice(0, 3) };
    };
    const luminance = (channels) => channels
      .map((channel) => channel / 255)
      .map((channel) => (channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4))
      .reduce((total, channel, index) => total + channel * [.2126, .7152, .0722][index], 0);
    const contrast = (foreground, background) => {
      const first = colorChannels(foreground);
      const second = colorChannels(background);
      if (!first || !second || first.alpha < .99 || second.alpha < .99) return null;
      const light = Math.max(luminance(first.channels), luminance(second.channels));
      const dark = Math.min(luminance(first.channels), luminance(second.channels));
      return (light + .05) / (dark + .05);
    };
    const semantics = Object.fromEntries(semanticSelectors.map((selector) => {
      const element = shadow.querySelector(selector);
      const style = element ? getComputedStyle(element) : null;
      const foreground = style?.webkitTextFillColor || style?.color || '';
      return [selector, {
        attributes: element
          ? Object.fromEntries([...element.attributes].map((attribute) => [attribute.name, attribute.value]))
          : {},
        disabled: element && 'disabled' in element ? Boolean(element.disabled) : null,
        exists: Boolean(element),
        hidden: element ? Boolean(element.hidden) : null,
        backgroundColor: style?.backgroundColor || '',
        color: style?.color || '',
        textContrast: style ? contrast(foreground, style.backgroundColor) : null,
        textFillColor: style?.webkitTextFillColor || '',
        text: element ? String(element.textContent || '').replace(/\\s+/g, ' ').trim() : '',
        tone: element?.dataset?.tone || null,
        visible: visible(element),
      }];
    }));
    const touchTargets = [...shadow.querySelectorAll(
      '.ia-launcher, .ia-tab, .ia-icon-button, .ia-button, .ia-link-button, .ia-settings summary, .ia-select, .ia-text-input',
    )].filter(visible).filter((element) => !element.closest('.ia-collision-strip')).map((element) => {
      const value = element.getBoundingClientRect();
      return { height: value.height, label: element.getAttribute('aria-label') || element.textContent.trim(), width: value.width };
    });
    return {
      activeElementSection: shadow.activeElement?.dataset?.iaSection || null,
      adaptiveDock: host.dataset.adaptiveDock || null,
      adaptiveWidth: host.dataset.adaptiveWidth || null,
      bodyWidth: document.body.scrollWidth,
      collision: host.dataset.collision,
      collisionPlacement: host.dataset.collisionPlacement || null,
      documentWidth: document.documentElement.scrollWidth,
      dock: host.dataset.dock,
      footer: rect(footer),
      header: rect(header),
      headerSizing: {
        actions: { client: headerActions?.clientWidth || 0, rect: rect(headerActions), scroll: headerActions?.scrollWidth || 0 },
        copy: { client: headerCopy?.clientWidth || 0, rect: rect(headerCopy), scroll: headerCopy?.scrollWidth || 0 },
        header: { client: header?.clientWidth || 0, scroll: header?.scrollWidth || 0 },
      },
      innerHeight,
      innerWidth,
      layout: host.dataset.layout,
      launcher: rect(launcher),
      opacity: host.style.getPropertyValue('--ia-panel-alpha'),
      overflowing: [...panel.querySelectorAll('*')]
        .filter((element) => element.scrollWidth - element.clientWidth > 1)
        .slice(0, 10)
        .map((element) => ({
          className: element.className || null,
          overflow: element.scrollWidth - element.clientWidth,
          role: element.dataset?.iaRole || null,
          tagName: element.tagName,
        })),
      panel: rect(panel),
      panelAreaShare: presentationRect
        ? (presentationRect.width * presentationRect.height) / (innerWidth * innerHeight)
        : 0,
      panelHorizontalOverflow: panel ? panel.scrollWidth - panel.clientWidth : 0,
      presentation: rect(presentation),
      presentationIntersectsTarget: intersects(presentationRect, targetRect),
      scrollerHorizontalOverflow: scroller ? scroller.scrollWidth - scroller.clientWidth : 0,
      selectedHidden: selected?.hidden ?? true,
      selectedHorizontalOverflow: selected ? selected.scrollWidth - selected.clientWidth : 0,
      semantics,
      status: footer?.textContent.trim() || '',
      strip: rect(strip),
      target: targetRect,
      theme: host.dataset.theme,
      touchTargets,
      viewTitle: shadow.querySelector('[data-ia-role="view-title"]')?.textContent || '',
      width: host.dataset.width,
    };
  })()`, true);
}

function assertScenario(metrics, scenario) {
  assert.ok(metrics.presentation, `${scenario.id}: expected ${scenario.presentation} is not visible`);
  assert.equal(metrics.theme, scenario.theme, `${scenario.id}: theme mismatch`);
  assert.equal(metrics.viewTitle, viewTitles[scenario.section], `${scenario.id}: selected view title mismatch`);
  assert.ok(
    metrics.documentWidth <= metrics.innerWidth + 1,
    `${scenario.id}: document overflows ${metrics.documentWidth}px into ${metrics.innerWidth}px`,
  );
  assert.ok(
    metrics.bodyWidth <= metrics.innerWidth + 1,
    `${scenario.id}: body overflows ${metrics.bodyWidth}px into ${metrics.innerWidth}px`,
  );
    assert.ok(
      metrics.panelHorizontalOverflow <= 1,
      `${scenario.id}: panel has horizontal overflow; ${JSON.stringify({ overflowing: metrics.overflowing, headerSizing: metrics.headerSizing })}`,
    );
  assert.ok(metrics.scrollerHorizontalOverflow <= 1, `${scenario.id}: scroller has horizontal overflow`);
  assert.ok(metrics.selectedHorizontalOverflow <= 1, `${scenario.id}: selected view has horizontal overflow`);
  assert.equal(
    metrics.presentationIntersectsTarget,
    false,
    `${scenario.id}: overlay presentation intersects its reviewed native target; ${JSON.stringify({
      adaptiveDock: metrics.adaptiveDock,
      adaptiveWidth: metrics.adaptiveWidth,
      dock: metrics.dock,
      presentation: metrics.presentation,
      target: metrics.target,
      width: metrics.width,
    })}`,
  );
  if (scenario.targetSelector) assert.ok(metrics.target, `${scenario.id}: target fixture is missing`);
  if (scenario.presentation === 'panel') {
    assert.equal(metrics.selectedHidden, false, `${scenario.id}: requested tool view is hidden`);
    assert.ok(metrics.header && metrics.footer, `${scenario.id}: panel chrome is incomplete`);
    assert.ok(metrics.panelAreaShare <= 0.86, `${scenario.id}: panel consumes too much viewport area`);
    for (const target of metrics.touchTargets) {
      assert.ok(target.height >= 43, `${scenario.id}: short touch target ${target.label} (${target.height}px)`);
      assert.ok(target.width >= 43, `${scenario.id}: narrow touch target ${target.label} (${target.width}px)`);
    }
  }
  if (scenario.layout === 'floating') {
    assert.equal(metrics.layout, 'floating', `${scenario.id}: floating layout was not applied`);
    assert.equal(metrics.opacity, `${Math.round(scenario.opacity * 100)}%`, `${scenario.id}: opacity mismatch`);
    assert.ok(Math.abs(metrics.panel.left - scenario.position.x) <= 1, `${scenario.id}: panel x position mismatch`);
    assert.ok(Math.abs(metrics.panel.top - scenario.position.y) <= 1, `${scenario.id}: panel y position mismatch`);
    assert.ok(Math.abs(metrics.panel.width - scenario.panelWidth) <= 1, `${scenario.id}: panel width mismatch`);
    assert.ok(Math.abs(metrics.panel.height - scenario.panelHeight) <= 1, `${scenario.id}: panel height mismatch`);
  }
  if (scenario.presentation === 'strip') {
    assert.equal(metrics.collision, 'active', `${scenario.id}: collision mode is not active`);
    assert.equal(metrics.collisionPlacement, 'safe', `${scenario.id}: status strip has no safe placement`);
  }
  if (scenario.presentation === 'launcher') {
    assert.equal(metrics.launcher.width, 44, `${scenario.id}: launcher width changed`);
    assert.equal(metrics.launcher.height, 44, `${scenario.id}: launcher height changed`);
  }
  for (const expectation of scenario.semantics) {
    const actual = metrics.semantics[expectation.selector];
    assert.ok(actual?.exists, `${scenario.id}: semantic target is missing: ${expectation.selector}`);
    if (Object.hasOwn(expectation, 'equals')) {
      assert.equal(actual.text, expectation.equals, `${scenario.id}: semantic text mismatch: ${expectation.selector}`);
    }
    for (const fragment of expectation.includes || []) {
      assert.ok(
        actual.text.includes(fragment),
        `${scenario.id}: ${expectation.selector} is missing semantic text ${JSON.stringify(fragment)}`,
      );
    }
    for (const fragment of expectation.excludes || []) {
      assert.equal(
        actual.text.includes(fragment),
        false,
        `${scenario.id}: ${expectation.selector} contains forbidden semantic text ${JSON.stringify(fragment)}`,
      );
    }
    if (Object.hasOwn(expectation, 'numberEquals')) {
      assert.equal(
        Number(actual.text),
        expectation.numberEquals,
        `${scenario.id}: semantic count mismatch: ${expectation.selector}`,
      );
    }
    if (Object.hasOwn(expectation, 'disabled')) {
      assert.equal(actual.disabled, expectation.disabled, `${scenario.id}: disabled state mismatch: ${expectation.selector}`);
    }
    if (Object.hasOwn(expectation, 'hidden')) {
      assert.equal(actual.hidden, expectation.hidden, `${scenario.id}: hidden state mismatch: ${expectation.selector}`);
    }
    if (Object.hasOwn(expectation, 'visible')) {
      assert.equal(actual.visible, expectation.visible, `${scenario.id}: visibility mismatch: ${expectation.selector}`);
    }
    if (Object.hasOwn(expectation, 'tone')) {
      assert.equal(actual.tone, expectation.tone, `${scenario.id}: tone mismatch: ${expectation.selector}`);
    }
    if (Object.hasOwn(expectation, 'minContrast')) {
      assert.ok(
        Number(actual.textContrast) >= expectation.minContrast,
        `${scenario.id}: ${expectation.selector} text contrast ${String(actual.textContrast)} is below ${expectation.minContrast}; ${JSON.stringify({
          backgroundColor: actual.backgroundColor,
          color: actual.color,
          textFillColor: actual.textFillColor,
        })}`,
      );
    }
    for (const [name, value] of Object.entries(expectation.attributes || {})) {
      if (value === null) {
        assert.equal(
          Object.hasOwn(actual.attributes, name),
          false,
          `${scenario.id}: ${expectation.selector} unexpectedly has attribute ${name}`,
        );
      } else {
        assert.equal(
          actual.attributes[name],
          value,
          `${scenario.id}: ${expectation.selector} attribute mismatch: ${name}`,
        );
      }
    }
  }
}

async function accessibilitySmoke(webContents, scenario) {
  if (!['profile-following-queue-match', 'profile-mobile-portrait'].includes(scenario.id)) return;
  if (!webContents.debugger.isAttached()) webContents.debugger.attach('1.3');
  await withTimeout(
    webContents.debugger.sendCommand('Accessibility.enable'),
    `${scenario.id}: accessibility domain`,
    5_000,
  );
  const tree = await withTimeout(
    webContents.debugger.sendCommand('Accessibility.getFullAXTree'),
    `${scenario.id}: accessibility tree`,
    5_000,
  );
  const names = new Set((tree.nodes || []).map((node) => node.name?.value).filter(Boolean));
  for (const expected of [
    'Insta AIO Instagram sidecar',
    'Toolbox',
    'Follower checker',
    'Follow / Unfollow',
    'DM Unsend',
    'Workspace',
  ]) {
    assert.equal(names.has(expected), true, `${scenario.id}: accessibility tree is missing ${expected}`);
  }
}

async function captureScenario(browserWindow, baseUrl, scenario, expectedManifest) {
  const { webContents } = browserWindow;
  const viewport = viewports[scenario.viewport];
  browserWindow.setContentSize(viewport.width, viewport.height);
  webContents.setZoomFactor(scenario.zoom);
  await withTimeout(
    webContents.debugger.sendCommand('Emulation.setEmulatedMedia', {
      media: 'screen',
      features: [
        { name: 'prefers-reduced-motion', value: 'reduce' },
        { name: 'prefers-color-scheme', value: scenario.theme === 'dark' ? 'dark' : 'light' },
        { name: 'forced-colors', value: scenario.forcedColors ? 'active' : 'none' },
      ],
    }),
    `${scenario.id}: media emulation`,
    5_000,
  );
  await withTimeout(webContents.loadURL(scenarioUrl(baseUrl, scenario)), `${scenario.id}: fixture load`);
  await waitForValue(
    webContents,
    `Boolean(document.querySelector('#insta-aio-sidecar-root')?.shadowRoot
      && document.querySelector('#insta-aio-sidecar-root').shadowRoot.querySelector('[data-ia-role="status-text"]')?.textContent.includes('Inspection ready'))`,
    `${scenario.id}: production overlay initialization`,
  );
  await applyAfterState(webContents, scenario);
  const presentationSelector = scenario.presentation === 'strip'
    ? '[data-ia-role="collision-strip"]'
    : scenario.presentation === 'launcher'
      ? '.ia-launcher'
      : '.ia-panel';
  await waitForValue(
    webContents,
    `(() => {
      const element = document.querySelector('#insta-aio-sidecar-root').shadowRoot.querySelector(${JSON.stringify(presentationSelector)});
      if (!element || element.hidden) return false;
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.display !== 'none' && rect.width > 0 && rect.height > 0;
    })()`,
    `${scenario.id}: ${scenario.presentation} presentation`,
  );
  await waitForPaint(webContents, scenario.id);
  const metrics = await inspectScenario(webContents, scenario);
  assertScenario(metrics, scenario);
  await accessibilitySmoke(webContents, scenario);
  webContents.invalidate();
  await waitForPaint(webContents, `${scenario.id}: final raster`);

  const screenshot = (await browserWindow.capturePage()).toPNG();
  const filename = `${scenario.id}.png`;
  const actualPath = path.join(actualRoot, filename);
  await writeFile(actualPath, screenshot);
  const digest = sha256(screenshot);
  if (update) {
    await copyFile(actualPath, path.join(evidenceRoot, filename));
  } else {
    const expected = expectedManifest.screenshots?.find((entry) => entry.id === scenario.id);
    assert.ok(expected, `${scenario.id}: reviewed platform baseline is missing`);
    const expectedPng = await readFile(path.join(evidenceRoot, filename));
    assert.equal(
      sha256(expectedPng),
      expected.sha256,
      `${scenario.id}: reviewed baseline file does not match its manifest`,
    );
    if (digest !== expected.sha256) {
      const difference = rasterDifference(screenshot, expectedPng);
      if (acceptableRasterDifference(difference)) {
        report(`TOLERATED ${scenario.id} ${difference.changedPixels}/${difference.totalPixels} pixels (${(difference.changedPixelRatio * 100).toFixed(4)}%, max channel delta ${difference.maxChannelDifference})`);
      } else {
        rasterProblems.push(`${scenario.id}: ${JSON.stringify(difference)}`);
        report(`MISMATCH ${rasterProblems.at(-1)}`);
      }
    }
  }
  report(`PASS ${scenario.id} ${viewport.width}x${viewport.height} ${scenario.theme} zoom=${scenario.zoom}`);
  return {
    ...scenario,
    metrics,
    sha256: digest,
  };
}

async function performanceMetrics(webContents) {
  async function taskDuration() {
    const response = await webContents.debugger.sendCommand('Performance.getMetrics');
    return response.metrics.find((metric) => metric.name === 'TaskDuration')?.value || 0;
  }
  await webContents.debugger.sendCommand('Performance.enable');
  const collapsedStart = await taskDuration();
  await new Promise((resolve) => setTimeout(resolve, 400));
  const collapsedTaskMs = ((await taskDuration()) - collapsedStart) * 1_000;

  await webContents.executeJavaScript(`document.querySelector('#insta-aio-sidecar-root').shadowRoot.querySelector('.ia-launcher').click()`, true);
  await waitForValue(
    webContents,
    `!document.querySelector('#insta-aio-sidecar-root').shadowRoot.querySelector('.ia-panel').hidden`,
    'performance open overlay',
  );
  await waitForPaint(webContents, 'performance open idle settle');
  const openStart = await taskDuration();
  await new Promise((resolve) => setTimeout(resolve, 400));
  const openTaskMs = ((await taskDuration()) - openStart) * 1_000;

  const routeStart = await webContents.executeJavaScript('performance.now()', true);
  await webContents.executeJavaScript(`(() => {
    history.pushState({}, '', '/other_creator/');
    document.body.append(document.createComment('overlay-route-transition'));
  })()`, true);
  await waitForValue(
    webContents,
    `document.querySelector('#insta-aio-sidecar-root').shadowRoot.querySelector('[data-ia-role="now-content"]')?.textContent.includes('@other_creator')`,
    'performance route transition',
  );
  const routeTransitionMs = await webContents.executeJavaScript(`performance.now() - ${routeStart}`, true);

  const queueResult = await webContents.executeJavaScript(`(async () => {
    const queue = Array.from({ length: 2000 }, (_, index) => ({
      id: 'perf-' + index,
      account: { username: 'perf_' + index, displayName: '', source: 'fixture' },
      action: 'review',
      status: 'pending',
      reason: 'performance fixture',
    }));
    const started = performance.now();
    await new Promise((resolve) => chrome.storage.local.set({
      instaAioOverlayManualQueueV1: { importedAt: new Date().toISOString(), queue },
    }, resolve));
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const shadow = document.querySelector('#insta-aio-sidecar-root').shadowRoot;
    return {
      durationMs: performance.now() - started,
      renderedItems: shadow.querySelectorAll('[data-ia-role="queue-current"] h2').length,
      totalOverlayNodes: shadow.querySelectorAll('*').length,
    };
  })()`, true);
  assert.ok(collapsedTaskMs < 100, `collapsed idle task time is ${collapsedTaskMs.toFixed(2)}ms`);
  assert.ok(openTaskMs < 100, `open idle task time is ${openTaskMs.toFixed(2)}ms`);
  assert.ok(routeTransitionMs < 500, `route transition is ${routeTransitionMs.toFixed(2)}ms`);
  assert.ok(queueResult.durationMs < 1_000, `2,000-item queue update is ${queueResult.durationMs.toFixed(2)}ms`);
  assert.equal(queueResult.renderedItems, 1, '2,000-item queue update did not render one bounded current item');
  assert.ok(queueResult.totalOverlayNodes < 400, '2,000-item queue created unbounded overlay DOM');
  return { collapsedTaskMs, openTaskMs, queue: queueResult, routeTransitionMs };
}

function fidelityLedger(results, performance) {
  const standard = results.find((entry) => entry.id === 'profile-following-queue-match');
  return {
    schemaVersion: 1,
    capturedAt: new Date().toISOString(),
    platform: process.platform,
    source: {
      current: `docs/evidence/overlay-ui-2026-08-02/after/${process.platform}`,
    },
    comparison: [
      { area: 'shell', before: 'Default-open, visually dominant field desk', after: `Fresh collapsed launcher; standard open share ${(standard.metrics.panelAreaShare * 100).toFixed(2)}%`, status: 'MEASURED' },
      { area: 'hierarchy', before: 'Multiple equal-weight cards and protocol copy', after: 'Current target, state, then one next safe step with progressive disclosure', status: 'MEASURED' },
      { area: 'theme', before: 'Forced light presentation', after: 'Explicit light/dark plus auto resolver', status: 'MEASURED' },
      { area: 'navigation', before: 'Text-heavy tabs', after: 'Five semantic 44px rail targets with keyboard roving tabindex', status: 'MEASURED' },
      { area: 'queue', before: 'Queue and safety protocol compete', after: 'One current item; exact gate disclosed only when relevant', status: 'MEASURED' },
      { area: 'messages', before: 'Evidence and identity rules visually dense', after: 'Bounded evidence thread and secondary exact-identity disclosure', status: 'MEASURED' },
      { area: 'collision', before: 'Maximum-z panel could compete with native surfaces', after: 'Measured opposite-edge strip or fail-closed hidden controls', status: 'MEASURED' },
      { area: 'mobile', before: 'Large work surface', after: 'Bounded bottom sheet with short-height rules', status: 'MEASURED' },
      { area: 'accessibility', before: 'DOM/focus checks only', after: 'Semantic tabs, forced colors, reduced motion, zoom matrix, and AX smoke; human screen-reader still open', status: 'PARTIAL' },
    ],
    performance,
    limitations: [
      'Platform screenshot hashes are not cross-platform visual proof.',
      'Automated accessibility checks are not human screen-reader acceptance.',
      'Synthetic Instagram fixtures are not authenticated selector acceptance.',
      'No Instagram account mutation was executed.',
    ],
  };
}

async function run() {
  const server = fixtureServer();
  const isolatedSession = session.fromPartition(`insta-aio-overlay-qa-${process.pid}`);
  isolatedSession.setPermissionCheckHandler(() => false);
  isolatedSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  const problems = [];
  const browserWindow = new BrowserWindow({
    show: false,
    frame: false,
    useContentSize: true,
    width: 1440,
    height: 900,
    backgroundColor: '#fafafa',
    webPreferences: {
      backgroundThrottling: false,
      contextIsolation: true,
      nodeIntegration: false,
      offscreen: true,
      sandbox: true,
      webSecurity: true,
      partition: `insta-aio-overlay-qa-${process.pid}`,
    },
  });
  browserWindow.webContents.setWindowOpenHandler(({ url }) => {
    problems.push(`blocked window open: ${url}`);
    return { action: 'deny' };
  });
  browserWindow.webContents.on('will-navigate', (event, url) => {
    if (isLoopbackFixtureUrl(url)) return;
    event.preventDefault();
    problems.push(`blocked external navigation: ${url}`);
  });
  browserWindow.webContents.on('console-message', (event) => recordConsoleProblem(problems, event));
  browserWindow.webContents.on('render-process-gone', (_event, details) => {
    problems.push(`renderer gone: ${details.reason}`);
  });
  browserWindow.webContents.on('did-fail-load', (_event, code, description, url, isMainFrame) => {
    if (isMainFrame !== false) problems.push(`load failed ${code}: ${description} (${url})`);
  });
  let expectedManifest = null;
  let exitCode = 0;
  try {
    await mkdir(actualRoot, { recursive: true });
    if (update) await mkdir(evidenceRoot, { recursive: true });
    if (check) expectedManifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    const address = await listen(server);
    const baseUrl = `http://127.0.0.1:${address.port}`;
    await withTimeout(
      browserWindow.loadURL(scenarioUrl(baseUrl, overlayQaScenarios[0])),
      'overlay QA debugger bootstrap',
      5_000,
    );
    browserWindow.webContents.debugger.attach('1.3');
    const results = [];
    for (const scenario of overlayQaScenarios) {
      results.push(await captureScenario(browserWindow, baseUrl, scenario, expectedManifest));
    }

    const performanceScenario = {
      ...overlayQaScenarios.find((entry) => entry.id === 'collapsed-desktop'),
      id: 'performance-collapsed',
    };
    browserWindow.setContentSize(viewports.desktop.width, viewports.desktop.height);
    browserWindow.webContents.setZoomFactor(1);
    await withTimeout(
      browserWindow.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', {
        media: 'screen',
        features: [
          { name: 'prefers-reduced-motion', value: 'reduce' },
          { name: 'prefers-color-scheme', value: 'light' },
          { name: 'forced-colors', value: 'none' },
        ],
      }),
      'performance media emulation',
      5_000,
    );
    await withTimeout(
      browserWindow.webContents.loadURL(scenarioUrl(baseUrl, performanceScenario)),
      'performance fixture load',
    );
    await waitForValue(
      browserWindow.webContents,
      `document.querySelector('#insta-aio-sidecar-root')?.shadowRoot?.querySelector('[data-ia-role="status-text"]')?.textContent.includes('Inspection ready')`,
      'performance overlay initialization',
    );
    const performance = await performanceMetrics(browserWindow.webContents);
    assert.deepEqual(problems, [], 'overlay QA browser problems');
    assert.deepEqual(rasterProblems, [], 'overlay screenshot differences exceeded the configured tolerance');

    const output = {
      schemaVersion: 1,
      capturedAt: new Date().toISOString(),
      platform: process.platform,
      builtExtensionVersion: builtManifest.version,
      screenshots: results.map(({ id, sha256: digest, ...entry }) => ({
        id,
        sha256: digest,
        scenario: entry,
      })),
      performance,
    };
    await writeFile(path.join(actualRoot, 'manifest.json'), `${JSON.stringify(output, null, 2)}\n`, 'utf8');
    if (update) {
      await writeFile(manifestPath, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
      await writeFile(fidelityPath, `${JSON.stringify(fidelityLedger(results, performance), null, 2)}\n`, 'utf8');
      report(`Updated ${results.length} ${process.platform} overlay baselines by explicit request.`);
    } else {
      assert.equal(expectedManifest.platform, process.platform, 'overlay baseline platform mismatch');
      assert.equal(expectedManifest.screenshots.length, results.length, 'overlay baseline scenario count changed');
      report(`Verified ${results.length} reviewed ${process.platform} overlay baselines.`);
    }
  } catch (error) {
    exitCode = 1;
    console.error(error?.stack || error);
  } finally {
    if (browserWindow.webContents.debugger.isAttached()) browserWindow.webContents.debugger.detach();
    if (!browserWindow.isDestroyed()) browserWindow.destroy();
    await isolatedSession.clearStorageData();
    await close(server);
    app.exit(exitCode);
  }
}

const readinessTimer = setTimeout(() => {
  console.error('Overlay QA readiness timed out after 15 seconds.');
  app.exit(1);
}, 15_000);
app.whenReady().then(() => {
  clearTimeout(readinessTimer);
  return run();
});

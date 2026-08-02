import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { app, BrowserWindow, session } from 'electron';

const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(moduleDirectory, '..');
const evidenceRoot = path.join(
  repositoryRoot,
  'docs',
  'evidence',
  'overlay-ui-2026-08-02',
  'concepts',
);
const resultsRoot = path.join(repositoryRoot, 'test-results', 'overlay-concepts');
const userDataRoot = path.resolve(
  process.env.INSTA_AIO_OVERLAY_CONCEPT_USER_DATA
    || path.join(resultsRoot, 'user-data', String(process.pid)),
);

if (!evidenceRoot.startsWith(`${repositoryRoot}${path.sep}`)) {
  throw new Error('Concept evidence must stay inside the repository.');
}
if (!userDataRoot.startsWith(`${resultsRoot}${path.sep}`)) {
  throw new Error('Concept browser data must stay inside test-results.');
}

const assets = new Map([
  ['/fixture.html', path.join(repositoryRoot, 'tests', 'fixtures', 'overlay-preview.html')],
  ['/extension/action-labels.js', path.join(repositoryRoot, 'extension', 'action-labels.js')],
  ['/extension/content-instagram.js', path.join(repositoryRoot, 'extension', 'content-instagram.js')],
  ['/extension/instagram-overlay.js', path.join(repositoryRoot, 'extension', 'instagram-overlay.js')],
]);

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
    if (!server.listening) {
      resolve();
      return;
    }
    server.close((error) => error ? reject(error) : resolve());
  });
}

function createFixtureServer() {
  return createServer(async (request, response) => {
    const host = String(request.headers.host || '').split(':')[0].toLowerCase();
    if (!['127.0.0.1', 'localhost'].includes(host)) {
      response.writeHead(421).end('Misdirected request');
      return;
    }
    const url = new URL(request.url || '/', 'http://127.0.0.1');
    const target = assets.get(url.pathname);
    if (!target || !['GET', 'HEAD'].includes(request.method || '')) {
      response.writeHead(404).end('Not found');
      return;
    }
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
      ].join('; '),
      'Content-Type': target.endsWith('.html')
        ? 'text/html; charset=utf-8'
        : 'text/javascript; charset=utf-8',
      'X-Content-Type-Options': 'nosniff',
    });
    response.end(body);
  });
}

async function waitFor(webContents, expression, label, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await webContents.executeJavaScript(expression, true)) return;
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
  throw new Error(`Timed out waiting for ${label}.`);
}

function injectConcept({ concept, theme }) {
  document.querySelector('#insta-aio-sidecar-root')?.remove();
  document.querySelector('#insta-aio-concept-root')?.remove();
  document.querySelector('#insta-aio-concept-theme')?.remove();

  const themeStyle = document.createElement('style');
  themeStyle.id = 'insta-aio-concept-theme';
  themeStyle.textContent = theme === 'dark' ? `
    html, body { background: #000 !important; color: #f5f5f5 !important; color-scheme: dark; }
    .instagram-nav { border-color: #262626 !important; background: #000 !important; }
    .profile button { background: #262626 !important; color: #f5f5f5 !important; }
    .feed-grid, .fixture-thread, .fixture-thread header { border-color: #262626 !important; }
    .post { background: #181818 !important; }
    .fixture-dialog, .fixture-thread { border-color: #363636 !important; background: #101010 !important; color: #f5f5f5 !important; }
    .fixture-dialog a { color: #f5f5f5 !important; }
  ` : 'html, body { color-scheme: light; }';
  document.head.append(themeStyle);

  const host = document.createElement('div');
  host.id = 'insta-aio-concept-root';
  host.dataset.concept = concept;
  host.dataset.theme = theme;
  const shadow = host.attachShadow({ mode: 'open' });

  const icons = {
    now: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 11.5 12 5l8 6.5v7a1 1 0 0 1-1 1h-5v-5h-4v5H5a1 1 0 0 1-1-1z"/></svg>',
    capture: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 7h14v11H5zM8 4h8M9 11h6M12 8v6"/></svg>',
    queue: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 6h13M7 12h13M7 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01"/></svg>',
    messages: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 5h14v11H9l-4 3z"/></svg>',
    workspace: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5h7v6H4zM13 5h7v10h-7zM4 13h7v6H4zM13 17h7v2h-7z"/></svg>',
    inspect: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6"/><path d="m16 16 4 4M11 8v6M8 11h6"/></svg>',
    more: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/></svg>',
    close: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m7 7 10 10M17 7 7 17"/></svg>',
  };

  const nativeMarkup = `
    <aside class="concept-panel concept-native" aria-label="Compact Instagram-native utility concept">
      <header class="native-header">
        <div class="native-brand"><span class="native-mark">A</span><span><strong>Insta AIO</strong><small>Profile</small></span></div>
        <button class="icon-button" type="button" aria-label="Collapse panel">${icons.close}</button>
      </header>
      <nav class="native-tabs" role="tablist" aria-label="Insta AIO tools">
        <button role="tab" aria-selected="true">Now</button><button role="tab" aria-selected="false">Capture</button><button role="tab" aria-selected="false">Queue</button><button role="tab" aria-selected="false">Messages</button><button role="tab" aria-selected="false">More</button>
      </nav>
      <main class="native-main">
        <div class="state-line"><span class="state-dot"></span><strong>Exact profile found</strong><span>Read only</span></div>
        <section class="native-target">
          <div class="target-heading"><span class="avatar-mini">DC</span><div><h1>@demo_creator</h1><p>Demo Creator</p></div><span class="verified">Verified</span></div>
          <dl><div><dt>Relationship</dt><dd>Following</dd></div><div><dt>Queue</dt><dd>Unfollow item matched</dd></div></dl>
        </section>
        <section class="next-step">
          <p class="section-label">Next safe step</p>
          <h2>Inspect this profile</h2>
          <p>Refresh the exact relationship and protection state. No Instagram control will be used.</p>
          <button class="primary-action" type="button">${icons.inspect}<span>Inspect profile</span></button>
        </section>
        <details><summary>Why live action is locked</summary><p>A fresh one-item intent, exact target, confirmation phrase, and PWA reservation are required.</p></details>
      </main>
      <footer><span class="lock-dot"></span><span>Live locked</span><span class="footer-detail">Workspace paired</span></footer>
    </aside>
  `;

  const operatorMarkup = `
    <aside class="concept-panel concept-operator" aria-label="Quiet professional operator panel concept">
      <nav class="operator-rail" role="tablist" aria-label="Insta AIO tools">
        <div class="operator-mark" aria-label="Insta AIO">A</div>
        <button class="rail-button" role="tab" aria-selected="true" aria-label="Now">${icons.now}</button>
        <button class="rail-button" role="tab" aria-selected="false" aria-label="Capture">${icons.capture}</button>
        <button class="rail-button" role="tab" aria-selected="false" aria-label="Queue">${icons.queue}<span class="attention-dot"></span></button>
        <button class="rail-button" role="tab" aria-selected="false" aria-label="Messages">${icons.messages}</button>
        <button class="rail-button rail-bottom" role="tab" aria-selected="false" aria-label="Workspace">${icons.workspace}</button>
      </nav>
      <div class="operator-body">
        <header class="operator-header">
          <div><p>Now · Profile</p><h1>Review target</h1></div>
          <div class="header-actions"><button type="button" aria-label="More options">${icons.more}</button><button type="button" aria-label="Collapse panel">${icons.close}</button></div>
        </header>
        <main class="operator-main">
          <div class="operator-state"><span class="state-dot"></span><span><strong>Page ready</strong><small>Identity and relationship resolved without clicking</small></span></div>
          <section class="operator-target">
            <div class="target-top"><span class="target-avatar">DC</span><div><h2>@demo_creator</h2><p>Exact profile identity</p></div><span class="state-badge">verified</span></div>
            <div class="operator-facts"><span><small>Relationship</small><strong>Following</strong></span><span><small>Queue match</small><strong>Unfollow</strong></span></div>
          </section>
          <section class="operator-next">
            <div><p>Next safe step</p><h3>Refresh protection state</h3><span>Confirm this remains the reviewed profile before returning to the queue.</span></div>
            <button class="operator-primary" type="button">Inspect page</button>
          </section>
          <button class="disclosure-button" type="button" aria-expanded="false"><span>Safety and identity details</span><span>+</span></button>
          <button class="text-action" type="button">Open matched queue item</button>
        </main>
        <footer class="operator-footer"><span><i></i> Live actions locked</span><span>Paired · read + action</span></footer>
      </div>
    </aside>
  `;

  shadow.innerHTML = `
    <style>
      :host {
        all: initial;
        color-scheme: ${theme};
        --signal: #b9ef35;
        --focus: #168cff;
        --font: "Segoe UI Variable", "Segoe UI", system-ui, sans-serif;
      }
      *, *::before, *::after { box-sizing: border-box; }
      button, summary { font: inherit; }
      button { cursor: pointer; }
      svg { width: 20px; height: 20px; fill: none; stroke: currentColor; stroke-linecap: round; stroke-linejoin: round; stroke-width: 1.7; }
      button:focus-visible, summary:focus-visible { outline: 3px solid var(--focus); outline-offset: 2px; }
      .concept-panel { position: fixed; z-index: 2147483000; font-family: var(--font); }

      .concept-native {
        --surface: ${theme === 'dark' ? '#121212' : '#ffffff'};
        --surface-soft: ${theme === 'dark' ? '#1b1b1b' : '#f7f7f7'};
        --ink: ${theme === 'dark' ? '#f5f5f5' : '#171717'};
        --muted: ${theme === 'dark' ? '#a8a8a8' : '#6b6b6b'};
        --line: ${theme === 'dark' ? '#343434' : '#dbdbdb'};
        top: 74px;
        right: 18px;
        display: grid;
        width: min(356px, calc(100vw - 32px));
        max-height: calc(100dvh - 92px);
        grid-template-rows: auto auto minmax(0, 1fr) auto;
        overflow: hidden;
        border: 1px solid var(--line);
        border-radius: 14px;
        background: var(--surface);
        color: var(--ink);
        box-shadow: 0 16px 46px rgba(0, 0, 0, ${theme === 'dark' ? '.46' : '.16'});
        font-size: 14px;
      }
      .native-header { display: flex; min-height: 58px; align-items: center; justify-content: space-between; padding: 10px 12px 9px 14px; border-bottom: 1px solid var(--line); }
      .native-brand { display: flex; align-items: center; gap: 10px; }
      .native-mark { display: grid; width: 30px; height: 30px; place-items: center; border-radius: 9px; background: var(--ink); color: var(--surface); font-size: 14px; font-weight: 750; }
      .native-brand strong, .native-brand small { display: block; }
      .native-brand strong { font-size: 14px; line-height: 1.15; }
      .native-brand small { margin-top: 2px; color: var(--muted); font-size: 11px; }
      .icon-button { display: grid; width: 40px; height: 40px; place-items: center; border: 0; border-radius: 10px; background: transparent; color: var(--ink); }
      .icon-button:hover { background: var(--surface-soft); }
      .native-tabs { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); border-bottom: 1px solid var(--line); }
      .native-tabs button { min-height: 44px; border: 0; border-bottom: 2px solid transparent; padding: 0 4px; background: transparent; color: var(--muted); font-size: 11px; }
      .native-tabs button[aria-selected="true"] { border-bottom-color: var(--ink); color: var(--ink); font-weight: 700; }
      .native-main { min-height: 0; overflow: auto; padding: 16px; }
      .state-line { display: flex; align-items: center; gap: 7px; color: var(--muted); font-size: 12px; }
      .state-line strong { color: var(--ink); font-weight: 650; }
      .state-line span:last-child { margin-left: auto; }
      .state-dot { width: 8px; height: 8px; flex: 0 0 auto; border: 1px solid ${theme === 'dark' ? '#d5fa72' : '#779f12'}; border-radius: 50%; background: var(--signal); }
      .native-target { margin-top: 14px; padding: 15px; border: 1px solid var(--line); border-radius: 12px; }
      .target-heading { display: grid; grid-template-columns: 38px minmax(0, 1fr) auto; gap: 10px; align-items: center; }
      .avatar-mini { display: grid; width: 38px; height: 38px; place-items: center; border-radius: 50%; background: var(--surface-soft); color: var(--muted); font-size: 11px; font-weight: 700; }
      .target-heading h1 { margin: 0; overflow-wrap: anywhere; font-size: 16px; line-height: 1.2; }
      .target-heading p { margin: 3px 0 0; color: var(--muted); font-size: 12px; }
      .verified { color: var(--muted); font-size: 11px; }
      .native-target dl { margin: 15px 0 0; }
      .native-target dl div { display: flex; justify-content: space-between; gap: 14px; padding: 9px 0; border-top: 1px solid var(--line); }
      .native-target dt { color: var(--muted); font-size: 12px; }
      .native-target dd { margin: 0; font-size: 12px; font-weight: 650; text-align: right; }
      .next-step { margin-top: 16px; padding: 2px 2px 4px; }
      .section-label { margin: 0; color: var(--muted); font-size: 12px; }
      .next-step h2 { margin: 5px 0 0; font-size: 18px; letter-spacing: -.01em; }
      .next-step > p:last-of-type { margin: 7px 0 0; color: var(--muted); font-size: 12px; line-height: 1.45; }
      .primary-action { display: flex; width: 100%; min-height: 44px; align-items: center; justify-content: center; gap: 8px; margin-top: 14px; border: 0; border-radius: 10px; background: var(--ink); color: var(--surface); font-size: 13px; font-weight: 700; }
      details { margin-top: 12px; border-top: 1px solid var(--line); color: var(--muted); font-size: 12px; }
      details summary { padding: 13px 0; color: var(--ink); cursor: pointer; }
      details p { margin: 0 0 13px; line-height: 1.45; }
      .concept-native footer { display: flex; min-height: 42px; align-items: center; gap: 7px; padding: 0 14px; border-top: 1px solid var(--line); background: var(--surface-soft); font-size: 11px; }
      .lock-dot { width: 7px; height: 7px; border-radius: 50%; background: ${theme === 'dark' ? '#8d8d8d' : '#777'}; }
      .footer-detail { margin-left: auto; color: var(--muted); }

      .concept-operator {
        --surface: ${theme === 'dark' ? '#151714' : '#f7f8f5'};
        --surface-raised: ${theme === 'dark' ? '#1c1f1b' : '#ffffff'};
        --rail: ${theme === 'dark' ? '#10120f' : '#eef0eb'};
        --ink: ${theme === 'dark' ? '#f3f5ef' : '#1d211b'};
        --muted: ${theme === 'dark' ? '#a9afa3' : '#687064'};
        --line: ${theme === 'dark' ? '#343a31' : '#d8ddd4'};
        top: 54px;
        right: 18px;
        display: grid;
        width: min(380px, calc(100vw - 32px));
        height: min(680px, calc(100dvh - 72px));
        max-height: calc(100dvh - 72px);
        grid-template-columns: 48px minmax(0, 1fr);
        overflow: hidden;
        border: 1px solid var(--line);
        border-radius: 12px;
        background: var(--surface);
        color: var(--ink);
        box-shadow: 0 18px 54px rgba(0, 0, 0, ${theme === 'dark' ? '.52' : '.18'});
        font-size: 14px;
      }
      .operator-rail { display: flex; min-height: 0; flex-direction: column; align-items: center; gap: 2px; padding: 8px 4px; border-right: 1px solid var(--line); background: var(--rail); }
      .operator-mark { display: grid; width: 36px; height: 36px; margin-bottom: 9px; place-items: center; border-radius: 10px; background: var(--ink); color: var(--surface); font-weight: 800; }
      .rail-button { position: relative; display: grid; width: 40px; height: 40px; place-items: center; border: 0; border-radius: 9px; background: transparent; color: var(--muted); }
      .rail-button:hover { background: var(--surface-raised); color: var(--ink); }
      .rail-button[aria-selected="true"] { background: var(--surface-raised); color: var(--ink); box-shadow: inset 3px 0 0 var(--signal); }
      .rail-bottom { margin-top: auto; }
      .attention-dot { position: absolute; top: 7px; right: 7px; width: 6px; height: 6px; border: 1px solid var(--rail); border-radius: 50%; background: var(--signal); }
      .operator-body { display: grid; min-width: 0; min-height: 0; grid-template-rows: auto minmax(0, 1fr) auto; }
      .operator-header { display: flex; min-height: 66px; align-items: center; justify-content: space-between; gap: 12px; padding: 10px 12px 10px 16px; border-bottom: 1px solid var(--line); background: var(--surface-raised); }
      .operator-header p { margin: 0 0 3px; color: var(--muted); font-size: 11px; }
      .operator-header h1 { margin: 0; font-size: 18px; letter-spacing: -.015em; }
      .header-actions { display: flex; gap: 2px; }
      .header-actions button { display: grid; width: 38px; height: 38px; place-items: center; border: 0; border-radius: 9px; background: transparent; color: var(--ink); }
      .header-actions button:hover { background: var(--surface); }
      .operator-main { min-height: 0; overflow: auto; padding: 16px; }
      .operator-state { display: flex; align-items: center; gap: 9px; padding-bottom: 14px; }
      .operator-state > span:last-child { min-width: 0; }
      .operator-state strong, .operator-state small { display: block; }
      .operator-state strong { font-size: 12px; }
      .operator-state small { margin-top: 2px; color: var(--muted); font-size: 11px; }
      .operator-target { border: 1px solid var(--line); border-radius: 10px; background: var(--surface-raised); }
      .target-top { display: grid; grid-template-columns: 42px minmax(0, 1fr) auto; gap: 10px; align-items: center; padding: 14px; }
      .target-avatar { display: grid; width: 42px; height: 42px; place-items: center; border-radius: 9px; background: var(--rail); color: var(--muted); font-size: 11px; font-weight: 700; }
      .target-top h2 { margin: 0; overflow-wrap: anywhere; font-size: 17px; }
      .target-top p { margin: 3px 0 0; color: var(--muted); font-size: 11px; }
      .state-badge { border: 1px solid var(--line); border-radius: 999px; padding: 4px 7px; color: var(--muted); font-size: 10px; }
      .operator-facts { display: grid; grid-template-columns: 1fr 1fr; border-top: 1px solid var(--line); }
      .operator-facts span { padding: 11px 14px; }
      .operator-facts span + span { border-left: 1px solid var(--line); }
      .operator-facts small, .operator-facts strong { display: block; }
      .operator-facts small { color: var(--muted); font-size: 10px; }
      .operator-facts strong { margin-top: 3px; font-size: 12px; }
      .operator-next { display: grid; gap: 14px; margin-top: 14px; padding: 14px; border-radius: 10px; background: var(--rail); }
      .operator-next p { margin: 0; color: var(--muted); font-size: 10px; }
      .operator-next h3 { margin: 4px 0 0; font-size: 15px; }
      .operator-next span { display: block; margin-top: 5px; color: var(--muted); font-size: 11px; line-height: 1.4; }
      .operator-primary { min-height: 42px; border: 0; border-radius: 9px; background: var(--ink); color: var(--surface); font-size: 12px; font-weight: 700; }
      .disclosure-button { display: flex; width: 100%; min-height: 44px; align-items: center; justify-content: space-between; margin-top: 12px; border: 0; border-bottom: 1px solid var(--line); background: transparent; color: var(--ink); font-size: 12px; text-align: left; }
      .text-action { min-height: 42px; margin-top: 7px; border: 0; background: transparent; color: var(--ink); font-size: 12px; font-weight: 700; text-decoration: underline; text-underline-offset: 3px; }
      .operator-footer { display: flex; min-height: 42px; align-items: center; justify-content: space-between; gap: 10px; padding: 0 14px; border-top: 1px solid var(--line); background: var(--surface-raised); color: var(--muted); font-size: 10px; }
      .operator-footer span:first-child { display: flex; align-items: center; gap: 6px; color: var(--ink); }
      .operator-footer i { width: 7px; height: 7px; border-radius: 50%; background: ${theme === 'dark' ? '#858b80' : '#777d73'}; }
    </style>
    ${concept === 'native' ? nativeMarkup : operatorMarkup}
  `;
  document.documentElement.append(host);
}

function intersects(a, b) {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}

async function captureConcept(window, baseUrl, concept, theme) {
  await window.loadURL(`${baseUrl}/fixture.html?mode=profile&shadow=open`);
  await waitFor(
    window.webContents,
    "Boolean(document.querySelector('#insta-aio-sidecar-root')?.shadowRoot)",
    'production overlay fixture',
  );
  await window.webContents.executeJavaScript(
    `(${injectConcept.toString()})(${JSON.stringify({ concept, theme })})`,
    true,
  );
  await waitFor(
    window.webContents,
    `document.querySelector('#insta-aio-concept-root')?.dataset?.concept === ${JSON.stringify(concept)}`,
    `${concept} concept`,
  );
  await new Promise((resolve) => setTimeout(resolve, 100));
  const metrics = await window.webContents.executeJavaScript(`(() => {
    const host = document.querySelector('#insta-aio-concept-root');
    const panel = host.shadowRoot.querySelector('.concept-panel').getBoundingClientRect();
    const nativeControl = document.querySelector('.profile button').getBoundingClientRect();
    const rail = host.shadowRoot.querySelector('.operator-rail')?.getBoundingClientRect() || null;
    const rect = (value) => ({
      bottom: value.bottom,
      height: value.height,
      left: value.left,
      right: value.right,
      top: value.top,
      width: value.width,
    });
    return {
      concept: host.dataset.concept,
      theme: host.dataset.theme,
      viewport: { width: innerWidth, height: innerHeight },
      panel: rect(panel),
      rail: rail ? rect(rail) : null,
      nativeControl: rect(nativeControl),
    };
  })()`, true);
  metrics.viewportAreaShare = Number((
    (metrics.panel.width * metrics.panel.height)
    / (metrics.viewport.width * metrics.viewport.height)
  ).toFixed(4));
  metrics.intersectsNativeProfileControl = intersects(metrics.panel, metrics.nativeControl);

  const image = await window.capturePage();
  const png = image.toPNG();
  const filename = `${concept === 'native' ? 'compact-instagram-native' : 'quiet-operator-panel'}-${theme}.png`;
  await writeFile(path.join(evidenceRoot, filename), png);
  metrics.file = filename;
  metrics.sha256 = createHash('sha256').update(png).digest('hex');
  console.log(`Captured ${filename}.`);
  return metrics;
}

async function run() {
  const server = createFixtureServer();
  const partition = `insta-aio-overlay-concepts-${process.pid}`;
  const isolatedSession = session.fromPartition(partition);
  isolatedSession.setPermissionCheckHandler(() => false);
  isolatedSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  const window = new BrowserWindow({
    show: false,
    frame: false,
    width: 1440,
    height: 900,
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
  let exitCode = 0;
  try {
    await mkdir(evidenceRoot, { recursive: true });
    const address = await listen(server);
    const baseUrl = `http://127.0.0.1:${address.port}`;
    const metrics = [];
    for (const concept of ['native', 'operator']) {
      for (const theme of ['light', 'dark']) {
        metrics.push(await captureConcept(window, baseUrl, concept, theme));
      }
    }
    await writeFile(
      path.join(evidenceRoot, 'concept-metrics.json'),
      `${JSON.stringify({
        buildId: 'ff8b4b8c9587114273e45d28e8bac14ec1d3f643',
        capturedAt: new Date().toISOString(),
        fixture: 'tests/fixtures/overlay-preview.html?mode=profile',
        metrics,
      }, null, 2)}\n`,
      'utf8',
    );
  } catch (error) {
    exitCode = 1;
    console.error(error?.stack || error);
  } finally {
    if (!window.isDestroyed()) window.destroy();
    await isolatedSession.clearStorageData();
    await close(server);
    app.exit(exitCode);
  }
}

const readinessTimer = setTimeout(() => {
  console.error('Overlay concept renderer readiness timed out after 15 seconds.');
  app.exit(1);
}, 15_000);

app.whenReady().then(() => {
  clearTimeout(readinessTimer);
  return run();
});

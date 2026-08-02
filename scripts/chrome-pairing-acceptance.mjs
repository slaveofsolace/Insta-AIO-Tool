import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import {
  cp,
  mkdir,
  readFile,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { createAppServer } from './serve.mjs';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const resultsRoot = path.resolve(repositoryRoot, 'test-results', 'chrome-acceptance');
const userDataRoot = path.join(resultsRoot, 'user-data');
const testExtensionRoot = path.join(resultsRoot, 'extension');
const devToolsPortPath = path.join(userDataRoot, 'DevToolsActivePort');

function chromeCandidates() {
  const candidates = [process.env.CHROME_BIN].filter(Boolean);
  if (process.platform === 'win32') {
    for (const root of [process.env.PROGRAMFILES, process.env['PROGRAMFILES(X86)'], process.env.LOCALAPPDATA]) {
      if (root) candidates.push(path.join(root, 'Google', 'Chrome', 'Application', 'chrome.exe'));
    }
  } else if (process.platform === 'darwin') {
    candidates.push('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome');
  } else {
    candidates.push('/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium');
  }
  return [...new Set(candidates)];
}

async function findChrome() {
  for (const candidate of chromeCandidates()) {
    try {
      if ((await stat(candidate)).isFile()) return candidate;
    } catch {
      // Try the next known browser location.
    }
  }
  throw new Error('Google Chrome was not found. Set CHROME_BIN to run target-browser acceptance.');
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

async function waitFor(check, label, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      const value = await check();
      if (value) return value;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for ${label}.${lastError ? ` ${lastError.message}` : ''}`);
}

async function prepareExtension() {
  const source = path.join(repositoryRoot, 'dist', 'extension');
  await rm(testExtensionRoot, { recursive: true, force: true });
  await cp(source, testExtensionRoot, { recursive: true, errorOnExist: true });
  const manifestPath = path.join(testExtensionRoot, 'manifest.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  manifest.host_permissions = [...new Set([
    ...(manifest.host_permissions || []),
    'http://127.0.0.1/*',
  ])];
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
}

class CdpClient {
  constructor(socket) {
    this.socket = socket;
    this.nextId = 1;
    this.pending = new Map();
    socket.addEventListener('message', (event) => {
      const message = JSON.parse(String(event.data));
      if (!message.id || !this.pending.has(message.id)) return;
      const pending = this.pending.get(message.id);
      this.pending.delete(message.id);
      clearTimeout(pending.timer);
      if (message.error) pending.reject(new Error(message.error.message));
      else pending.resolve(message.result || {});
    });
    socket.addEventListener('close', () => {
      for (const pending of this.pending.values()) {
        clearTimeout(pending.timer);
        pending.reject(new Error('Chrome DevTools connection closed.'));
      }
      this.pending.clear();
    });
  }

  static async connect(url) {
    const socket = new WebSocket(url);
    await new Promise((resolve, reject) => {
      socket.addEventListener('open', resolve, { once: true });
      socket.addEventListener('error', () => reject(new Error(
        `Unable to connect to Chrome DevTools target ${url}.`,
      )), { once: true });
    });
    return new CdpClient(socket);
  }

  send(method, params = {}, timeoutMs = 10_000) {
    const id = this.nextId;
    this.nextId += 1;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${method} timed out after ${timeoutMs}ms.`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  close() {
    this.socket.close();
  }
}

async function evaluate(client, expression, { userGesture = false } = {}) {
  const result = await client.send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
    userGesture,
  });
  if (result.exceptionDetails) {
    throw new Error(
      result.exceptionDetails.exception?.description
      || result.exceptionDetails.text
      || 'Chrome evaluation failed.',
    );
  }
  return result.result?.value;
}

async function targets(port) {
  const response = await fetch(`http://127.0.0.1:${port}/json/list`);
  if (!response.ok) throw new Error(`Chrome target list returned ${response.status}.`);
  return response.json();
}

async function createTarget(port, url) {
  const response = await fetch(
    `http://127.0.0.1:${port}/json/new?${encodeURIComponent(url)}`,
    { method: 'PUT' },
  );
  if (!response.ok) throw new Error(`Chrome target creation returned ${response.status}.`);
  return response.json();
}

async function extensionIdFromPreferences() {
  const candidates = [
    path.join(userDataRoot, 'Default', 'Preferences'),
    path.join(userDataRoot, 'Default', 'Secure Preferences'),
  ];
  return waitFor(async () => {
    for (const candidate of candidates) {
      let preferences;
      try {
        preferences = JSON.parse(await readFile(candidate, 'utf8'));
      } catch {
        continue;
      }
      for (const [id, setting] of Object.entries(preferences.extensions?.settings || {})) {
        const configuredPath = String(setting?.path || '');
        const samePath = process.platform === 'win32'
          ? path.resolve(configuredPath).toLowerCase() === path.resolve(testExtensionRoot).toLowerCase()
          : path.resolve(configuredPath) === path.resolve(testExtensionRoot);
        if (samePath || setting?.manifest?.name === 'Insta AIO Companion') return id;
      }
    }
    return null;
  }, 'unpacked extension identity');
}

async function run() {
  const chromePath = await findChrome();
  await rm(resultsRoot, { recursive: true, force: true });
  await mkdir(userDataRoot, { recursive: true });
  await prepareExtension();

  const server = createAppServer();
  const address = await listen(server);
  const pwaUrl = `http://127.0.0.1:${address.port}/`;
  const chromeArguments = [
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-background-networking',
    '--disable-component-update',
    '--disable-default-apps',
    '--disable-dev-shm-usage',
    '--disable-extensions-http-throttling',
    `--disable-extensions-except=${testExtensionRoot}`,
    `--load-extension=${testExtensionRoot}`,
    '--remote-debugging-port=0',
    '--remote-allow-origins=*',
    `--user-data-dir=${userDataRoot}`,
    '--window-position=-32000,-32000',
    '--window-size=1200,900',
    pwaUrl,
  ];
  if (typeof process.getuid === 'function' && process.getuid() === 0) {
    chromeArguments.unshift('--no-sandbox');
  }

  const chrome = spawn(chromePath, chromeArguments, {
    cwd: repositoryRoot,
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  let chromeOutput = '';
  chrome.stdout.on('data', (chunk) => { chromeOutput = `${chromeOutput}${chunk}`.slice(-20_000); });
  chrome.stderr.on('data', (chunk) => { chromeOutput = `${chromeOutput}${chunk}`.slice(-20_000); });
  const clients = [];
  try {
    const port = await waitFor(async () => {
      const lines = (await readFile(devToolsPortPath, 'utf8')).trim().split(/\r?\n/);
      const value = Number(lines[0]);
      return Number.isInteger(value) && value > 0 ? value : null;
    }, 'Chrome remote-debugging port');
    const targetList = () => targets(port);
    const pwaTarget = await waitFor(async () => (
      (await targetList()).find((target) => target.type === 'page' && target.url === pwaUrl)
    ), 'PWA Chrome target');
    const extensionId = await extensionIdFromPreferences();
    const pwa = await CdpClient.connect(pwaTarget.webSocketDebuggerUrl);
    clients.push(pwa);
    await pwa.send('Runtime.enable');
    await pwa.send('Page.enable');
    await waitFor(async () => evaluate(
      pwa,
      `document.querySelector('[data-page-heading]')?.textContent === 'Overview'`,
    ), 'PWA overview in Google Chrome');

    const manifest = await pwa.send('Page.getAppManifest');
    assert.equal(manifest.errors?.length || 0, 0, 'Chrome reported manifest errors');
    assert.equal(manifest.url, `${pwaUrl}manifest.webmanifest`);
    const installability = await pwa.send('Page.getInstallabilityErrors');
    assert.deepEqual(installability.installabilityErrors || [], []);

    await evaluate(
      pwa,
      `document.querySelector('[data-action="navigate"][data-view="settings"]').click()`,
      { userGesture: true },
    );
    await waitFor(async () => evaluate(
      pwa,
      `document.querySelector('[data-page-heading]')?.textContent === 'Settings'`,
    ), 'PWA settings in Google Chrome');
    const defaults = await evaluate(pwa, `({
      actionPermission: document.querySelector('#bridge-action-permission')?.checked,
      liveAccount: document.querySelector('#live-action-enabled')?.checked,
      liveDm: document.querySelector('#live-dm-enabled')?.checked,
    })`);
    assert.deepEqual(defaults, { actionPermission: false, liveAccount: false, liveDm: false });
    await evaluate(
      pwa,
      `document.querySelector('[data-action="create-extension-pairing"]').click()`,
      { userGesture: true },
    );
    const pairingCode = await waitFor(async () => evaluate(
      pwa,
      `document.querySelector('#bridge-pairing-code')?.value || ''`,
    ), 'PWA pairing code in Google Chrome');
    assert.ok(pairingCode.length > 40);

    const popupTarget = await createTarget(port, `chrome-extension://${extensionId}/popup.html`);
    const popup = await CdpClient.connect(popupTarget.webSocketDebuggerUrl);
    clients.push(popup);
    await popup.send('Runtime.enable');
    await popup.send('Page.enable');
    await pwa.send('Page.bringToFront');
    await popup.send('Page.reload', { ignoreCache: true });
    await waitFor(async () => evaluate(
      popup,
      `document.querySelector('#active-origin')?.textContent === ${JSON.stringify(new URL(pwaUrl).origin)}`,
    ), 'popup exact active origin');
    await evaluate(popup, `(() => {
      const code = document.querySelector('#pairing-code');
      code.value = ${JSON.stringify(pairingCode)};
      code.dispatchEvent(new Event('input', { bubbles: true }));
      document.querySelector('#action-permission').checked = false;
      document.querySelector('#pairing-form').requestSubmit();
    })()`, { userGesture: true });
    await waitFor(async () => evaluate(
      popup,
      `document.querySelector('#status')?.textContent === 'Origin paired. Return to the PWA and complete the handshake.'`,
    ), 'extension origin pairing');

    await evaluate(
      pwa,
      `document.querySelector('[data-action="complete-extension-pairing"]').click()`,
      { userGesture: true },
    );
    await waitFor(async () => evaluate(
      pwa,
      `document.body.innerText.includes('Extension pairing completed and the one-time code was consumed.')`,
    ), 'signed pairing handshake');
    await waitFor(async () => (
      (await targetList()).find((target) => (
        target.type === 'service_worker'
        && target.url === `chrome-extension://${extensionId}/background.js`
      ))
    ), 'signed bridge service worker');
    const pairedUi = await evaluate(pwa, `({
      codeRemoved: !document.querySelector('#bridge-pairing-code'),
      liveAccount: document.querySelector('#live-action-enabled')?.checked,
      liveDm: document.querySelector('#live-dm-enabled')?.checked,
      paired: [...document.querySelectorAll('.badge')].some((badge) => badge.textContent.trim() === 'paired'),
      permissions: [...document.querySelectorAll('.field')]
        .find((field) => field.querySelector('label')?.textContent === 'Permissions')
        ?.querySelector('input')?.value,
    })`);
    assert.deepEqual(pairedUi, {
      codeRemoved: true,
      liveAccount: false,
      liveDm: false,
      paired: true,
      permissions: 'read',
    });
    await evaluate(
      pwa,
      `document.querySelector('[data-action="ping-extension"]').click()`,
      { userGesture: true },
    );
    await waitFor(async () => evaluate(
      pwa,
      `document.body.innerText.includes('Extension 0.4.0 connected; live account actions are locked by default.')`,
    ), 'paired extension ping');
    const storedPairings = await evaluate(
      popup,
      `chrome.storage.local.get('bridgePairings').then(({ bridgePairings }) => bridgePairings)`,
    );
    assert.equal(storedPairings.length, 1);
    assert.equal(storedPairings[0].origin, new URL(pwaUrl).origin);
    assert.deepEqual(storedPairings[0].permissions, ['read']);
    assert.equal(typeof storedPairings[0].pairedAt, 'string');
    console.log(`Accepted Google Chrome PWA installability and real extension pairing at ${pwaUrl}`);
  } catch (error) {
    throw new Error(`${error.message}\nChrome output:\n${chromeOutput}`, { cause: error });
  } finally {
    for (const client of clients.reverse()) client.close();
    if (!chrome.killed) chrome.kill('SIGTERM');
    await new Promise((resolve) => {
      const timer = setTimeout(() => {
        if (!chrome.killed) chrome.kill('SIGKILL');
        resolve();
      }, 5_000);
      chrome.once('exit', () => {
        clearTimeout(timer);
        resolve();
      });
    });
    await close(server);
    const resolvedResultsRoot = path.resolve(resultsRoot);
    const resolvedTestResults = path.resolve(repositoryRoot, 'test-results');
    if (
      resolvedResultsRoot.startsWith(`${resolvedTestResults}${path.sep}`)
      && path.basename(resolvedResultsRoot) === 'chrome-acceptance'
    ) {
      await rm(resolvedResultsRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  }
}

await run();

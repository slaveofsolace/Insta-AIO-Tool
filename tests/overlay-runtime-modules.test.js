import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const moduleNames = [
  'shared',
  'preferences',
  'layout',
  'route-observer',
  'theme',
  'bridge',
  'downloads',
  'accessibility',
  'collision',
];
const sources = Object.fromEntries(await Promise.all(moduleNames.map(async (name) => [
  name,
  await readFile(new URL(`../extension/overlay/${name}.js`, import.meta.url), 'utf8'),
])));

function loadModules() {
  const context = vm.createContext({ console, Date, Intl });
  for (const name of moduleNames) vm.runInContext(sources[name], context);
  return context.__instaAioOverlayModules;
}

test('route observer emits one debounced change and installs no location polling', async () => {
  const modules = loadModules();
  assert.doesNotMatch(sources['route-observer'], /setInterval/);
  const windowEvents = new EventTarget();
  const navigationEvents = new EventTarget();
  const fakeWindow = {
    addEventListener: windowEvents.addEventListener.bind(windowEvents),
    clearTimeout,
    location: { href: 'https://www.instagram.com/demo/' },
    navigation: {
      addEventListener: navigationEvents.addEventListener.bind(navigationEvents),
      removeEventListener: navigationEvents.removeEventListener.bind(navigationEvents),
    },
    removeEventListener: windowEvents.removeEventListener.bind(windowEvents),
    setTimeout,
  };
  let observer;
  class FakeObserver {
    constructor(callback) {
      this.callback = callback;
      observer = this;
    }
    disconnect() {
      this.disconnected = true;
    }
    observe(target, options) {
      this.target = target;
      this.options = options;
    }
  }
  const changes = [];
  const controller = modules.routeObserver.create({
    document: { documentElement: {} },
    window: fakeWindow,
    MutationObserver: FakeObserver,
    debounceMs: 1,
    onRouteChange: (change) => changes.push(change),
  });
  observer.callback();
  observer.callback();
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(changes.length, 0);
  fakeWindow.location.href = 'https://www.instagram.com/direct/t/123/';
  observer.callback();
  navigationEvents.dispatchEvent(new Event('navigate'));
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(changes.length, 1);
  assert.equal(changes[0].priorUrl, 'https://www.instagram.com/demo/');
  assert.equal(changes[0].nextUrl, 'https://www.instagram.com/direct/t/123/');
  controller.teardown();
  assert.equal(observer.disconnected, true);
});

test('theme resolver honors explicit choice and rendered Instagram surface', () => {
  const { theme } = loadModules();
  const document = {
    body: { className: '', dataset: {} },
    documentElement: { className: '', dataset: {} },
  };
  const environment = {
    document,
    getComputedStyle: () => ({ backgroundColor: 'rgb(9, 9, 9)' }),
    matchMedia: () => ({ matches: false }),
  };
  assert.equal(theme.resolve('light', environment), 'light');
  assert.equal(theme.resolve('dark', environment), 'dark');
  assert.equal(theme.resolve('auto', environment), 'dark');
  environment.getComputedStyle = () => ({ backgroundColor: 'rgb(250, 250, 250)' });
  assert.equal(theme.resolve('auto', environment), 'light');
  document.documentElement.className = 'instagram dark';
  assert.equal(theme.resolve('auto', environment), 'dark');
});

test('download manager revokes replacement and teardown URLs', () => {
  const { downloads } = loadModules();
  const revoked = [];
  let sequence = 0;
  const manager = downloads.create({
    Blob: class FixtureBlob {},
    URL: {
      createObjectURL() {
        sequence += 1;
        return `blob:fixture-${sequence}`;
      },
      revokeObjectURL(value) {
        revoked.push(value);
      },
    },
  });
  const attributes = new Map();
  const anchor = {
    removeAttribute(name) {
      attributes.delete(name);
      delete this[name];
    },
    setAttribute(name, value) {
      attributes.set(name, value);
    },
  };
  manager.update('capture', anchor, { filename: 'one.json', payload: { one: 1 } });
  assert.equal(anchor.href, 'blob:fixture-1');
  manager.update('capture', anchor, { filename: 'two.json', payload: { two: 2 } });
  assert.deepEqual(revoked, ['blob:fixture-1']);
  manager.teardown();
  assert.deepEqual(revoked, ['blob:fixture-1', 'blob:fixture-2']);
  assert.equal(manager.activeCount(), 0);
});

test('tab keyboard mapping wraps and supports Home and End', () => {
  const { accessibility } = loadModules();
  assert.equal(accessibility.nextTabIndex('ArrowRight', 4, 5), 0);
  assert.equal(accessibility.nextTabIndex('ArrowLeft', 0, 5), 4);
  assert.equal(accessibility.nextTabIndex('Home', 3, 5), 0);
  assert.equal(accessibility.nextTabIndex('End', 1, 5), 4);
  assert.equal(accessibility.nextTabIndex('Enter', 1, 5), -1);
});

test('bridge errors are returned as safe results', async () => {
  const { bridge } = loadModules();
  const chromeLike = {
    runtime: {
      lastError: null,
      sendMessage(_message, callback) {
        chromeLike.runtime.lastError = { message: 'bridge-unavailable' };
        callback(undefined);
        chromeLike.runtime.lastError = null;
      },
    },
  };
  assert.deepEqual(
    JSON.parse(JSON.stringify(await bridge.send(chromeLike, { kind: 'fixture' }))),
    { error: 'bridge-unavailable' },
  );
});

test('collision placement selects a non-intersecting opposite edge or fails closed', () => {
  const { collision } = loadModules();
  const placed = collision.placement({
    viewport: { width: 1440, height: 900 },
    strip: { width: 300, height: 52 },
    dock: 'right',
    obstacles: [{ left: 1000, right: 1400, top: 700, bottom: 880 }],
  });
  assert.deepEqual(JSON.parse(JSON.stringify(placed)), { left: 260, top: 834 });
  const blocked = collision.placement({
    viewport: { width: 390, height: 300 },
    strip: { width: 360, height: 80 },
    dock: 'right',
    obstacles: [{ left: 0, right: 390, top: 0, bottom: 300 }],
  });
  assert.equal(blocked, null);
});

test('expired arms cannot keep collision mode active', () => {
  const { collision } = loadModules();
  const future = new Date(10_000).toISOString();
  const expired = new Date(1_000).toISOString();
  assert.equal(Boolean(collision.publicState({
    accountArm: { expiresAt: future },
  }, 5_000).accountArm), true);
  assert.equal(collision.publicState({
    dmArm: { expiresAt: expired },
  }, 5_000).dmArm, null);
});

test('countdown derives from immutable expiry and the model starts without an arm notice', () => {
  const { shared } = loadModules();
  const arm = { expiresAt: new Date(10_000).toISOString() };
  const before = JSON.stringify(arm);
  assert.equal(shared.countdownLabel(arm, 7_100), '3s remaining');
  assert.equal(shared.countdownLabel(arm, 10_001), 'Expired');
  assert.equal(JSON.stringify(arm), before);
  assert.equal(shared.createModel('fixture').armNotice, null);
});

test('floating layout clamps drag position, resize bounds, and opacity preferences', () => {
  const { layout, preferences } = loadModules();
  assert.deepEqual(
    JSON.parse(JSON.stringify(layout.constrainSize(
      { width: 2_000, height: 10 },
      { width: 1_000, height: 700 },
    ))),
    { width: 560, height: 280 },
  );
  assert.deepEqual(
    JSON.parse(JSON.stringify(layout.constrainPosition(
      { x: 900, y: -20 },
      { width: 380, height: 500 },
      { width: 1_000, height: 700 },
    ))),
    { x: 612, y: 8 },
  );
  const normalized = preferences.normalize({
    opacity: 0.4,
    panelHeight: 5_000,
    panelWidth: 100,
    position: { x: -10, y: 50_000 },
  });
  assert.equal(normalized.opacity, 0.7);
  assert.equal(normalized.panelWidth, 320);
  assert.equal(normalized.panelHeight, 1_200);
  assert.deepEqual(JSON.parse(JSON.stringify(normalized.position)), { x: 0, y: 10_000 });
});

test('follower checker migrates the legacy draft and compares both rendered lists locally', () => {
  const { shared } = loadModules();
  const normalizeUsername = (value) => String(value || '')
    .replace(/^@/, '')
    .replace(/^\/+/, '')
    .split('/')[0]
    .toLowerCase();
  const migrated = shared.migrateCaptureWorkspace({
    v1: {
      listType: 'following',
      capturedAt: '2026-08-01T00:00:00.000Z',
      following: [{ username: 'Mutual' }, { username: 'not_back' }],
    },
  }, normalizeUsername);
  assert.equal(migrated.source, 'v1');
  assert.equal(migrated.shouldPersist, true);
  const workspace = shared.normalizeCaptureWorkspace({
    ...migrated.workspace,
    followers: [{ username: 'mutual' }, { username: 'follower_only' }],
  }, normalizeUsername);
  const comparison = shared.compareCaptureWorkspace(workspace);
  assert.deepEqual(JSON.parse(JSON.stringify(
    comparison.mutuals.map((item) => item.username),
  )), ['mutual']);
  assert.deepEqual(JSON.parse(JSON.stringify(
    comparison.notFollowingMeBack.map((item) => item.username),
  )), ['not_back']);
  assert.deepEqual(JSON.parse(JSON.stringify(
    comparison.iDoNotFollowBack.map((item) => item.username),
  )), ['follower_only']);
  const exported = shared.captureRecord(workspace, 'followers', () => 'fallback');
  assert.equal(exported.kind, 'insta-aio-visible-list');
  assert.equal(exported.followers.length, 2);
  assert.equal('following' in exported, false);
});

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
const captureViewSource = await readFile(
  new URL('../extension/overlay/views/capture.js', import.meta.url),
  'utf8',
);
const queueViewSource = await readFile(
  new URL('../extension/overlay/views/queue.js', import.meta.url),
  'utf8',
);

function loadModules() {
  const context = vm.createContext({ console, Date, Intl });
  for (const name of moduleNames) vm.runInContext(sources[name], context);
  return context.__instaToolboxOverlayModules;
}

function loadQueueModules() {
  const context = vm.createContext({ console, Date, Intl });
  vm.runInContext(sources.shared, context);
  vm.runInContext(queueViewSource, context);
  return context.__instaToolboxOverlayModules;
}

function loadCaptureModules() {
  const context = vm.createContext({ console, Date, Intl, Map, AbortController });
  vm.runInContext(sources.shared, context);
  vm.runInContext(captureViewSource, context);
  return context.__instaToolboxOverlayModules;
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
    accent: 'violet',
    blur: 'strong',
    launcherPosition: { x: 900, y: -20 },
    launcherSize: 'large',
    opacity: 0.4,
    panelHeight: 5_000,
    panelWidth: 100,
    position: { x: -10, y: 50_000 },
  });
  assert.equal(normalized.opacity, 0.55);
  assert.equal(normalized.panelWidth, 320);
  assert.equal(normalized.panelHeight, 1_200);
  assert.deepEqual(JSON.parse(JSON.stringify(normalized.position)), { x: 0, y: 10_000 });
  assert.equal(normalized.accent, 'violet');
  assert.equal(normalized.blur, 'strong');
  assert.equal(normalized.launcherSize, 'large');
  assert.deepEqual(JSON.parse(JSON.stringify(normalized.launcherPosition)), { x: 900, y: 0 });
});

test('launcher dragging persists a clamped position and both resize corners stay wired', () => {
  const { layout } = loadModules();
  class FakeTarget extends EventTarget {
    constructor(rectangle = {}) {
      super();
      this.rectangle = rectangle;
      this.dataset = {};
      const values = new Map();
      this.style = {
        removeProperty(name) { values.delete(name); },
        setProperty(name, value) { values.set(name, value); },
      };
    }
    getBoundingClientRect() { return this.rectangle; }
  }
  const pointer = (type, properties) => {
    const event = new Event(type, { bubbles: false, cancelable: true });
    for (const [name, value] of Object.entries(properties)) {
      Object.defineProperty(event, name, { configurable: true, value });
    }
    return event;
  };
  const host = new FakeTarget();
  const launcher = new FakeTarget({ left: 900, top: 630, width: 44, height: 44 });
  const panel = new FakeTarget({ left: 300, right: 760, top: 60, width: 460, height: 500 });
  const moveHandle = new FakeTarget();
  const resizeStartHandle = new FakeTarget();
  const resizeEndHandle = new FakeTarget();
  const windowLike = new FakeTarget();
  windowLike.innerWidth = 1_000;
  windowLike.innerHeight = 700;
  const commits = [];
  const controller = layout.create({
    host,
    launcher,
    moveHandle,
    onCommit: (patch) => commits.push(JSON.parse(JSON.stringify(patch))),
    panel,
    resizeEndHandle,
    resizeStartHandle,
    window: windowLike,
  });
  controller.apply({ open: false });

  launcher.dispatchEvent(pointer('pointerdown', {
    button: 0, clientX: 910, clientY: 640, pointerId: 1,
  }));
  windowLike.dispatchEvent(pointer('pointermove', {
    clientX: 1_020, clientY: 750, pointerId: 1,
  }));
  windowLike.dispatchEvent(pointer('pointerup', {
    clientX: 1_020, clientY: 750, pointerId: 1,
  }));
  assert.deepEqual(commits.at(-1), { launcherPosition: { x: 948, y: 648 } });
  const suppressedClick = new Event('click', { cancelable: true });
  launcher.dispatchEvent(suppressedClick);
  assert.equal(suppressedClick.defaultPrevented, true, 'drag release must not also open the toolbox');

  resizeStartHandle.dispatchEvent(pointer('pointerdown', {
    button: 0, clientX: 300, clientY: 560, pointerId: 2,
  }));
  windowLike.dispatchEvent(pointer('pointerup', {
    clientX: 260, clientY: 600, pointerId: 2,
  }));
  assert.deepEqual(commits.at(-1), {
    panelHeight: 540,
    panelWidth: 500,
    position: { x: 260, y: 60 },
  });

  resizeEndHandle.dispatchEvent(pointer('keydown', { key: 'ArrowRight', shiftKey: false }));
  assert.equal(commits.at(-1).panelWidth, 512);
  controller.teardown();
});

test('Mutual Checker migrates the legacy draft and compares both rendered lists locally', () => {
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
  assert.equal(migrated.workspace.schemaVersion, 6);
  assert.equal(migrated.workspace.verified.following, false);
  assert.equal(migrated.workspace.complete.following, false);
  assert.deepEqual(
    JSON.parse(JSON.stringify(shared.verifiedCaptureAccounts(migrated.workspace, 'following'))),
    [],
  );
  assert.equal(
    captureViewSource.match(/shared\.verifiedCaptureAccounts\(workspace, listType\)/g)?.length,
    2,
    'both full and visible rescans must replace quarantined rows instead of promoting them',
  );
  assert.match(captureViewSource, /reason === 'list-count-mismatch'/);
  assert.match(captureViewSource, /Instagram reports \$\{expectedCount\}, so this capture stays incomplete/);
  assert.equal(shared.compareCaptureWorkspace(migrated.workspace).notFollowingMeBack.length, 0);
  const workspace = shared.normalizeCaptureWorkspace({
    ...migrated.workspace,
    schemaVersion: 6,
    followers: [{ username: 'mutual' }, { username: 'follower_only' }],
    verified: { followers: true, following: true },
    complete: { followers: true, following: true },
  }, normalizeUsername);
  assert.deepEqual(
    JSON.parse(JSON.stringify(shared.verifiedCaptureAccounts(workspace, 'following'))),
    JSON.parse(JSON.stringify(workspace.following)),
  );
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
  assert.equal(exported.kind, 'insta-toolbox-visible-list');
  assert.equal(exported.followers.length, 2);
  assert.equal(exported.verifiedDialog, true);
  assert.equal('following' in exported, false);
});

test('schema 3 list confidence is quarantined until a count-reconciled rescan', () => {
  const { shared } = loadModules();
  const normalizeUsername = (value) => String(value || '').replace(/^@/, '').toLowerCase();
  const migrated = shared.normalizeCaptureWorkspace({
    schemaVersion: 3,
    kind: 'insta-toolbox-visible-checker-workspace',
    followers: [],
    following: [{ username: 'alpha' }, { username: 'beta' }],
    capturedAt: { followers: null, following: '2026-08-20T00:00:00.000Z' },
    complete: { followers: false, following: true },
    verified: { followers: false, following: true },
  }, normalizeUsername);

  assert.equal(migrated.schemaVersion, 6);
  assert.equal(migrated.following.length, 2, 'stored rows remain available locally');
  assert.equal(migrated.verified.following, false);
  assert.equal(migrated.complete.following, false);
  assert.deepEqual(
    JSON.parse(JSON.stringify(shared.verifiedCaptureAccounts(migrated, 'following'))),
    [],
  );

  const rescanned = shared.normalizeCaptureWorkspace({
    ...migrated,
    schemaVersion: 6,
    complete: { followers: false, following: true },
    verified: { followers: false, following: true },
  }, normalizeUsername);
  assert.equal(rescanned.verified.following, true);
  assert.equal(rescanned.complete.following, true);
});

test('authenticated checker provenance is additive and supports an exact empty comparison', () => {
  const { shared } = loadModules();
  const normalizeUsername = (value) => String(value || '').replace(/^@/, '').toLowerCase();
  const workspace = shared.normalizeCaptureWorkspace({
    schemaVersion: 5,
    kind: 'insta-toolbox-visible-checker-workspace',
    subjectUsername: '@demo.creator',
    followers: [],
    following: [],
    capturedAt: {
      followers: '2026-08-22T00:00:00.000Z',
      following: '2026-08-22T00:00:00.000Z',
    },
    complete: { followers: true, following: true },
    verified: { followers: true, following: true },
    source: { followers: 'authenticated-web', following: 'authenticated-web' },
  }, normalizeUsername);

  assert.equal(workspace.schemaVersion, 6);
  assert.equal(workspace.subjectUsername, 'demo.creator');
  assert.deepEqual(JSON.parse(JSON.stringify(workspace.source)), {
    followers: 'authenticated-web',
    following: 'authenticated-web',
  });
  assert.deepEqual(JSON.parse(JSON.stringify(shared.compareCaptureWorkspace(workspace))), {
    mutuals: [],
    iDoNotFollowBack: [],
    notFollowingMeBack: [],
  });
  const exported = shared.captureRecord(workspace, 'followers');
  assert.equal(exported.kind, 'insta-toolbox-visible-list', 'the established export kind stays compatible');
  assert.equal(exported.subjectUsername, 'demo.creator');
  assert.equal(exported.verificationMethod, 'authenticated-web');
  assert.equal(exported.verifiedDialog, false);
});

test('authenticated checker publishes a comparison only after persistence succeeds', () => {
  assert.match(
    captureViewSource,
    /await runtime\.persistCapture\(nextCapture\);\s*model\.capture = nextCapture;/,
    'extension storage failures must leave the prior rendered comparison untouched',
  );
});

test('partial Mutual Checker data cannot produce a comparison or seed account actions', () => {
  const { queueView, shared } = loadQueueModules();
  const normalizeUsername = (value) => String(value || '').replace(/^@/, '').toLowerCase();
  const base = {
    schemaVersion: 6,
    subjectUsername: 'signed_in',
    followers: [{ username: 'mutual' }, { username: 'follower_only' }],
    following: [{ username: 'mutual' }, { username: 'not_back' }],
    verified: { followers: true, following: true },
    complete: { followers: true, following: true },
  };
  const complete = shared.normalizeCaptureWorkspace(base, normalizeUsername);
  const runtime = {
    inspector: {
      detectAuthenticatedUsername: () => 'signed_in',
      normalizeUsername,
    },
    model: { capture: complete },
  };

  assert.deepEqual(
    JSON.parse(JSON.stringify(queueView.botTargets(runtime, 'not-following-me-back', 'unfollow').pool)),
    ['not_back'],
  );
  assert.deepEqual(
    JSON.parse(JSON.stringify(queueView.botTargets(runtime, 'i-do-not-follow-back', 'follow').pool)),
    ['follower_only'],
  );

  runtime.model.capture = shared.normalizeCaptureWorkspace({
    ...base,
    subjectUsername: 'other_person',
  }, normalizeUsername);
  const wrongSubject = queueView.botTargets(runtime, 'not-following-me-back', 'unfollow');
  assert.deepEqual(JSON.parse(JSON.stringify(wrongSubject.pool)), []);
  assert.match(wrongSubject.skipped[0].reason, /signed-in account/i);
  runtime.model.capture = complete;

  for (const [listType, directSource] of [
    ['followers', 'scanned-followers'],
    ['following', 'scanned-following'],
  ]) {
    runtime.model.capture = shared.normalizeCaptureWorkspace({
      ...base,
      complete: { ...base.complete, [listType]: false },
    }, normalizeUsername);
    assert.deepEqual(JSON.parse(JSON.stringify(shared.compareCaptureWorkspace(runtime.model.capture))), {
      mutuals: [], iDoNotFollowBack: [], notFollowingMeBack: [],
    });
    for (const source of ['not-following-me-back', 'i-do-not-follow-back', directSource]) {
      const result = queueView.botTargets(runtime, source, source.includes('following-me') ? 'unfollow' : 'follow');
      assert.deepEqual(JSON.parse(JSON.stringify(result.pool)), []);
      assert.match(result.skipped[0].reason, /data is partial/i);
    }
  }

  const quarantined = shared.normalizeCaptureWorkspace({ ...base, schemaVersion: 3 }, normalizeUsername);
  runtime.model.capture = quarantined;
  assert.deepEqual(
    JSON.parse(JSON.stringify(queueView.botTargets(runtime, 'not-following-me-back', 'unfollow').pool)),
    [],
  );
  assert.equal(quarantined.followers.length, 2, 'partial rows remain available for display and export');
});

test('pre-3.1.5 dialog captures retain rows but lose unproven completion, while paginated captures survive', () => {
  const { shared } = loadModules();
  const normalizeUsername = (value) => String(value || '').toLowerCase();
  for (const method of ['list-dialog', 'authenticated-web', '']) {
    const migrated = shared.normalizeCaptureWorkspace({
      schemaVersion: 5,
      followers: [{ username: 'first' }], following: [{ username: 'second' }],
      verified: { followers: true, following: true },
      complete: { followers: true, following: true },
      source: { followers: method, following: method },
    }, normalizeUsername);
    assert.equal(migrated.schemaVersion, 6);
    assert.equal(migrated.followers.length, 1);
    assert.equal(migrated.following.length, 1);
    assert.equal(migrated.complete.followers, method === 'authenticated-web');
    assert.equal(migrated.complete.following, method === 'authenticated-web');
  }
});

test('extension complete rescans replace stale rows and partial rescans cannot be promoted', async () => {
  const { captureView, shared } = loadCaptureModules();
  const normalizeUsername = (value) => String(value || '').replace(/^@/, '').toLowerCase();
  const makeRuntime = (outcome) => ({
    inspector: {
      collectAccountList: async () => outcome,
      detectAuthenticatedUsername: () => 'signed_in',
      normalizeUsername,
    },
    model: {
      context: { pageKind: 'profile', username: 'signed_in' },
      capture: shared.normalizeCaptureWorkspace({
        schemaVersion: 5,
        subjectUsername: 'signed_in',
        followers: [{ username: 'stale' }],
        following: [],
        verified: { followers: true, following: false },
        complete: { followers: false, following: false },
        source: { followers: 'list-dialog', following: '' },
      }, normalizeUsername),
    },
    persistCapture: async () => {},
    query: () => null,
    status: () => {},
  });

  const completeRuntime = makeRuntime({
    accounts: [{ username: 'fresh' }],
    complete: true,
    expectedCount: 1,
    listType: 'followers',
  });
  await captureView.scanFullList(completeRuntime, 'followers');
  assert.deepEqual(
    JSON.parse(JSON.stringify(completeRuntime.model.capture.followers.map((account) => account.username))),
    ['fresh'],
  );
  assert.equal(completeRuntime.model.capture.complete.followers, true);

  const partialRuntime = makeRuntime({
    accounts: [{ username: 'fresh' }],
    complete: false,
    expectedCount: 2,
    listType: 'followers',
    reason: 'list-count-mismatch',
  });
  await captureView.scanFullList(partialRuntime, 'followers');
  assert.deepEqual(
    JSON.parse(JSON.stringify(partialRuntime.model.capture.followers.map((account) => account.username))),
    ['fresh', 'stale'],
  );
  assert.equal(partialRuntime.model.capture.complete.followers, false);

  const switchedAccountRuntime = makeRuntime({
    accounts: [{ username: 'fresh' }],
    complete: false,
    expectedCount: 2,
    listType: 'followers',
    reason: 'list-count-mismatch',
  });
  switchedAccountRuntime.model.capture.subjectUsername = 'other_person';
  await captureView.scanFullList(switchedAccountRuntime, 'followers');
  assert.deepEqual(
    JSON.parse(JSON.stringify(switchedAccountRuntime.model.capture.followers.map((account) => account.username))),
    ['fresh'],
  );
  assert.equal(switchedAccountRuntime.model.capture.subjectUsername, 'signed_in');

  const externalProfileRuntime = makeRuntime({
    accounts: [{ username: 'fresh' }],
    complete: false,
    expectedCount: 2,
    listType: 'followers',
    reason: 'list-count-mismatch',
  });
  externalProfileRuntime.model.context.username = 'external_b';
  externalProfileRuntime.model.capture.subjectUsername = 'external_a';
  await captureView.scanFullList(externalProfileRuntime, 'followers');
  assert.deepEqual(
    JSON.parse(JSON.stringify(externalProfileRuntime.model.capture.followers.map((account) => account.username))),
    ['fresh'],
  );
  assert.equal(externalProfileRuntime.model.capture.subjectUsername, 'external_b');
});

test('background comparison replaces storage only after both complete lists are verified', async () => {
  const { captureView, shared } = loadCaptureModules();
  const normalizeUsername = value => String(value || '').toLowerCase();
  const original = shared.normalizeCaptureWorkspace({
    subjectUsername: 'fixture_profile',
    followers: [{ username: 'previous_person' }], following: [{ username: 'previous_person' }],
    verified: { followers: true, following: true }, complete: { followers: true, following: true },
  }, normalizeUsername);
  let persisted = 0;
  let complete = false;
  const runtime = {
    inspector: {
      normalizeUsername,
      detectAuthenticatedUsername: () => 'fixture_profile',
      fetchFollowerComparison: async options => {
        assert.equal(options.mode, 'graphql');
        return {
          username: 'fixture_profile', capturedAt: '2026-09-08T00:00:00.000Z',
          followers: [{ username: 'new_person' }], following: [{ username: 'new_person' }],
          complete: { followers: complete, following: true }, expectedCounts: { followers: complete ? 1 : 2, following: 1 },
          reasons: {},
        };
      },
    },
    model: { context: { pageKind: 'profile', username: 'fixture_profile' }, capture: original },
    persistCapture: async () => { persisted += 1; }, query: () => null, status: () => {}, setText: () => {},
  };
  await captureView.checkAccount(runtime, 'graphql');
  assert.equal(runtime.model.capture, original);
  assert.equal(persisted, 0);
  complete = true;
  await captureView.checkAccount(runtime, 'graphql');
  assert.equal(persisted, 1);
  assert.equal(runtime.model.capture.followers[0].username, 'new_person');
});

test('follower comparison filters stay local, bounded, and category-specific', () => {
  const { shared } = loadModules();
  const comparison = {
    iDoNotFollowBack: [{ username: 'follower_only', displayName: 'Taylor North' }],
    mutuals: [{ username: 'mutual.friend', displayName: 'Morgan' }],
    notFollowingMeBack: [
      { username: 'alpha.friend', displayName: 'Alpha' },
      { username: 'beta_account', displayName: 'Taylor South' },
    ],
  };
  const searched = shared.filterComparisonResults(
    comparison,
    'not-following-me-back',
    '@TAYLOR',
  );
  assert.equal(searched.category, 'not-following-me-back');
  assert.equal(searched.total, 1);
  assert.deepEqual(
    JSON.parse(JSON.stringify(searched.accounts.map((account) => account.username))),
    ['beta_account'],
  );
  assert.equal(searched.truncated, false);

  const bounded = shared.filterComparisonResults(comparison, 'mutuals', '', 0);
  assert.equal(bounded.total, 1);
  assert.equal(bounded.accounts.length, 1);
  assert.equal(bounded.truncated, false);

  const fallback = shared.filterComparisonResults(comparison, 'unknown-category', '', 1);
  assert.equal(fallback.category, 'not-following-me-back');
  assert.equal(fallback.total, 2);
  assert.equal(fallback.accounts.length, 1);
  assert.equal(fallback.truncated, true);
});

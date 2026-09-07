import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const labelsSource = await readFile(new URL('../extension/action-labels.js', import.meta.url), 'utf8');
const contentSource = await readFile(new URL('../extension/content-instagram.js', import.meta.url), 'utf8');
const shellSource = await readFile(new URL('../userscripts/src/toolbox-shell.js', import.meta.url), 'utf8');
const bridgeSource = await readFile(new URL('../extension/overlay/bridge.js', import.meta.url), 'utf8');
const messagesSource = await readFile(new URL('../extension/overlay/views/messages.js', import.meta.url), 'utf8');
const metadata = await readFile(new URL('../userscripts/src/metadata.txt', import.meta.url), 'utf8');
const generated = await readFile(new URL('../userscripts/insta-toolbox.user.js', import.meta.url), 'utf8');
const extensionManifest = JSON.parse(
  await readFile(new URL('../extension/manifest.json', import.meta.url), 'utf8'),
);

function loadRunner(overrides = {}) {
  const context = vm.createContext({
    __instaToolboxTestHooks: true,
    clearTimeout,
    console,
    Date,
    DOMException,
    Event,
    EventTarget,
    innerHeight: 800,
    innerWidth: 1_280,
    Map,
    Math,
    Object,
    Promise,
    queueMicrotask,
    Set,
    setTimeout,
    ...overrides,
  });
  vm.runInContext(labelsSource, context, { filename: 'action-labels.js' });
  return context.InstaToolboxDmThreadUnsender;
}

function loadOverlayModule(source, name, overrides = {}) {
  const modules = {
    shared: {
      install(moduleName, value) { modules[moduleName] = value; },
      safeText(value, fallback) { return String(value || fallback || ''); },
    },
  };
  const context = vm.createContext({
    __instaToolboxOverlayModules: modules,
    clearTimeout,
    console,
    Date,
    Map,
    Object,
    Promise,
    Set,
    setTimeout,
    WeakMap,
    WeakSet,
    ...overrides,
  });
  vm.runInContext(source, context, { filename: `${name}.js` });
  return { context, module: modules[name] };
}

test('thread changes cancel pending work even without Firefox navigation events', async () => {
  const location = { pathname: '/direct/t/original/' };
  let notify;
  let disconnected = 0;
  const runner = loadRunner({
    location,
    document: { documentElement: {}, querySelectorAll: () => [] },
    MutationObserver: class {
      constructor(callback) { notify = callback; }
      observe() {}
      disconnect() { disconnected += 1; }
    },
  });
  const controller = new AbortController();
  const cleanup = runner.__test.watchThread(controller, 'original');
  notify();
  assert.equal(controller.signal.aborted, false, 'ordinary DOM changes keep the run alive');
  location.pathname = '/direct/t/other/';
  notify();
  assert.equal(controller.signal.aborted, true);
  assert.match(controller.signal.reason, /Conversation changed/);
  location.pathname = '/direct/t/original/';
  notify();
  assert.equal(controller.signal.aborted, true, 'returning cannot revive the run');
  assert.ok(disconnected > 0);
  cleanup();

  const fallback = new AbortController();
  const stopWatching = runner.__test.watchThread(fallback, 'original');
  location.pathname = '/direct/inbox/';
  await new Promise((resolve) => setTimeout(resolve, 250));
  assert.equal(fallback.signal.aborted, true, 'route-only changes are caught without DOM events');
  stopWatching();
});

test('switching thread during preparation stops the run with zero removals and allows a fresh run', async () => {
  const location = { pathname: '/direct/t/original/' };
  let notify;
  let switchThread = true;
  const view = { getComputedStyle: () => ({}) };
  const document = { documentElement: {}, querySelectorAll: () => [root] };
  const root = Object.assign(new EventTarget(), {
    isConnected: true,
    children: [],
    ownerDocument: { defaultView: view },
    getBoundingClientRect: () => ({ width: 100, height: 100, top: 0, left: 0, right: 100, bottom: 100 }),
    scrollHeight: 100,
    clientHeight: 100,
    scrollTop: 0,
    removeAttribute() {},
  });
  const runner = loadRunner({
    AbortController, location, document,
    MutationObserver: class {
      constructor(callback) { notify = callback; }
      observe() {}
      disconnect() {}
    },
  });
  root.addEventListener('scroll', () => {
    if (switchThread) {
      location.pathname = '/direct/t/other/';
      notify();
    } else runner.stop();
  });
  let ledgerWrites = 0;
  const run = () => runner.start({
    plan: runner.createPlan({ threadId: 'original', scope: 'all', expiresAt: Date.now() + 60_000 }),
    onVerifiedRemoval() { ledgerWrites += 1; },
  });
  const outcome = await run();
  assert.equal(outcome.status, 'stopped');
  assert.equal(outcome.processed, 0);
  assert.equal(outcome.canStop, false);
  assert.equal(ledgerWrites, 0);
  location.pathname = '/direct/t/original/';
  switchThread = false;
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal((await run()).status, 'stopped');
});

test('thread runner carries the proven 0.7.2 interaction model', () => {
  for (const expected of [
    "[data-pagelet='IGDMessagesList']",
    "justifyContent === 'flex-end'",
    "[role=\"none\"], [role=\"presentation\"]",
    "flexDirection === 'column-reverse'",
    "new PointerEvent('pointerenter'",
    "new MouseEvent('mouseenter'",
    'MAX_SCAN_PASSES = 3',
    'STABLE_EMPTY_PASSES = 3',
    'DEFAULT_MAX_FAILURES = 5',
    'Math.min(15_000',
    '1_000',
    '2_000',
    "'zurücknehmen'",
  ]) assert.match(labelsSource, new RegExp(expected.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(labelsSource, /function revealActionButton\(row, signal\)/);
  assert.match(labelsSource, /function openUnsendMenu\(control, signal, expectedThreadId, authorizationExpiresAt\)/);
  assert.match(labelsSource, /function confirmUnsend\(menuControl, row, signal, expectedThreadId, authorizationExpiresAt\)/);
  assert.match(labelsSource, /function dialogUnsendCandidates\(existing = new Set\(\)\)/);
  assert.match(labelsSource, /filter\(dialogControlHasUnsendLabel\)/);
  assert.match(labelsSource, /function loadAllHistory\(context, signal\)/);
  assert.match(
    labelsSource,
    /function nextSentRow\(\s*context,\s*signal,\s*order = 'newest'/,
  );
  assert.match(labelsSource, /function createPlan\(value = \{\}\)/);
  assert.match(labelsSource, /function createTraversal\(order = 'newest'\)/);
  assert.match(labelsSource, /function stableMessageKey\(row\)/);
  assert.match(labelsSource, /function inspectAll\(\)/);
  assert.doesNotMatch(labelsSource, /graphql|private[_ -]?api|cookie|password/i);
});

test('message-options label accepts current text-only control and rejects Reply', () => {
  const context = vm.createContext({ console });
  vm.runInContext(labelsSource, context);
  const labels = context.__instaToolboxActionLabels;
  assert.equal(labels.isDmMessageOptionsLabel('See more options for message from demo.creator'), true);
  assert.equal(labels.isDmMessageOptionsLabel('Reply'), false);
});

test('extension bridge rejects empty replies and ignores replies after its watchdog fires', async () => {
  const { module: bridge } = loadOverlayModule(bridgeSource, 'bridge');
  const empty = await bridge.send({
    runtime: {
      lastError: null,
      sendMessage(_message, callback) { callback(undefined); },
    },
  }, { kind: 'insta-toolbox-reserve-thread-unsend' }, { timeoutMs: 20 });
  assert.equal(empty.error, 'extension-bridge-empty-response');

  let lateCallback;
  const pending = bridge.send({
    runtime: {
      lastError: null,
      sendMessage(_message, callback) { lateCallback = callback; },
    },
  }, { kind: 'insta-toolbox-reserve-thread-unsend' }, { timeoutMs: 10 });
  const timedOut = await pending;
  assert.equal(timedOut.error, 'extension-bridge-timeout');
  lateCallback({ reservation: { id: 'thread-unsend-too-late' } });
  await new Promise((resolve) => { setTimeout(resolve, 5); });
  assert.equal(timedOut.error, 'extension-bridge-timeout');
});

test('DM button makes zero clicks for malformed or stalled reservation proof', async () => {
  async function exercise(sendBridge) {
    let starts = 0;
    let confirmations = 0;
    let bridgeCalls = 0;
    const runner = {
      createPlan(value) {
        return {
          ...value,
          version: 2,
          reviewedDigest: 'a1b2c3d4',
        };
      },
      inspect: () => ({ ready: true, threadId: 'thread-123' }),
      snapshot: () => ({
        canStop: false, failed: 0, message: 'Ready', processed: 0, retryAttempts: 0, status: 'idle',
      }),
      start: async () => {
        starts += 1;
        return { failed: 0, processed: 0, status: 'completed' };
      },
      stop: () => false,
    };
    const quickTimer = (callback, timeout, ...args) => setTimeout(callback, Math.min(timeout, 10), ...args);
    const { module: messagesView } = loadOverlayModule(messagesSource, 'messagesView', {
      clearTimeout,
      InstaToolboxDmThreadUnsender: runner,
      location: { pathname: '/direct/t/thread-123/' },
      setTimeout: quickTimer,
    });
    const statuses = [];
    const runtime = {
      document: { createElement: () => ({}) },
      model: {},
      query(selector) {
        if (selector === '[data-insta-toolbox-role="unsend-scope"]') return { closest: () => null, value: 'all' };
        if (selector === '[data-insta-toolbox-role="unsend-count"]') return { closest: () => null, value: '1' };
        return null;
      },
      sendBridge(message) {
        bridgeCalls += 1;
        return sendBridge(message);
      },
      setText() {},
      shadow: { append() {} },
      status(message, tone) { statuses.push({ message, tone }); },
      async confirmAction(request) {
        confirmations += 1;
        return request.binding;
      },
    };
    const first = messagesView.massUnsend(runtime);
    await Promise.resolve();
    const duplicate = messagesView.massUnsend(runtime);
    await Promise.all([first, duplicate]);
    return { bridgeCalls, confirmations, messagesView, runtime, starts, statuses };
  }

  const malformed = await exercise(async () => ({}));
  assert.equal(malformed.starts, 0);
  assert.equal(malformed.bridgeCalls, 1, 'the pending lock suppresses duplicate reservations');
  assert.equal(malformed.confirmations, 1);
  assert.match(malformed.statuses.at(-1).message, /Could not reserve/);

  let resolveLate;
  const stalled = await exercise(() => new Promise((resolve) => { resolveLate = resolve; }));
  assert.equal(stalled.starts, 0, 'the watchdog expires before runner.start can click');
  assert.equal(stalled.bridgeCalls, 1);
  resolveLate({
    pacing: { maxDelayMs: 2_000, minDelayMs: 1_000 },
    reservation: {
      count: null,
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      failed: 0,
      id: 'thread-unsend-lateproof1',
      processed: 0,
      reservedAt: new Date().toISOString(),
      reviewedDigest: 'a1b2c3d4',
      scope: 'all',
      status: 'reserved',
      threadId: 'thread-123',
    },
  });
  await new Promise((resolve) => { setTimeout(resolve, 15); });
  assert.equal(stalled.starts, 0, 'a late response cannot revive an expired run');
});

test('DM reservation proof must exactly match the reviewed plan before execution', () => {
  const runner = {
    snapshot: () => ({ status: 'idle' }),
    subscribe: () => () => {},
  };
  const { module: messagesView } = loadOverlayModule(messagesSource, 'messagesView', {
    InstaToolboxDmThreadUnsender: runner,
    location: { pathname: '/direct/t/thread-123/' },
  });
  const plan = {
    expiresAt: Date.now() + 60_000,
    limit: null,
    reviewedDigest: 'a1b2c3d4',
    scope: 'all',
    threadId: 'thread-123',
  };
  const response = {
    pacing: { maxDelayMs: 2_000, minDelayMs: 1_000 },
    reservation: {
      count: null,
      expiresAt: new Date(plan.expiresAt).toISOString(),
      failed: 0,
      id: 'thread-unsend-validproof1',
      processed: 0,
      reservedAt: new Date().toISOString(),
      reviewedDigest: plan.reviewedDigest,
      scope: plan.scope,
      status: 'reserved',
      threadId: plan.threadId,
    },
  };
  assert.equal(messagesView.reservationMatchesPlan(response, plan), true);
  assert.equal(messagesView.reservationMatchesPlan({
    ...response,
    reservation: { ...response.reservation, processed: 1 },
  }, plan), false);
  assert.equal(messagesView.reservationMatchesPlan({
    ...response,
    reservation: { ...response.reservation, threadId: 'thread-wrong' },
  }, plan), false);
  assert.equal(messagesView.reservationMatchesPlan({
    ...response,
    pacing: { maxDelayMs: 500, minDelayMs: 100 },
  }, plan), false);
  assert.equal(messagesView.reservationMatchesPlan({
    ...response,
    pacing: { maxDelayMs: '2000', minDelayMs: '1000' },
  }, plan), false);
});

test('thread runner chooses the text-only message menu instead of Reply', () => {
  const runner = loadRunner();
  const ownerDocument = {
    defaultView: {
      getComputedStyle: () => ({ display: 'block', visibility: 'visible' }),
      innerHeight: 800,
      innerWidth: 1_280,
    },
    documentElement: {},
  };
  const control = (text) => ({
    closest() { return this; },
    getAttribute: () => '',
    getBoundingClientRect: () => ({ bottom: 60, height: 40, left: 10, right: 110, top: 20, width: 100 }),
    isConnected: true,
    matches: () => true,
    ownerDocument,
    parentElement: ownerDocument.documentElement,
    textContent: text,
  });
  const reply = control('Reply');
  const options = control('See more options for message from demo.creator');
  const row = {
    contains: (candidate) => candidate === reply || candidate === options,
    querySelectorAll: (selector) => (selector === "[role='button']" ? [reply, options] : []),
  };
  assert.equal(runner.__test.actionButton(row), options);
});

test('thread runner resolves one compact-drawer thread and gives the exact route precedence', () => {
  const view = {
    getComputedStyle: () => ({ display: 'block', visibility: 'visible' }),
    innerHeight: 800,
    innerWidth: 1_280,
  };
  const documentElement = {};
  const ownerDocument = { defaultView: view, documentElement };
  const visible = (attributes = {}) => ({
    getAttribute: (name) => attributes[name] || '',
    getBoundingClientRect: () => ({ bottom: 60, height: 40, left: 10, right: 110, top: 20, width: 100 }),
    isConnected: true,
    ownerDocument,
    parentElement: documentElement,
  });
  const root = visible();
  const threadLink = visible({ href: '/direct/t/456/' });
  const document = {
    querySelectorAll(selector) {
      if (selector === "[data-pagelet='IGDMessagesList']") return [root];
      if (selector === "a[href*='/direct/t/']") return [threadLink];
      return [];
    },
  };
  const drawerRunner = loadRunner({ document, location: { pathname: '/demo.creator/' } });
  assert.equal(drawerRunner.__test.currentThreadId(), '456');

  const routedRunner = loadRunner({ document, location: { pathname: '/direct/t/123/' } });
  assert.equal(routedRunner.__test.currentThreadId(), '123');

  document.querySelectorAll = (selector) => (
    selector === "[data-pagelet='IGDMessagesList']" ? [root] : [threadLink, visible({ href: '/direct/t/789/' })]
  );
  const ambiguousRunner = loadRunner({ document, location: { pathname: '/demo.creator/' } });
  assert.equal(ambiguousRunner.__test.currentThreadId(), '');
});

test('sent-message ownership requires the message row or its descendants to align right', () => {
  const runner = loadRunner();
  const right = { children: [], style: { justifyContent: 'flex-end' } };
  const left = { children: [], style: { justifyContent: 'flex-start' } };
  const row = {
    children: [left, { children: [right], style: { justifyContent: 'normal' } }],
    getAttribute: () => '',
    style: { justifyContent: 'normal' },
  };
  const view = { getComputedStyle: (element) => element.style };
  assert.equal(runner.__test.sentByCurrentUser(row, view), true);
  assert.equal(runner.__test.sentByCurrentUser({ ...row, children: [left] }, view), false);
  assert.equal(runner.__test.sentByCurrentUser({ ...row, getAttribute: () => 'false' }, view), false);
  assert.equal(runner.__test.sentByCurrentUser({ ...row, getAttribute: () => 'true' }, view), true);
});

test('visibility excludes message rows clipped by the thread scroller', () => {
  const runner = loadRunner();
  const documentElement = { parentElement: null };
  const view = {
    getComputedStyle: (element) => element.style || {},
    innerHeight: 800,
    innerWidth: 1_280,
  };
  const ownerDocument = { defaultView: view, documentElement };
  const scroller = {
    getBoundingClientRect: () => ({ bottom: 500, height: 400, left: 0, right: 600, top: 100, width: 600 }),
    ownerDocument,
    parentElement: documentElement,
    style: { overflowX: 'hidden', overflowY: 'auto' },
  };
  const row = {
    getBoundingClientRect: () => ({ bottom: 560, height: 40, left: 20, right: 300, top: 520, width: 280 }),
    isConnected: true,
    ownerDocument,
    parentElement: scroller,
  };

  // A row entirely below the scroller is not actionable.
  assert.equal(runner.__test.isVisible(row), false);
  // Nor is a two-pixel sliver whose hidden action button cannot be revealed.
  row.getBoundingClientRect = () => ({ bottom: 102, height: 40, left: 20, right: 300, top: 62, width: 280 });
  assert.equal(runner.__test.isVisible(row), false);
  row.getBoundingClientRect = () => ({ bottom: 240, height: 40, left: 20, right: 300, top: 200, width: 280 });
  assert.equal(runner.__test.isVisible(row), true);
  // A message taller than the scroller remains eligible when a usable portion is visible.
  row.getBoundingClientRect = () => ({ bottom: 560, height: 500, left: 20, right: 300, top: 60, width: 280 });
  assert.equal(runner.__test.isVisible(row), true);
  scroller.style = { overflowX: 'visible', overflowY: 'visible' };
  row.getBoundingClientRect = () => ({ bottom: 560, height: 40, left: 20, right: 300, top: 520, width: 280 });
  assert.equal(runner.__test.isVisible(row), true);
});

test('column-reverse detection matches Instagram thread paging', () => {
  const runner = loadRunner();
  const reversed = {
    ownerDocument: { defaultView: { getComputedStyle: () => ({ flexDirection: 'column-reverse' }) } },
    scrollTop: 0,
  };
  const normal = {
    ownerDocument: { defaultView: { getComputedStyle: () => ({ flexDirection: 'column' }) } },
    scrollTop: 0,
  };
  assert.equal(runner.__test.reversedLayout(reversed), true);
  assert.equal(runner.__test.reversedLayout(normal), false);
  normal.scrollTop = -10;
  assert.equal(runner.__test.reversedLayout(normal), true);
});

test('virtualized mounted-row high-water is advisory, not a conversation total', () => {
  const runner = loadRunner();
  let progress = { maxHeight: 3_041, maxRows: 4 };
  progress = runner.__test.advanceHistoryProgress(progress, 3_041, 7);
  assert.equal(progress.grew, true);
  assert.equal(progress.maxRows, 7);

  // Current Instagram can alternate between four and seven structurally
  // provable sent rows while the same oldest-boundary DOM is stationary.
  // Falling back to four and returning to seven is virtualization churn, not
  // another history page.
  progress = runner.__test.advanceHistoryProgress(progress, 3_041, 4);
  assert.equal(progress.grew, false);
  progress = runner.__test.advanceHistoryProgress(progress, 3_041, 7);
  assert.equal(progress.grew, false);

  progress = runner.__test.advanceHistoryProgress(progress, 3_400, 8);
  assert.equal(progress.grew, true);
  assert.equal(progress.maxHeight, 3_400);
  assert.equal(progress.maxRows, 8);

  const inspectBody = labelsSource.slice(
    labelsSource.indexOf('async function inspectAll'),
    labelsSource.indexOf('async function start'),
  );
  assert.match(inspectBody, /detectedCount/);
  assert.match(inspectBody, /countExact: false/);
  assert.match(inspectBody, /At least/);
  assert.doesNotMatch(inspectBody, /eligibleCount/);
});

test('a recycled virtual row is eligible again when its logical message changes', () => {
  const runner = loadRunner();
  const documentElement = { parentElement: null };
  const view = {
    getComputedStyle: (element) => element.style || { display: 'block', visibility: 'visible' },
    innerHeight: 800,
    innerWidth: 1_280,
  };
  const ownerDocument = { defaultView: view, documentElement };
  const attributes = new Map([
    ['data-message-id', 'message-1'],
    ['data-sent-by-me', 'true'],
  ]);
  let text = 'First logical message';
  const leaf = {
    getAttribute: () => '',
    getBoundingClientRect: () => ({ bottom: 80, height: 30, left: 20, right: 300, top: 50, width: 280 }),
    ownerDocument,
    parentElement: null,
    querySelector: () => null,
    textContent: text,
  };
  const row = {
    children: [],
    getAttribute: (name) => attributes.get(name) || '',
    getBoundingClientRect: () => ({ bottom: 90, height: 50, left: 10, right: 310, top: 40, width: 300 }),
    hasAttribute: (name) => attributes.has(name),
    isConnected: true,
    ownerDocument,
    parentElement: null,
    querySelector: (selector) => (selector.includes('[role="none"]') ? leaf : null),
    querySelectorAll: (selector) => (selector === '[dir="auto"]' ? [leaf] : []),
    removeAttribute: (name) => attributes.delete(name),
    setAttribute: (name, value) => attributes.set(name, String(value)),
  };
  const scroller = {
    children: [row],
    ownerDocument,
    parentElement: documentElement,
  };
  row.parentElement = scroller;
  leaf.parentElement = row;
  const traversal = runner.__test.createTraversal('newest');

  runner.__test.markProcessedRow(row, traversal, 'data-message-id:message-1');
  assert.equal(runner.__test.candidateRows(scroller, traversal).length, 0);

  attributes.set('data-message-id', 'message-2');
  text = 'Second logical message';
  leaf.textContent = text;
  assert.equal(runner.__test.candidateRows(scroller, traversal).length, 1);
  assert.equal(attributes.has('data-insta-toolbox-unsent'), false);
});

test('newest and oldest finite scopes follow visual geometry in normal and reversed layouts', () => {
  const runner = loadRunner();

  function exercise(flexDirection) {
    const documentElement = { parentElement: null };
    const view = {
      getComputedStyle: (element) => element.style || { display: 'block', visibility: 'visible' },
      innerHeight: 800,
      innerWidth: 1_280,
    };
    const ownerDocument = { defaultView: view, documentElement };
    const scroller = {
      children: [],
      getBoundingClientRect: () => ({ bottom: 500, height: 400, left: 0, right: 600, top: 100, width: 600 }),
      ownerDocument,
      parentElement: documentElement,
      style: { flexDirection, overflowY: 'auto' },
    };
    const makeRow = (id, top) => {
      const leaf = { textContent: id };
      const row = {
        children: [],
        getAttribute(name) {
          if (name === 'data-message-id') return id;
          if (name === 'data-sent-by-me') return 'true';
          return '';
        },
        getBoundingClientRect: () => ({ bottom: top + 40, height: 40, left: 20, right: 320, top, width: 300 }),
        hasAttribute: () => false,
        ownerDocument,
        parentElement: scroller,
        querySelector: (selector) => (selector.includes('[role="none"]') ? leaf : null),
        querySelectorAll: () => [],
      };
      return row;
    };
    const oldest = makeRow('oldest', 140);
    const middle = makeRow('middle', 240);
    const newest = makeRow('newest', 340);
    scroller.children = flexDirection === 'column-reverse'
      ? [newest, middle, oldest]
      : [oldest, middle, newest];
    const traversal = runner.__test.createTraversal('newest');
    traversal.scroller = scroller;

    assert.deepEqual(
      Array.from(
        runner.__test.orderedCandidates(scroller, 'newest', traversal),
        (row) => row.getAttribute('data-message-id'),
      ),
      ['newest', 'middle', 'oldest'],
    );
    assert.deepEqual(
      Array.from(
        runner.__test.orderedCandidates(scroller, 'oldest', traversal),
        (row) => row.getAttribute('data-message-id'),
      ),
      ['oldest', 'middle', 'newest'],
    );
  }

  exercise('column');
  exercise('column-reverse');
});

test('generic slot IDs and duplicate id-less text cannot alias processed messages across positions', () => {
  const runner = loadRunner();
  const documentElement = { parentElement: null };
  const view = {
    getComputedStyle: (element) => element.style || { display: 'block', visibility: 'visible' },
    innerHeight: 800,
    innerWidth: 1_280,
  };
  const ownerDocument = { defaultView: view, documentElement };
  const scroller = {
    children: [],
    getBoundingClientRect: () => ({ bottom: 500, height: 400, left: 0, right: 600, top: 100, width: 600 }),
    ownerDocument,
    parentElement: documentElement,
    scrollTop: 0,
    style: { flexDirection: 'column', overflowY: 'auto' },
  };
  const makeRow = (top) => {
    const attributes = new Map([
      ['data-id', 'recycled-slot-1'],
      ['data-sent-by-me', 'true'],
    ]);
    const leaf = { textContent: 'Same duplicate message' };
    const row = {
      children: [],
      getAttribute: (name) => attributes.get(name) || '',
      getBoundingClientRect: () => ({ bottom: top + 40, height: 40, left: 20, right: 320, top, width: 300 }),
      hasAttribute: (name) => attributes.has(name),
      ownerDocument,
      parentElement: scroller,
      querySelector: (selector) => (selector.includes('[role="none"]') ? leaf : null),
      querySelectorAll: (selector) => (selector === '[dir="auto"]' ? [leaf] : []),
      removeAttribute: (name) => attributes.delete(name),
      setAttribute: (name, value) => attributes.set(name, String(value)),
    };
    return row;
  };
  const first = makeRow(140);
  const duplicate = makeRow(240);
  scroller.children = [first, duplicate];
  const traversal = runner.__test.createTraversal('newest');
  traversal.scroller = scroller;

  assert.equal(runner.__test.stableMessageKey(first), null, 'generic slot IDs are not logical message authority');
  assert.notEqual(
    runner.__test.messageFingerprint(first, traversal),
    runner.__test.messageFingerprint(duplicate, traversal),
    'same-text rows retain distinct structural positions',
  );
  runner.__test.markProcessedRow(first, traversal, null);
  assert.deepEqual(Array.from(runner.__test.candidateRows(scroller, traversal)), [duplicate]);

  scroller.scrollTop = 500;
  assert.equal(
    runner.__test.candidateRows(scroller, traversal).includes(first),
    true,
    'a recycled slot at another virtual position is eligible again',
  );
});

test('streaming traversal keeps its position unless the scroller shrinks or is replaced', () => {
  const runner = loadRunner();
  const traversal = runner.__test.createTraversal('newest');
  const scroller = { scrollHeight: 1_000, scrollTop: 420 };
  traversal.scroller = scroller;
  traversal.lastScrollTop = 400;

  runner.__test.resetTraversalAfterRemoval(traversal, scroller, { scroller, scrollHeight: 1_000 });
  assert.equal(traversal.lastScrollTop, 420, 'persistent placeholders must not force a return to the edge');

  scroller.scrollHeight = 800;
  runner.__test.resetTraversalAfterRemoval(traversal, scroller, { scroller, scrollHeight: 1_000 });
  assert.equal(traversal.lastScrollTop, null, 'a shrinking list restarts from the requested edge');

  const replacement = { scrollHeight: 800, scrollTop: 200 };
  traversal.lastScrollTop = 200;
  runner.__test.resetTraversalAfterRemoval(traversal, replacement, { scroller, scrollHeight: 800 });
  assert.equal(traversal.lastScrollTop, null, 'a replaced virtual scroller restarts safely');
});

test('finite traversal re-establishes its requested edge after virtual replacement or shrink', async () => {
  const runner = loadRunner();
  const signal = { aborted: false, addEventListener: () => {} };

  async function exercise(order, reversed, resetKind) {
    const documentElement = { parentElement: null };
    const view = {
      getComputedStyle: (element) => element.style || {},
      innerHeight: 800,
      innerWidth: 1_280,
    };
    const ownerDocument = { defaultView: view, documentElement };
    let logicalMessages = Array.from({ length: 6 }, (_, index) => ({ id: `message-${index}` }));
    let edgeDispatches = 0;

    function makeScroller(scrollHeight = 1_200) {
      const scroller = Object.assign(new EventTarget(), {
        children: [],
        clientHeight: 200,
        getBoundingClientRect: () => ({ bottom: 400, height: 300, left: 0, right: 600, top: 100, width: 600 }),
        ownerDocument,
        parentElement: documentElement,
        querySelectorAll: () => [],
        scrollHeight,
        scrollTop: 0,
        style: {
          flexDirection: reversed ? 'column-reverse' : 'column',
          overflowX: 'hidden',
          overflowY: 'auto',
        },
      });

      function mountedRow(message, slot) {
        const top = 150 + (slot * 70);
        const leaf = {
          getAttribute: () => '',
          getBoundingClientRect: () => ({ bottom: top + 28, height: 28, left: 30, right: 320, top, width: 290 }),
          ownerDocument,
          parentElement: null,
          querySelector: () => null,
          textContent: message.id,
        };
        const row = {
          children: [],
          getAttribute(name) {
            if (name === 'data-message-id') return message.id;
            if (name === 'data-sent-by-me') return 'true';
            return '';
          },
          getBoundingClientRect: () => ({ bottom: top + 40, height: 40, left: 20, right: 330, top, width: 310 }),
          hasAttribute: () => false,
          isConnected: true,
          ownerDocument,
          parentElement: scroller,
          querySelector: (selector) => (selector.includes('[role="none"]') ? leaf : null),
          querySelectorAll: (selector) => (selector === '[dir="auto"]' ? [leaf] : []),
          removeAttribute: () => {},
          scrollIntoView: () => {},
        };
        leaf.parentElement = row;
        return row;
      }

      function renderWindow() {
        const range = Math.max(1, scroller.scrollHeight - scroller.clientHeight);
        const progress = reversed
          ? (Number(scroller.scrollTop) + range) / range
          : Number(scroller.scrollTop) / range;
        const clamped = Math.max(0, Math.min(1, progress));
        const start = Math.round(clamped * Math.max(0, logicalMessages.length - 2));
        scroller.children = logicalMessages.slice(start, start + 2).map(mountedRow);
      }

      scroller.mountAt = (edge) => {
        const range = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
        scroller.scrollTop = edge === 'oldest'
          ? (reversed ? -range : 0)
          : (reversed ? 0 : range);
        renderWindow();
      };
      scroller.addEventListener('scroll', () => {
        edgeDispatches += 1;
        renderWindow();
      });
      return scroller;
    }

    const firstScroller = makeScroller();
    firstScroller.mountAt(order);
    const traversal = runner.__test.createTraversal(order);
    traversal.scroller = firstScroller;
    traversal.lastScrollTop = runner.__test.traversalBounds(firstScroller, order).start;
    traversal.lastScrollHeight = firstScroller.scrollHeight;
    if (order === 'oldest') traversal.oldestBoundaryProven = true;

    const first = await runner.__test.nextSentRow(
      { scroller: firstScroller },
      signal,
      order,
      traversal,
    );
    const firstExpected = order === 'newest' ? 'message-5' : 'message-0';
    assert.equal(first.getAttribute('data-message-id'), firstExpected);
    logicalMessages = logicalMessages.filter((message) => message.id !== firstExpected);

    const before = { scroller: firstScroller, scrollHeight: firstScroller.scrollHeight };
    const nextScroller = resetKind === 'replacement' ? makeScroller() : firstScroller;
    if (resetKind === 'shrink') nextScroller.scrollHeight -= 200;
    nextScroller.mountAt(order === 'newest' ? 'oldest' : 'newest');
    runner.__test.resetTraversalAfterRemoval(traversal, nextScroller, before);
    if (order === 'oldest') {
      assert.equal(traversal.oldestBoundaryProven, false, 'replacement or shrink invalidates the oldest-edge proof');
      // This matrix isolates edge repositioning. The delayed-history regression
      // below exercises the real bounded proof before a second row is returned.
      traversal.oldestBoundaryProven = true;
    }

    const secondExpected = order === 'newest' ? 'message-4' : 'message-1';
    assert.equal(
      nextScroller.children.some((row) => row.getAttribute('data-message-id') === secondExpected),
      false,
      'the deliberately wrong mounted window must not contain the next authorized message',
    );
    const dispatchesBeforeSelection = edgeDispatches;
    const second = await runner.__test.nextSentRow(
      { scroller: nextScroller },
      signal,
      order,
      traversal,
    );
    assert.equal(
      second.getAttribute('data-message-id'),
      secondExpected,
      `${order} ${reversed ? 'reversed' : 'normal'} ${resetKind} traversal must return to its authorized edge`,
    );
    assert.ok(edgeDispatches > dispatchesBeforeSelection, 'edge reset must happen before selecting a mounted row');
  }

  for (const order of ['newest', 'oldest']) {
    for (const reversed of [false, true]) {
      await exercise(order, reversed, 'replacement');
      await exercise(order, reversed, 'shrink');
    }
  }
});

test('oldest traversal waits for delayed history after virtual scroller replacement', async () => {
  for (const reversed of [false, true]) {
    const documentElement = { parentElement: null };
    const view = {
      getComputedStyle: (element) => element.style || {},
      innerHeight: 800,
      innerWidth: 1_280,
    };
    const ownerDocument = { defaultView: view, documentElement };
    const root = {
      children: [],
      getBoundingClientRect: () => ({ bottom: 500, height: 450, left: 0, right: 700, top: 50, width: 700 }),
      isConnected: true,
      ownerDocument,
      parentElement: documentElement,
      querySelectorAll: () => [],
      style: {},
    };
    const document = {
      documentElement,
      querySelectorAll(selector) {
        return selector === "[data-pagelet='IGDMessagesList']" ? [root] : [];
      },
    };
    const runner = loadRunner({ document, location: { pathname: '/direct/t/thread-delayed/' } });
    const signal = { aborted: false, addEventListener: () => {} };

    function makeScroller(initialMessages, { loadOlder = false } = {}) {
      let logicalMessages = [...initialMessages];
      let loadScheduled = false;
      const scroller = Object.assign(new EventTarget(), {
        children: [],
        clientHeight: 200,
        getBoundingClientRect: () => ({ bottom: 400, height: 300, left: 0, right: 600, top: 100, width: 600 }),
        isConnected: true,
        ownerDocument,
        parentElement: root,
        querySelectorAll: () => [],
        scrollHeight: 1_200,
        scrollTop: 0,
        style: {
          flexDirection: reversed ? 'column-reverse' : 'column',
          overflowX: 'hidden',
          overflowY: 'auto',
        },
      });

      function mountedRow(id, slot) {
        const top = 150 + (slot * 70);
        const leaf = {
          getAttribute: () => '',
          getBoundingClientRect: () => ({ bottom: top + 28, height: 28, left: 30, right: 320, top, width: 290 }),
          isConnected: true,
          ownerDocument,
          parentElement: null,
          querySelector: () => null,
          textContent: id,
        };
        const row = {
          children: [],
          getAttribute(name) {
            if (name === 'data-message-id') return id;
            if (name === 'data-sent-by-me') return 'true';
            return '';
          },
          getBoundingClientRect: () => ({ bottom: top + 40, height: 40, left: 20, right: 330, top, width: 310 }),
          hasAttribute: () => false,
          isConnected: true,
          ownerDocument,
          parentElement: scroller,
          querySelector: (selector) => (selector.includes('[role="none"]') ? leaf : null),
          querySelectorAll: (selector) => (selector === '[dir="auto"]' ? [leaf] : []),
          removeAttribute: () => {},
          scrollIntoView: () => {},
        };
        leaf.parentElement = row;
        return row;
      }

      function renderWindow() {
        const range = Math.max(1, scroller.scrollHeight - scroller.clientHeight);
        const progress = reversed
          ? (Number(scroller.scrollTop) + range) / range
          : Number(scroller.scrollTop) / range;
        const start = Math.round(Math.max(0, Math.min(1, progress)) * Math.max(0, logicalMessages.length - 2));
        scroller.children = logicalMessages.slice(start, start + 2).map(mountedRow);
      }

      scroller.mountOldest = () => {
        const range = scroller.scrollHeight - scroller.clientHeight;
        scroller.scrollTop = reversed ? -range : 0;
        renderWindow();
      };
      scroller.addEventListener('scroll', () => {
        renderWindow();
        if (!loadOlder || loadScheduled) return;
        loadScheduled = true;
        setTimeout(() => {
          logicalMessages = ['message-1', ...logicalMessages];
          scroller.scrollHeight += 240;
          renderWindow();
        }, 40);
      });
      scroller.mountOldest();
      return scroller;
    }

    const firstScroller = makeScroller([
      'message-0', 'message-1', 'message-2', 'message-3', 'message-4', 'message-5',
    ]);
    root.children = [firstScroller];
    const traversal = runner.__test.createTraversal('oldest');
    traversal.scroller = firstScroller;
    traversal.lastScrollTop = runner.__test.traversalBounds(firstScroller, 'oldest').start;
    traversal.lastScrollHeight = firstScroller.scrollHeight;
    traversal.oldestBoundaryProven = true;

    const first = await runner.__test.nextSentRow(
      { root, scroller: firstScroller, threadId: 'thread-delayed' },
      signal,
      'oldest',
      traversal,
      Date.now() + 30_000,
    );
    assert.equal(first.getAttribute('data-message-id'), 'message-0');

    const replacement = makeScroller(
      ['message-2', 'message-3', 'message-4', 'message-5'],
      { loadOlder: true },
    );
    root.children = [replacement];
    runner.__test.resetTraversalAfterRemoval(
      traversal,
      replacement,
      { scroller: firstScroller, scrollHeight: firstScroller.scrollHeight },
    );
    assert.equal(traversal.oldestBoundaryProven, false);

    let callerCanOpenMenu = false;
    const selection = runner.__test.nextSentRow(
      { root, scroller: replacement, threadId: 'thread-delayed' },
      signal,
      'oldest',
      traversal,
      Date.now() + 30_000,
    ).then((row) => {
      callerCanOpenMenu = true;
      return row;
    });
    await new Promise((resolve) => { setTimeout(resolve, 250); });
    assert.equal(
      callerCanOpenMenu,
      false,
      'the next menu cannot open while delayed oldest history is still stabilizing',
    );

    const second = await selection;
    assert.equal(
      second.getAttribute('data-message-id'),
      'message-1',
      `${reversed ? 'reversed' : 'normal'} traversal must select the true next oldest message`,
    );
    assert.equal(traversal.oldestBoundaryProven, true);
  }
});

test('the next comfortably visible message row is not repositioned before hover', async () => {
  const runner = loadRunner();
  const documentElement = { parentElement: null };
  const view = {
    getComputedStyle: (element) => element.style || {},
    innerHeight: 800,
    innerWidth: 1_280,
  };
  const ownerDocument = { defaultView: view, documentElement };
  let scrollCalls = 0;
  const scroller = Object.assign(new EventTarget(), {
    clientHeight: 200,
    children: [],
    getBoundingClientRect: () => ({ bottom: 300, height: 200, left: 0, right: 600, top: 100, width: 600 }),
    ownerDocument,
    parentElement: documentElement,
    scrollHeight: 200,
    scrollTop: 0,
    style: { overflowX: 'hidden', overflowY: 'auto' },
  });
  const row = {
    children: [],
    getAttribute: (name) => (name === 'data-sent-by-me' ? 'true' : ''),
    getBoundingClientRect: () => ({ bottom: 190, height: 40, left: 20, right: 300, top: 150, width: 280 }),
    hasAttribute: () => false,
    isConnected: true,
    ownerDocument,
    parentElement: scroller,
    querySelector: () => ({}),
    scrollIntoView: (options) => {
      assert.equal(options.block, 'center');
      assert.equal(options.inline, 'nearest');
      scrollCalls += 1;
    },
  };
  scroller.children.push(row);

  const selected = await runner.__test.nextSentRow(
    { scroller },
    { aborted: false, addEventListener: () => {} },
  );
  assert.equal(selected, row);
  assert.equal(scrollCalls, 0);
});

test('a clipped sent-message row is centered once before hover', async () => {
  const runner = loadRunner();
  const documentElement = { parentElement: null };
  const view = {
    getComputedStyle: (element) => element.style || {},
    innerHeight: 800,
    innerWidth: 1_280,
  };
  const ownerDocument = { defaultView: view, documentElement };
  let scrollCalls = 0;
  let exposed = false;
  const scroller = Object.assign(new EventTarget(), {
    clientHeight: 200,
    children: [],
    getBoundingClientRect: () => ({ bottom: 300, height: 200, left: 0, right: 600, top: 100, width: 600 }),
    ownerDocument,
    parentElement: documentElement,
    scrollHeight: 200,
    scrollTop: 0,
    style: { overflowX: 'hidden', overflowY: 'auto' },
  });
  const row = {
    children: [],
    getAttribute: (name) => (name === 'data-sent-by-me' ? 'true' : ''),
    getBoundingClientRect: () => (exposed
      ? { bottom: 190, height: 40, left: 20, right: 300, top: 150, width: 280 }
      : { bottom: 118, height: 40, left: 20, right: 300, top: 78, width: 280 }),
    hasAttribute: () => false,
    isConnected: true,
    ownerDocument,
    parentElement: scroller,
    querySelector: () => ({}),
    scrollIntoView: (options) => {
      assert.equal(options.block, 'center');
      assert.equal(options.inline, 'nearest');
      exposed = true;
      scrollCalls += 1;
    },
  };
  scroller.children.push(row);

  const selected = await runner.__test.nextSentRow(
    { scroller },
    { aborted: false, addEventListener: () => {} },
  );
  assert.equal(selected, row);
  assert.equal(scrollCalls, 1);
});

test('whole-scroll streaming finds sent rows beyond replaced virtual windows', async () => {
  const runner = loadRunner();

  async function exercise(reversed) {
    const documentElement = { parentElement: null };
    const view = {
      getComputedStyle: (element) => element.style || {},
      innerHeight: 800,
      innerWidth: 1_280,
    };
    const ownerDocument = { defaultView: view, documentElement };
    const sentIndexes = new Set([18, 22, 26, 30]);
    const logical = Array.from({ length: 40 }, (_, index) => ({
      id: `logical-${index}`,
      mine: sentIndexes.has(index),
    }));
    const range = 1_000;
    const windowSize = 5;
    let renderedWindows = 0;
    let mountedSentHighWater = 0;
    const scroller = Object.assign(new EventTarget(), {
      children: [],
      clientHeight: 200,
      getBoundingClientRect: () => ({ bottom: 300, height: 200, left: 0, right: 600, top: 100, width: 600 }),
      ownerDocument,
      parentElement: documentElement,
      scrollHeight: range + 200,
      scrollTop: 0,
      style: {
        flexDirection: reversed ? 'column-reverse' : 'column',
        overflowX: 'hidden',
        overflowY: 'auto',
      },
    });

    function mountedRow(message, slot) {
      const leaf = {
        getAttribute: () => '',
        getBoundingClientRect: () => ({
          bottom: 150 + (slot * 28),
          height: 24,
          left: 20,
          right: 300,
          top: 126 + (slot * 28),
          width: 280,
        }),
        ownerDocument,
        parentElement: null,
        querySelector: () => null,
        textContent: `Message ${message.id}`,
      };
      const row = {
        children: [],
        getAttribute: (name) => {
          if (name === 'data-message-id') return message.id;
          if (name === 'data-sent-by-me') return String(message.mine);
          return '';
        },
        getBoundingClientRect: () => ({
          bottom: 160 + (slot * 28),
          height: 28,
          left: 10,
          right: 310,
          top: 132 + (slot * 28),
          width: 300,
        }),
        hasAttribute: () => false,
        isConnected: true,
        ownerDocument,
        parentElement: scroller,
        querySelector: (selector) => (selector.includes('[role="none"]') ? leaf : null),
        querySelectorAll: (selector) => (selector === '[dir="auto"]' ? [leaf] : []),
        removeAttribute: () => {},
        scrollIntoView: () => {},
      };
      leaf.parentElement = row;
      return row;
    }

    function renderWindow() {
      const ratio = reversed
        ? Math.min(1, Math.abs(scroller.scrollTop) / range)
        : Math.min(1, Math.max(0, range - scroller.scrollTop) / range);
      const start = Math.min(logical.length - windowSize, Math.floor(ratio * (logical.length - windowSize)));
      scroller.children = logical.slice(start, start + windowSize).map(mountedRow);
      mountedSentHighWater = Math.max(
        mountedSentHighWater,
        scroller.children.filter((row) => row.getAttribute('data-sent-by-me') === 'true').length,
      );
      renderedWindows += 1;
    }
    scroller.addEventListener('scroll', renderWindow);
    renderWindow();

    const selected = await runner.__test.nextSentRow(
      { scroller },
      { aborted: false, addEventListener: () => {} },
      'newest',
      runner.__test.createTraversal('newest'),
    );
    assert.ok(selected, `${reversed ? 'reversed' : 'normal'} virtual scroller should yield a sent row`);
    assert.equal(sentIndexes.has(Number(selected.getAttribute('data-message-id').split('-')[1])), true);
    assert.ok(renderedWindows > 2, 'the iterator must move beyond the initially mounted window');
    assert.ok(mountedSentHighWater < sentIndexes.size, 'one mounted window must not be treated as the total');
  }

  await exercise(false);
  await exercise(true);
});

test('Unsend requires message-row change instead of treating a hidden hover control as success', () => {
  const runner = loadRunner();
  const view = { getComputedStyle: () => ({}) };
  const leaf = (text) => ({
    getAttribute: () => '',
    getBoundingClientRect: () => ({ width: 100, height: 20 }),
    ownerDocument: { defaultView: view },
    querySelector: () => null,
    textContent: text,
  });
  let text = 'Disposable message';
  const row = {
    isConnected: true,
    querySelector: () => ({}),
    querySelectorAll: () => [leaf(text)],
  };
  const before = runner.__test.removalEvidence(row);
  assert.equal(runner.__test.removalProven(row, before), false);
  text = 'You unsent a message';
  assert.equal(runner.__test.removalProven(row, before), true);
  row.isConnected = false;
  assert.equal(runner.__test.removalProven(row, before), true);
});

test('thread-wide Unsend requires an untampered v2 thread-specific reviewed plan', async () => {
  const runner = loadRunner();
  const result = await runner.start();
  assert.equal(result.status, 'error');
  assert.match(result.message, /thread-specific reviewed plan is required/);

  const all = runner.createPlan({
    threadId: 'thread-123',
    scope: 'all',
    detectedCount: 7,
    expiresAt: Date.now() + 60_000,
  });
  assert.equal(all.version, 2);
  assert.equal(all.limit, null);
  assert.equal(all.scope, 'all');
  assert.equal(all.detectedCount, 7);
  assert.match(all.reviewedDigest, /^[0-9a-f]{8}$/);
  assert.equal(runner.__test.validatePlan(all).reviewedDigest, all.reviewedDigest);
  const allWithoutDiagnostic = runner.createPlan({
    threadId: 'thread-123',
    scope: 'all',
    expiresAt: Date.now() + 60_000,
  });
  assert.equal(allWithoutDiagnostic.detectedCount, null);
  assert.equal(
    runner.__test.validatePlan(allWithoutDiagnostic).reviewedDigest,
    allWithoutDiagnostic.reviewedDigest,
  );

  const newest = runner.createPlan({
    threadId: 'thread-123',
    scope: 'newest',
    limit: 3,
    expiresAt: Date.now() + 60_000,
  });
  assert.equal(newest.limit, 3);
  assert.equal(runner.__test.validatePlan(newest).reviewedDigest, newest.reviewedDigest);
  const oldest = runner.createPlan({
    threadId: 'thread-123',
    scope: 'oldest',
    limit: 2,
    expiresAt: Date.now() + 60_000,
  });
  assert.equal(oldest.limit, 2);
  assert.equal(runner.__test.validatePlan(oldest).reviewedDigest, oldest.reviewedDigest);
  assert.equal(runner.createPlan({
    threadId: 'thread-123',
    scope: 'oldest',
    expiresAt: Date.now() + 60_000,
  }), null);
  assert.equal(runner.createPlan({
    threadId: 'thread-123',
    scope: 'all',
    expiresAt: Date.now() - 1,
  }), null);
  assert.equal(runner.createPlan({
    threadId: 'thread-123',
    scope: 'everything',
    expiresAt: Date.now() + 60_000,
  }), null);

  const tampered = await runner.start({ plan: { ...all, detectedCount: 6 } });
  assert.equal(tampered.status, 'error');
  assert.match(tampered.message, /thread-specific reviewed plan is required/);
  const wrongVersion = await runner.start({ plan: { ...all, version: 3 } });
  assert.equal(wrongVersion.status, 'error');
});

test('primary execution never performs a history prescan or exact-count equality gate', () => {
  const startBody = labelsSource.slice(
    labelsSource.indexOf('async function start'),
    labelsSource.indexOf('function stop'),
  );
  assert.doesNotMatch(startBody, /loadAllHistory/);
  assert.doesNotMatch(startBody, /eligibleCount|currentEligibleCount/);
  assert.match(startBody, /nextSentRow/);
  assert.match(startBody, /stableEmptyPasses/);
  assert.match(startBody, /consumedPlanDigests\.has\(plan\.reviewedDigest\)/);
  assert.match(startBody, /This reviewed Unsend plan was already used/);
});

test('extension message view uses the shared runner and Instagram design tokens', () => {
  assert.match(messagesSource, /globalThis\.InstaToolboxDmThreadUnsender/);
  assert.match(messagesSource, /DM_PLAN_TTL_MS = 15 \* 60 \* 1_000/);
  assert.match(messagesSource, /threadId: inspection\.threadId/);
  assert.doesNotMatch(messagesSource, /phrase = `UNSEND|ARM UNSEND|ENABLE LIVE ACTIONS/);
  assert.match(messagesSource, /data-insta-toolbox-action="mass-unsend"/);
  assert.match(messagesSource, /'Unsend DMs'/);
  assert.match(messagesSource, /Permanently unsend \$\{scopeLabel\} in this conversation/);
  assert.match(messagesSource, /Thread \$\{plan\.threadId\}/);
  assert.match(messagesSource, /await runtime\.confirmAction\(\{/);
  assert.match(messagesSource, /confirmedInspection\.threadId !== plan\.threadId/);
  assert.doesNotMatch(messagesSource, /runtime\.window\.confirm|globalThis\.confirm/);
  assert.match(messagesSource, /Canceled\. Nothing was removed\./);
  assert.match(messagesSource, /--ig-primary-background/);
  assert.match(messagesSource, /--ig-primary-button/);
  assert.match(messagesSource, /prefers-reduced-motion/);
  assert.match(labelsSource, /authorizationExpiresAt <= Date\.now\(\)/);
  assert.match(labelsSource, /context\.threadId !== expectedThreadId/);
  assert.doesNotMatch(labelsSource, /currentEligibleCount|plan\.eligibleCount/);
  assert.match(labelsSource, /PLAN_VERSION = 2/);
  assert.match(labelsSource, /const currentContext = threadContext\(\)/);
  assert.match(labelsSource, /STABLE_EMPTY_PASSES = 3/);
  assert.match(labelsSource, /complete: quietRounds >= 10/);
  assert.match(labelsSource, /countExact: false/);
  assert.match(labelsSource, /MAX_HISTORY_CHECK_MS = 90_000/);
  assert.match(messagesSource, /kind: 'insta-toolbox-reserve-thread-unsend'/);
  assert.match(messagesSource, /reservation\.pacing\?\.minDelayMs/);
  assert.match(labelsSource, /const order = plan\.scope === 'oldest' \? 'oldest' : 'newest'/);
  assert.match(labelsSource, /unsendCandidates\(document\)\.filter\(\(candidate\) => !existing\.has\(candidate\)\)/);
  assert.match(labelsSource, /Instagram showed more than one new Unsend option/);
  assert.doesNotMatch(messagesSource, /\bAI\b/i);
});

test('Tampermonkey entry point auto-updates from main and embeds the shared sources', () => {
  // Assert the shape, not one release, so a version bump does not fail here.
  const userscriptVersion = metadata.match(/@version\s+(\d+\.\d+\.\d+)/)?.[1];
  assert.equal(userscriptVersion, extensionManifest.version);
  assert.match(metadata, /@sandbox\s+DOM/);
  assert.match(metadata, /@grant\s+GM_getTab/);
  assert.match(metadata, /@grant\s+GM_saveTab/);
  assert.match(metadata, /@downloadURL\s+https:\/\/github\.com\/slaveofsolace\/Insta-Toolbox\/releases\/latest\/download\/insta-toolbox\.user\.js/);
  assert.doesNotMatch(metadata, /@require|@resource/);
  assert.equal(generated.startsWith(metadata), true);
  assert.ok(generated.includes(labelsSource.trim()), 'thread runner is embedded verbatim');
  assert.ok(generated.includes(contentSource.trim()), 'exact-target engine is embedded verbatim');
  assert.ok(generated.includes(shellSource.trim()), 'toolbox shell is embedded verbatim');
  assert.match(generated, /Generated file\. Do not edit\./);
  assert.match(generated, /InstaToolboxDmThreadUnsender/);
  assert.doesNotMatch(generated, /\bAI\b/i);
});

test('optional read-only history inspection remains bounded at the oldest edge', () => {
  // inspectAll may still wake Instagram's oldest-history loader, but primary
  // execution is separately proven not to call this diagnostic path.
  const body = labelsSource.slice(
    labelsSource.indexOf('async function loadAllHistory'),
    labelsSource.indexOf('async function nextSentRow'),
  );
  assert.match(body, /scroller\.scrollTop = oldestOffset\(scroller, reversed\);/);
  assert.doesNotMatch(body, /scroller\.scrollTop = newestOffset\(scroller, reversed\);/);
  // Instagram pauses between pages, so a handful of quiet rounds must not be
  // read as the end of the conversation.
  assert.match(body, /quietRounds < 10/);
  assert.match(body, /page < 600/);
  assert.match(body, /Date\.now\(\) - startedAt < MAX_HISTORY_CHECK_MS/);
  assert.match(body, /advanceHistoryProgress/);
  assert.match(body, /let topNudgeUsed = false/);
  assert.match(body, /!topNudgeUsed && quietRounds >= 2/);
});

test('finite oldest scope proves a stable boundary before the first destructive search', () => {
  const startBody = labelsSource.slice(
    labelsSource.indexOf('async function start'),
    labelsSource.indexOf('function stop'),
  );
  const boundaryBody = labelsSource.slice(
    labelsSource.indexOf('async function proveStableOldestBoundary'),
    labelsSource.indexOf('function markProcessedRow'),
  );
  assert.match(startBody, /if \(plan\.scope === 'oldest'\)/);
  assert.match(startBody, /await proveStableOldestBoundary\(/);
  assert.match(boundaryBody, /MAX_HISTORY_CHECK_MS/);
  assert.match(boundaryBody, /before\.scroller !== after\.scroller/);
  assert.match(boundaryBody, /before\.height !== after\.height/);
  assert.match(boundaryBody, /after\.loaderVisible/);
  assert.match(boundaryBody, /OLDEST_BOUNDARY_STABLE_MS/);
  assert.ok(
    startBody.indexOf('await proveStableOldestBoundary(') < startBody.indexOf('await nextSentRow('),
    'oldest-boundary proof must complete before any row can expose a message menu',
  );
});

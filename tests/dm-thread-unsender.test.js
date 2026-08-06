import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const labelsSource = await readFile(new URL('../extension/action-labels.js', import.meta.url), 'utf8');
const contentSource = await readFile(new URL('../extension/content-instagram.js', import.meta.url), 'utf8');
const shellSource = await readFile(new URL('../userscripts/src/toolbox-shell.js', import.meta.url), 'utf8');
const messagesSource = await readFile(new URL('../extension/overlay/views/messages.js', import.meta.url), 'utf8');
const metadata = await readFile(new URL('../userscripts/src/metadata.txt', import.meta.url), 'utf8');
const generated = await readFile(new URL('../userscripts/insta-aio-companion.user.js', import.meta.url), 'utf8');
const extensionManifest = JSON.parse(
  await readFile(new URL('../extension/manifest.json', import.meta.url), 'utf8'),
);

function loadRunner() {
  const context = vm.createContext({
    __instaAioTestHooks: true,
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
  });
  vm.runInContext(labelsSource, context, { filename: 'action-labels.js' });
  return context.InstaAioDmThreadUnsender;
}

test('thread runner carries the proven 0.7.2 interaction model', () => {
  for (const expected of [
    "[data-pagelet='IGDMessagesList']",
    "justifyContent === 'flex-end'",
    "[role=\"none\"], [role=\"presentation\"]",
    "flexDirection === 'column-reverse'",
    "new PointerEvent('pointerenter'",
    "new MouseEvent('mouseenter'",
    'MAX_SCAN_PASSES = 3',
    'DEFAULT_MAX_FAILURES = 5',
    'Math.min(60_000',
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
  assert.match(labelsSource, /function nextSentRow\(context, signal\)/);
  assert.doesNotMatch(labelsSource, /graphql|private[_ -]?api|cookie|password/i);
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

test('the next visible message row is centered before its hover control is requested', async () => {
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
    children: [],
    getBoundingClientRect: () => ({ bottom: 300, height: 200, left: 0, right: 600, top: 100, width: 600 }),
    ownerDocument,
    parentElement: documentElement,
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
  assert.equal(scrollCalls, 1);
});

test('thread-wide Unsend refuses to start without a live authorization expiry', async () => {
  const runner = loadRunner();
  const result = await runner.start();
  assert.equal(result.status, 'error');
  assert.match(result.message, /Live authorization is required/);
});

test('extension message view uses the shared runner and Instagram design tokens', () => {
  assert.match(messagesSource, /globalThis\.InstaAioDmThreadUnsender/);
  assert.match(messagesSource, /MASS_UNSEND_ARM_PHRASE = 'UNSEND ALL DMS'/);
  assert.match(messagesSource, /threadId: inspection\.threadId/);
  assert.match(messagesSource, /expectedThreadId: massArm\.threadId/);
  assert.match(messagesSource, /Unsend all DMs/);
  assert.match(messagesSource, /--ig-primary-background/);
  assert.match(messagesSource, /--ig-primary-button/);
  assert.match(messagesSource, /prefers-reduced-motion/);
  assert.match(messagesSource, /Exact message ID, timestamp, digest, conversation, and sent-by-me ownership must all match/);
  assert.match(labelsSource, /authorizationExpiresAt <= Date\.now\(\)/);
  assert.match(labelsSource, /context\.threadId !== expectedThreadId/);
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
  assert.match(metadata, /@downloadURL\s+https:\/\/raw\.githubusercontent\.com\/slaveofsolace\/Insta-AIO-Tool\/main\/userscripts\/insta-aio-companion\.user\.js/);
  assert.doesNotMatch(metadata, /@require|@resource/);
  assert.equal(generated.startsWith(metadata), true);
  assert.ok(generated.includes(labelsSource.trim()), 'thread runner is embedded verbatim');
  assert.ok(generated.includes(contentSource.trim()), 'exact-target engine is embedded verbatim');
  assert.ok(generated.includes(shellSource.trim()), 'toolbox shell is embedded verbatim');
  assert.match(generated, /Generated file\. Do not edit\./);
  assert.match(generated, /InstaAioDmThreadUnsender/);
  assert.doesNotMatch(generated, /\bAI\b/i);
});

test('history is loaded to the top and the run then works down from there', () => {
  // The run used to load all history and then jump back to the newest message,
  // so removals started at the bottom and worked upward. Reaching the top and
  // staying there is both faster and easier to follow.
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
});

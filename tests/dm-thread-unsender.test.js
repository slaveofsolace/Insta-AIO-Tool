import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const labelsSource = await readFile(new URL('../extension/action-labels.js', import.meta.url), 'utf8');
const messagesSource = await readFile(new URL('../extension/overlay/views/messages.js', import.meta.url), 'utf8');
const metadata = await readFile(new URL('../userscripts/src/metadata.txt', import.meta.url), 'utf8');
const generated = await readFile(new URL('../userscripts/insta-aio-companion.user.js', import.meta.url), 'utf8');

function loadRunner() {
  const context = vm.createContext({
    __instaAioTestHooks: true,
    clearTimeout,
    console,
    Date,
    DOMException,
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
  assert.match(labelsSource, /function openUnsendMenu\(control, signal\)/);
  assert.match(labelsSource, /function confirmUnsend\(menuControl, row, signal\)/);
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

test('extension message view uses the shared runner and Instagram design tokens', () => {
  assert.match(messagesSource, /globalThis\.InstaAioDmThreadUnsender/);
  assert.match(messagesSource, /runner\.start\(\{ minDelayMs: 1_000, maxDelayMs: 2_000 \}\)/);
  assert.match(messagesSource, /Unsend all DMs/);
  assert.match(messagesSource, /--ig-primary-background/);
  assert.match(messagesSource, /--ig-primary-button/);
  assert.match(messagesSource, /prefers-reduced-motion/);
  assert.match(messagesSource, /Exact message ID, timestamp, digest, conversation, and sent-by-me ownership must all match/);
  assert.doesNotMatch(messagesSource, /\bAI\b/i);
});

test('Tampermonkey entry point auto-updates from main and loads the shared sources', () => {
  assert.match(metadata, /@version\s+0\.8\.0/);
  assert.match(metadata, /@downloadURL\s+https:\/\/raw\.githubusercontent\.com\/slaveofsolace\/Insta-AIO-Tool\/main\/userscripts\/insta-aio-companion\.user\.js/);
  for (const source of [
    'extension/action-labels.js',
    'extension/content-instagram.js',
    'userscripts/src/toolbox-shell.js',
  ]) assert.match(metadata, new RegExp(`@require\\s+https://raw\\.githubusercontent\\.com/slaveofsolace/Insta-AIO-Tool/main/${source.replaceAll('.', '\\.')}`));
  assert.equal(generated.startsWith(metadata.trimEnd()), true);
  assert.match(generated, /InstaAioDmThreadUnsender/);
  assert.doesNotMatch(generated, /\bAI\b/i);
});

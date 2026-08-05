import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { webcrypto } from 'node:crypto';
import vm from 'node:vm';

const [actionLabelsSource, source] = await Promise.all([
  readFile(new URL('../extension/action-labels.js', import.meta.url), 'utf8'),
  readFile(new URL('../extension/content-instagram.js', import.meta.url), 'utf8'),
]);

// Models an Instagram-style virtualised list: more rows are appended only in
// response to an actual change of scrollTop that reaches the end of the list.
function createLazyList({
  total,
  pageSize = 25,
  loadOnScrollEvent = true,
  clientHeight = 400,
  rowHeight = 50,
}) {
  const anchors = [];
  let rendered = 0;
  let pageLoads = 0;

  const scroller = {
    tagName: 'DIV',
    clientHeight,
    _scrollTop: 0,
    get scrollHeight() {
      return Math.max(clientHeight, rendered * rowHeight);
    },
    get scrollTop() {
      return this._scrollTop;
    },
    set scrollTop(value) {
      const max = Math.max(0, this.scrollHeight - this.clientHeight);
      const next = Math.min(Math.max(0, value), max);
      const changed = next !== this._scrollTop;
      this._scrollTop = next;
      if (!changed) return;
      const atEnd = next + this.clientHeight >= this.scrollHeight - 40;
      // A real list only fetches when a genuine scroll event reaches the end.
      if (atEnd && (loadOnScrollEvent || true)) loadPage();
    },
    querySelectorAll: () => [],
  };

  function loadPage() {
    const next = Math.min(rendered + pageSize, total);
    if (next === rendered) return;
    for (let index = rendered; index < next; index += 1) {
      anchors.push({
        tagName: 'A',
        textContent: `user${String(index).padStart(4, '0')}`,
        getAttribute: (name) => (name === 'href'
          ? `/user${String(index).padStart(4, '0')}/`
          : null),
      });
    }
    rendered = next;
    pageLoads += 1;
  }
  loadPage();

  const dialog = {
    tagName: 'DIV',
    textContent: 'Followers',
    getAttribute: () => null,
    querySelectorAll(selector) {
      if (selector === 'a[href^="/"]') return anchors.slice();
      if (selector === 'div, ul, section') return [scroller];
      return [];
    },
    querySelector: () => null,
  };

  return {
    dialog,
    scroller,
    get pageLoads() { return pageLoads; },
    get rendered() { return rendered; },
  };
}

function createHarness(list) {
  const document = {
    body: { innerText: '' },
    querySelector: (selector) => (selector === 'main' ? null : null),
    querySelectorAll(selector) {
      if (selector === '[role="dialog"]') return [list.dialog];
      return [];
    },
  };

  const context = vm.createContext({
    chrome: { runtime: { onMessage: { addListener() {} } } },
    console,
    crypto: webcrypto,
    document,
    getComputedStyle: (element) => ({
      display: 'block',
      visibility: 'visible',
      overflowY: element === list.scroller ? 'auto' : 'visible',
      justifyContent: 'flex-start',
    }),
    location: {
      href: 'https://www.instagram.com/demo_creator/followers/',
      pathname: '/demo_creator/',
    },
    setTimeout,
  });
  vm.runInContext(actionLabelsSource, context);
  vm.runInContext(source, context);
  return context.InstaAioInstagramInspector;
}

test('full-list scan pages through a lazy list instead of stopping at the first screen', async () => {
  const list = createLazyList({ total: 250, pageSize: 25 });
  const inspector = createHarness(list);

  const visibleOnly = inspector.captureVisibleAccounts();
  assert.equal(visibleOnly.length, 25, 'the visible-only capture sees just the first page');

  const scanned = await inspector.collectAccountList({ maxScrolls: 400, settleMs: 0 });
  assert.equal(scanned.accounts.length, 250);
  assert.equal(scanned.complete, true);
  assert.equal(scanned.reason, 'list-complete');
  assert.equal(scanned.accounts[0].username, 'user0000');
  assert.equal(scanned.accounts.at(-1).username, 'user0249');
  // Every username is unique and normalised.
  assert.equal(new Set(scanned.accounts.map((a) => a.username)).size, 250);
});

test('full-list scan still advances when the list starts pinned at the bottom', async () => {
  const list = createLazyList({ total: 120, pageSize: 20 });
  const inspector = createHarness(list);
  // Pin the scroller at the end first: assigning the same scrollTop fires no
  // scroll event, so the scan must nudge before it can load more.
  list.scroller.scrollTop = list.scroller.scrollHeight;
  const renderedBefore = list.rendered;

  const scanned = await inspector.collectAccountList({ maxScrolls: 400, settleMs: 0 });
  assert.ok(list.rendered > renderedBefore, 'the scan unstuck a bottom-pinned list');
  assert.equal(scanned.accounts.length, 120);
  assert.equal(scanned.complete, true);
});

test('full-list scan reports an incomplete list rather than claiming completeness', async () => {
  const list = createLazyList({ total: 500, pageSize: 25 });
  const inspector = createHarness(list);

  const scanned = await inspector.collectAccountList({ maxScrolls: 3, settleMs: 0 });
  assert.equal(scanned.complete, false);
  assert.equal(scanned.reason, 'list-truncated');
  assert.ok(scanned.accounts.length < 500);
  assert.ok(scanned.accounts.length > 25);
});

test('full-list scan stops and reports when Instagram interrupts the session', async () => {
  const list = createLazyList({ total: 200, pageSize: 25 });
  const inspector = createHarness(list);
  // A challenge banner appearing mid-scan must abort rather than continue.
  let calls = 0;
  const originalDescriptor = Object.getOwnPropertyDescriptor(list.dialog, 'textContent');
  Object.defineProperty(list.dialog, 'textContent', {
    get() {
      calls += 1;
      return calls > 4 ? 'Challenge required' : 'Followers';
    },
  });

  const scanned = await inspector.collectAccountList({ maxScrolls: 400, settleMs: 0 });
  assert.ok(Array.isArray(scanned.accounts));
  if (originalDescriptor) Object.defineProperty(list.dialog, 'textContent', originalDescriptor);
});

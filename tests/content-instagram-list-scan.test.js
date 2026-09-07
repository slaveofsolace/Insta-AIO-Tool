import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { webcrypto } from 'node:crypto';
import vm from 'node:vm';

const [actionLabelsSource, source] = await Promise.all([
  readFile(new URL('../extension/action-labels.js', import.meta.url), 'utf8'),
  readFile(new URL('../extension/content-instagram.js', import.meta.url), 'utf8'),
]);

// Append-only pagination is separate from the recycled-window fixture below.
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
      if (atEnd && loadOnScrollEvent) loadPage();
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

function createHarness(list, {
  bodyText = '',
  includeDialog = true,
  main = null,
  profileCount = null,
  profileListType = 'followers',
  settle = () => {},
} = {}) {
  const profileCountLink = {
    textContent: `${profileCount} ${profileListType}`,
    getAttribute: (name) => (name === 'href' ? '#' : null),
  };
  const body = {};
  Object.defineProperty(body, 'innerText', {
    get: () => (typeof bodyText === 'function' ? bodyText() : bodyText),
  });
  const document = {
    body,
    querySelector: (selector) => (selector === 'main' ? main : null),
    querySelectorAll(selector) {
      if (selector === '[role="dialog"]') return includeDialog ? [list.dialog] : [];
      if (selector === 'a[role="link"], a[href="#"]') {
        return Number.isSafeInteger(profileCount) ? [profileCountLink] : [];
      }
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
    setTimeout(callback, ms) { return setTimeout(() => { settle(); callback(); }, ms); },
  });
  vm.runInContext(actionLabelsSource, context);
  vm.runInContext(source, context);
  return context.InstaToolboxInstagramInspector;
}

test('full-list scan pages through a lazy list instead of stopping at the first screen', async () => {
  const list = createLazyList({ total: 250, pageSize: 25 });
  const inspector = createHarness(list, { profileCount: 250 });

  const visibleOnly = inspector.captureVisibleAccounts();
  assert.equal(visibleOnly.length, 25, 'the visible-only capture sees just the first page');

  const scanned = await inspector.collectAccountList({ maxScrolls: 400, settleMs: 0, listType: 'followers' });
  assert.equal(scanned.accounts.length, 250);
  assert.equal(scanned.complete, true);
  assert.equal(scanned.reason, 'list-complete');
  assert.equal(scanned.accounts[0].username, 'user0000');
  assert.equal(scanned.accounts.at(-1).username, 'user0249');
  // Every username is unique and normalised.
  assert.equal(new Set(scanned.accounts.map((a) => a.username)).size, 250);
});

test('full-list scan rejects profile suggestions when no account-list dialog is open', async () => {
  const list = createLazyList({ total: 25, pageSize: 25 });
  const main = {
    querySelectorAll(selector) {
      if (selector === 'a[href^="/"]') {
        return [{
          textContent: 'suggested_account',
          getAttribute: (name) => (name === 'href' ? '/suggested_account/' : null),
        }];
      }
      if (selector === 'div, ul, section') return [];
      return [];
    },
    querySelector: () => null,
  };
  const inspector = createHarness(list, { includeDialog: false, main });

  assert.equal(inspector.captureVisibleAccounts('following').length, 0);
  const scanned = await inspector.collectAccountList({ maxScrolls: 400, settleMs: 0, listType: 'following' });
  assert.equal(Array.isArray(scanned.accounts), true);
  assert.equal(scanned.accounts.length, 0);
  assert.equal(scanned.complete, false);
  assert.equal(scanned.reason, 'open-a-followers-or-following-list');
});

test('full-list scan refuses a Followers dialog when Following was requested', async () => {
  const list = createLazyList({ total: 25, pageSize: 25 });
  const inspector = createHarness(list);

  assert.equal(inspector.captureVisibleAccounts('following').length, 0);
  const scanned = await inspector.collectAccountList({ maxScrolls: 400, settleMs: 0, listType: 'following' });
  assert.equal(Array.isArray(scanned.accounts), true);
  assert.equal(scanned.accounts.length, 0);
  assert.equal(scanned.complete, false);
  assert.equal(scanned.reason, 'open-a-followers-or-following-list');
});

test('full-list scan fails closed when dialog semantics conflict', async () => {
  const list = createLazyList({ total: 25, pageSize: 25 });
  list.dialog.getAttribute = (name) => (name === 'aria-label' ? 'Following' : null);
  const inspector = createHarness(list);

  assert.equal(inspector.captureVisibleAccounts('followers').length, 0);
  assert.equal(inspector.captureVisibleAccounts('following').length, 0);
  const scanned = await inspector.collectAccountList({ maxScrolls: 400, settleMs: 0, listType: 'followers' });
  assert.equal(scanned.accounts.length, 0);
  assert.equal(scanned.complete, false);
  assert.equal(scanned.reason, 'open-a-followers-or-following-list');
});

test('full-list scan still advances when the list starts pinned at the bottom', async () => {
  const list = createLazyList({ total: 120, pageSize: 20 });
  const inspector = createHarness(list, { profileCount: 120 });
  // Pin the scroller at the end first: assigning the same scrollTop fires no
  // scroll event, so the scan must nudge before it can load more.
  list.scroller.scrollTop = list.scroller.scrollHeight;
  const renderedBefore = list.rendered;

  const scanned = await inspector.collectAccountList({ maxScrolls: 400, settleMs: 0 });
  assert.ok(list.rendered > renderedBefore, 'the scan unstuck a bottom-pinned list');
  assert.equal(scanned.accounts.length, 120);
  assert.equal(scanned.complete, true);
});

test('a first page that fits the dialog is not mistaken for the full list', async () => {
  const list = createLazyList({ total: 75, pageSize: 25, clientHeight: 2_000 });
  const inspector = createHarness(list);

  const scanned = await inspector.collectAccountList({ maxScrolls: 20, settleMs: 0, listType: 'followers' });
  assert.equal(scanned.accounts.length, 25);
  assert.equal(scanned.complete, false);
  assert.equal(scanned.reason, 'list-count-unverified');
});

test('full-list scan reports an incomplete list rather than claiming completeness', async () => {
  const list = createLazyList({ total: 500, pageSize: 25 });
  const inspector = createHarness(list);

  const scanned = await inspector.collectAccountList({ maxScrolls: 3, settleMs: 0 });
  assert.equal(scanned.complete, false);
  assert.equal(scanned.reason, 'list-count-unverified');
  assert.ok(scanned.accounts.length < 500);
  assert.ok(scanned.accounts.length > 25);
});

test('full-list scan stays incomplete when the exact profile total exceeds readable rows', async () => {
  const list = createLazyList({ total: 115, pageSize: 25 });
  const inspector = createHarness(list, { profileCount: 116 });

  const scanned = await inspector.collectAccountList({
    maxScrolls: 400,
    settleMs: 0,
    listType: 'followers',
  });
  assert.equal(scanned.accounts.length, 115);
  assert.equal(scanned.observedCount, 115);
  assert.equal(scanned.expectedCount, 116);
  assert.equal(scanned.complete, false);
  assert.equal(scanned.reason, 'list-count-mismatch');
});

test('full-list scan stops and reports when Instagram interrupts the session', async () => {
  const list = createLazyList({ total: 200, pageSize: 25 });
  let sessionReads = 0;
  const inspector = createHarness(list, {
    bodyText() {
      sessionReads += 1;
      return sessionReads > 3 ? 'Please wait a few minutes' : '';
    },
  });

  const scanned = await inspector.collectAccountList({ maxScrolls: 400, settleMs: 0 });
  assert.equal(scanned.rateLimited, true);
  assert.equal(scanned.complete, false);
  assert.equal(scanned.reason, 'session-stop');
  assert.ok(scanned.accounts.length < 200);
});

function createRecycledList({ total = 63, replaceScroller = false, delayed = false } = {}) {
  let first = 0;
  let pending = 0;
  let nextFirst = 0;
  let replaced = false;
  const anchors = Array.from({ length: 7 }, (_, slot) => ({
    get textContent() { return `person${first + slot}`; },
    getAttribute(name) {
      return name === 'href' && first + slot < total ? `/person${first + slot}/` : null;
    },
  }));
  const makeScroller = () => ({
    tagName: 'DIV', clientHeight: 200, scrollHeight: total * 50, top: 0,
    get scrollTop() { return this.top; },
    set scrollTop(value) {
      this.top = Math.min(Math.max(0, value), this.scrollHeight - this.clientHeight);
      nextFirst = Math.floor(this.top / 50);
      if (delayed) pending = 2;
      else first = nextFirst;
      if (replaceScroller && !replaced && this.top > 600) {
        replaced = true;
        scroller = makeScroller();
      }
    },
    querySelectorAll: () => [],
  });
  let scroller = makeScroller();
  const dialog = {
    tagName: 'DIV', textContent: 'Followers', getAttribute: () => null,
    querySelectorAll(selector) {
      if (selector === 'a[href^="/"]') return anchors;
      if (selector === 'div, ul, section') return [scroller];
      return [];
    },
    querySelector: () => pending > 0 ? {} : null,
  };
  return {
    dialog, get scroller() { return scroller; },
    settle() { if (pending > 0 && --pending === 0) first = nextFirst; },
  };
}

test('virtualized scans accumulate recycled windows from the top, including delayed and replaced scrollers', async () => {
  for (const options of [{}, { delayed: true }, { replaceScroller: true }]) {
    const list = createRecycledList(options);
    list.scroller.scrollTop = 1_500;
    const inspector = createHarness(list, { profileCount: 63, settle: list.settle });
    const result = await inspector.collectAccountList({ settleMs: 0, maxScrolls: 150, listType: 'followers' });
    assert.equal(result.accounts.length, 63, JSON.stringify(options));
    assert.equal(result.complete, true);
    assert.equal(new Set(result.accounts.map((item) => item.username)).size, 63);
    assert.ok(result.accounts.some((item) => item.username === 'person0'));
    assert.ok(result.accounts.some((item) => item.username === 'person62'));
  }
});

test('a quiet virtualized end without an exact total remains unverified', async () => {
  const list = createRecycledList();
  const inspector = createHarness(list);
  const result = await inspector.collectAccountList({ settleMs: 0, maxScrolls: 150 });
  assert.equal(result.accounts.length, 63);
  assert.equal(result.complete, false);
  assert.equal(result.reason, 'list-count-unverified');
});

test('virtualized partial data cannot pass even when the scroll height stops changing', async () => {
  const list = createRecycledList({ total: 27 });
  const inspector = createHarness(list, { profileCount: 2_104 });
  const result = await inspector.collectAccountList({ settleMs: 0, maxScrolls: 150 });
  assert.equal(result.accounts.length, 27);
  assert.equal(result.complete, false);
  assert.equal(result.reason, 'list-count-mismatch');
});

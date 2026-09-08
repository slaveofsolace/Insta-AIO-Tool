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
    clearTimeout,
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
    setTimeout(callback, ms) { return setTimeout(() => { settle(ms); callback(); }, ms); },
  });
  vm.runInContext(actionLabelsSource, context);
  vm.runInContext(source, context);
  return context.InstaToolboxInstagramInspector;
}

function addRecommendations(list, { empty = false } = {}) {
  const read = list.dialog.querySelectorAll;
  const suggestions = Array.from({ length: 30 }, (_, index) => ({
    textContent: `suggestion${index}`,
    getAttribute: name => name === 'href' ? `/suggestion${index}/` : null,
  }));
  const heading = {
    textContent: 'Suggested for you',
    getAttribute: () => null,
    compareDocumentPosition: anchor => suggestions.includes(anchor) ? 4 : 2,
  };
  const emptyMessage = { textContent: "You'll see all the people who follow you here.", getAttribute: () => null };
  list.dialog.querySelectorAll = selector => {
    if (selector === 'a[href^="/"]') return [...read(selector), ...suggestions];
    if (selector === 'h1, h2, h3, h4, [role="heading"], span, p') {
      return empty ? [emptyMessage, heading] : [heading];
    }
    return read(selector);
  };
}

test('recommended profiles inside a list dialog never enter visible or full captures', async () => {
  const list = createLazyList({ total: 25, pageSize: 25 });
  addRecommendations(list);
  const inspector = createHarness(list, { profileCount: 55 });
  assert.equal(inspector.captureVisibleAccounts('followers').length, 25);
  const result = await inspector.collectAccountList({ settleMs: 0, listType: 'followers' });
  assert.equal(result.accounts.length, 25);
  assert.equal(result.complete, false, 'suggestions cannot fill the missing profile total');
  assert.equal(result.accounts.some(account => account.username.startsWith('suggestion')), false);
});

test('an empty native list with a positive profile total reports unavailable without scrolling suggestions', async () => {
  const list = createLazyList({ total: 0 });
  addRecommendations(list, { empty: true });
  const inspector = createHarness(list, { profileCount: 30 });
  assert.equal(inspector.captureVisibleAccounts('followers').length, 0);
  const result = await inspector.collectAccountList({ settleMs: 0, listType: 'followers' });
  assert.equal(result.accounts.length, 0);
  assert.equal(result.complete, false);
  assert.equal(result.reason, 'list-unavailable');
  assert.equal(list.scroller.scrollTop, 0);
});

test('a genuinely empty list can complete with recommendations excluded', async () => {
  const list = createLazyList({ total: 0 });
  addRecommendations(list, { empty: true });
  const inspector = createHarness(list, { profileCount: 0 });
  const result = await inspector.collectAccountList({ settleMs: 0, listType: 'followers' });
  assert.equal(result.accounts.length, 0);
  assert.equal(result.complete, true);
  assert.equal(result.reason, 'list-complete');
});

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

test('offscreen next-page spinners do not delay traversal through loaded rows', async () => {
  const list = createLazyList({ total: 250, pageSize: 25 });
  let spinnerWaits = 0;
  list.scroller.getBoundingClientRect = () => ({ top: 0, bottom: 400 });
  list.dialog.querySelector = () => list.rendered < 250 ? {
    getBoundingClientRect: () => ({
      top: list.scroller.scrollHeight - list.scroller.scrollTop,
      bottom: list.scroller.scrollHeight - list.scroller.scrollTop + 32,
      width: 32, height: 32,
    }),
  } : null;
  const inspector = createHarness(list, {
    profileCount: 250,
    settle(ms) { if (ms === 250) spinnerWaits += 1; },
  });
  const result = await inspector.collectAccountList({ settleMs: 0, listType: 'followers' });
  assert.equal(result.accounts.length, 250);
  assert.equal(result.complete, true);
  assert.equal(spinnerWaits, 0, 'a mounted spinner below the viewport must not add six-second waits');
});

test('an in-viewport loading indicator still waits before claiming completion', async () => {
  const list = createLazyList({ total: 25, pageSize: 25 });
  let pending = 3;
  list.scroller.getBoundingClientRect = () => ({ top: 0, bottom: 400 });
  list.dialog.querySelector = () => pending > 0 ? {
    getBoundingClientRect: () => ({ top: 350, bottom: 382, width: 32, height: 32 }),
  } : null;
  const inspector = createHarness(list, {
    profileCount: 25,
    settle(ms) { if (ms === 250) pending -= 1; },
  });
  const result = await inspector.collectAccountList({ settleMs: 0, listType: 'followers' });
  assert.equal(pending, 0);
  assert.equal(result.complete, true);
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

function createRecycledList({ total = 63, replaceScroller = false, delayed = false, omitFirstSweepIndex = -1 } = {}) {
  let first = 0;
  let pending = 0;
  let nextFirst = 0;
  let replaced = false;
  let sweeps = 0;
  const anchors = Array.from({ length: 7 }, (_, slot) => ({
    get textContent() { return `person${first + slot}`; },
    getAttribute(name) {
      const index = first + slot;
      return name === 'href' && index < total && !(sweeps === 0 && index === omitFirstSweepIndex)
        ? `/person${index}/`
        : null;
    },
  }));
  const makeScroller = () => ({
    tagName: 'DIV', clientHeight: 200, scrollHeight: total * 50, top: 0,
    get scrollTop() { return this.top; },
    set scrollTop(value) {
      if (value === 0 && this.top > 0) sweeps += 1;
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

function guidedHarness({ total = 45, expected = total, duplicateLink = false, wrongDialog = false, closeButtons = 1, unavailableFollowers = false } = {}) {
  const lists = {
    followers: createRecycledList({ total, delayed: true }),
    following: createRecycledList({ total, replaceScroller: true }),
  };
  if (unavailableFollowers) {
    lists.followers = createRecycledList({ total: 0 });
    addRecommendations(lists.followers, { empty: true });
  }
  let active = null;
  const clicks = [];
  const listeners = new Map();
  const location = { origin: 'https://www.instagram.com', pathname: '/demo_creator/' };
  const heading = { textContent: 'demo_creator', getAttribute: () => null };
  const header = {
    textContent: 'demo_creator', getAttribute: () => null,
    querySelectorAll: selector => selector === 'a[href]' ? links : [heading],
  };
  const links = ['followers', 'following'].map(type => ({
    textContent: `${expected} ${type}`,
    getAttribute: name => name === 'href' ? '#' : null,
    closest: () => header, querySelector: () => null,
    click() { clicks.push(`open:${type}`); active = lists[type]; },
  }));
  if (duplicateLink) links.push({ ...links[0] });
  for (const [type, list] of Object.entries(lists)) {
    const read = list.dialog.querySelectorAll;
    list.dialog.textContent = wrongDialog ? 'Unrelated dialog' : type === 'followers' ? 'Followers' : 'Following';
    Object.defineProperty(list.dialog, 'isConnected', { get: () => active === list });
    list.dialog.querySelectorAll = selector => selector === 'button, [role="button"]'
      ? Array.from({ length: closeButtons }, () => ({
        getAttribute: name => name === 'aria-label' ? 'Close' : null,
        click() { clicks.push(`close:${type}`); active = null; },
      })) : read(selector);
  }
  const document = {
    body: { innerText: '' }, querySelector: () => null,
    querySelectorAll(selector) {
      if (selector === 'main header') return [header];
      if (selector === 'a[role="link"], a[href="#"]') return links;
      if (selector === '[role="dialog"]') return active ? [active.dialog] : [];
      return [];
    },
    addEventListener: (type, callback) => listeners.set(type, callback),
    removeEventListener: type => listeners.delete(type),
  };
  const context = vm.createContext({
    document, location, URL, AbortController, clearTimeout, console, crypto: webcrypto,
    getComputedStyle: node => ({ display: 'block', visibility: 'visible', overflowY: Object.values(lists).some(list => node === list.scroller) ? 'auto' : 'visible' }),
    setTimeout(callback, ms) {
      return setTimeout(() => { Object.values(lists).forEach(list => list.settle()); callback(); }, ms >= 1_200_000 ? ms : 1);
    },
  });
  vm.runInContext(actionLabelsSource, context);
  vm.runInContext(source, context);
  return {
    inspector: context.InstaToolboxInstagramInspector, clicks, listeners, location, document,
    closeExternally() { active = null; },
    interact() { listeners.get('pointerdown')?.({ isTrusted: true, composedPath: () => [] }); },
  };
}

test('guided check opens Followers, captures recycled rows, closes it, then handles Following', async () => {
  const h = guidedHarness();
  const progress = [];
  const result = await h.inspector.fetchFollowerComparison({
    mode: 'dialog', username: 'demo_creator', onProgress: entry => progress.push(entry),
    fetchImpl: () => assert.fail('guided capture must not call the background API reader'),
  });
  assert.deepEqual(h.clicks, ['open:followers', 'close:followers', 'open:following', 'close:following']);
  assert.equal(result.followers.length, 45);
  assert.equal(result.following.length, 45);
  assert.equal(result.complete.followers, true);
  assert.equal(result.complete.following, true);
  assert.equal(result.source, 'list-dialog');
  assert.ok(progress.some(p => p.phase === 'loading' && p.found > 7));
  assert.equal(h.listeners.size, 0);
});

test('guided incomplete lists remain partial instead of producing false non-mutuals', async () => {
  const h = guidedHarness({ expected: 46 });
  const result = await h.inspector.fetchFollowerComparison({ mode: 'dialog', username: 'demo_creator' });
  assert.equal(result.complete.followers, false);
  assert.equal(result.complete.following, false);
  assert.equal(result.reasons.followers, 'count-mismatch');
  assert.equal(result.followers.length, 45);
});

test('guided capture rejects an unavailable native list before saving or opening the next list', async () => {
  const h = guidedHarness({ unavailableFollowers: true });
  await assert.rejects(h.inspector.fetchFollowerComparison({
    mode: 'dialog', username: 'demo_creator',
  }), { code: 'list-unavailable' });
  assert.deepEqual(h.clicks, ['open:followers']);
  assert.equal(h.listeners.size, 0);
});

test('guided capture never falls back to a request without Instagram native session headers', async () => {
  const h = guidedHarness({ expected: 46 });
  const requests = [];
  const progress = [];
  const fetchImpl = async (url) => {
    requests.push(url);
    assert.fail('dialog mode must use Instagram native list requests');
  };
  const result = await h.inspector.fetchFollowerComparison({
    mode: 'dialog',
    username: 'demo_creator',
    fetchImpl,
    onProgress: entry => progress.push(entry),
  });

  assert.equal(requests.length, 0);
  assert.equal(result.followers.length, 45);
  assert.equal(result.following.length, 45);
  assert.equal(result.complete.followers, false);
  assert.equal(result.complete.following, false);
  assert.equal(result.reasons.followers, 'count-mismatch');
  assert.equal(result.reasons.following, 'count-mismatch');
  assert.equal(result.source, 'list-dialog');
  assert.ok(progress.some(entry => entry.phase === 'resweeping'));
});

for (const [label, options, code] of [
  ['ambiguous link', { duplicateLink: true }, 'ambiguous-list-link'],
  ['wrong dialog', { wrongDialog: true }, 'dialog-changed'],
  ['ambiguous close', { closeButtons: 2 }, 'ambiguous-close'],
]) {
  test(`guided capture stops on ${label} without advancing to Following`, async () => {
    const h = guidedHarness(options);
    await assert.rejects(h.inspector.fetchFollowerComparison({ mode: 'dialog', username: 'demo_creator' }), { code });
    assert.equal(h.clicks.includes('open:following'), false);
    assert.equal(h.listeners.size, 0);
  });
}

for (const reason of ['stop', 'profile', 'dialog', 'interaction', 'rate-limit']) {
  test(`guided ${reason} interruption leaves no late close or next-list click`, async () => {
    const h = guidedHarness();
    const controller = new AbortController();
    let interrupted = false;
    await assert.rejects(h.inspector.fetchFollowerComparison({
      mode: 'dialog', username: 'demo_creator', signal: controller.signal,
      onProgress(entry) {
        if (entry.phase !== 'loading' || interrupted) return;
        interrupted = true;
        if (reason === 'stop') controller.abort();
        if (reason === 'profile') h.location.pathname = '/another_profile/';
        if (reason === 'dialog') h.closeExternally();
        if (reason === 'interaction') h.interact();
        if (reason === 'rate-limit') h.document.body.innerText = 'Please wait a few minutes';
      },
    }));
    assert.deepEqual(h.clicks, ['open:followers']);
    assert.equal(h.listeners.size, 0);
  });
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

test('virtualized scans revisit the list to recover rows skipped during the first sweep', async () => {
  const list = createRecycledList({ total: 63, omitFirstSweepIndex: 31 });
  const inspector = createHarness(list, { profileCount: 63, settle: list.settle });
  const progress = [];
  const result = await inspector.collectAccountList({
    settleMs: 0,
    maxScrolls: 300,
    listType: 'followers',
    onProgress: entry => progress.push(entry),
  });
  assert.equal(result.accounts.length, 63);
  assert.equal(result.complete, true);
  assert.ok(progress.some(entry => entry.phase === 'resweeping'));
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

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { webcrypto } from 'node:crypto';
import vm from 'node:vm';

const [actionLabelsSource, inspectorSource, overlaySharedSource] = await Promise.all([
  readFile(new URL('../extension/action-labels.js', import.meta.url), 'utf8'),
  readFile(new URL('../extension/content-instagram.js', import.meta.url), 'utf8'),
  readFile(new URL('../extension/overlay/shared.js', import.meta.url), 'utf8'),
]);

function response(data, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() { return data; },
  };
}

function profileResponse({
  followers,
  following,
  id = '77',
  username = 'target_name',
}) {
  return response({
    data: {
      user: {
        edge_follow: { count: following },
        edge_followed_by: { count: followers },
        id,
        username,
      },
    },
  });
}

function temporaryHttpResponse(status, { data, retryAfter, html = false } = {}) {
  return {
    ...response(data ?? { status: 'fail', message: 'Temporary server failure' }, status),
    headers: { get: (name) => name.toLowerCase() === 'retry-after' ? retryAfter ?? null : null },
    async json() {
      if (html) throw new SyntaxError('HTML gateway response');
      return data ?? { status: 'fail', message: 'Temporary server failure' };
    },
  };
}

function temporaryPageFixture(nextPage) {
  const calls = [];
  let nextPageAttempts = 0;
  return {
    calls,
    async fetchImpl(input) {
      const url = new URL(input);
      calls.push(url);
      if (url.pathname.includes('topsearch')) return response({ users: [{ user: { pk: '77', username: 'target_name' } }] });
      if (url.pathname.includes('web_profile_info')) return profileResponse({ followers: 2, following: 0 });
      if (url.pathname.includes('/followers/')) {
        if (!url.searchParams.has('max_id')) return response({ users: [{ pk: '1', username: 'first.person' }], next_max_id: 'page-two' });
        assert.equal(url.searchParams.get('max_id'), 'page-two');
        return nextPage(++nextPageAttempts);
      }
      assert.ok(url.pathname.includes('/following/'));
      return response({ users: [] });
    },
  };
}

async function scanGroupFixture({
  followerPages = [{ users: [] }], followerCount = 0,
  followingPage = { users: [] }, followingCount = followingPage.users.length,
  maxAccounts, onProgress, onRequest = () => {},
} = {}) {
  let followerPageIndex = 0;
  return createInspector().fetchFollowerComparison({
    username: 'target_name', maxAccounts, onProgress,
    sleepImpl: async () => {},
    fetchImpl: async (input) => {
      const url = new URL(input);
      onRequest(url);
      if (url.pathname.includes('topsearch')) return response({ users: [{ user: { pk: '77', username: 'target_name' } }] });
      if (url.pathname.includes('web_profile_info')) return profileResponse({ followers: followerCount, following: followingCount });
      if (url.pathname.includes('/followers/')) {
        assert.equal(url.searchParams.get('max_id'), followerPageIndex === 0 ? null : followerPages[followerPageIndex - 1].next_max_id);
        assert.ok(followerPages[followerPageIndex], 'no unexpected follower page request');
        return response(followerPages[followerPageIndex++]);
      }
      assert.ok(url.pathname.includes('/following/'));
      return response(followingPage);
    },
  });
}

function createInspector({
  origin = 'https://www.instagram.com',
  pathname = '/demo_creator/',
  profileCounts = null,
  profileLinks: suppliedProfileLinks = null,
} = {}) {
  const profileLinkData = Array.isArray(suppliedProfileLinks)
    ? suppliedProfileLinks
    : profileCounts
      ? [
        { title: `${profileCounts.followers} followers` },
        { title: `${profileCounts.following} following` },
      ]
      : [];
  const profileLinks = profileLinkData.map((entry) => ({
    getAttribute(name) {
      if (name === 'title') return entry.title;
      if (name === 'href') return entry.href || null;
      return null;
    },
    get textContent() { return entry.text || entry.title; },
    querySelector: () => entry.childTitle ? { getAttribute: () => entry.childTitle } : null,
    closest: () => entry.inProfileHeader ? {
      querySelectorAll: () => [{
        textContent: entry.headerUsername || 'target_name',
        getAttribute: () => null,
      }],
    } : null,
  }));
  const document = {
    body: { innerText: '' },
    querySelector: () => null,
    querySelectorAll: (selector) => (
      selector === 'a[role="link"], a[href="#"]' ? profileLinks : []
    ),
  };
  const context = vm.createContext({
    AbortController,
    URL,
    chrome: { runtime: { onMessage: { addListener() {} } } },
    clearTimeout,
    console,
    crypto: webcrypto,
    document,
    getComputedStyle: () => ({ display: 'block', visibility: 'visible' }),
    location: {
      href: `${origin}${pathname}`,
      origin,
      pathname,
    },
    setTimeout,
  });
  vm.runInContext(actionLabelsSource, context);
  vm.runInContext(inspectorSource, context);
  return context.InstaToolboxInstagramInspector;
}

test('authenticated follower check uses only bounded exact read endpoints and paginates both lists', async () => {
  const inspector = createInspector();
  const requests = [];
  const delays = [];
  const progress = [];
  const fetchImpl = async (input, options) => {
    const url = new URL(input);
    requests.push({ url, options });
    if (url.pathname === '/api/v1/web/search/topsearch/') {
      return response({
        users: [
          { user: { pk: '999', username: 'not_demo' } },
          { user: { pk: '12345', username: 'Demo.Creator' } },
        ],
      });
    }
    if (url.pathname === '/api/v1/users/web_profile_info/') {
      return profileResponse({ followers: 3, following: 3, id: '12345', username: 'demo.creator' });
    }
    if (url.pathname === '/api/v1/friendships/12345/followers/' && !url.searchParams.has('max_id')) {
      return response({
        users: [
          { username: 'mutual.one', full_name: 'Mutual One' },
          { username: 'follower.only', full_name: 'Follower Only' },
        ],
        next_max_id: 'followers-page-2',
      });
    }
    if (url.pathname === '/api/v1/friendships/12345/followers/'
      && url.searchParams.get('max_id') === 'followers-page-2') {
      return response({ users: [{ username: 'mutual.two', full_name: 'Mutual Two' }] });
    }
    if (url.pathname === '/api/v1/friendships/12345/following/') {
      return response({
        users: [
          { username: 'mutual.one', full_name: 'Mutual One' },
          { username: 'mutual.two', full_name: 'Mutual Two' },
          { username: 'following.only', full_name: 'Following Only' },
        ],
      });
    }
    throw new Error(`Unexpected request: ${url.href}`);
  };

  const result = await inspector.fetchFollowerComparison({
    fetchImpl,
    now: () => 1_800_000_000_000,
    onProgress: (entry) => progress.push(entry),
    random: () => 0.5,
    sleepImpl: async (ms) => { delays.push(ms); },
    username: '@Demo.Creator',
  });

  assert.equal(result.username, 'demo.creator');
  assert.equal(result.userId, '12345');
  assert.deepEqual([...result.followers].map((account) => account.username), [
    'follower.only', 'mutual.one', 'mutual.two',
  ]);
  assert.deepEqual([...result.following].map((account) => account.username), [
    'following.only', 'mutual.one', 'mutual.two',
  ]);
  assert.deepEqual({ ...result.complete }, { followers: true, following: true });
  assert.deepEqual({ ...result.pages }, { followers: 2, following: 1 });
  assert.deepEqual(delays, [1_150]);
  const countsReadyIndex = progress.findIndex((entry) => entry.phase === 'counts-ready');
  const firstLoadingIndex = progress.findIndex((entry) => entry.phase === 'loading');
  assert.ok(countsReadyIndex >= 0 && countsReadyIndex < firstLoadingIndex);
  assert.deepEqual({ ...progress[countsReadyIndex].expectedCounts }, { followers: 3, following: 3 });
  assert.equal(
    progress.filter((entry) => entry.listType).every((entry) => Number.isSafeInteger(entry.expectedCount)),
    true,
  );
  assert.equal(progress.at(-1).phase, 'complete');
  assert.equal(requests.length, 6);
  assert.equal(requests[0].url.searchParams.get('query'), 'demo.creator');
  assert.equal(requests[1].url.pathname, '/api/v1/users/web_profile_info/');
  assert.equal(requests[1].url.searchParams.get('username'), 'demo.creator');
  for (const { url, options } of requests) {
    assert.equal(url.origin, 'https://www.instagram.com');
    assert.equal(options.method, 'GET');
    assert.equal(options.credentials, 'include');
    assert.equal(options.cache, 'no-store');
    assert.equal(options.referrer, 'https://www.instagram.com/demo.creator/');
    assert.equal(options.referrerPolicy, 'strict-origin-when-cross-origin');
    assert.deepEqual({ ...options.headers }, {
      'X-ASBD-ID': '129477',
      'X-IG-App-ID': '936619743392459',
      'X-Requested-With': 'XMLHttpRequest',
    });
  }
  assert.equal(requests[2].url.searchParams.get('count'), '50');
  assert.equal(requests[2].url.searchParams.get('search_surface'), 'follow_list_page');
  assert.equal(requests[2].url.searchParams.get('query'), '');
  assert.equal(requests[2].url.searchParams.get('enable_groups'), 'true');
  assert.equal(requests[2].url.searchParams.has('includes_hashtags'), false);
  assert.equal(requests[3].url.searchParams.get('max_id'), 'followers-page-2');
  assert.equal(requests[4].url.searchParams.get('includes_hashtags'), 'false');
  assert.equal(requests[5].url.pathname, '/api/v1/users/web_profile_info/');
});

test('authenticated follower check requires an exact username search result', async () => {
  const inspector = createInspector();
  await assert.rejects(
    inspector.fetchFollowerComparison({
      fetchImpl: async () => response({ users: [{ user: { pk: '55', username: 'similar_name' } }] }),
      username: 'target_name',
    }),
    (error) => error.code === 'username-not-found',
  );
});

test('open-profile background check accepts real hash-link counters without profile requests or dialogs', async () => {
  const inspector = createInspector({
    pathname: '/target_name/',
    profileLinks: [
      { href: '#', inProfileHeader: true, text: '2.1K followers', childTitle: '2,104' },
      { href: '#', inProfileHeader: true, title: '101 following' },
    ],
  });
  const calls = [];
  const result = await inspector.fetchFollowerComparison({
    fetchImpl: async (input) => {
      const url = new URL(input);
      calls.push(url.pathname);
      if (url.pathname.includes('topsearch')) return response({ users: [{ user: { pk: '77', username: 'target_name' } }] });
      assert.ok(url.pathname.startsWith('/api/v1/friendships/77/'), 'no profile-count request');
      const followers = url.pathname.includes('/followers/');
      const total = followers ? 2_104 : 101;
      const offset = Number(url.searchParams.get('max_id') || 0);
      const end = Math.min(offset + 50, total);
      return response({
        users: Array.from({ length: end - offset }, (_, i) => ({ username: `${followers ? 'follower' : 'following'}.${offset + i}` })),
        ...(end < total ? { next_max_id: String(end) } : {}),
      });
    },
    sleepImpl: async () => {},
    username: 'target_name',
  });
  assert.equal(calls.length, 47);
  assert.deepEqual({ ...result.expectedCounts }, { followers: 2_104, following: 101 });
  assert.deepEqual({ ...result.complete }, { followers: true, following: true });
  assert.deepEqual({ ...result.pages }, { followers: 43, following: 3 });
});

for (const changed of ['count', 'route']) {
  test(`open-profile background check rejects ${changed} changes without a network fallback`, async () => {
    const links = [
      { href: '/target_name/followers/', title: '1 followers' },
      { href: '/target_name/following/', title: '1 following' },
    ];
    const inspector = createInspector({ pathname: '/target_name/', profileLinks: links });
    let calls = 0;
    const pending = inspector.fetchFollowerComparison({
      fetchImpl: async (input) => {
        calls += 1;
        const url = new URL(input);
        if (url.pathname.includes('topsearch')) return response({ users: [{ user: { pk: '77', username: 'target_name' } }] });
        assert.ok(url.pathname.includes('/friendships/'));
        if (url.pathname.includes('/following/')) {
          if (changed === 'count') links[0].title = '2 followers';
          else links[0].href = '/different_profile/followers/';
        }
        return response({ users: [{ username: 'mutual' }] });
      },
      username: 'target_name',
    });
    if (changed === 'route') await assert.rejects(pending, { code: 'profile-count-unavailable' });
    else {
      const result = await pending;
      assert.equal(result.complete.followers, false);
      assert.equal(result.reasons.followers, 'count-changed');
    }
    assert.equal(calls, 3);
  });
}

for (const kind of ['different-profile', 'rounded-only', 'external-origin', 'conflicting-counts', 'unscoped-hash', 'wrong-header-hash']) {
  test(`background count source does not trust ${kind} profile labels`, async () => {
    const profileLinks = [
      { href: kind.endsWith('-hash') ? '#' : kind === 'different-profile' ? '/different/followers/' : kind === 'external-origin' ? 'https://example.com/target_name/followers/' : '/target_name/followers/', title: kind === 'rounded-only' ? '2.1K followers' : '1 followers', inProfileHeader: kind === 'wrong-header-hash', headerUsername: 'different_profile' },
      { href: '/target_name/following/', title: '1 following' },
    ];
    if (kind === 'conflicting-counts') profileLinks.push({ href: '/target_name/followers/', title: '2 followers' });
    const inspector = createInspector({ pathname: '/target_name/', profileLinks });
    let profileCalls = 0;
    await assert.rejects(inspector.fetchFollowerComparison({
      fetchImpl: async (input) => {
        if (input.includes('topsearch')) return response({ users: [{ user: { pk: '77', username: 'target_name' } }] });
        assert.ok(input.includes('web_profile_info'));
        profileCalls += 1;
        return { ok: false, status: 429, json() { throw new SyntaxError('HTML'); } };
      },
      username: 'target_name',
    }), { code: 'rate-limited' });
    assert.equal(profileCalls, 1);
  });
}

for (const [status, url, code] of [
  [429, '', 'rate-limited'],
  [401, '', 'session-expired'],
  [403, '', 'action-blocked'],
  [200, 'https://www.instagram.com/accounts/login/', 'session-expired'],
  [200, 'https://www.instagram.com/challenge/', 'challenge'],
  [200, 'https://www.instagram.com/checkpoint/', 'challenge'],
]) {
  test(`HTML ${status} ${code} stops before JSON decoding, retry, or another request`, async () => {
    const inspector = createInspector();
    let requests = 0;
    let decodes = 0;
    await assert.rejects(inspector.fetchFollowerComparison({
      fetchImpl: async () => {
        requests += 1;
        return { ok: status === 200, status, url, json() { decodes += 1; throw new SyntaxError('HTML'); } };
      },
      sleepImpl: async () => assert.fail('must not retry a session stop'),
      username: 'target_name',
    }), { code });
    assert.equal(requests, 1);
    assert.equal(decodes, 0);
  });
}

test('body timeout aborts the original fetch before a retry starts', async () => {
  const inspector = createInspector();
  const signals = [];
  await assert.rejects(inspector.fetchFollowerComparison({
    fetchImpl: async (_url, { signal }) => {
      if (signals.length) assert.equal(signals.at(-1).aborted, true);
      signals.push(signal);
      return { ok: true, status: 200, json: () => new Promise(() => {}) };
    },
    requestTimeoutMs: 5,
    sleepImpl: async () => {},
    username: 'target_name',
  }), { code: 'request-timeout' });
  assert.equal(signals.length, 3);
  assert.equal(signals.every((signal) => signal.aborted), true);
});

for (const status of [500, 502, 503, 504]) {
  test(`temporary HTML ${status} retries only the failed page and retains completed accounts`, async () => {
    const fixture = temporaryPageFixture(attempt => attempt === 1
      ? temporaryHttpResponse(status, { html: true })
      : response({ users: [{ pk: '2', username: 'second.person' }] }));
    const progress = [], delays = [];
    const result = await createInspector().fetchFollowerComparison({
      fetchImpl: fixture.fetchImpl, username: 'target_name', random: () => 0,
      onProgress: entry => progress.push(entry), sleepImpl: async ms => { delays.push(ms); },
    });
    const followerCalls = fixture.calls.filter(url => url.pathname.includes('/followers/'));
    assert.deepEqual(followerCalls.map(url => url.searchParams.get('max_id')), [null, 'page-two', 'page-two']);
    assert.equal(result.pages.followers, 2);
    assert.equal(result.followers.length, 2);
    assert.equal(result.complete.followers, true);
    const retry = progress.filter(entry => entry.phase === 'retrying');
    assert.equal(retry.length, 1);
    assert.equal(retry[0].found, 1);
    assert.equal(retry[0].pages, 1);
    assert.equal(retry[0].httpStatus, status);
    assert.equal(retry[0].attempt, 2);
    assert.deepEqual(delays, [800, 1000]);
  });
}

test('temporary page exhaustion retains HTTP metadata without publishing a replacement comparison', async () => {
  const fixture = temporaryPageFixture(() => temporaryHttpResponse(502, { html: true }));
  const previous = { saved: 'previous comparison' };
  let published = previous;
  await assert.rejects(createInspector().fetchFollowerComparison({
    fetchImpl: fixture.fetchImpl, username: 'target_name', sleepImpl: async () => {},
  }).then(result => { published = result; }), error => error.code === 'temporary-http-error'
    && error.httpStatus === 502 && error.attempts === 3
    && /previous comparison is unchanged/i.test(error.message));
  assert.equal(published, previous);
  assert.deepEqual(fixture.calls.filter(url => url.pathname.includes('/followers/')).map(url => url.searchParams.get('max_id')), [null, 'page-two', 'page-two', 'page-two']);
  assert.equal(fixture.calls.some(url => url.pathname.includes('/following/')), false);
});

const retryAfterNow = Date.parse('Mon, 07 Sep 2026 20:00:00 GMT');
for (const [header, delay] of [['3', 3000], ['6', 6000], ['30', 30000], [new Date(retryAfterNow + 4000).toUTCString(), 3200]]) {
  test(`temporary server retry honors Retry-After ${header}`, async () => {
    let clock = retryAfterNow, failedAt;
    const fixture = temporaryPageFixture(attempt => {
      if (attempt === 1) {
        failedAt = clock;
        return temporaryHttpResponse(503, { retryAfter: header });
      }
      assert.ok(clock >= failedAt + delay, 'the next request must wait for Retry-After');
      return response({ users: [{ pk: '2', username: 'second.person' }] });
    });
    const delays = [], retries = [];
    await createInspector().fetchFollowerComparison({
      fetchImpl: fixture.fetchImpl, username: 'target_name', now: () => clock, random: () => 0,
      sleepImpl: async ms => { delays.push(ms); clock += ms; },
      onProgress: entry => { if (entry.phase === 'retrying') retries.push(entry); },
    });
    assert.deepEqual(delays, [800, delay]);
    assert.equal(retries[0].retryAfterMs, delay);
    assert.equal(retries[0].retryDelayMs, delay);
    assert.equal(retries[0].httpStatus, 503);
  });
}

for (const [header, code] of [['999999999999999999999', 'retry-after-invalid'], ['1.5', 'retry-after-invalid'], ['not-a-date', 'retry-after-invalid']]) {
  test(`Retry-After ${header} stops instead of retrying too early`, async () => {
    let calls = 0;
    await assert.rejects(createInspector().fetchFollowerComparison({
      fetchImpl: async () => { calls += 1; return temporaryHttpResponse(503, { retryAfter: header }); },
      username: 'target_name', sleepImpl: async () => assert.fail('retry must not start'),
    }), error => error.code === code && error.httpStatus === 503);
    assert.equal(calls, 1);
  });
}

test('Retry-After beyond the remaining run budget stops without another request', async () => {
  let clock = 0;
  const fixture = temporaryPageFixture(() => temporaryHttpResponse(503, { retryAfter: '30' }));
  await assert.rejects(createInspector().fetchFollowerComparison({
    fetchImpl: fixture.fetchImpl, username: 'target_name', now: () => clock, maxDurationMs: 30000, random: () => 0,
    sleepImpl: async ms => { assert.equal(ms, 800); clock += ms; },
  }), error => error.code === 'retry-after-limit' && error.httpStatus === 503
    && error.retryAfterMs === 30000 && error.remainingMs === 29200
    && /not enough time left/i.test(error.message));
  assert.deepEqual(fixture.calls.filter(url => url.pathname.includes('/followers/')).map(url => url.searchParams.get('max_id')), [null, 'page-two']);
  assert.equal(fixture.calls.some(url => url.pathname.includes('/following/')), false);
});

for (const [data, code] of [
  [{ status: 'fail', message: 'challenge_required' }, 'challenge'],
  [{ status: 'fail', message: 'Temporary failure', error_type: 'checkpoint_required' }, 'challenge'],
  [{ status: 'fail', challenge: { url: '/challenge/' } }, 'challenge'],
  [{ status: 'fail', message: 'feedback_required' }, 'action-blocked'],
  [{ status: 'fail', error_type: 'action_blocked' }, 'action-blocked'],
  [{ status: 'fail', error_type: 'login_required' }, 'session-expired'],
  [{ status: 'fail', error_type: 'rate_limit_error' }, 'rate-limited'],
  [{ status: 'fail', message: 'Please wait a few minutes before you try again.' }, 'rate-limited'],
]) {
  test(`HTTP 503 ${code} envelope never triggers server recovery`, async () => {
    let calls = 0;
    await assert.rejects(createInspector().fetchFollowerComparison({
      fetchImpl: async () => { calls += 1; return temporaryHttpResponse(503, { data, retryAfter: '1' }); },
      username: 'target_name', sleepImpl: async () => assert.fail('security stops must not retry'),
    }), error => error.code === code && error.httpStatus === 503);
    assert.equal(calls, 1);
  });
}

for (const status of [400, 404, 408, 501]) {
  test(`HTTP ${status} is not added to temporary server recovery`, async () => {
    let calls = 0;
    await assert.rejects(createInspector().fetchFollowerComparison({
      fetchImpl: async () => { calls += 1; return temporaryHttpResponse(status, { html: true }); },
      username: 'target_name', sleepImpl: async () => assert.fail('must not retry'),
    }), error => error.code === 'request-failed' && error.httpStatus === status);
    assert.equal(calls, 1);
  });
}

test('Stop interrupts temporary HTTP Retry-After backoff before another request', async () => {
  const controller = new AbortController();
  let calls = 0;
  await assert.rejects(createInspector().fetchFollowerComparison({
    fetchImpl: async () => { calls += 1; return temporaryHttpResponse(502, { retryAfter: '30', html: true }); },
    username: 'target_name', signal: controller.signal,
    onProgress(entry) { if (entry.phase === 'retrying') queueMicrotask(() => controller.abort()); },
  }), { code: 'stopped' });
  assert.equal(calls, 1);
});

test('Retry-After remains authoritative when the temporary HTTP response body hangs', async () => {
  let calls = 0;
  await assert.rejects(createInspector().fetchFollowerComparison({
    fetchImpl: async () => {
      calls += 1;
      return { ...temporaryHttpResponse(503, { retryAfter: '30' }), json: () => new Promise(() => {}) };
    },
    username: 'target_name', requestTimeoutMs: 5, maxDurationMs: 1000,
    sleepImpl: async () => assert.fail('must not retry sooner than the server permits'),
  }), error => error.code === 'retry-after-limit' && error.httpStatus === 503 && error.retryAfterMs === 30000);
  assert.equal(calls, 1);
});

test('a temporary hung body can recover after its 30-second Retry-After wait', async () => {
  let clock = 0;
  const delays = [];
  const fixture = temporaryPageFixture(attempt => attempt === 1
    ? { ...temporaryHttpResponse(503, { retryAfter: '30' }), json: () => new Promise(() => {}) }
    : response({ users: [{ pk: '2', username: 'second.person' }] }));
  const result = await createInspector().fetchFollowerComparison({
    fetchImpl: fixture.fetchImpl, username: 'target_name', now: () => clock, requestTimeoutMs: 5, random: () => 0,
    sleepImpl: async ms => { delays.push(ms); clock += ms; },
  });
  assert.deepEqual(delays, [800, 30000]);
  assert.equal(result.followers.length, 2);
  assert.deepEqual(fixture.calls.filter(url => url.pathname.includes('/followers/')).map(url => url.searchParams.get('max_id')), [null, 'page-two', 'page-two']);
});

test('the run deadline interrupts Retry-After backoff without an early retry', async () => {
  let calls = 0, expire;
  await assert.rejects(createInspector().fetchFollowerComparison({
    fetchImpl: async () => { calls += 1; return temporaryHttpResponse(503, { retryAfter: '30' }); },
    username: 'target_name', maxDurationMs: 60000,
    setTimer(callback, ms) { if (ms === 60000) expire = callback; return 1; },
    clearTimer() {},
    onProgress(entry) { if (entry.phase === 'retrying') queueMicrotask(expire); },
  }), { code: 'time-limit' });
  assert.equal(calls, 1);
});

test('elapsed run deadline is checked after retry sleep even before its timer fires', async () => {
  let calls = 0, clock = 0;
  await assert.rejects(createInspector().fetchFollowerComparison({
    fetchImpl: async () => { calls += 1; return temporaryHttpResponse(503, { retryAfter: '1' }); },
    username: 'target_name', maxDurationMs: 2000, now: () => clock, random: () => 0,
    sleepImpl: async ms => { assert.equal(ms, 1000); clock = 2000; },
  }), { code: 'time-limit' });
  assert.equal(calls, 1);
});

test('Mutual Checker includes supplied deactivated followers before checking the exact total', async () => {
  const users = Array.from({ length: 100 }, (_, index) => ({ pk: String(index + 1), username: `follower.${index}` }));
  const progress = [];
  const result = await scanGroupFixture({
    followerCount: 101,
    followerPages: [{ users, groups: [{
      group: 'self_deactivated_followers',
      facepile: [{ pk: '101', username: 'deactivated.person', full_name: 'Deactivated Person' }],
      context: '67 accounts',
    }] }],
    onProgress: entry => progress.push(entry),
  });
  assert.equal(result.followers.length, 101);
  assert.equal(result.complete.followers, true);
  assert.equal(result.reasons.followers, 'pagination-complete');
  assert.equal(result.pages.followers, 1);
  const groupRow = result.followers.find(row => row.username === 'deactivated.person');
  assert.deepEqual(Object.keys(groupRow).sort(), ['displayName', 'profileUrl', 'source', 'username']);
  assert.equal(groupRow.displayName, 'Deactivated Person');
  assert.equal(groupRow.profileUrl, 'https://www.instagram.com/deactivated.person/');
  assert.equal(progress.find(entry => entry.phase === 'loading' && entry.listType === 'followers').found, 101);
});

test('deactivated follower rows deduplicate by ID within the group and against main rows', async () => {
  const shared = { pk: '1', username: 'shared.person' };
  const grouped = { pk: '2', username: 'group.person' };
  const result = await scanGroupFixture({
    followerCount: 2,
    followerPages: [{ users: [shared], groups: [{
      group: 'self_deactivated_followers', facepile: [shared, grouped, { ...grouped, id: '2' }],
    }] }],
  });
  assert.deepEqual([...result.followers].map(row => row.username), ['group.person', 'shared.person']);
  assert.equal(result.complete.followers, true);
});

test('repeated deactivated follower groups across cursor pages do not duplicate accounts', async () => {
  const groups = [{ group: 'self_deactivated_followers', facepile: [{ pk: '2', username: 'group.person' }] }];
  const result = await scanGroupFixture({
    followerCount: 3,
    followerPages: [
      { users: [{ pk: '1', username: 'first.person' }], groups, next_max_id: 'page-two' },
      { users: [{ pk: '3', username: 'last.person' }], groups },
    ],
  });
  assert.equal(result.followers.length, 3);
  assert.equal(result.pages.followers, 2);
  assert.equal(result.complete.followers, true);
});

test('only the exact deactivated follower group contributes account rows', async () => {
  const result = await scanGroupFixture({
    followerCount: 1,
    followerPages: [{ users: [{ pk: '1', username: 'main.person' }], groups: [
      { group: 'suggested_accounts', facepile: [{ pk: '2', username: 'suggested.person' }] },
      { group: 'SELF_DEACTIVATED_FOLLOWERS', facepile: [{ pk: '3', username: 'other.person' }] },
      { group: 'unrelated', facepile: 'not an account list' },
    ] }],
  });
  assert.deepEqual([...result.followers].map(row => row.username), ['main.person']);
  assert.equal(result.complete.followers, true);
});

test('Following ignores follower-group metadata and account rows', async () => {
  const result = await scanGroupFixture({
    followingPage: { users: [{ pk: '1', username: 'following.person' }], groups: [
      { group: 'self_deactivated_followers', facepile: [{ pk: '2', username: 'group.person' }] },
      { group: 'self_deactivated_followers', facepile: 'malformed but unrelated to Following' },
    ] },
  });
  assert.deepEqual([...result.following].map(row => row.username), ['following.person']);
  assert.equal(result.complete.following, true);
});

for (const groups of [undefined, null, [], [{ group: 'self_deactivated_followers' }], [{ group: 'self_deactivated_followers', facepile: null }]]) {
  test(`missing or empty deactivated follower rows remain empty: ${JSON.stringify(groups)}`, async () => {
    const result = await scanGroupFixture({ followerPages: [{ users: [], groups }] });
    assert.equal(result.followers.length, 0);
    assert.equal(result.complete.followers, true);
  });
}

for (const [label, groups] of [
  ['non-array groups', {}],
  ['non-array facepile', [{ group: 'self_deactivated_followers', facepile: {} }]],
  ['duplicate matching groups', [{ group: 'self_deactivated_followers' }, { group: 'self_deactivated_followers', facepile: [] }]],
  ...[
    null,
    [],
    'not an account',
    { username: 'group.person' },
    { pk: '1' },
    { pk: '1', username: '/group.person/' },
    { pk: '1', username: 'accounts' },
    { pk: '1', username: 123 },
    { pk: '0', username: 'group.person' },
    { pk: 'not-an-id', username: 'group.person' },
    { pk: Number.MAX_SAFE_INTEGER + 1, username: 'group.person' },
    { pk: '1', id: '2', username: 'group.person' },
  ].map((row, index) => [`invalid group identity ${index}`, [{ group: 'self_deactivated_followers', facepile: [row] }]]),
]) {
  test(`malformed deactivated follower data fails closed: ${label}`, async () => {
    const previous = { saved: 'previous comparison' };
    let published = previous, listCalls = 0;
    await assert.rejects(scanGroupFixture({
      followerPages: [{ users: [], groups }],
      onRequest(url) { if (url.pathname.includes('/friendships/')) listCalls += 1; },
    }).then(result => { published = result; }), { code: 'invalid-response' });
    assert.equal(published, previous);
    assert.equal(listCalls, 1);
  });
}

test('deactivated follower identities cannot conflict with the main list or each other', async () => {
  for (const users of [[], [{ pk: '1', username: 'conflicting.person' }]]) {
    await assert.rejects(scanGroupFixture({
      followerPages: [{ users, groups: [{ group: 'self_deactivated_followers', facepile: [
        { pk: '2', username: 'conflicting.person' }, { pk: '3', username: 'conflicting.person' },
      ] }] }],
    }), { code: 'invalid-response' });
  }
});

test('group rows preserve exact ID aliases and the existing stable-ID rename contract', async () => {
  const grouped = JSON.parse('{"pk":9007199254740993,"pk_id":"9007199254740993","username":"renamed.person"}');
  const result = await scanGroupFixture({
    followerCount: 1,
    followerPages: [{ users: [{ id: '9007199254740993', username: 'previous.name' }], groups: [{
      group: 'self_deactivated_followers', facepile: [grouped],
    }] }],
  });
  assert.equal(result.followers.length, 1);
  assert.equal(result.followers[0].username, 'renamed.person');
  assert.equal(result.complete.followers, true);
});

test('group context counts alone cannot fill a follower counter gap', async () => {
  const result = await scanGroupFixture({
    followerCount: 2,
    followerPages: [{ users: [{ pk: '1', username: 'main.person' }], groups: [{
      group: 'self_deactivated_followers', facepile: [], context: '1 account', count: 1, total_count: 1,
    }] }],
  });
  assert.equal(result.followers.length, 1);
  assert.equal(result.complete.followers, false);
  assert.equal(result.reasons.followers, 'count-mismatch');
});

test('group rows stay within the existing account limit', async () => {
  const result = await scanGroupFixture({
    followerCount: 3, maxAccounts: 2,
    followerPages: [{ users: [{ pk: '1', username: 'main.person' }], groups: [{
      group: 'self_deactivated_followers', facepile: [
        { pk: '2', username: 'group.one' }, { pk: '3', username: 'group.two' },
      ],
    }], next_max_id: 'unused-cursor' }],
  });
  assert.equal(result.followers.length, 2);
  assert.equal(result.complete.followers, false);
  assert.equal(result.reasons.followers, 'account-limit');
});

for (const flags of [{ has_more: true }, { should_limit_list_of_followers: true }]) {
  test(`group rows do not override existing pagination safety flags: ${JSON.stringify(flags)}`, async () => {
    const result = await scanGroupFixture({
      followerCount: 1,
      followerPages: [{ users: [], groups: [{
        group: 'self_deactivated_followers', facepile: [{ pk: '1', username: 'group.person' }],
      }], ...flags }],
    });
    assert.equal(result.followers.length, 1);
    assert.equal(result.complete.followers, false);
  });
}

test('Mutual Checker stops after one premature final Followers page without rerunning the list', async () => {
  const inspector = createInspector();
  const baseFollowers = Array.from({ length: 100 }, (_, index) => ({ username: `follower.${index}` }));
  let followerCalls = 0;
  const progress = [];
  const result = await inspector.fetchFollowerComparison({
    fetchImpl: async (input) => {
      const url = new URL(input);
      if (url.pathname.includes('topsearch')) {
        return response({
          users: [{ user: {
            pk: '77', username: 'target_name', follower_count: 101, following_count: 1,
          } }],
        });
      }
      if (url.pathname.includes('web_profile_info')) {
        return profileResponse({ followers: 101, following: 1 });
      }
      if (url.pathname.includes('/followers/')) {
        followerCalls += 1;
        return response({ users: baseFollowers });
      }
      return response({ users: [{ username: 'following.one' }] });
    },
    onProgress: (entry) => progress.push(entry),
    sleepImpl: async () => {},
    username: 'target_name',
  });

  assert.equal(followerCalls, 1);
  assert.equal(result.followers.length, 100);
  assert.equal(result.complete.followers, false);
  assert.equal(result.reasons.followers, 'count-mismatch');
  assert.equal(progress.some((entry) => entry.phase === 'reconciling'), false);
});

test('Mutual Checker never calls a changing union complete when no pass reached the exact count', async () => {
  const inspector = createInspector();
  let followerCalls = 0;
  const result = await inspector.fetchFollowerComparison({
    fetchImpl: async (input) => {
      const url = new URL(input);
      if (url.pathname.includes('topsearch')) {
        return response({ users: [{ user: { pk: '77', username: 'target_name' } }] });
      }
      if (url.pathname.includes('web_profile_info')) {
        return profileResponse({ followers: 2, following: 0 });
      }
      if (url.pathname.includes('/followers/')) {
        followerCalls += 1;
        return response({ users: [{ username: followerCalls === 1 ? 'account.a' : 'account.b' }] });
      }
      return response({ users: [] });
    },
    sleepImpl: async () => {},
    username: 'target_name',
  });

  assert.equal(followerCalls, 1);
  assert.equal(result.followers.length, 1);
  assert.equal(result.followers[0].username, 'account.a');
  assert.equal(result.complete.followers, false);
  assert.equal(result.reasons.followers, 'count-mismatch');
});

test('Mutual Checker finishes partial instead of hanging when Instagram keeps one account hidden', async () => {
  const inspector = createInspector();
  const followers = Array.from({ length: 100 }, (_, index) => ({ username: `follower.${index}` }));
  let followerCalls = 0;
  const result = await inspector.fetchFollowerComparison({
    fetchImpl: async (input) => {
      const url = new URL(input);
      if (url.pathname.includes('topsearch')) {
        return response({ users: [{ user: {
          pk: '77', username: 'target_name', follower_count: 101, following_count: 1,
        } }] });
      }
      if (url.pathname.includes('web_profile_info')) {
        return profileResponse({ followers: 101, following: 1 });
      }
      if (url.pathname.includes('/followers/')) {
        followerCalls += 1;
        return response({ users: followers });
      }
      return response({ users: [{ username: 'following.one' }] });
    },
    sleepImpl: async () => {},
    username: 'target_name',
  });

  assert.equal(followerCalls, 1);
  assert.equal(result.followers.length, 100);
  assert.equal(result.complete.followers, false);
  assert.equal(result.reasons.followers, 'count-mismatch');
});

test('Mutual Checker reads a 2,104-follower list in one cursor traversal', async () => {
  const inspector = createInspector();
  const followers = Array.from({ length: 2_104 }, (_, index) => ({ username: `follower.${index}` }));
  let followerCalls = 0;
  const progress = [];
  const result = await inspector.fetchFollowerComparison({
    fetchImpl: async (input) => {
      const url = new URL(input);
      if (url.pathname.includes('topsearch')) {
        return response({ users: [{ user: {
          pk: '77', username: 'target_name', follower_count: 2_104, following_count: 1,
        } }] });
      }
      if (url.pathname.includes('web_profile_info')) {
        return profileResponse({ followers: 2_104, following: 1 });
      }
      if (url.pathname.includes('/followers/')) {
        followerCalls += 1;
        const offset = Number(String(url.searchParams.get('max_id') || 'offset-0').replace('offset-', ''));
        const end = Math.min(followers.length, offset + 50);
        return response({
          users: followers.slice(offset, end),
          ...(end < followers.length ? { next_max_id: `offset-${end}` } : {}),
        });
      }
      return response({ users: [{ username: 'following.one' }] });
    },
    onProgress: (entry) => progress.push(entry),
    sleepImpl: async () => {},
    username: 'target_name',
  });

  assert.equal(followerCalls, 43);
  assert.equal(result.followers.length, 2_104);
  assert.equal(result.complete.followers, true);
  assert.equal(result.reasons.followers, 'pagination-complete');
  assert.equal(progress.some((entry) => entry.phase === 'reconciling'), false);
});

test('matching totals cannot override an explicit limited list or a missing continuation cursor', async () => {
  for (const flags of [{ should_limit_list_of_followers: true }, { has_more: true }]) {
    const result = await createInspector().fetchFollowerComparison({
      username: 'target_name', sleepImpl: async () => {},
      fetchImpl: async (input) => {
        const url = new URL(input);
        if (url.pathname.includes('topsearch')) return response({ users: [{ user: { pk: '77', username: 'target_name' } }] });
        if (url.pathname.includes('web_profile_info')) return profileResponse({ followers: 1, following: 0 });
        if (url.pathname.includes('/followers/')) return response({ users: [{ username: 'first' }], ...flags });
        return response({ users: [] });
      },
    });
    assert.equal(result.complete.followers, false);
    assert.equal(result.complete.following, true);
  }
});

test('missing profile counters are not coerced into a verified zero', async () => {
  for (const count of [null, '', false]) {
    await assert.rejects(createInspector().fetchFollowerComparison({
      username: 'target_name', sleepImpl: async () => {},
      fetchImpl: async (input) => new URL(input).pathname.includes('topsearch')
        ? response({ users: [{ user: { pk: '77', username: 'target_name' } }] })
        : profileResponse({ followers: count, following: 0 }),
    }), (error) => error.code === 'profile-count-unavailable');
  }
});

test('comparison data is not published while the last Following page or final count check is pending', async () => {
  const followingGate = Promise.withResolvers();
  const followingReached = Promise.withResolvers();
  const finalGate = Promise.withResolvers();
  const finalReached = Promise.withResolvers();
  let countReads = 0;
  let published = false;
  const pending = createInspector().fetchFollowerComparison({
    username: 'target_name', sleepImpl: async () => {},
    fetchImpl: async (input) => {
      const url = new URL(input);
      if (url.pathname.includes('topsearch')) return response({ users: [{ user: { pk: '77', username: 'target_name' } }] });
      if (url.pathname.includes('web_profile_info')) {
        if (++countReads === 2) { finalReached.resolve(); await finalGate.promise; }
        return profileResponse({ followers: 1, following: 2 });
      }
      if (url.pathname.includes('/followers/')) return response({ users: [{ username: 'mutual' }] });
      if (!url.searchParams.has('max_id')) return response({ users: [{ username: 'first' }], next_max_id: 'last' });
      followingReached.resolve();
      await followingGate.promise;
      return response({ users: [{ username: 'mutual' }] });
    },
  }).then((result) => { published = true; return result; });
  await followingReached.promise;
  assert.equal(published, false);
  followingGate.resolve();
  await finalReached.promise;
  assert.equal(published, false);
  finalGate.resolve();
  const result = await pending;
  assert.equal(result.complete.followers, true);
  assert.equal(result.complete.following, true);
  assert.equal(result.following.length, 2);
});

test('Mutual Checker finishes a large cursorless list partial after one traversal', async () => {
  const inspector = createInspector();
  const followers = Array.from({ length: 2_070 }, (_, index) => ({ username: `follower.${index}` }));
  let followerCalls = 0;
  const progress = [];
  const result = await inspector.fetchFollowerComparison({
    fetchImpl: async (input) => {
      const url = new URL(input);
      if (url.pathname.includes('topsearch')) {
        return response({ users: [{ user: {
          pk: '77', username: 'target_name', follower_count: 2_104, following_count: 1,
        } }] });
      }
      if (url.pathname.includes('web_profile_info')) {
        return profileResponse({ followers: 2_104, following: 1 });
      }
      if (url.pathname.includes('/followers/')) {
        followerCalls += 1;
        return response({ users: followers });
      }
      return response({ users: [{ username: 'following.one' }] });
    },
    onProgress: (entry) => progress.push(entry),
    sleepImpl: async () => {},
    username: 'target_name',
  });

  assert.equal(followerCalls, 1);
  assert.equal(result.followers.length, 2_070);
  assert.equal(result.expectedCounts.followers, 2_104);
  assert.equal(result.complete.followers, false);
  assert.equal(result.reasons.followers, 'count-mismatch');
  assert.equal(progress.some((entry) => entry.phase === 'reconciling'), false);
});

test('Mutual Checker reports when Instagram explicitly limits a relationship list', async () => {
  const inspector = createInspector();
  let followerCalls = 0;
  const result = await inspector.fetchFollowerComparison({
    fetchImpl: async (input) => {
      const url = new URL(input);
      if (url.pathname.includes('topsearch')) {
        return response({ users: [{ user: { pk: '77', username: 'target_name' } }] });
      }
      if (url.pathname.includes('web_profile_info')) {
        return profileResponse({ followers: 2_104, following: 0 });
      }
      if (url.pathname.includes('/followers/')) {
        followerCalls += 1;
        return response({
          has_more: false,
          should_limit_list_of_followers: true,
          users: Array.from({ length: 100 }, (_, index) => ({ username: `follower.${index}` })),
        });
      }
      return response({ users: [] });
    },
    sleepImpl: async () => {},
    username: 'target_name',
  });

  assert.equal(followerCalls, 1);
  assert.equal(result.followers.length, 100);
  assert.equal(result.complete.followers, false);
  assert.equal(result.reasons.followers, 'instagram-limited-list');
});

test('Mutual Checker reports a missing cursor without restarting the list', async () => {
  const inspector = createInspector();
  let followerCalls = 0;
  const result = await inspector.fetchFollowerComparison({
    fetchImpl: async (input) => {
      const url = new URL(input);
      if (url.pathname.includes('topsearch')) {
        return response({ users: [{ user: { pk: '77', username: 'target_name' } }] });
      }
      if (url.pathname.includes('web_profile_info')) {
        return profileResponse({ followers: 2, following: 0 });
      }
      if (url.pathname.includes('/followers/')) {
        followerCalls += 1;
        return response({ has_more: true, users: [{ username: 'account.a' }] });
      }
      return response({ users: [] });
    },
    sleepImpl: async () => {},
    username: 'target_name',
  });

  assert.equal(followerCalls, 1);
  assert.equal(result.followers.length, 1);
  assert.equal(result.complete.followers, false);
  assert.equal(result.reasons.followers, 'cursor-missing');
});

test('Mutual Checker rejects malformed Instagram pagination flags', async () => {
  const inspector = createInspector();
  await assert.rejects(
    inspector.fetchFollowerComparison({
      fetchImpl: async (input) => {
        const url = new URL(input);
        if (url.pathname.includes('topsearch')) {
          return response({ users: [{ user: { pk: '77', username: 'target_name' } }] });
        }
        if (url.pathname.includes('web_profile_info')) {
          return profileResponse({ followers: 2, following: 0 });
        }
        if (url.pathname.includes('/followers/')) {
          return response({ has_more: 'yes', users: [{ username: 'account.a' }] });
        }
        return response({ users: [] });
      },
      sleepImpl: async () => {},
      username: 'target_name',
    }),
    (error) => error.code === 'invalid-response',
  );
});

test('Mutual Checker does not treat stale top-search counters as completeness proof', async () => {
  const inspector = createInspector();
  const followers = Array.from({ length: 2_071 }, (_, index) => ({ username: `follower.${index}` }));
  const following = Array.from({ length: 100 }, (_, index) => ({ username: `following.${index}` }));
  let followerCalls = 0;
  let followingCalls = 0;
  const progress = [];
  const result = await inspector.fetchFollowerComparison({
    fetchImpl: async (input) => {
      const url = new URL(input);
      if (url.pathname.includes('topsearch')) {
        return response({ users: [{ user: {
          pk: '77', username: 'target_name', follower_count: 2_071, following_count: 100,
        } }] });
      }
      if (url.pathname.includes('web_profile_info')) {
        return profileResponse({ followers: 2_101, following: 101 });
      }
      if (url.pathname.includes('/followers/')) {
        followerCalls += 1;
        return response({ users: followers });
      }
      followingCalls += 1;
      return response({ users: following });
    },
    onProgress: (entry) => progress.push(entry),
    sleepImpl: async () => {},
    username: 'target_name',
  });

  assert.deepEqual({ ...result.expectedCounts }, { followers: 2_101, following: 101 });
  assert.deepEqual({ ...result.complete }, { followers: false, following: false });
  assert.deepEqual({ ...result.reasons }, { followers: 'count-mismatch', following: 'count-mismatch' });
  assert.equal(result.followers.length, 2_071);
  assert.equal(result.following.length, 100);
  assert.equal(followerCalls, 1);
  assert.equal(followingCalls, 1);
  assert.equal(progress.some((entry) => entry.phase === 'reconciling'), false);
});

test('Mutual Checker requires exact count equality when a traversal returns too many identities', async () => {
  const inspector = createInspector();
  const result = await inspector.fetchFollowerComparison({
    fetchImpl: async (input) => {
      const url = new URL(input);
      if (url.pathname.includes('topsearch')) {
        return response({ users: [{ user: { pk: '77', username: 'target_name' } }] });
      }
      if (url.pathname.includes('web_profile_info')) {
        return profileResponse({ followers: 1, following: 0 });
      }
      if (url.pathname.includes('/followers/')) {
        return response({ users: [{ username: 'one' }, { username: 'two' }] });
      }
      return response({ users: [] });
    },
    sleepImpl: async () => {},
    username: 'target_name',
  });

  assert.equal(result.followers.length, 2);
  assert.equal(result.complete.followers, false);
  assert.equal(result.reasons.followers, 'count-mismatch');
  assert.equal(result.complete.following, true);
});

test('Mutual Checker deduplicates a renamed account by stable Instagram ID', async () => {
  const inspector = createInspector();
  const result = await inspector.fetchFollowerComparison({
    fetchImpl: async (input) => {
      const url = new URL(input);
      if (url.pathname.includes('topsearch')) {
        return response({ users: [{ user: { pk: '77', username: 'target_name' } }] });
      }
      if (url.pathname.includes('web_profile_info')) {
        return profileResponse({ followers: 2, following: 0 });
      }
      if (url.pathname.includes('/followers/')) {
        if (!url.searchParams.has('max_id')) {
          return response({
            users: [
              { pk: '1001', username: 'old.name' },
              { pk: '1002', username: 'steady.name' },
            ],
            next_max_id: 'second-page',
          });
        }
        return response({ users: [{ pk: '1001', username: 'new.name' }] });
      }
      return response({ users: [] });
    },
    sleepImpl: async () => {},
    username: 'target_name',
  });

  assert.deepEqual([...result.followers].map((account) => account.username), ['new.name', 'steady.name']);
  assert.equal(result.complete.followers, true);
});

async function scanIdentityFixture({ followers = [], following = [], identity = { pk: '77' }, onRequest = () => {} }) {
  return createInspector().fetchFollowerComparison({
    username: 'target_name',
    sleepImpl: async () => {},
    fetchImpl: async (input) => {
      const url = new URL(input);
      onRequest(url);
      if (url.pathname.includes('topsearch')) {
        return response({ users: [{ user: { ...identity, username: 'target_name' } }] });
      }
      if (url.pathname.includes('web_profile_info')) {
        return response({ data: { user: {
          ...identity,
          username: 'target_name',
          edge_followed_by: { count: followers.length },
          edge_follow: { count: following.length },
        } } });
      }
      return response({ users: url.pathname.includes('/followers/') ? followers : following });
    },
  });
}

test('Mutual Checker preserves exact text IDs when JSON numeric IDs collide', async () => {
  const followers = JSON.parse('[{"pk":9007199254740992,"pk_id":"9007199254740992","username":"fixture.alpha"},{"pk":9007199254740993,"pk_id":"9007199254740993","username":"fixture.beta"}]');
  assert.equal(followers[0].pk, followers[1].pk, 'JSON has already rounded the second number');
  const result = await scanIdentityFixture({ followers });
  assert.equal(result.followers.length, 2);
  assert.equal(result.complete.followers, true);
  assert.deepEqual([...result.followers].map((account) => account.username), ['fixture.alpha', 'fixture.beta']);
  assert.deepEqual(Object.keys(result.followers[0]).sort(), ['displayName', 'profileUrl', 'source', 'username']);
});

test('Mutual Checker resolves the exact large profile ID instead of its rounded numeric alias', async () => {
  const identity = JSON.parse('{"pk":9007199254740993,"pk_id":"9007199254740993"}');
  const paths = [];
  const result = await scanIdentityFixture({ identity, onRequest: (url) => paths.push(url.pathname) });
  assert.equal(result.userId, '9007199254740993');
  assert.equal(paths.filter((path) => path.includes('/friendships/9007199254740993/')).length, 2);
});

for (const identity of [
  { pk: Number.MAX_SAFE_INTEGER + 1 },
  { pk: '1001', pk_id: '1002' },
  { pk: 1001, id: '1002' },
  { pk: Number.MAX_SAFE_INTEGER + 1, id: '9007199254741000' },
  { pk: 'not-an-id' },
  { pk: 1.5 },
]) {
  test(`Mutual Checker rejects ambiguous identity ${JSON.stringify(identity)} before list requests`, async () => {
    let requests = 0;
    await assert.rejects(scanIdentityFixture({ identity, onRequest: () => { requests += 1; } }), { code: 'invalid-response' });
    assert.equal(requests, 1);
  });
}

test('Mutual Checker rejects an unsafe list ID without publishing rounded identities', async () => {
  await assert.rejects(scanIdentityFixture({
    followers: [{ pk: Number.MAX_SAFE_INTEGER + 1, username: 'fixture.alpha' }],
  }), { code: 'invalid-response' });
});

test('Mutual Checker matches a cross-list rename by ID while preserving the public row schema', async () => {
  const result = await scanIdentityFixture({
    followers: [{ pk: '1001', username: 'fixture.old' }],
    following: [{ id: '1001', username: 'fixture.new' }],
  });
  const context = vm.createContext({});
  vm.runInContext(overlaySharedSource, context);
  const comparison = context.__instaToolboxOverlayModules.shared.compareCaptureWorkspace({
    ...result, verified: { followers: true, following: true },
  });
  assert.equal(comparison.mutuals.length, 1);
  assert.equal(comparison.notFollowingMeBack.length, 0);
  assert.equal(comparison.iDoNotFollowBack.length, 0);
  assert.equal(comparison.mutuals[0].username, 'fixture.new');
  assert.equal(result.followers[0].profileUrl, 'https://www.instagram.com/fixture.new/');
  assert.equal(Object.hasOwn(result.followers[0], 'id'), false);
});

test('Mutual Checker rejects one username assigned to different IDs across lists', async () => {
  await assert.rejects(scanIdentityFixture({
    followers: [{ pk: '1001', username: 'fixture.same' }],
    following: [{ pk: '1002', username: 'fixture.same' }],
  }), { code: 'invalid-response' });
});

test('Mutual Checker rejects a rename that collides with a username-only row', async () => {
  await assert.rejects(scanIdentityFixture({
    followers: [{ pk: '1001', username: 'fixture.old' }, { username: 'fixture.new' }],
    following: [{ pk: '1001', username: 'fixture.new' }],
  }), { code: 'invalid-response' });
});

test('Mutual Checker keeps username-only rows compatible and accepts matching safe ID aliases', async () => {
  const result = await scanIdentityFixture({
    followers: [{ pk: 1001, id: '1001', pk_id: '1001', username: 'fixture.stable' }, { username: 'fixture.legacy' }],
    following: [{ username: 'fixture.legacy' }],
  });
  assert.deepEqual({ ...result.complete }, { followers: true, following: true });
  assert.deepEqual([...result.followers].map((account) => account.username), ['fixture.legacy', 'fixture.stable']);
});

test('Mutual Checker marks a run partial when verified profile totals change during traversal', async () => {
  const inspector = createInspector();
  let profileReads = 0;
  const result = await inspector.fetchFollowerComparison({
    fetchImpl: async (input) => {
      const url = new URL(input);
      if (url.pathname.includes('topsearch')) {
        return response({ users: [{ user: { pk: '77', username: 'target_name' } }] });
      }
      if (url.pathname.includes('web_profile_info')) {
        profileReads += 1;
        return profileResponse({ followers: profileReads === 1 ? 2 : 3, following: 1 });
      }
      if (url.pathname.includes('/followers/')) {
        return response({ users: [{ username: 'one' }, { username: 'two' }] });
      }
      return response({ users: [{ username: 'following.one' }] });
    },
    sleepImpl: async () => {},
    username: 'target_name',
  });

  assert.equal(profileReads, 2);
  assert.equal(result.complete.followers, false);
  assert.equal(result.reasons.followers, 'count-changed');
  assert.equal(result.expectedCounts.followers, 3);
  assert.equal(result.complete.following, true);
});

test('Mutual Checker marks an exact-profile counter disagreement partial', async () => {
  const inspector = createInspector({
    pathname: '/target_name/',
    profileCounts: { followers: 2_102, following: 101 },
  });
  const followers = Array.from({ length: 2_101 }, (_, index) => ({ username: `follower.${index}` }));
  const following = Array.from({ length: 101 }, (_, index) => ({ username: `following.${index}` }));
  const result = await inspector.fetchFollowerComparison({
    fetchImpl: async (input) => {
      const url = new URL(input);
      if (url.pathname.includes('topsearch')) {
        return response({ users: [{ user: { pk: '77', username: 'target_name' } }] });
      }
      if (url.pathname.includes('web_profile_info')) {
        return profileResponse({ followers: 2_101, following: 101 });
      }
      if (url.pathname.includes('/followers/')) return response({ users: followers });
      return response({ users: following });
    },
    sleepImpl: async () => {},
    username: 'target_name',
  });

  assert.equal(result.complete.followers, false);
  assert.equal(result.reasons.followers, 'profile-count-disagreement');
  assert.equal(result.complete.following, true);
});

test('Mutual Checker ignores unrelated profile counters when checking the exact profile', async () => {
  const inspector = createInspector({
    pathname: '/target_name/',
    profileLinks: [
      { href: '/suggested_profile/followers/', title: '99 followers' },
      { href: '/target_name/followers/', title: '3 followers' },
      { href: '/target_name/following/', title: '1 following' },
    ],
  });
  const result = await inspector.fetchFollowerComparison({
    fetchImpl: async (input) => {
      const url = new URL(input);
      if (url.pathname.includes('topsearch')) {
        return response({ users: [{ user: { pk: '77', username: 'target_name' } }] });
      }
      if (url.pathname.includes('web_profile_info')) {
        return profileResponse({ followers: 3, following: 1 });
      }
      if (url.pathname.includes('/followers/')) {
        return response({ users: [{ username: 'one' }, { username: 'two' }, { username: 'three' }] });
      }
      return response({ users: [{ username: 'following.one' }] });
    },
    sleepImpl: async () => {},
    username: 'target_name',
  });

  assert.equal(result.complete.followers, true);
  assert.equal(result.reasons.followers, 'pagination-complete');
});

test('Mutual Checker fails closed when profile counter identity differs from search identity', async () => {
  const inspector = createInspector();
  let relationshipRequests = 0;
  await assert.rejects(
    inspector.fetchFollowerComparison({
      fetchImpl: async (input) => {
        const url = new URL(input);
        if (url.pathname.includes('topsearch')) {
          return response({ users: [{ user: { pk: '77', username: 'target_name' } }] });
        }
        if (url.pathname.includes('web_profile_info')) {
          return profileResponse({ followers: 2_101, following: 101, id: '78' });
        }
        relationshipRequests += 1;
        return response({ users: [] });
      },
      username: 'target_name',
    }),
    (error) => error.code === 'profile-mismatch'
      && /previous comparison is unchanged/i.test(error.message),
  );
  assert.equal(relationshipRequests, 0);
});

test('Mutual Checker fails closed when exact profile counters are unavailable', async () => {
  const inspector = createInspector();
  await assert.rejects(
    inspector.fetchFollowerComparison({
      fetchImpl: async (input) => {
        const url = new URL(input);
        if (url.pathname.includes('topsearch')) {
          return response({ users: [{ user: { pk: '77', username: 'target_name' } }] });
        }
        if (url.pathname.includes('web_profile_info')) {
          return response({ data: { user: { id: '77', username: 'target_name' } } });
        }
        throw new Error(`Unexpected request: ${url.href}`);
      },
      username: 'target_name',
    }),
    (error) => error.code === 'profile-count-unavailable'
      && /previous comparison is unchanged/i.test(error.message),
  );
});

test('authenticated follower check stops on rate limits before requesting another list', async () => {
  const inspector = createInspector();
  let calls = 0;
  await assert.rejects(
    inspector.fetchFollowerComparison({
      fetchImpl: async (input) => {
        calls += 1;
        const url = new URL(input);
        if (url.pathname.includes('topsearch')) {
          return response({ users: [{ user: { pk: '88', username: 'target_name' } }] });
        }
        if (url.pathname.includes('web_profile_info')) {
          return profileResponse({ followers: 1, following: 1, id: '88' });
        }
        return response({ message: 'Please wait a few minutes before you try again.' }, 429);
      },
      username: 'target_name',
    }),
    (error) => error.code === 'rate-limited',
  );
  assert.equal(calls, 3);
});

test('authenticated follower check marks bounded pagination as partial instead of claiming completion', async () => {
  const inspector = createInspector();
  const result = await inspector.fetchFollowerComparison({
    fetchImpl: async (input) => {
      const url = new URL(input);
      if (url.pathname.includes('topsearch')) {
        return response({ users: [{ user: { pk: '77', username: 'target_name' } }] });
      }
      if (url.pathname.includes('web_profile_info')) {
        return profileResponse({ followers: 2, following: 2 });
      }
      return response({ users: [{ username: `${url.pathname.includes('/followers/') ? 'follower' : 'following'}.one` }], next_max_id: 'next' });
    },
    maxPages: 1,
    sleepImpl: async () => {},
    username: 'target_name',
  });
  assert.deepEqual({ ...result.complete }, { followers: false, following: false });
  assert.deepEqual({ ...result.reasons }, { followers: 'page-limit', following: 'page-limit' });
});

test('Mutual Checker stops one traversal after three stagnant cursor pages', async () => {
  const inspector = createInspector();
  let followerCalls = 0;
  const result = await inspector.fetchFollowerComparison({
    fetchImpl: async (input) => {
      const url = new URL(input);
      if (url.pathname.includes('topsearch')) {
        return response({ users: [{ user: { pk: '77', username: 'target_name' } }] });
      }
      if (url.pathname.includes('web_profile_info')) {
        return profileResponse({ followers: 2, following: 0 });
      }
      if (url.pathname.includes('/followers/')) {
        followerCalls += 1;
        return response({
          users: [{ username: 'only.visible' }],
          next_max_id: `rotating-${followerCalls}`,
        });
      }
      return response({ users: [] });
    },
    maxPages: 100,
    sleepImpl: async () => {},
    username: 'target_name',
  });

  assert.equal(followerCalls, 4);
  assert.equal(result.followers.length, 1);
  assert.equal(result.complete.followers, false);
  assert.equal(result.reasons.followers, 'count-mismatch');
});

test('authenticated follower check refuses to run outside instagram.com', async () => {
  const inspector = createInspector({ origin: 'https://example.com' });
  await assert.rejects(
    inspector.fetchFollowerComparison({ fetchImpl: async () => response({}), username: 'target_name' }),
    (error) => error.code === 'wrong-origin',
  );
});

test('authenticated follower check maps an aborted browser request to an explicit safe stop', async () => {
  const inspector = createInspector();
  const controller = new AbortController();
  const pending = inspector.fetchFollowerComparison({
    fetchImpl: async (_input, { signal }) => new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => {
        const error = new Error('browser abort');
        error.name = 'AbortError';
        reject(error);
      }, { once: true });
    }),
    signal: controller.signal,
    username: 'target_name',
  });
  controller.abort();
  await assert.rejects(pending, (error) => error.code === 'stopped');
});

test('authenticated follower check enforces its hard deadline during a pending request', async () => {
  const inspector = createInspector();
  let cleared = false;
  await assert.rejects(
    inspector.fetchFollowerComparison({
      clearTimer: () => { cleared = true; },
      fetchImpl: async (_input, { signal }) => new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => {
          const error = new Error('deadline abort');
          error.name = 'AbortError';
          reject(error);
        }, { once: true });
      }),
      maxDurationMs: 1_000,
      setTimer(callback) {
        queueMicrotask(callback);
        return 1;
      },
      username: 'target_name',
    }),
    (error) => error.code === 'time-limit',
  );
  assert.equal(cleared, true);
});

test('authenticated follower check retries a hung fetch twice before preserving the previous result', async () => {
  const inspector = createInspector();
  const progress = [];
  let calls = 0;
  await assert.rejects(
    inspector.fetchFollowerComparison({
      fetchImpl: async () => {
        calls += 1;
        return new Promise(() => {});
      },
      onProgress: (entry) => progress.push(entry),
      requestTimeoutMs: 5,
      retryBaseMs: 0,
      sleepImpl: async () => {},
      username: 'target_name',
    }),
    (error) => error.code === 'request-timeout'
      && /3 attempts/.test(error.message)
      && /previous comparison is unchanged/i.test(error.message),
  );
  assert.equal(calls, 3);
  assert.deepEqual(
    progress.filter((entry) => entry.phase === 'retrying').map((entry) => ({
      attempt: entry.attempt,
      listType: entry.listType,
      pages: entry.pages,
    })),
    [
      { attempt: 2, listType: null, pages: 0 },
      { attempt: 3, listType: null, pages: 0 },
    ],
  );
});

test('authenticated follower check retries a hung JSON body and succeeds without duplicate rows', async () => {
  const inspector = createInspector();
  const progress = [];
  let searchBodies = 0;
  const result = await inspector.fetchFollowerComparison({
    fetchImpl: async (input) => {
      const url = new URL(input);
      if (url.pathname.includes('topsearch')) {
        searchBodies += 1;
        if (searchBodies < 3) return { ok: true, status: 200, json: async () => new Promise(() => {}) };
        return response({ users: [{ user: { pk: '44', username: 'target_name' } }] });
      }
      if (url.pathname.includes('web_profile_info')) {
        return profileResponse({ followers: 1, following: 1, id: '44' });
      }
      return response({
        users: [
          { username: 'same.person', full_name: 'Same Person' },
          { username: 'same.person', full_name: 'Same Person' },
        ],
      });
    },
    onProgress: (entry) => progress.push(entry),
    requestTimeoutMs: 5,
    retryBaseMs: 0,
    sleepImpl: async () => {},
    username: 'target_name',
  });
  assert.equal(searchBodies, 3);
  assert.equal(result.followers.length, 1);
  assert.equal(result.following.length, 1);
  assert.deepEqual(
    progress.filter((entry) => entry.phase === 'retrying').map((entry) => entry.attempt),
    [2, 3],
  );
});

test('authenticated follower check stops immediately when aborted during retry backoff', async () => {
  const inspector = createInspector();
  const controller = new AbortController();
  let calls = 0;
  await assert.rejects(
    inspector.fetchFollowerComparison({
      fetchImpl: async () => {
        calls += 1;
        throw new TypeError('offline');
      },
      onProgress(entry) {
        if (entry.phase === 'retrying') queueMicrotask(() => controller.abort());
      },
      retryBaseMs: 250,
      signal: controller.signal,
      username: 'target_name',
    }),
    (error) => error.code === 'stopped',
  );
  assert.equal(calls, 1);
});

test('follower comparison export provides a readable UTF-8 report and preserves schema-1 JSON', () => {
  const inspector = createInspector();
  const workspace = {
    subjectUsername: 'Demo.Creator',
    followers: [{ username: 'friend.one' }, { username: 'incoming.only' }],
    following: [{ username: 'friend.one' }, { username: 'outgoing.only' }],
    complete: { followers: true, following: true },
    verified: { followers: true, following: true },
    source: { followers: 'authenticated-web', following: 'authenticated-web' },
  };
  const comparison = {
    mutuals: [{ username: 'friend.one', displayName: 'Friend One' }],
    notFollowingMeBack: [{ username: 'outgoing.only', displayName: 'Outgoing Only' }],
    iDoNotFollowBack: [{ username: 'incoming.only', displayName: 'Incoming Only' }],
  };
  const generatedAt = '2026-08-22T12:34:56.000Z';
  const report = inspector.followerComparisonReport(workspace, comparison, generatedAt);
  assert.match(report, /^INSTA TOOLBOX MUTUAL CHECK\r\n/m);
  assert.match(report, /Account: @demo\.creator/);
  assert.match(report, /Generated: 2026-08-22T12:34:56\.000Z/);
  assert.match(report, /Completeness: Complete/);
  assert.match(report, /Followers: 2\r\nFollowing: 2\r\nMutual followers: 1/);
  assert.match(report, /NOT FOLLOWING YOU BACK\r\n-+\r\n1\. @outgoing\.only — Outgoing Only/);
  assert.match(report, /YOU DO NOT FOLLOW BACK\r\n-+\r\n1\. @incoming\.only — Incoming Only/);
  assert.match(report, /MUTUAL FOLLOWERS\r\n-+\r\n1\. @friend\.one — Friend One/);

  const record = inspector.followerComparisonRecord(workspace, comparison, generatedAt);
  assert.equal(record.schemaVersion, 1);
  assert.equal(record.kind, 'insta-toolbox-comparison');
  assert.equal(record.generatedAt, generatedAt);
  assert.equal(record.notFollowingMeBack[0].username, 'outgoing.only');
});

test('comparison exports refuse partial lists instead of publishing false non-mutuals', () => {
  const inspector = createInspector();
  const workspace = {
    subjectUsername: 'demo.creator',
    followers: Array.from({ length: 2_070 }, (_, index) => ({ username: `follower.${index}` })),
    following: Array.from({ length: 101 }, (_, index) => ({ username: `following.${index}` })),
    complete: { followers: false, following: true },
    verified: { followers: true, following: true },
    source: { followers: 'authenticated-web', following: 'authenticated-web' },
  };
  const comparison = {
    mutuals: [], notFollowingMeBack: [], iDoNotFollowBack: [],
  };
  for (const method of ['followerComparisonReport', 'followerComparisonRecord']) {
    assert.throws(() => inspector[method](workspace, comparison), (error) => error.code === 'incomplete-comparison');
  }
  workspace.complete.followers = true;
  assert.match(inspector.followerComparisonReport(workspace, comparison), /Followers: 2,070\r\nFollowing: 101/);
});

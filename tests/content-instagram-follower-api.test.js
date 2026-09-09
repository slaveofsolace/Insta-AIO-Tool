import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { webcrypto } from 'node:crypto';
import vm from 'node:vm';

const [actionLabelsSource, inspectorSource] = await Promise.all([
  readFile(new URL('../extension/action-labels.js', import.meta.url), 'utf8'),
  readFile(new URL('../extension/content-instagram.js', import.meta.url), 'utf8'),
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

function createInspector({
  origin = 'https://www.instagram.com',
  pathname = '/demo_creator/',
  profileCounts = null,
  profileLinks: suppliedProfileLinks = null,
  pageLocation = null,
  headerUsername = null,
  headerCopies = 1,
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
      if (name === 'aria-hidden') return entry.hidden ? 'true' : null;
      if (name === 'title') return entry.title;
      if (name === 'href') return entry.href || null;
      return null;
    },
    get textContent() { return entry.text || entry.title; },
    querySelector: () => entry.childTitle ? { getAttribute: () => entry.childTitle } : null,
    closest: () => entry.inDialog ? {} : null,
  }));
  const header = {
    getAttribute: () => null,
    textContent: headerUsername,
    contains: (link) => profileLinks.includes(link) && !profileLinkData[profileLinks.indexOf(link)].outsideHeader,
    querySelectorAll: () => [{ getAttribute: () => null, textContent: headerUsername }],
  };
  const document = {
    body: { innerText: '' },
    querySelector: () => null,
    querySelectorAll: (selector) => (
      selector === 'a[role="link"], a[href="#"]' ? profileLinks
        : selector === 'main header' && headerUsername ? Array(headerCopies).fill(header) : []
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
    location: pageLocation || {
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

test('profile metadata restrictions stop before decoding HTML or stalled bodies', async () => {
  for (const [status, code] of [[429, 'rate-limited'], [401, 'session-expired']]) {
    for (const body of ['html', 'stalled']) {
      const inspector = createInspector();
      const requests = [];
      let decodeCalls = 0;
      let retries = 0;
      await assert.rejects(inspector.fetchFollowerComparison({
        username: 'target_name',
        fetchImpl: async (input) => {
          const url = new URL(input);
          requests.push(url.pathname);
          if (url.pathname.includes('topsearch')) {
            return response({ users: [{ user: { pk: '77', username: 'target_name' } }] });
          }
          assert.equal(url.pathname, '/api/v1/users/web_profile_info/');
          return {
            ok: false,
            status,
            json() {
              decodeCalls += 1;
              if (body === 'stalled') return new Promise(() => {});
              throw new SyntaxError('HTML is not JSON');
            },
          };
        },
        requestTimeoutMs: 5,
        sleepImpl: async () => { retries += 1; },
      }), (error) => error.code === code);
      assert.equal(decodeCalls, 0);
      assert.equal(retries, 0);
      assert.deepEqual(requests, [
        '/api/v1/web/search/topsearch/',
        '/api/v1/users/web_profile_info/',
      ]);
    }
  }
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

test('open-profile background check uses exact rendered totals without profile requests or dialogs', async () => {
  const inspector = createInspector({
    pathname: '/target_name/',
    profileLinks: [
      { href: '/target_name/followers/', text: '2.1K followers', childTitle: '2,104' },
      { href: '/target_name/following/', title: '101 following' },
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

for (const titled of [false, true]) {
  test(`hash-link profile counters avoid metadata requests (${titled ? 'exact title' : 'visible text'})`, async () => {
    const inspector = createInspector({
      pathname: '/target_name/',
      headerUsername: 'target_name',
      profileLinks: [
        { href: '#', text: titled ? '1K followers' : '1,001 followers', childTitle: titled ? '1,001' : null },
        { href: '#', text: '2 following' },
        { href: '#', text: '999 followers', outsideHeader: true },
        { href: '#', text: '888 followers', hidden: true },
        { href: '#', text: '777 followers', inDialog: true },
      ],
    });
    const paths = [];
    const result = await inspector.fetchFollowerComparison({
      username: 'target_name',
      sleepImpl: async () => {},
      fetchImpl: async (input) => {
        const url = new URL(input);
        paths.push(url.pathname);
        if (url.pathname.includes('topsearch')) return response({ users: [{ user: { pk: '77', username: 'target_name' } }] });
        assert.ok(url.pathname.startsWith('/api/v1/friendships/77/'), 'must not request profile metadata');
        const followers = url.pathname.includes('/followers/');
        const total = followers ? 1_001 : 2;
        const offset = Number(url.searchParams.get('max_id') || 0);
        const end = Math.min(offset + 50, total);
        return response({
          users: Array.from({ length: end - offset }, (_, i) => ({ username: `account.${offset + i}` })),
          ...(end < total ? { next_max_id: String(end) } : {}),
        });
      },
    });
    assert.deepEqual({ ...result.expectedCounts }, { followers: 1_001, following: 2 });
    assert.deepEqual({ ...result.complete }, { followers: true, following: true });
    assert.equal(paths.length, 23);
  });
}

for (const kind of ['missing-header', 'wrong-header', 'ambiguous-header', 'outside-header', 'rounded', 'decimal', 'conflicting', 'hidden', 'dialog']) {
  test(`hash-link counters reject ${kind} evidence`, async () => {
    const links = [
      { href: '#', text: kind === 'rounded' ? '1K followers' : kind === 'decimal' ? '1.2 followers' : '1 followers',
        outsideHeader: kind === 'outside-header', hidden: kind === 'hidden', inDialog: kind === 'dialog' },
      { href: '#', text: '1 following' },
    ];
    if (kind === 'conflicting') links.push({ href: '#', text: '2 followers' });
    const inspector = createInspector({
      pathname: '/target_name/',
      headerUsername: kind === 'missing-header' ? null : kind === 'wrong-header' ? 'another_profile' : 'target_name',
      headerCopies: kind === 'ambiguous-header' ? 2 : 1,
      profileLinks: links,
    });
    let metadataRequests = 0;
    await assert.rejects(inspector.fetchFollowerComparison({
      username: 'target_name',
      fetchImpl: async (input) => {
        if (input.includes('topsearch')) return response({ users: [{ user: { pk: '77', username: 'target_name' } }] });
        assert.ok(input.includes('web_profile_info'));
        metadataRequests += 1;
        return response({}, 429);
      },
    }), { code: 'rate-limited' });
    assert.equal(metadataRequests, 1);
  });
}

test('hash-link counter changes keep the comparison incomplete', async () => {
  const links = [{ href: '#', text: '1 followers' }, { href: '#', text: '1 following' }];
  const inspector = createInspector({ pathname: '/target_name/', headerUsername: 'target_name', profileLinks: links });
  const result = await inspector.fetchFollowerComparison({
    username: 'target_name',
    fetchImpl: async (input) => {
      if (input.includes('topsearch')) return response({ users: [{ user: { pk: '77', username: 'target_name' } }] });
      assert.ok(input.includes('/friendships/'));
      if (input.includes('/following/')) links[0].text = '2 followers';
      return response({ users: [{ username: 'mutual' }] });
    },
  });
  assert.equal(result.complete.followers, false);
  assert.equal(result.reasons.followers, 'count-changed');
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

for (const kind of ['different-profile', 'rounded-only', 'external-origin', 'conflicting-counts']) {
  test(`background count source does not trust ${kind} profile labels`, async () => {
    const profileLinks = [
      { href: kind === 'different-profile' ? '/different/followers/' : kind === 'external-origin' ? 'https://example.com/target_name/followers/' : '/target_name/followers/', title: kind === 'rounded-only' ? '2.1K followers' : '1 followers' },
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

test('cooldown retries the same page after Retry-After seconds or HTTP date without rescanning', async () => {
  for (const dateHeader of [false, true]) {
    const inspector = createInspector();
    let clock = 1_800_000_000_000;
    const start = clock;
    const requests = [];
    const events = [];
    let secondPage = 0;
    const result = await inspector.fetchFollowerComparison({
      username: 'target_name', retryRateLimits: true, now: () => clock,
      sleepImpl: async (ms) => { clock += ms; }, random: () => 0,
      onProgress: (event) => events.push(event),
      fetchImpl: async (input) => {
        const url = new URL(input);
        requests.push(url.pathname + url.search);
        if (url.pathname.includes('topsearch')) return response({ users: [{ user: { pk: '77', username: 'target_name' } }] });
        if (url.pathname.includes('web_profile_info')) return profileResponse({ followers: 2, following: 1 });
        if (url.pathname.includes('/followers/')) {
          if (!url.searchParams.has('max_id')) return response({ users: [{ username: 'first' }], next_max_id: 'second' });
          if (++secondPage === 1) return {
            status: 429, ok: false,
            headers: { get: () => dateHeader ? new Date(clock + 4000).toUTCString() : '4' },
            json() { throw new Error('must not decode restriction HTML'); },
          };
          assert.ok(clock >= start + 4000);
          return response({ users: [{ username: 'second' }] });
        }
        return response({ users: [{ username: 'first' }] });
      },
    });
    assert.equal(result.followers.length, 2);
    assert.equal(result.complete.followers, true);
    assert.equal(requests.filter(u => u.includes('/followers/') && !u.includes('max_id')).length, 1);
    assert.equal(secondPage, 2);
    const cooldowns = events.filter(e => e.phase === 'cooldown');
    assert.ok(cooldowns.length >= 3);
    assert.equal(cooldowns[0].found, 1);
    assert.equal(cooldowns[0].pages, 1);
    assert.equal(cooldowns[0].cooldownSource, 'server');
    assert.ok(cooldowns.at(-1).remainingMs <= 1000);
  }
});

test('missing or malformed Retry-After backs off five then ten minutes and stops before the run deadline', async () => {
  for (const header of [null, 'nonsense', '-1', '0.5']) {
    let clock = 1_800_000_000_000;
    let calls = 0;
    const starts = [];
    await assert.rejects(createInspector().fetchFollowerComparison({
      username: 'target_name', retryRateLimits: true, now: () => clock,
      sleepImpl: async (ms) => { clock += ms; },
      onProgress(e) { if (e.phase === 'cooldown' && !starts.some(s => s.attempt === e.attempt)) starts.push(e); },
      fetchImpl: async () => { calls += 1; return { status: 429, headers: { get: () => header } }; },
    }), e => e.code === 'rate-limited' && /run has stopped/.test(e.message));
    assert.equal(calls, 3);
    assert.deepEqual(starts.map(e => e.remainingMs), [300000, 600000]);
    assert.ok(starts.every(e => e.cooldownSource === 'fallback'));
  }
});

test('long Retry-After is never shortened to fit the run deadline', async () => {
  let calls = 0;
  let waits = 0;
  await assert.rejects(createInspector().fetchFollowerComparison({
    username: 'target_name', retryRateLimits: true,
    fetchImpl: async () => { calls += 1; return { status: 429, headers: { get: () => '86400' } }; },
    sleepImpl: async () => { waits += 1; },
  }), e => e.code === 'rate-limited' && /no earlier than/.test(e.message));
  assert.equal(calls, 1);
  assert.equal(waits, 0);
});

test('Stop and profile navigation cancel a cooldown before another request', async () => {
  for (const navigate of [false, true]) {
    const controller = new AbortController();
    const pageLocation = { origin: 'https://www.instagram.com', pathname: '/target_name/' };
    let clock = 1_800_000_000_000;
    let calls = 0;
    await assert.rejects(createInspector({ pageLocation }).fetchFollowerComparison({
      username: 'target_name', retryRateLimits: true, signal: controller.signal, now: () => clock,
      fetchImpl: async () => { calls += 1; return { status: 429, headers: { get: () => '4' } }; },
      sleepImpl: async (ms) => {
        clock += ms;
        if (navigate) pageLocation.pathname = '/different/';
        else controller.abort();
      },
    }), e => e.code === (navigate ? 'profile-mismatch' : 'stopped'));
    assert.equal(calls, 1);
  }
});

test('Stop then restart keeps the pending cooldown in the same tab', async () => {
  const inspector = createInspector();
  const controller = new AbortController();
  let clock = 1_800_000_000_000;
  const start = clock;
  await assert.rejects(inspector.fetchFollowerComparison({
    username: 'target_name', retryRateLimits: true, now: () => clock, signal: controller.signal,
    fetchImpl: async () => ({ status: 429, headers: { get: () => '10' } }),
    sleepImpl: async (ms) => { clock += ms; controller.abort(); },
  }), e => e.code === 'stopped');
  let calls = 0;
  await assert.rejects(inspector.fetchFollowerComparison({
    username: 'target_name', retryRateLimits: true, now: () => clock,
    sleepImpl: async (ms) => { clock += ms; },
    fetchImpl: async () => {
      calls += 1;
      assert.ok(clock >= start + 10000);
      return response(null, 401);
    },
  }), e => e.code === 'session-expired');
  assert.equal(calls, 1);
});

test('zero Retry-After still has a finite retry budget and no immediate request loop', async () => {
  let clock = 1_800_000_000_000;
  const start = clock;
  let calls = 0;
  await assert.rejects(createInspector().fetchFollowerComparison({
    username: 'target_name', retryRateLimits: true, now: () => clock,
    sleepImpl: async (ms) => { assert.ok(ms > 0); clock += ms; },
    fetchImpl: async () => { calls += 1; return { status: 429, headers: { get: () => '0' } }; },
  }), e => e.code === 'rate-limited' && /Automatic retries stopped/.test(e.message));
  assert.equal(calls, 9);
  assert.equal(clock - start, 8000);
});

test('both surfaces enable cancellable cooldowns with source-labeled countdown text', async () => {
  for (const file of ['../userscripts/src/toolbox-shell.js', '../extension/overlay/views/capture.js']) {
    const source = await readFile(new URL(file, import.meta.url), 'utf8');
    assert.match(source, /retryRateLimits: true/);
    assert.match(source, /progress\.phase === 'cooldown'/);
    assert.match(source, /progress\.remainingMs/);
    assert.match(source, /Wait supplied by Instagram/);
    assert.match(source, /Instagram gave no reset time/);
    assert.match(source, /Stop cancels the retry/);
  }
});

test('automatic cooldown never retries login, challenge, or action-block responses', async () => {
  for (const [status, body, code] of [
    [401, null, 'session-expired'],
    [400, { message: 'challenge_required' }, 'challenge'],
    [400, { message: 'feedback_required' }, 'action-blocked'],
  ]) {
    let calls = 0;
    await assert.rejects(createInspector().fetchFollowerComparison({
      username: 'target_name', retryRateLimits: true,
      fetchImpl: async () => { calls += 1; return response(body, status); },
      sleepImpl: async () => assert.fail('must not wait or retry'),
    }), e => e.code === code);
    assert.equal(calls, 1);
  }
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

test('partial comparison exports retain captured accounts with explicit uncertainty', () => {
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
    mutuals: [], notFollowingMeBack: workspace.following, iDoNotFollowBack: workspace.followers,
  };
  const record = inspector.followerComparisonRecord(workspace, comparison);
  assert.equal(record.schemaVersion, 1);
  assert.equal(record.partial, true);
  assert.equal(record.complete.followers, false);
  assert.equal(record.notFollowingMeBack.length, 101);
  assert.equal(record.labels.notFollowingMeBack, 'Not found in followers');
  assert.match(record.warning, /may still be a mutual/);
  assert.match(record.warning, /reason are unknown/);
  const report = inspector.followerComparisonReport(workspace, comparison);
  assert.match(report, /Completeness: Partial/);
  assert.match(report, /NOT FOUND IN FOLLOWERS/);
  assert.match(report, /1\. @following\.0/);
  assert.doesNotMatch(report, /NOT FOLLOWING YOU BACK/);
  workspace.complete.followers = true;
  assert.match(inspector.followerComparisonReport(workspace, comparison), /Followers: 2,070\r\nFollowing: 101/);
});

test('comparison availability includes one-sided and unverified saved rows without claiming completeness', () => {
  const inspector = createInspector();
  for (const workspace of [
    { followers: [{ username: 'captured' }], following: [] },
    { followers: [], following: [{ username: 'captured' }], verified: { following: false } },
    { followers: [], following: [], verified: { followers: true }, complete: { followers: false } },
  ]) {
    const summary = inspector.followerComparisonSummary(workspace);
    assert.equal(summary.available, true);
    assert.equal(summary.complete, false);
    assert.equal(summary.labels.iDoNotFollowBack, 'Not found in following');
    assert.match(summary.warning, /captured accounts only/);
  }
  assert.equal(inspector.followerComparisonSummary({}).available, false);
  const empty = inspector.followerComparisonSummary({ verified: { followers: true, following: true }, complete: { followers: true, following: true } });
  assert.equal(empty.available, true);
  assert.equal(empty.complete, true);
  assert.equal(empty.warning, '');
});

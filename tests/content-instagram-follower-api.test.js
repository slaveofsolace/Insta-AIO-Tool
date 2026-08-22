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

function createInspector({ origin = 'https://www.instagram.com' } = {}) {
  const document = {
    body: { innerText: '' },
    querySelector: () => null,
    querySelectorAll: () => [],
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
      href: `${origin}/demo_creator/`,
      origin,
      pathname: '/demo_creator/',
    },
    setTimeout,
  });
  vm.runInContext(actionLabelsSource, context);
  vm.runInContext(inspectorSource, context);
  return context.InstaAioInstagramInspector;
}

test('authenticated follower check uses only the exact supplied read endpoints and paginates both lists', async () => {
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
  assert.equal(progress.at(-1).phase, 'complete');
  assert.equal(requests.length, 4);
  assert.equal(requests[0].url.searchParams.get('query'), 'demo.creator');
  for (const { url, options } of requests) {
    assert.equal(url.origin, 'https://www.instagram.com');
    assert.equal(options.method, 'GET');
    assert.equal(options.credentials, 'include');
    assert.deepEqual({ ...options.headers }, { 'X-IG-App-ID': '936619743392459' });
  }
  assert.equal(requests[1].url.searchParams.get('count'), '50');
  assert.equal(requests[2].url.searchParams.get('max_id'), 'followers-page-2');
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
        return response({ message: 'Please wait a few minutes before you try again.' }, 429);
      },
      username: 'target_name',
    }),
    (error) => error.code === 'rate-limited',
  );
  assert.equal(calls, 2);
});

test('authenticated follower check marks bounded pagination as partial instead of claiming completion', async () => {
  const inspector = createInspector();
  const result = await inspector.fetchFollowerComparison({
    fetchImpl: async (input) => {
      const url = new URL(input);
      if (url.pathname.includes('topsearch')) {
        return response({ users: [{ user: { pk: '77', username: 'target_name' } }] });
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

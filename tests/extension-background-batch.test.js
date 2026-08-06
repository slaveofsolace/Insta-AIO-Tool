import test from 'node:test';
import assert from 'node:assert/strict';
import {
  copyFile,
  mkdir,
  mkdtemp,
  rm,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

async function loadBackground({ profileResponses, performResponses, stored }) {
  const temporaryRoot = await mkdtemp(path.join(tmpdir(), 'insta-aio-batch-'));
  const libraryRoot = path.join(temporaryRoot, 'lib');
  await mkdir(libraryRoot, { recursive: true });
  await Promise.all([
    copyFile(new URL('../extension/background.js', import.meta.url), path.join(temporaryRoot, 'background.js')),
    copyFile(new URL('../src/core/bridge-protocol.js', import.meta.url), path.join(libraryRoot, 'bridge-protocol.js')),
    copyFile(new URL('../src/core/controlled-account-action.js', import.meta.url), path.join(libraryRoot, 'controlled-account-action.js')),
    copyFile(new URL('../src/core/controlled-dm-unsend.js', import.meta.url), path.join(libraryRoot, 'controlled-dm-unsend.js')),
  ]);

  let runtimeListener = null;
  const navigations = [];
  const performed = [];
  let currentUrl = 'https://www.instagram.com/';

  globalThis.chrome = {
    runtime: {
      getManifest: () => ({ version: '0.10.0' }),
      onMessage: { addListener(listener) { runtimeListener = listener; } },
    },
    storage: {
      local: {
        async get(keys) {
          return Object.fromEntries(keys.map((key) => [key, stored[key]]));
        },
        async set(values) {
          Object.assign(stored, structuredClone(values));
        },
      },
    },
    tabs: {
      async get(tabId) {
        return {
          id: tabId, active: true, status: 'complete', url: currentUrl,
        };
      },
      async query() {
        return [{
          id: 7, active: true, status: 'complete', url: currentUrl,
        }];
      },
      async update(tabId, { url }) {
        navigations.push(url);
        currentUrl = url;
        return { id: tabId, url, status: 'complete' };
      },
      async sendMessage(_tabId, message) {
        if (message.kind === 'insta-aio-inspect-session') return { authenticated: true };
        if (message.kind === 'insta-aio-inspect-profile') {
          const response = profileResponses[message.username];
          if (!response) throw new Error(`No profile fixture for ${message.username}`);
          return response;
        }
        if (message.kind === 'insta-aio-perform-reviewed-profile-action') {
          performed.push(message.item);
          const response = performResponses[message.item.username];
          return response || { result: 'unfollowed', relationship: 'not-following' };
        }
        throw new Error(`Unexpected tab message: ${message.kind}`);
      },
    },
  };

  const url = `${pathToFileURL(path.join(temporaryRoot, 'background.js')).href}?test=${Date.now()}${Math.random()}`;
  await import(url);
  assert.equal(typeof runtimeListener, 'function');

  function deliver(request, sender) {
    return new Promise((resolve) => {
      const result = runtimeListener(request, sender, resolve);
      if (result !== true) queueMicrotask(() => resolve(undefined));
    });
  }

  return {
    cleanup: () => rm(temporaryRoot, { recursive: true, force: true }),
    deliver,
    navigations,
    performed,
  };
}

const sender = { url: 'https://www.instagram.com/', tab: { id: 7, url: 'https://www.instagram.com/' } };

function baseStored() {
  return {
    bridgePairings: [],
    bridgeReplayNonces: [],
    pendingJobs: [],
    accountActionLedger: [],
    dmActionLedger: [],
    pendingLiveIntent: null,
    liveArm: null,
    pendingDmIntent: null,
    dmArm: null,
    batchArm: null,
    batchRun: null,
    // Fastest pacing the runner allows, so the test stays quick.
    batchLimits: {
      dailyActionLimit: 50,
      dailyDmLimit: 50,
      minDelayMs: 1,
      maxDelayMs: 1,
    },
  };
}

async function waitForRun(deliver, predicate, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const status = await deliver({ kind: 'insta-aio-batch-status' }, sender);
    if (predicate(status.run)) return status.run;
    await new Promise((resolve) => { setTimeout(resolve, 25); });
  }
  throw new Error('Batch did not reach the expected state in time.');
}

test('batch arming requires the exact phrase and the armed tab', async () => {
  const stored = baseStored();
  const { cleanup, deliver } = await loadBackground({
    profileResponses: {},
    performResponses: {},
    stored,
  });
  try {
    const wrong = await deliver({
      kind: 'insta-aio-arm-batch',
      batchKind: 'account',
      action: 'unfollow',
      count: 3,
      phrase: 'ARM BATCH UNFOLLOW 2',
    }, sender);
    assert.equal(wrong.error, 'batch-arm-phrase-mismatch');
    assert.equal(stored.batchArm, null);

    const missingTab = await deliver({
      kind: 'insta-aio-arm-batch',
      batchKind: 'account',
      action: 'unfollow',
      count: 3,
      phrase: 'ARM BATCH UNFOLLOW 3',
    }, { url: 'https://www.instagram.com/', tab: {} });
    assert.equal(missingTab.error, 'instagram-tab-required');

    const armed = await deliver({
      kind: 'insta-aio-arm-batch',
      batchKind: 'account',
      action: 'unfollow',
      count: 3,
      phrase: 'ARM BATCH UNFOLLOW 3',
    }, sender);
    assert.equal(armed.error, undefined);
    assert.equal(armed.arm.kind, 'account');
    assert.equal(armed.arm.count, 3);
    assert.equal(armed.arm.tabId, 7);
  } finally {
    await cleanup();
  }
});

test('batch run navigates, verifies, and acts on each account exactly once', async () => {
  const stored = baseStored();
  const { cleanup, deliver, navigations, performed } = await loadBackground({
    profileResponses: {
      alpha: { username: 'alpha', relationship: 'following', resolutionToken: 'token-alpha' },
      beta: { username: 'beta', relationship: 'following', resolutionToken: 'token-beta' },
    },
    performResponses: {},
    stored,
  });
  try {
    await deliver({
      kind: 'insta-aio-arm-batch',
      batchKind: 'account',
      action: 'unfollow',
      count: 2,
      phrase: 'ARM BATCH UNFOLLOW 2',
    }, sender);

    const started = await deliver({
      kind: 'insta-aio-start-batch',
      batchKind: 'account',
      items: [{ id: 'i-1', username: 'alpha' }, { id: 'i-2', username: 'beta' }],
    }, sender);
    assert.equal(started.error, undefined);
    assert.equal(started.run.total, 2);

    const run = await waitForRun(deliver, (value) => value?.status === 'completed');
    assert.equal(run.completed, 2);
    assert.equal(run.failed, 0);
    assert.equal(run.skipped, 0);

    assert.deepEqual(navigations, [
      'https://www.instagram.com/alpha/',
      'https://www.instagram.com/beta/',
    ]);
    assert.deepEqual(performed.map((item) => item.username), ['alpha', 'beta']);
    assert.deepEqual(performed.map((item) => item.resolutionToken), ['token-alpha', 'token-beta']);
    for (const item of performed) {
      assert.equal(item.action, 'unfollow');
      assert.equal(item.expectedRelationship, 'following');
    }
    // The arm is consumed by the run and cannot authorise a second one.
    assert.equal(stored.batchArm, null);
    assert.equal(stored.accountActionLedger.length, 2);
    assert.ok(stored.accountActionLedger.every((entry) => entry.status === 'succeeded'));
  } finally {
    await cleanup();
  }
});

test('batch skips a target whose relationship no longer matches without stopping the run', async () => {
  const stored = baseStored();
  const { cleanup, deliver, performed } = await loadBackground({
    profileResponses: {
      alpha: { username: 'alpha', relationship: 'not-following', resolutionToken: 'token-alpha' },
      beta: { username: 'beta', relationship: 'following', resolutionToken: 'token-beta' },
    },
    performResponses: {},
    stored,
  });
  try {
    await deliver({
      kind: 'insta-aio-arm-batch',
      batchKind: 'account',
      action: 'unfollow',
      count: 2,
      phrase: 'ARM BATCH UNFOLLOW 2',
    }, sender);
    await deliver({
      kind: 'insta-aio-start-batch',
      batchKind: 'account',
      items: [{ id: 'i-1', username: 'alpha' }, { id: 'i-2', username: 'beta' }],
    }, sender);

    const run = await waitForRun(deliver, (value) => value?.status === 'completed');
    assert.equal(run.skipped, 1);
    assert.equal(run.completed, 1);
    // Only the still-valid target was touched.
    assert.deepEqual(performed.map((item) => item.username), ['beta']);
  } finally {
    await cleanup();
  }
});

test('batch stops the whole run when Instagram signals a rate limit', async () => {
  const stored = baseStored();
  const { cleanup, deliver, performed } = await loadBackground({
    profileResponses: {
      alpha: { username: 'alpha', relationship: 'following', resolutionToken: 'token-alpha' },
      beta: { username: 'beta', relationship: 'following', resolutionToken: 'token-beta' },
      gamma: { username: 'gamma', relationship: 'following', resolutionToken: 'token-gamma' },
    },
    performResponses: {
      beta: { rateLimited: true, reason: 'rate-limited' },
    },
    stored,
  });
  try {
    await deliver({
      kind: 'insta-aio-arm-batch',
      batchKind: 'account',
      action: 'unfollow',
      count: 3,
      phrase: 'ARM BATCH UNFOLLOW 3',
    }, sender);
    await deliver({
      kind: 'insta-aio-start-batch',
      batchKind: 'account',
      items: [
        { id: 'i-1', username: 'alpha' },
        { id: 'i-2', username: 'beta' },
        { id: 'i-3', username: 'gamma' },
      ],
    }, sender);

    const run = await waitForRun(deliver, (value) => value?.status === 'stopped');
    assert.equal(run.stopReason, 'rate-limited');
    // gamma was never attempted after the safe stop.
    assert.deepEqual(performed.map((item) => item.username), ['alpha', 'beta']);
  } finally {
    await cleanup();
  }
});

test('a slow-loading profile is retried rather than silently skipped', async () => {
  const stored = baseStored();
  // The first two inspections land before Instagram has hydrated the header,
  // exactly as they would on a slow connection.
  let attempts = 0;
  const profileResponses = {};
  Object.defineProperty(profileResponses, 'alpha', {
    enumerable: true,
    get() {
      attempts += 1;
      return attempts > 2
        ? { username: 'alpha', relationship: 'following', resolutionToken: 'token-alpha' }
        : { unexpectedUi: true, reason: 'inspector-unavailable' };
    },
  });

  const { cleanup, deliver, performed } = await loadBackground({
    profileResponses,
    performResponses: {},
    stored,
  });
  try {
    await deliver({
      kind: 'insta-aio-arm-batch',
      batchKind: 'account',
      action: 'unfollow',
      count: 1,
      phrase: 'ARM BATCH UNFOLLOW 1',
    }, sender);
    await deliver({
      kind: 'insta-aio-start-batch',
      batchKind: 'account',
      items: [{ id: 'i-1', username: 'alpha' }],
    }, sender);

    const run = await waitForRun(deliver, (value) => value?.status === 'completed');
    assert.equal(run.completed, 1, 'the target was acted on once it resolved');
    assert.equal(run.skipped, 0);
    assert.ok(attempts > 2, 'the runner retried before giving up');
    assert.deepEqual(performed.map((item) => item.username), ['alpha']);
  } finally {
    await cleanup();
  }
});

test('starting a batch without a valid arm is rejected', async () => {
  const stored = baseStored();
  const { cleanup, deliver } = await loadBackground({
    profileResponses: {},
    performResponses: {},
    stored,
  });
  try {
    const response = await deliver({
      kind: 'insta-aio-start-batch',
      batchKind: 'account',
      items: [{ id: 'i-1', username: 'alpha' }],
    }, sender);
    assert.equal(response.error, 'batch-arm-required');
  } finally {
    await cleanup();
  }
});

test('batch pacing limits are clamped to the allowed ceilings', async () => {
  const stored = baseStored();
  const { cleanup, deliver } = await loadBackground({
    profileResponses: {},
    performResponses: {},
    stored,
  });
  try {
    const response = await deliver({
      kind: 'insta-aio-batch-limits',
      limits: {
        dailyActionLimit: 100_000,
        dailyDmLimit: 100_000,
        minDelayMs: 1,
        maxDelayMs: 5_000,
      },
    }, sender);
    assert.equal(response.limits.dailyActionLimit, 400);
    assert.equal(response.limits.dailyDmLimit, 300);
    assert.equal(response.limits.minDelayMs, 1_500);
    assert.equal(response.limits.maxDelayMs, 5_000);
  } finally {
    await cleanup();
  }
});

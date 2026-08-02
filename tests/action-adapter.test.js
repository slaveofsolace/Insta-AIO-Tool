import test from 'node:test';
import assert from 'node:assert/strict';

import { executeReviewedActionJob } from '../src/adapters/reviewed-action-adapter.js';
import {
  confirmReviewedActionJob,
  createReviewedActionJob,
  ActionJobError,
} from '../src/core/action-jobs.js';
import {
  finalizeActionAttempt,
  reserveActionAttempt,
} from '../src/core/action-ledger.js';
import { createQueueItem } from '../src/core/queue.js';
import { createSnapshot } from '../src/core/snapshots.js';
import { defaultState } from '../src/core/storage.js';

function confirmedJob(queue, options = {}, mode = 'dry-run') {
  const job = createReviewedActionJob(queue, options);
  return confirmReviewedActionJob(job, {
    phrase: job.confirmationPhrase,
    mode,
    settings: options.settings,
    confirmedAt: 1_700_000_000_000,
  });
}

function inspectionDriver(observations) {
  const calls = [];
  let index = 0;
  return {
    calls,
    async inspectSession() {
      calls.push('inspect-session');
      return { authenticated: true };
    },
    async resolveProfile(username) {
      calls.push(`resolve:${username}`);
      const observation = observations[Math.min(index, observations.length - 1)];
      index += 1;
      return observation;
    },
    async performReviewedAction(item) {
      calls.push(`perform:${item.action}:${item.username}`);
      return { result: 'clicked-once' };
    },
  };
}

test('excludes protected and historical records from an action preview', () => {
  const queue = [
    createQueueItem('whitelisted', 'unfollow'),
    createQueueItem('preexisting', 'unfollow', { preexisting: true }),
    createQueueItem('mutual', 'unfollow'),
    createQueueItem('safe_target', 'unfollow'),
    {
      ...createQueueItem('history_only', 'follow'),
      migrationOnly: true,
    },
  ];
  const snapshot = createSnapshot({
    followers: ['mutual'],
    following: ['mutual', 'safe_target'],
  });
  const job = createReviewedActionJob(queue, {
    snapshot,
    settings: {
      whitelist: ['whitelisted'],
      preexistingFollowing: ['preexisting'],
      protectMutuals: true,
    },
    createdAt: 1_700_000_000_000,
  });

  assert.deepEqual(job.items.map((item) => item.username), ['safe_target']);
  assert.deepEqual(
    job.blockedItems.map((item) => [item.username, item.blockReason]),
    [
      ['whitelisted', 'whitelist'],
      ['preexisting', 'preexisting-follow'],
      ['mutual', 'mutual-follow'],
      ['history_only', 'migration-history'],
    ],
  );
});

test('requires an unchanged preview and exact confirmation phrase', () => {
  const job = createReviewedActionJob([
    createQueueItem('target', 'follow'),
  ], { createdAt: 1_700_000_000_000 });

  assert.throws(
    () => confirmReviewedActionJob(job, { phrase: 'REVIEW' }),
    (error) => error instanceof ActionJobError && error.code === 'CONFIRMATION_MISMATCH',
  );
  assert.throws(
    () => confirmReviewedActionJob(job, {
      phrase: job.confirmationPhrase,
      mode: 'live',
      settings: { liveActionEnabled: false },
    }),
    (error) => error instanceof ActionJobError && error.code === 'LIVE_DISABLED',
  );

  const changed = structuredClone(job);
  changed.items[0].username = 'different';
  assert.throws(
    () => confirmReviewedActionJob(changed, { phrase: changed.confirmationPhrase }),
    (error) => error instanceof ActionJobError && error.code === 'PREVIEW_CHANGED',
  );
});

test('true dry run resolves exact profiles and never calls the click method', async () => {
  const queue = [
    createQueueItem('follow_target', 'follow'),
    createQueueItem('unfollow_target', 'unfollow'),
  ];
  const job = confirmedJob(queue);
  const driver = inspectionDriver([
    {
      username: 'follow_target',
      relationship: 'not-following',
      evidence: { label: 'Follow' },
    },
    {
      username: 'unfollow_target',
      relationship: 'following',
      evidence: { label: 'Following' },
    },
  ]);
  const checkpoints = [];
  const result = await executeReviewedActionJob(job, {
    driver,
    settings: { protectMutuals: true },
    onCheckpoint(checkpointJob) {
      checkpoints.push(structuredClone(checkpointJob));
    },
  });

  assert.equal(result.status, 'completed');
  assert.deepEqual(
    result.items.map((item) => [item.username, item.status, item.result]),
    [
      ['follow_target', 'dry-run-complete', 'resolved-no-click'],
      ['unfollow_target', 'dry-run-complete', 'resolved-no-click'],
    ],
  );
  assert.equal(driver.calls.some((call) => call.startsWith('perform:')), false);
  assert.equal(checkpoints.length >= 4, true);
});

test('wrong-profile and ambiguous observations safe-stop without clicking', async () => {
  const job = confirmedJob([
    createQueueItem('expected_target', 'follow'),
    createQueueItem('never_reached', 'follow'),
  ]);
  const driver = inspectionDriver([
    {
      username: 'different_target',
      relationship: 'not-following',
    },
  ]);
  const result = await executeReviewedActionJob(job, { driver });

  assert.equal(result.status, 'stopped');
  assert.equal(result.stopReason, 'wrong-profile');
  assert.equal(result.items[0].status, 'safe-stopped');
  assert.equal(result.items[1].status, 'pending');
  assert.equal(driver.calls.some((call) => call.startsWith('perform:')), false);
});

test('interrupted jobs resume from the last durable item checkpoint', async () => {
  const job = confirmedJob([
    createQueueItem('first_target', 'follow'),
    createQueueItem('second_target', 'follow'),
  ]);
  const controller = new AbortController();
  const firstDriver = inspectionDriver([
    { username: 'first_target', relationship: 'not-following' },
  ]);
  let durableJob = job;
  const interrupted = await executeReviewedActionJob(job, {
    driver: firstDriver,
    signal: controller.signal,
    onCheckpoint(checkpointJob) {
      durableJob = structuredClone(checkpointJob);
      if (checkpointJob.items[0].status === 'dry-run-complete') controller.abort();
    },
  });

  assert.equal(interrupted.status, 'paused');
  assert.equal(interrupted.items[0].status, 'dry-run-complete');
  assert.equal(interrupted.items[1].status, 'pending');

  const secondDriver = inspectionDriver([
    { username: 'second_target', relationship: 'not-following' },
  ]);
  const resumed = await executeReviewedActionJob(durableJob, {
    driver: secondDriver,
  });
  assert.equal(resumed.status, 'completed');
  assert.equal(resumed.items[0].status, 'dry-run-complete');
  assert.equal(resumed.items[1].status, 'dry-run-complete');
  assert.deepEqual(secondDriver.calls, [
    'inspect-session',
    'resolve:second_target',
  ]);
});

test('revalidates protection immediately before execution', async () => {
  const queueItem = createQueueItem('new_mutual', 'unfollow');
  const job = confirmedJob([queueItem], {
    snapshot: createSnapshot({ followers: [], following: ['new_mutual'] }),
  });
  const currentSnapshot = createSnapshot({
    followers: ['new_mutual'],
    following: ['new_mutual'],
  });
  const driver = inspectionDriver([]);
  const result = await executeReviewedActionJob(job, {
    driver,
    snapshot: currentSnapshot,
    settings: { protectMutuals: true },
  });

  assert.equal(result.status, 'completed');
  assert.equal(result.items[0].status, 'blocked');
  assert.equal(result.items[0].blockReason, 'mutual-follow');
  assert.deepEqual(driver.calls, []);
});

test('reserves live attempts before clicking and confirms the result', async () => {
  const settings = {
    liveActionEnabled: true,
    liveActionBatchLimit: 1,
    dailyFollowLimit: 5,
  };
  const job = confirmedJob([
    createQueueItem('live_target', 'follow'),
  ], { settings }, 'live');
  const calls = [];
  const driver = {
    async inspectSession() {
      calls.push('session');
      return { authenticated: true };
    },
    async resolveProfile(username) {
      calls.push(`resolve:${username}`);
      return calls.filter((value) => value.startsWith('resolve:')).length === 1
        ? {
          username,
          relationship: 'not-following',
          resolutionToken: 'exact-button-token',
        }
        : { username, relationship: 'following' };
    },
    async performReviewedAction(item) {
      calls.push(`perform:${item.resolutionToken}`);
      return { result: 'followed' };
    },
  };
  const ledger = {
    async reserve(claim) {
      calls.push(`reserve:${claim.username}`);
      return { ok: true, record: { id: 'attempt-1' } };
    },
    async finalize(id, completion) {
      calls.push(`finalize:${id}:${completion.status}`);
      return { ok: true };
    },
  };
  const result = await executeReviewedActionJob(job, {
    driver,
    ledger,
    settings,
    now: () => 1_700_000_000_500,
  });

  assert.equal(result.status, 'completed');
  assert.equal(result.items[0].status, 'completed');
  assert.deepEqual(calls, [
    'session',
    'resolve:live_target',
    'reserve:live_target',
    'perform:exact-button-token',
    'resolve:live_target',
    'finalize:attempt-1:succeeded',
  ]);
});

test('revalidates action confirmation, preview, and live limits at execution time', async () => {
  const settings = {
    liveActionEnabled: true,
    liveActionBatchLimit: 2,
  };
  const job = confirmedJob([
    createQueueItem('live_target_one', 'follow'),
    createQueueItem('live_target_two', 'follow'),
  ], { settings }, 'live');
  const driver = inspectionDriver([]);
  const ledger = {
    async reserve() {
      throw new Error('must not reserve an invalid job');
    },
  };

  const tampered = structuredClone(job);
  tampered.items[0].username = 'different_target';
  await assert.rejects(
    executeReviewedActionJob(tampered, { driver, ledger, settings }),
    /preview changed after confirmation/,
  );
  await assert.rejects(
    executeReviewedActionJob(job, {
      driver,
      ledger,
      settings: { ...settings, liveActionEnabled: false },
      now: () => 1_700_000_000_500,
    }),
    /disabled in settings/,
  );
  await assert.rejects(
    executeReviewedActionJob(job, {
      driver,
      ledger,
      settings: { ...settings, liveActionBatchLimit: Number.NaN },
      now: () => 1_700_000_000_500,
    }),
    /configured limit is 1/,
  );
  assert.deepEqual(driver.calls, []);
});

test('rejects stale live confirmations before inspecting or reserving', async () => {
  const settings = {
    liveActionEnabled: true,
    liveActionBatchLimit: 1,
  };
  const job = confirmedJob([
    createQueueItem('stale_target', 'follow'),
  ], { settings }, 'live');
  const driver = inspectionDriver([]);
  let reservations = 0;

  await assert.rejects(
    executeReviewedActionJob(job, {
      driver,
      ledger: {
        async reserve() {
          reservations += 1;
        },
      },
      settings,
      now: () => new Date(job.confirmedAt).getTime() + (11 * 60 * 1000),
    }),
    /confirmation expired/,
  );
  assert.deepEqual(driver.calls, []);
  assert.equal(reservations, 0);
});

test('revalidates one-shot live authorization before ledger reservation', async () => {
  const settings = {
    liveActionEnabled: true,
    liveActionBatchLimit: 1,
  };
  const job = confirmedJob([
    createQueueItem('armed_target', 'follow'),
  ], { settings }, 'live');
  const calls = [];
  const driver = {
    async inspectSession() {
      calls.push('session');
      return {};
    },
    async resolveProfile(username) {
      calls.push(`resolve:${username}`);
      return {
        username,
        relationship: 'not-following',
        resolutionToken: 'exact-token',
      };
    },
    async inspectLiveAuthorization(item) {
      calls.push(`authorize:${item.resolutionToken}`);
      return { authorized: false, reason: 'live-arm-required' };
    },
    async performReviewedAction() {
      calls.push('perform');
    },
  };
  const ledger = {
    async reserve() {
      calls.push('reserve');
    },
  };

  const result = await executeReviewedActionJob(job, {
    driver,
    ledger,
    settings,
    now: () => new Date(job.confirmedAt).getTime() + 1_000,
  });

  assert.equal(result.status, 'stopped');
  assert.equal(result.stopReason, 'live-arm-required');
  assert.deepEqual(calls, [
    'session',
    'resolve:armed_target',
    'authorize:exact-token',
  ]);
});

test('ledger enforces daily limits and duplicate prevention before actions', () => {
  const settings = { dailyFollowLimit: 1, dailyUnfollowLimit: 1 };
  const now = Date.UTC(2026, 6, 30, 12);
  const first = reserveActionAttempt(defaultState(), {
    jobId: 'job-1',
    itemId: 'item-1',
    queueItemId: 'queue-1',
    action: 'follow',
    username: 'first',
  }, settings, now);
  assert.equal(first.result.ok, true);

  const duplicate = reserveActionAttempt(first.state, {
    jobId: 'job-1',
    itemId: 'item-1',
    queueItemId: 'queue-1',
    action: 'follow',
    username: 'first',
  }, settings, now);
  assert.equal(duplicate.result.reason, 'duplicate-attempt');

  const duplicateAcrossJobs = reserveActionAttempt(first.state, {
    jobId: 'job-different',
    itemId: 'item-different',
    queueItemId: 'queue-1',
    action: 'follow',
    username: 'first',
  }, settings, now);
  assert.equal(duplicateAcrossJobs.result.reason, 'duplicate-queue-item');

  const limited = reserveActionAttempt(first.state, {
    jobId: 'job-2',
    itemId: 'item-2',
    queueItemId: 'queue-2',
    action: 'follow',
    username: 'second',
  }, settings, now);
  assert.equal(limited.result.reason, 'daily-limit');

  const finalized = finalizeActionAttempt(
    first.state,
    first.result.record.id,
    { status: 'succeeded', now },
  );
  assert.equal(finalized.actionLedger[0].status, 'succeeded');
});

test('ledger treats malformed daily limits as a fail-closed limit of one', () => {
  const now = Date.UTC(2026, 6, 30, 12);
  const first = reserveActionAttempt(defaultState(), {
    jobId: 'job-1',
    itemId: 'item-1',
    queueItemId: 'queue-1',
    action: 'follow',
    username: 'first',
  }, { dailyFollowLimit: 1 }, now);

  for (const malformed of ['not-a-number', 'Infinity', Number.POSITIVE_INFINITY]) {
    const outcome = reserveActionAttempt(first.state, {
      jobId: `job-${String(malformed)}`,
      itemId: `item-${String(malformed)}`,
      queueItemId: `queue-${String(malformed)}`,
      action: 'follow',
      username: `next_${String(malformed).replaceAll(/[^a-z0-9._]/gi, '_')}`,
    }, { dailyFollowLimit: malformed }, now);
    assert.equal(outcome.result.ok, false);
    assert.equal(outcome.result.reason, 'daily-limit');
    assert.equal(outcome.result.limit, 1);
  }
});

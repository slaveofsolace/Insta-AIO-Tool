import test from 'node:test';
import assert from 'node:assert/strict';

import { executeReviewedDmJob } from '../src/adapters/reviewed-dm-adapter.js';
import {
  confirmDmJobDestructive,
  confirmDmJobReview,
  createReviewedDmJob,
  DmJobError,
} from '../src/core/dm-jobs.js';
import {
  finalizeDmAttempt,
  reserveDmAttempt,
} from '../src/core/dm-ledger.js';
import { messageSelectionKey } from '../src/core/messages.js';
import { defaultState } from '../src/core/storage.js';

function message(id, {
  conversationId = 'inbox/friend_123',
  senderName = 'Owner Example',
  isMine = true,
  timestamp = 1_700_000_000_000,
  content = `message ${id}`,
} = {}) {
  return {
    id,
    conversationId,
    conversationName: 'Friend Example',
    senderName,
    senderId: null,
    isMine,
    timestamp,
    type: 'text',
    content,
    source: 'meta-export',
  };
}

function confirmedDryRun(messages) {
  const job = createReviewedDmJob(
    messages,
    messages.map(messageSelectionKey),
    { createdAt: 1_700_000_000_000 },
  );
  return confirmDmJobReview(job, {
    phrase: job.reviewConfirmationPhrase,
    mode: 'dry-run',
    confirmedAt: 1_700_000_000_100,
  });
}

function exactResolution(item, overrides = {}) {
  return {
    conversationId: item.conversationId,
    messageId: item.messageId,
    sentByMe: true,
    timestamp: item.timestamp,
    contentDigest: item.contentDigest,
    resolutionToken: `resolution:${item.id}`,
    evidence: { source: 'test-driver' },
    ...overrides,
  };
}

function exactRemovalResult(item) {
  return {
    result: 'unsent',
    conversationId: item.conversationId,
    messageId: item.messageId,
    postcondition: {
      exactCandidateAbsent: true,
      exactThread: true,
      expectedThreadId: '123',
      observedThreadId: '123',
      observationReason: 'exact-message-not-found',
      retainedIdentityNodeDisconnected: true,
      retainedRowDisconnected: true,
    },
  };
}

function exactMissingResolution(item, overrides = {}) {
  return {
    conversationId: item.conversationId,
    messageId: item.messageId,
    missing: true,
    exactIdentityAvailable: true,
    reason: 'exact-message-not-found',
    evidence: { observedThreadId: '123' },
    ...overrides,
  };
}

test('DM preview hard-blocks received messages and preserves exact sent-message identity', () => {
  const sent = message('sent-1');
  const received = message('received-1', {
    senderName: 'Friend Example',
    isMine: false,
  });
  const job = createReviewedDmJob(
    [sent, received],
    [messageSelectionKey(sent), messageSelectionKey(received)],
    { createdAt: 1_700_000_000_000 },
  );

  assert.equal(job.items.length, 1);
  assert.equal(job.items[0].messageId, 'sent-1');
  assert.equal(job.items[0].conversationId, 'inbox/friend_123');
  assert.equal(job.items[0].sentByMe, true);
  assert.equal(job.blockedItems.length, 1);
  assert.equal(job.blockedItems[0].blockReason, 'received-message');
});

test('live DM jobs require review plus a second destructive confirmation', () => {
  const source = message('sent-1');
  const job = createReviewedDmJob([source], [messageSelectionKey(source)]);
  const settings = {
    liveDmUnsendEnabled: true,
    liveDmBatchLimit: 1,
  };
  const reviewed = confirmDmJobReview(job, {
    phrase: job.reviewConfirmationPhrase,
    mode: 'live',
    settings,
  });
  assert.equal(reviewed.status, 'awaiting-destructive-confirmation');
  assert.equal(reviewed.destructiveConfirmedAt, null);

  assert.throws(
    () => confirmDmJobDestructive(reviewed, { phrase: 'UNSEND' }),
    (error) => (
      error instanceof DmJobError
      && error.code === 'DESTRUCTIVE_CONFIRMATION_MISMATCH'
    ),
  );
  const confirmed = confirmDmJobDestructive(reviewed, {
    phrase: reviewed.destructiveConfirmationPhrase,
  });
  assert.equal(confirmed.status, 'ready');
  assert.ok(confirmed.destructiveConfirmedAt);
});

test('DM dry run resolves every exact sent message without calling Unsend', async () => {
  const messages = [
    message('sent-1'),
    message('sent-2', { timestamp: 1_700_000_000_100 }),
  ];
  const job = confirmedDryRun(messages);
  const calls = [];
  const driver = {
    async inspectSession() {
      calls.push('session');
      return { authenticated: true };
    },
    async resolveConversation(conversationId) {
      calls.push(`conversation:${conversationId}`);
      return { conversationId };
    },
    async resolveMessage(item) {
      calls.push(`message:${item.messageId}`);
      return exactResolution(item);
    },
    async performReviewedUnsend(item) {
      calls.push(`unsend:${item.messageId}`);
    },
  };
  const result = await executeReviewedDmJob(job, { driver });

  assert.equal(result.status, 'completed');
  assert.deepEqual(
    result.items.map((item) => [item.messageId, item.status, item.result]),
    [
      ['sent-1', 'dry-run-complete', 'resolved-no-click'],
      ['sent-2', 'dry-run-complete', 'resolved-no-click'],
    ],
  );
  assert.equal(calls.some((call) => call.startsWith('unsend:')), false);
});

test('wrong conversation, wrong message, and received-message resolutions are hard failures', async () => {
  const source = message('sent-1');
  const baseJob = confirmedDryRun([source]);

  const wrongConversation = await executeReviewedDmJob(baseJob, {
    driver: {
      async inspectSession() {
        return {};
      },
      async resolveConversation() {
        return { conversationId: 'inbox/someone_else' };
      },
      async resolveMessage() {
        throw new Error('must not resolve a message in the wrong conversation');
      },
    },
  });
  assert.equal(wrongConversation.stopReason, 'wrong-conversation');

  const receivedResolution = await executeReviewedDmJob(baseJob, {
    driver: {
      async inspectSession() {
        return {};
      },
      async resolveConversation(conversationId) {
        return { conversationId };
      },
      async resolveMessage(item) {
        return exactResolution(item, { sentByMe: false });
      },
    },
  });
  assert.equal(receivedResolution.stopReason, 'received-message');
  assert.equal(receivedResolution.items[0].status, 'safe-stopped');

  const wrongMessage = await executeReviewedDmJob(baseJob, {
    driver: {
      async inspectSession() {
        return {};
      },
      async resolveConversation(conversationId) {
        return { conversationId };
      },
      async resolveMessage(item) {
        return exactResolution(item, { messageId: 'different-message' });
      },
    },
  });
  assert.equal(wrongMessage.stopReason, 'wrong-message');
});

test('interrupted DM jobs resume after the last message checkpoint', async () => {
  const messages = [
    message('sent-1'),
    message('sent-2', { timestamp: 1_700_000_000_100 }),
  ];
  const job = confirmedDryRun(messages);
  const controller = new AbortController();
  let durable = job;
  const driver = {
    async inspectSession() {
      return {};
    },
    async resolveConversation(conversationId) {
      return { conversationId };
    },
    async resolveMessage(item) {
      return exactResolution(item);
    },
  };
  const interrupted = await executeReviewedDmJob(job, {
    driver,
    signal: controller.signal,
    onCheckpoint(checkpointJob) {
      durable = structuredClone(checkpointJob);
      if (checkpointJob.items[0].status === 'dry-run-complete') controller.abort();
    },
  });
  assert.equal(interrupted.status, 'paused');
  assert.equal(interrupted.items[0].status, 'dry-run-complete');
  assert.equal(interrupted.items[1].status, 'pending');

  const resumed = await executeReviewedDmJob(durable, { driver });
  assert.equal(resumed.status, 'completed');
  assert.equal(resumed.items[1].status, 'dry-run-complete');
});

test('live DM execution reserves before Unsend and verifies message removal', async () => {
  const source = message('sent-1');
  const settings = {
    liveDmUnsendEnabled: true,
    liveDmBatchLimit: 1,
  };
  const draft = createReviewedDmJob([source], [messageSelectionKey(source)]);
  const reviewed = confirmDmJobReview(draft, {
    phrase: draft.reviewConfirmationPhrase,
    mode: 'live',
    settings,
  });
  const job = confirmDmJobDestructive(reviewed, {
    phrase: reviewed.destructiveConfirmationPhrase,
  });
  const calls = [];
  let resolveCount = 0;
  const driver = {
    async inspectSession() {
      calls.push('session');
      return {};
    },
    async resolveConversation(conversationId) {
      calls.push(`conversation:${conversationId}`);
      return { conversationId };
    },
    async resolveMessage(item) {
      resolveCount += 1;
      calls.push(`message:${resolveCount}`);
      return resolveCount === 1 ? exactResolution(item) : exactMissingResolution(item);
    },
    async inspectLiveAuthorization(item) {
      calls.push(`authorize:${item.resolutionToken}`);
      return { authorized: true };
    },
    async performReviewedUnsend(item) {
      calls.push(`unsend:${item.resolutionToken}`);
      return exactRemovalResult(item);
    },
  };
  const ledger = {
    async reserve(claim) {
      calls.push(`reserve:${claim.messageId}`);
      return { ok: true, record: { id: 'dm-attempt-1' } };
    },
    async finalize(id, completion) {
      calls.push(`finalize:${id}:${completion.status}`);
      return { ok: true };
    },
  };
  const result = await executeReviewedDmJob(job, {
    driver,
    ledger,
    settings,
  });

  assert.equal(result.status, 'completed');
  assert.equal(result.items[0].status, 'completed');
  assert.deepEqual(calls, [
    'session',
    'conversation:inbox/friend_123',
    'message:1',
    `authorize:resolution:${job.items[0].id}`,
    'reserve:sent-1',
    `unsend:resolution:${job.items[0].id}`,
    'message:2',
    'finalize:dm-attempt-1:succeeded',
  ]);
});

test('live DM postcheck keeps the durable ledger uncertain when exact removal evidence is incomplete', async () => {
  const source = message('sent-1');
  const settings = { liveDmUnsendEnabled: true, liveDmBatchLimit: 1 };
  const draft = createReviewedDmJob([source], [messageSelectionKey(source)]);
  const reviewed = confirmDmJobReview(draft, {
    phrase: draft.reviewConfirmationPhrase,
    mode: 'live',
    settings,
  });
  const job = confirmDmJobDestructive(reviewed, {
    phrase: reviewed.destructiveConfirmationPhrase,
  });
  let resolveCount = 0;
  const finalizations = [];
  const result = await executeReviewedDmJob(job, {
    settings,
    driver: {
      async inspectSession() {
        return {};
      },
      async resolveConversation(conversationId) {
        return { conversationId };
      },
      async resolveMessage(item) {
        resolveCount += 1;
        return resolveCount === 1
          ? exactResolution(item)
          : exactMissingResolution(item, {
            exactIdentityAvailable: false,
            evidence: {},
            reason: 'exact-message-identity-unavailable',
          });
      },
      async inspectLiveAuthorization() {
        return { authorized: true };
      },
      async performReviewedUnsend(item) {
        return exactRemovalResult(item);
      },
    },
    ledger: {
      async reserve() {
        return { ok: true, record: { id: 'dm-attempt-uncertain' } };
      },
      async finalize(id, completion) {
        finalizations.push({ id, completion });
        return { ok: true };
      },
    },
  });

  assert.equal(result.status, 'stopped');
  assert.equal(result.stopReason, 'unsend-not-confirmed');
  assert.equal(result.items[0].status, 'safe-stopped');
  assert.equal(finalizations.length, 1);
  assert.equal(finalizations[0].completion.status, 'uncertain');
});

test('DM live authorization safe-stops before reserving the durable ledger', async () => {
  const source = message('sent-1');
  const settings = { liveDmUnsendEnabled: true, liveDmBatchLimit: 1 };
  const draft = createReviewedDmJob([source], [messageSelectionKey(source)]);
  const reviewed = confirmDmJobReview(draft, {
    phrase: draft.reviewConfirmationPhrase,
    mode: 'live',
    settings,
  });
  const job = confirmDmJobDestructive(reviewed, {
    phrase: reviewed.destructiveConfirmationPhrase,
  });
  let reservationCount = 0;
  let performCount = 0;
  const result = await executeReviewedDmJob(job, {
    settings,
    driver: {
      async inspectSession() {
        return {};
      },
      async resolveConversation(conversationId) {
        return { conversationId };
      },
      async resolveMessage(item) {
        return exactResolution(item);
      },
      async inspectLiveAuthorization() {
        return { authorized: false, reason: 'dm-live-arm-required' };
      },
      async performReviewedUnsend() {
        performCount += 1;
        return { result: 'unsent' };
      },
    },
    ledger: {
      async reserve() {
        reservationCount += 1;
        return { ok: true, record: { id: 'must-not-exist' } };
      },
    },
  });

  assert.equal(result.status, 'stopped');
  assert.equal(result.stopReason, 'dm-live-arm-required');
  assert.equal(result.items[0].status, 'safe-stopped');
  assert.equal(reservationCount, 0);
  assert.equal(performCount, 0);
});

test('discard cancellation during DM live authorization stops before reservation or Unsend', async () => {
  const source = message('sent-discarded');
  const settings = { liveDmUnsendEnabled: true, liveDmBatchLimit: 1 };
  const draft = createReviewedDmJob([source], [messageSelectionKey(source)]);
  const reviewed = confirmDmJobReview(draft, {
    phrase: draft.reviewConfirmationPhrase,
    mode: 'live',
    settings,
  });
  const job = confirmDmJobDestructive(reviewed, {
    phrase: reviewed.destructiveConfirmationPhrase,
  });
  const controller = new AbortController();
  const calls = [];
  const result = await executeReviewedDmJob(job, {
    settings,
    signal: controller.signal,
    driver: {
      async inspectSession() {
        calls.push('session');
        return {};
      },
      async resolveConversation(conversationId) {
        calls.push(`conversation:${conversationId}`);
        return { conversationId };
      },
      async resolveMessage(item) {
        calls.push(`message:${item.messageId}`);
        return exactResolution(item);
      },
      async inspectLiveAuthorization() {
        calls.push('authorize');
        controller.abort();
        return { authorized: true };
      },
      async performReviewedUnsend() {
        calls.push('unsend');
        return exactRemovalResult(job.items[0]);
      },
    },
    ledger: {
      async reserve() {
        calls.push('reserve');
        return { ok: true, record: { id: 'must-not-exist' } };
      },
    },
  });

  assert.equal(result.status, 'paused');
  assert.equal(result.stopReason, 'execution-canceled-before-driver');
  assert.deepEqual(calls, [
    'session',
    `conversation:${source.conversationId}`,
    `message:${source.id}`,
    'authorize',
  ]);
});

test('discard cancellation after DM reservation finalizes canceled without dispatching Unsend', async () => {
  const source = message('sent-reserved');
  const settings = { liveDmUnsendEnabled: true, liveDmBatchLimit: 1 };
  const draft = createReviewedDmJob([source], [messageSelectionKey(source)]);
  const reviewed = confirmDmJobReview(draft, {
    phrase: draft.reviewConfirmationPhrase,
    mode: 'live',
    settings,
  });
  const job = confirmDmJobDestructive(reviewed, {
    phrase: reviewed.destructiveConfirmationPhrase,
  });
  const controller = new AbortController();
  const calls = [];
  const result = await executeReviewedDmJob(job, {
    settings,
    signal: controller.signal,
    driver: {
      async inspectSession() {
        calls.push('session');
        return {};
      },
      async resolveConversation(conversationId) {
        calls.push(`conversation:${conversationId}`);
        return { conversationId };
      },
      async resolveMessage(item) {
        calls.push(`message:${item.messageId}`);
        return exactResolution(item);
      },
      async inspectLiveAuthorization() {
        calls.push('authorize');
        return { authorized: true };
      },
      async performReviewedUnsend() {
        calls.push('unsend');
        return exactRemovalResult(job.items[0]);
      },
    },
    ledger: {
      async reserve() {
        calls.push('reserve');
        controller.abort();
        return { ok: true, record: { id: 'dm-attempt-canceled' } };
      },
      async finalize(id, completion) {
        calls.push(`finalize:${id}:${completion.status}:${completion.result.reason}`);
        return { ok: true };
      },
    },
  });

  assert.equal(result.status, 'paused');
  assert.equal(result.stopReason, 'execution-canceled-before-driver');
  assert.deepEqual(calls, [
    'session',
    `conversation:${source.conversationId}`,
    `message:${source.id}`,
    'authorize',
    'reserve',
    'finalize:dm-attempt-canceled:canceled:execution-canceled-before-driver',
  ]);
});

test('cancellation after Unsend dispatch preserves postcheck and durable outcome semantics', async () => {
  const source = message('sent-in-flight');
  const settings = { liveDmUnsendEnabled: true, liveDmBatchLimit: 1 };
  const draft = createReviewedDmJob([source], [messageSelectionKey(source)]);
  const reviewed = confirmDmJobReview(draft, {
    phrase: draft.reviewConfirmationPhrase,
    mode: 'live',
    settings,
  });
  const job = confirmDmJobDestructive(reviewed, {
    phrase: reviewed.destructiveConfirmationPhrase,
  });
  const controller = new AbortController();
  const finalizations = [];
  let resolutionCount = 0;
  const result = await executeReviewedDmJob(job, {
    settings,
    signal: controller.signal,
    driver: {
      async inspectSession() {
        return {};
      },
      async resolveConversation(conversationId) {
        return { conversationId };
      },
      async resolveMessage(item) {
        resolutionCount += 1;
        return resolutionCount === 1 ? exactResolution(item) : exactMissingResolution(item);
      },
      async inspectLiveAuthorization() {
        return { authorized: true };
      },
      async performReviewedUnsend(item) {
        controller.abort();
        return exactRemovalResult(item);
      },
    },
    ledger: {
      async reserve() {
        return { ok: true, record: { id: 'dm-attempt-in-flight' } };
      },
      async finalize(id, completion) {
        finalizations.push({ id, completion });
        return { ok: true };
      },
    },
  });

  assert.equal(result.status, 'completed');
  assert.equal(result.items[0].status, 'completed');
  assert.equal(finalizations.length, 1);
  assert.equal(finalizations[0].completion.status, 'succeeded');
});

test('revalidates DM confirmation, preview, and live limits at execution time', async () => {
  const sources = [
    message('sent-1'),
    message('sent-2', { timestamp: 1_700_000_000_100 }),
  ];
  const settings = {
    liveDmUnsendEnabled: true,
    liveDmBatchLimit: 2,
  };
  const draft = createReviewedDmJob(sources, sources.map(messageSelectionKey));
  const reviewed = confirmDmJobReview(draft, {
    phrase: draft.reviewConfirmationPhrase,
    mode: 'live',
    settings,
  });
  const job = confirmDmJobDestructive(reviewed, {
    phrase: reviewed.destructiveConfirmationPhrase,
  });
  const driver = {
    async inspectSession() {
      throw new Error('must not inspect an invalid job');
    },
    async resolveConversation() {},
    async resolveMessage() {},
    async performReviewedUnsend() {},
  };
  const ledger = {};

  const tampered = structuredClone(job);
  tampered.items[0].messageId = 'different-message';
  await assert.rejects(
    executeReviewedDmJob(tampered, { driver, ledger, settings }),
    /preview changed after confirmation/,
  );
  await assert.rejects(
    executeReviewedDmJob(job, {
      driver,
      ledger,
      settings: { ...settings, liveDmUnsendEnabled: false },
    }),
    /disabled in settings/,
  );
  await assert.rejects(
    executeReviewedDmJob(job, {
      driver,
      ledger,
      settings: { ...settings, liveDmBatchLimit: Number.NaN },
    }),
    /configured limit is 1/,
  );
});

test('DM ledger prevents duplicate destructive attempts across jobs', () => {
  const claim = {
    jobId: 'job-1',
    itemId: 'item-1',
    conversationId: 'inbox/friend_123',
    messageId: 'sent-1',
  };
  const first = reserveDmAttempt(defaultState(), claim, 1_700_000_000_000);
  assert.equal(first.result.ok, true);

  const duplicateMessage = reserveDmAttempt(first.state, {
    ...claim,
    jobId: 'job-2',
    itemId: 'item-2',
  }, 1_700_000_001_000);
  assert.equal(duplicateMessage.result.reason, 'duplicate-message');

  const finalized = finalizeDmAttempt(first.state, first.result.record.id, {
    status: 'succeeded',
    now: 1_700_000_002_000,
  });
  assert.equal(finalized.dmLedger[0].status, 'succeeded');
});

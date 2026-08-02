import test from 'node:test';
import assert from 'node:assert/strict';

import {
  controlledDmArmPhrase,
  dmArmMatchesIntent,
  prepareControlledDmIntent,
  pruneControlledDmState,
  validateControlledDmJob,
  verifiedControlledDmResult,
} from '../src/core/controlled-dm-unsend.js';
import {
  confirmDmJobDestructive,
  confirmDmJobReview,
  createReviewedDmJob,
} from '../src/core/dm-jobs.js';

const settings = {
  liveDmUnsendEnabled: true,
  liveDmBatchLimit: 1,
};
const pairing = {
  pairingId: 'pairing-1',
  origin: 'http://127.0.0.1:4173',
};

function sentMessage(id = 'message-1', timestamp = 1_700_000_000_000) {
  return {
    id,
    conversationId: 'inbox/friend_123',
    conversationName: 'Friend',
    timestamp,
    type: 'text',
    senderName: 'Owner',
    senderId: 'owner-1',
    isMine: true,
    content: 'Reviewed exact message',
    source: 'fixture',
  };
}

function liveJob(createdAt = 1_700_000_000_000) {
  const message = sentMessage('message-1', createdAt - 1_000);
  const draft = createReviewedDmJob([message], [message.id], { createdAt });
  const reviewed = confirmDmJobReview(draft, {
    phrase: draft.reviewConfirmationPhrase,
    mode: 'live',
    settings,
    confirmedAt: createdAt + 100,
  });
  return confirmDmJobDestructive(reviewed, {
    phrase: reviewed.destructiveConfirmationPhrase,
    confirmedAt: createdAt + 200,
  });
}

test('prepares only one fresh, twice-confirmed, unchanged DM intent', () => {
  const job = liveJob();
  const state = { pendingDmIntent: null, dmArm: null };
  const prepared = prepareControlledDmIntent(job, pairing, state, 1_700_000_001_000);

  assert.equal(prepared.error, undefined);
  assert.equal(prepared.armed, false);
  assert.equal(prepared.intent.jobId, job.id);
  assert.equal(prepared.intent.itemId, job.items[0].id);
  assert.equal(prepared.intent.conversationId, 'inbox/friend_123');
  assert.equal(prepared.intent.messageId, 'message-1');
  assert.match(prepared.intent.armCode, /^[A-F0-9]{8}$/);
  assert.equal(controlledDmArmPhrase(prepared.intent), `ARM UNSEND ${prepared.intent.armCode}`);
  assert.equal(Object.hasOwn(prepared.intent, 'pairingId'), false);
  assert.equal(prepared.intent.contentDigest, job.items[0].contentDigest);
  assert.equal(state.pendingDmIntent.pairingId, 'pairing-1');

  const multiple = structuredClone(job);
  multiple.items.push({ ...multiple.items[0], id: 'second-item' });
  assert.equal(
    validateControlledDmJob(multiple, 1_700_000_001_000),
    'controlled-live-dm-batch-must-be-one',
  );

  const changed = structuredClone(job);
  changed.items[0].contentDigest = 'deadbeef';
  assert.equal(
    validateControlledDmJob(changed, 1_700_000_001_000),
    'reviewed-dm-preview-changed',
  );
});

test('rejects stale, out-of-order, received, and incompletely confirmed DM jobs', () => {
  const job = liveJob();
  assert.equal(
    validateControlledDmJob(job, 1_700_000_000_200 + (11 * 60 * 1000)),
    'dm-review-confirmation-expired',
  );

  const outOfOrder = structuredClone(job);
  outOfOrder.destructiveConfirmedAt = new Date(1_700_000_000_050).toISOString();
  assert.equal(
    validateControlledDmJob(outOfOrder, 1_700_000_001_000),
    'dm-confirmations-out-of-order',
  );

  const received = structuredClone(job);
  received.items[0].sentByMe = false;
  assert.equal(
    validateControlledDmJob(received, 1_700_000_001_000),
    'invalid-live-dm-item',
  );

  const missingSecondConfirmation = structuredClone(job);
  missingSecondConfirmation.destructiveConfirmedAt = null;
  assert.equal(
    validateControlledDmJob(missingSecondConfirmation, 1_700_000_001_000),
    'invalid-live-dm-job',
  );
});

test('preserves a matching arm, invalidates a changed intent, and expires closed', () => {
  const job = liveJob();
  const state = { pendingDmIntent: null, dmArm: null };
  prepareControlledDmIntent(job, pairing, state, 1_700_000_001_000);
  state.dmArm = {
    armedAt: '2023-11-14T22:13:22.000Z',
    expiresAt: '2023-11-14T22:14:52.000Z',
    itemId: job.items[0].id,
    jobId: job.id,
    tabId: 7,
    conversationId: 'inbox/friend_123',
    messageId: 'message-1',
    resolutionToken: 'one-use-token',
  };

  const repeated = prepareControlledDmIntent(job, pairing, state, 1_700_000_002_000);
  assert.equal(repeated.armed, true);
  assert.equal(dmArmMatchesIntent(state.dmArm, state.pendingDmIntent), true);

  const different = liveJob(1_700_000_003_000);
  different.items[0].messageId = 'message-2';
  different.previewDigest = 'c1572602';
  const invalid = prepareControlledDmIntent(different, pairing, state, 1_700_000_004_000);
  assert.equal(invalid.error, 'reviewed-dm-preview-changed');
  assert.notEqual(state.dmArm, null);

  state.pendingDmIntent.expiresAt = '2023-11-14T22:13:20.000Z';
  state.dmArm.expiresAt = '2023-11-14T22:13:20.000Z';
  pruneControlledDmState(state, 1_700_000_000_001);
  assert.equal(state.pendingDmIntent, null);
  assert.equal(state.dmArm, null);
});

test('accepts only an exact-thread retained-node removal proof as DM success', () => {
  const job = liveJob();
  const state = { pendingDmIntent: null, dmArm: null };
  prepareControlledDmIntent(job, pairing, state, 1_700_000_001_000);
  const intent = state.pendingDmIntent;
  const valid = {
    result: 'unsent',
    conversationId: intent.conversationId,
    messageId: intent.messageId,
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

  assert.equal(verifiedControlledDmResult(intent, valid), true);
  assert.equal(verifiedControlledDmResult(intent, {
    ...valid,
    messageId: 'different-message',
  }), false);
  assert.equal(verifiedControlledDmResult(intent, {
    ...valid,
    postcondition: { ...valid.postcondition, observedThreadId: '999' },
  }), false);
  assert.equal(verifiedControlledDmResult(intent, {
    ...valid,
    postcondition: { ...valid.postcondition, retainedRowDisconnected: false },
  }), false);
  assert.equal(verifiedControlledDmResult(intent, {
    ...valid,
    postcondition: { ...valid.postcondition, observationReason: 'wrong-conversation' },
  }), false);
  assert.equal(verifiedControlledDmResult(intent, {
    ...valid,
    postcondition: {
      ...valid.postcondition,
      observationReason: 'exact-message-identity-unavailable',
    },
  }), false);
});

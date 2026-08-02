import test from 'node:test';
import assert from 'node:assert/strict';

import {
  accountArmMatchesIntent,
  prepareControlledAccountIntent,
  pruneControlledAccountState,
  validateControlledAccountJob,
} from '../src/core/controlled-account-action.js';
import {
  confirmReviewedActionJob,
  createReviewedActionJob,
} from '../src/core/action-jobs.js';
import { createQueueItem } from '../src/core/queue.js';

const settings = {
  liveActionEnabled: true,
  liveActionBatchLimit: 1,
};
const pairing = {
  pairingId: 'pairing-1',
  origin: 'http://127.0.0.1:4173',
};

function liveJob(username = 'controlled_target', createdAt = 1_700_000_000_000) {
  const draft = createReviewedActionJob([
    createQueueItem(username, 'follow'),
  ], { settings, createdAt });
  return confirmReviewedActionJob(draft, {
    phrase: draft.confirmationPhrase,
    mode: 'live',
    settings,
    confirmedAt: createdAt + 100,
  });
}

test('prepares only one fresh, unchanged reviewed account action', () => {
  const job = liveJob();
  const state = { pendingLiveIntent: null, liveArm: null };
  const prepared = prepareControlledAccountIntent(job, pairing, state, 1_700_000_001_000);

  assert.equal(prepared.error, undefined);
  assert.equal(prepared.armed, false);
  assert.deepEqual(prepared.intent, {
    action: 'follow',
    confirmedAt: job.confirmedAt,
    expiresAt: '2023-11-14T22:23:21.000Z',
    itemId: job.items[0].id,
    jobId: job.id,
    username: 'controlled_target',
  });
  assert.equal(Object.hasOwn(prepared.intent, 'pairingId'), false);
  assert.equal(state.pendingLiveIntent.pairingId, 'pairing-1');

  const multiple = structuredClone(job);
  multiple.items.push({ ...multiple.items[0], id: 'second-item' });
  assert.equal(validateControlledAccountJob(multiple, 1_700_000_001_000), 'controlled-live-batch-must-be-one');

  const changed = structuredClone(job);
  changed.items[0].username = 'different_target';
  assert.equal(validateControlledAccountJob(changed, 1_700_000_001_000), 'reviewed-preview-changed');

  assert.equal(
    validateControlledAccountJob(job, 1_700_000_000_100 + (11 * 60 * 1000)),
    'live-confirmation-expired',
  );
});

test('preserves a matching one-use arm and invalidates it when the signed intent changes', () => {
  const job = liveJob();
  const state = { pendingLiveIntent: null, liveArm: null };
  prepareControlledAccountIntent(job, pairing, state, 1_700_000_001_000);
  state.liveArm = {
    action: 'follow',
    armedAt: '2023-11-14T22:13:22.000Z',
    expiresAt: '2023-11-14T22:14:52.000Z',
    itemId: job.items[0].id,
    jobId: job.id,
    tabId: 7,
    username: 'controlled_target',
  };

  const repeated = prepareControlledAccountIntent(job, pairing, state, 1_700_000_002_000);
  assert.equal(repeated.armed, true);
  assert.equal(accountArmMatchesIntent(state.liveArm, state.pendingLiveIntent), true);

  const differentJob = liveJob('other_target', 1_700_000_003_000);
  prepareControlledAccountIntent(differentJob, pairing, state, 1_700_000_004_000);
  assert.equal(state.liveArm, null);
  assert.equal(state.pendingLiveIntent.username, 'other_target');
});

test('expired intent and arm state fail closed', () => {
  const state = {
    pendingLiveIntent: {
      jobId: 'job-1',
      expiresAt: '2023-11-14T22:13:20.000Z',
    },
    liveArm: {
      jobId: 'job-1',
      expiresAt: '2023-11-14T22:13:20.000Z',
    },
  };
  pruneControlledAccountState(state, 1_700_000_000_001);
  assert.equal(state.pendingLiveIntent, null);
  assert.equal(state.liveArm, null);
});

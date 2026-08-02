import test from 'node:test';
import assert from 'node:assert/strict';
import { indexedDB } from 'fake-indexeddb';
import {
  clearState,
  loadState,
  updateStateAtomically,
} from '../src/core/storage.js';
import { saveActionJobCheckpoint } from '../src/adapters/indexeddb-action-ledger.js';
import { saveDmJobCheckpoint } from '../src/adapters/indexeddb-dm-ledger.js';

globalThis.indexedDB = indexedDB;

const localValues = new Map();
let localWrites = 0;
globalThis.localStorage = {
  getItem(key) {
    return localValues.get(key) ?? null;
  },
  setItem(key, value) {
    localWrites += 1;
    localValues.set(key, String(value));
  },
};

test('business-rule errors from an IndexedDB updater never fall back to localStorage', async () => {
  await clearState();
  localWrites = 0;
  const expected = Object.assign(new Error('daily limit reached'), { code: 'DAILY_LIMIT' });
  await assert.rejects(
    updateStateAtomically(() => {
      throw expected;
    }),
    (error) => error === expected,
  );
  assert.equal(localWrites, 0);
});

test('successful atomic state updates persist the returned state and result', async () => {
  const outcome = await updateStateAtomically((state) => ({
    state: {
      ...state,
      activity: [{
        id: 'atomic-test',
        timestamp: '2026-07-30T00:00:00.000Z',
        kind: 'test',
        message: 'stored',
      }],
    },
    result: { ok: true },
  }));
  assert.deepEqual(outcome.result, { ok: true });
  assert.equal(outcome.state.activity[0].id, 'atomic-test');
  assert.equal((await loadState()).activity[0].id, 'atomic-test');
});

test('discarded reviewed jobs cannot be resurrected by a late checkpoint', async () => {
  await clearState();
  const actionJob = { id: 'discarded-action-job', activity: [] };
  const dmJob = { id: 'discarded-dm-job', activity: [] };

  await assert.rejects(
    saveActionJobCheckpoint(actionJob),
    /Reviewed action job no longer exists/,
  );
  await assert.rejects(
    saveDmJobCheckpoint(dmJob),
    /Reviewed DM job no longer exists/,
  );

  const state = await loadState();
  assert.deepEqual(state.actionJobs, []);
  assert.deepEqual(state.dmJobs, []);
});

test('checkpoint writers still update reviewed jobs that remain current', async () => {
  await clearState();
  await updateStateAtomically((state) => ({
    state: {
      ...state,
      actionJobs: [{ id: 'current-action-job', status: 'ready', activity: [] }],
      dmJobs: [{ id: 'current-dm-job', status: 'ready', activity: [] }],
    },
    result: { ok: true },
  }));

  await saveActionJobCheckpoint({
    id: 'current-action-job',
    status: 'running',
    activity: [],
  });
  await saveDmJobCheckpoint({
    id: 'current-dm-job',
    status: 'running',
    activity: [],
  });

  const state = await loadState();
  assert.equal(state.actionJobs[0].status, 'running');
  assert.equal(state.dmJobs[0].status, 'running');
});

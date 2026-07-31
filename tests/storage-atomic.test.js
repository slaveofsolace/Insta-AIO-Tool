import test from 'node:test';
import assert from 'node:assert/strict';
import { indexedDB } from 'fake-indexeddb';
import {
  clearState,
  loadState,
  updateStateAtomically,
} from '../src/core/storage.js';

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

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const [sharedSource, preferencesSource] = await Promise.all([
  readFile(new URL('../extension/overlay/shared.js', import.meta.url), 'utf8'),
  readFile(new URL('../extension/overlay/preferences.js', import.meta.url), 'utf8'),
]);

function loadPreferences() {
  const context = vm.createContext({ console, Date, Intl });
  vm.runInContext(sharedSource, context);
  vm.runInContext(preferencesSource, context);
  return context.__instaAioOverlayModules.preferences;
}

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

test('fresh V2 preferences default collapsed with bounded non-sensitive settings', () => {
  const preferences = loadPreferences();
  assert.deepEqual(plain(preferences.defaults()), {
    schemaVersion: 2,
    open: false,
    section: 'now',
    dock: 'right',
    width: 'standard',
    theme: 'auto',
    density: 'comfortable',
    firstRunComplete: false,
  });
});

test('V1 migration preserves valid open and section state while adding safe defaults', () => {
  const preferences = loadPreferences();
  const migrated = preferences.migrate({
    v1: { open: true, section: 'messages', username: 'must-not-migrate' },
  });
  assert.equal(migrated.source, 'v1');
  assert.equal(migrated.shouldPersist, true);
  assert.deepEqual(plain(migrated.preferences), {
    schemaVersion: 2,
    open: true,
    section: 'messages',
    dock: 'right',
    width: 'standard',
    theme: 'auto',
    density: 'comfortable',
    firstRunComplete: true,
  });
  assert.equal('username' in migrated.preferences, false);
});

test('V2 normalization repairs invalid fields independently', () => {
  const preferences = loadPreferences();
  const normalized = preferences.normalize({
    schemaVersion: 99,
    open: true,
    section: 'unknown',
    dock: 'left',
    width: 'enormous',
    theme: 'dark',
    density: 'compact',
    firstRunComplete: true,
  });
  assert.deepEqual(plain(normalized), {
    schemaVersion: 2,
    open: true,
    section: 'now',
    dock: 'left',
    width: 'standard',
    theme: 'dark',
    density: 'compact',
    firstRunComplete: true,
  });
});

test('preference loading persists one normalized V2 record', async () => {
  const preferences = loadPreferences();
  const values = {
    instaAioOverlayPreferencesV1: { open: true, section: 'queue' },
  };
  const writes = [];
  const chromeLike = {
    runtime: { lastError: null },
    storage: {
      local: {
        get(keys, callback) {
          callback(Object.fromEntries(keys.map((key) => [key, values[key]])));
        },
        set(value, callback) {
          writes.push(plain(value));
          Object.assign(values, value);
          callback();
        },
        remove(key, callback) {
          delete values[key];
          callback();
        },
      },
    },
  };
  const storage = preferences.createStorage(chromeLike);
  const loaded = await preferences.load(storage);
  assert.equal(loaded.source, 'v1');
  assert.equal(loaded.preferences.open, true);
  assert.equal(loaded.preferences.section, 'queue');
  assert.equal(writes.length, 1);
  assert.equal(writes[0].instaAioOverlayPreferencesV2.schemaVersion, 2);
});

test('Chrome storage errors reject instead of pretending preferences persisted', async () => {
  const preferences = loadPreferences();
  const chromeLike = {
    runtime: { lastError: null },
    storage: {
      local: {
        get(_keys, callback) {
          chromeLike.runtime.lastError = { message: 'fixture-storage-failure' };
          callback({});
          chromeLike.runtime.lastError = null;
        },
        set(_value, callback) {
          callback();
        },
        remove(_key, callback) {
          callback();
        },
      },
    },
  };
  await assert.rejects(
    preferences.createStorage(chromeLike).get(['key']),
    /fixture-storage-failure/,
  );
});

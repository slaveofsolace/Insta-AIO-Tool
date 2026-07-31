const DB_NAME = 'insta-aio-tool';
const STORE_NAME = 'kv';
const STATE_KEY = 'state';
const DB_VERSION = 1;
const STATE_SCHEMA_VERSION = 3;

class AtomicStateUpdaterError extends Error {
  constructor(cause) {
    super(cause?.message || 'Atomic state update failed.');
    this.name = 'AtomicStateUpdaterError';
    this.cause = cause;
  }
}

export function defaultState() {
  return {
    schemaVersion: STATE_SCHEMA_VERSION,
    snapshots: [],
    activeSnapshotId: null,
    queue: [],
    messages: [],
    selectedMessageIds: [],
    selectedQueueItemIds: [],
    migrationReports: [],
    relationshipReports: [],
    actionJobs: [],
    actionLedger: [],
    dmJobs: [],
    dmLedger: [],
    bridgePairing: null,
    settings: {
      waitingDays: 7,
      protectMutuals: true,
      ownerNames: [],
      whitelist: [],
      preexistingFollowing: [],
      dailyFollowLimit: 25,
      dailyUnfollowLimit: 25,
      dryRun: true,
      liveActionEnabled: false,
      liveActionBatchLimit: 1,
      liveDmUnsendEnabled: false,
      liveDmBatchLimit: 1,
    },
    activity: [],
    importWarnings: [],
  };
}

export function migrateState(candidate) {
  const base = defaultState();
  if (!candidate || typeof candidate !== 'object') return base;
  return {
    ...base,
    ...candidate,
    schemaVersion: STATE_SCHEMA_VERSION,
    settings: { ...base.settings, ...(candidate.settings || {}) },
    snapshots: Array.isArray(candidate.snapshots) ? candidate.snapshots : [],
    queue: Array.isArray(candidate.queue) ? candidate.queue : [],
    messages: Array.isArray(candidate.messages) ? candidate.messages : [],
    selectedMessageIds: Array.isArray(candidate.selectedMessageIds) ? candidate.selectedMessageIds : [],
    selectedQueueItemIds: Array.isArray(candidate.selectedQueueItemIds) ? candidate.selectedQueueItemIds : [],
    migrationReports: Array.isArray(candidate.migrationReports) ? candidate.migrationReports : [],
    relationshipReports: Array.isArray(candidate.relationshipReports) ? candidate.relationshipReports : [],
    actionJobs: Array.isArray(candidate.actionJobs) ? candidate.actionJobs : [],
    actionLedger: Array.isArray(candidate.actionLedger) ? candidate.actionLedger : [],
    dmJobs: Array.isArray(candidate.dmJobs) ? candidate.dmJobs : [],
    dmLedger: Array.isArray(candidate.dmLedger) ? candidate.dmLedger : [],
    bridgePairing: candidate.bridgePairing && typeof candidate.bridgePairing === 'object'
      ? candidate.bridgePairing
      : null,
    activity: Array.isArray(candidate.activity) ? candidate.activity : [],
  };
}

function openDb() {
  return new Promise((resolve, reject) => {
    if (!('indexedDB' in globalThis)) {
      reject(new Error('IndexedDB unavailable'));
      return;
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) db.createObjectStore(STORE_NAME);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function idbGet(key) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const request = tx.objectStore(STORE_NAME).get(key);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    tx.oncomplete = () => db.close();
  });
}

async function idbSet(key, value) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put(value, key);
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => reject(tx.error);
  });
}

async function idbUpdateState(updater) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const request = store.get(STATE_KEY);
    let outcome;
    request.onsuccess = () => {
      try {
        outcome = updater(migrateState(request.result));
        if (!outcome || !outcome.state) {
          throw new Error('Atomic state updater must return { state, result }.');
        }
        store.put(migrateState(outcome.state), STATE_KEY);
      } catch (error) {
        tx.abort();
        reject(new AtomicStateUpdaterError(error));
      }
    };
    request.onerror = () => reject(request.error);
    tx.oncomplete = () => {
      db.close();
      resolve({
        state: migrateState(outcome.state),
        result: outcome.result,
      });
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error);
    };
    tx.onabort = () => db.close();
  });
}

let localUpdateTail = Promise.resolve();

async function localUpdateState(updater) {
  const operation = localUpdateTail.then(() => {
    const current = migrateState(JSON.parse(localStorage.getItem('insta-aio-state') || 'null'));
    const outcome = updater(current);
    if (!outcome || !outcome.state) {
      throw new Error('Atomic state updater must return { state, result }.');
    }
    const state = migrateState(outcome.state);
    localStorage.setItem('insta-aio-state', JSON.stringify(state));
    return { state, result: outcome.result };
  });
  localUpdateTail = operation.catch(() => {});
  return operation;
}

export async function updateStateAtomically(updater) {
  try {
    return await idbUpdateState(updater);
  } catch (error) {
    if (error instanceof AtomicStateUpdaterError) throw error.cause;
    if (typeof localStorage === 'undefined') throw error;
    return localUpdateState(updater);
  }
}

export async function loadState() {
  try {
    return migrateState(await idbGet(STATE_KEY));
  } catch {
    try {
      return migrateState(JSON.parse(localStorage.getItem('insta-aio-state') || 'null'));
    } catch {
      return defaultState();
    }
  }
}

export async function saveState(state) {
  const migrated = migrateState(state);
  try {
    await idbSet(STATE_KEY, migrated);
  } catch {
    localStorage.setItem('insta-aio-state', JSON.stringify(migrated));
  }
}

export async function clearState() {
  await saveState(defaultState());
}

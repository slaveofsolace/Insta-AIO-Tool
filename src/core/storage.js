const DB_NAME = 'insta-aio-tool';
const STORE_NAME = 'kv';
const STATE_KEY = 'state';
const DB_VERSION = 1;

export function defaultState() {
  return {
    schemaVersion: 1,
    snapshots: [],
    activeSnapshotId: null,
    queue: [],
    messages: [],
    selectedMessageIds: [],
    settings: {
      waitingDays: 7,
      protectMutuals: true,
      ownerNames: [],
      whitelist: [],
      preexistingFollowing: [],
      dailyFollowLimit: 25,
      dailyUnfollowLimit: 25,
      dryRun: true,
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
    schemaVersion: 1,
    settings: { ...base.settings, ...(candidate.settings || {}) },
    snapshots: Array.isArray(candidate.snapshots) ? candidate.snapshots : [],
    queue: Array.isArray(candidate.queue) ? candidate.queue : [],
    messages: Array.isArray(candidate.messages) ? candidate.messages : [],
    selectedMessageIds: Array.isArray(candidate.selectedMessageIds) ? candidate.selectedMessageIds : [],
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

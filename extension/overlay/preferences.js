(() => {
  'use strict';

  const modules = globalThis.__instaAioOverlayModules;
  const shared = modules?.shared;
  if (!shared || modules.preferences) return;

  const DOCKS = new Set(['left', 'right']);
  const WIDTHS = new Set(['compact', 'standard', 'wide']);
  const THEMES = new Set(['auto', 'light', 'dark']);
  const DENSITIES = new Set(['comfortable', 'compact']);

  function defaults() {
    return {
      schemaVersion: 2,
      open: false,
      section: 'now',
      dock: 'right',
      width: 'standard',
      theme: 'auto',
      density: 'comfortable',
      firstRunComplete: false,
    };
  }

  function normalize(value, fallback = defaults()) {
    const source = value && typeof value === 'object' ? value : {};
    return {
      schemaVersion: 2,
      open: typeof source.open === 'boolean' ? source.open : fallback.open,
      section: shared.SECTIONS.includes(source.section) ? source.section : fallback.section,
      dock: DOCKS.has(source.dock) ? source.dock : fallback.dock,
      width: WIDTHS.has(source.width) ? source.width : fallback.width,
      theme: THEMES.has(source.theme) ? source.theme : fallback.theme,
      density: DENSITIES.has(source.density) ? source.density : fallback.density,
      firstRunComplete: typeof source.firstRunComplete === 'boolean'
        ? source.firstRunComplete
        : fallback.firstRunComplete,
    };
  }

  function migrate({ v1, v2 }) {
    if (v2 && typeof v2 === 'object') {
      const preferences = normalize(v2);
      return {
        preferences,
        source: 'v2',
        shouldPersist: JSON.stringify(preferences) !== JSON.stringify(v2),
      };
    }
    if (v1 && typeof v1 === 'object') {
      const preferences = normalize({
        ...defaults(),
        open: typeof v1.open === 'boolean' ? v1.open : false,
        section: shared.SECTIONS.includes(v1.section) ? v1.section : 'now',
        firstRunComplete: true,
      });
      return { preferences, source: 'v1', shouldPersist: true };
    }
    return { preferences: defaults(), source: 'fresh', shouldPersist: true };
  }

  function runtimeError(chromeLike) {
    return chromeLike?.runtime?.lastError?.message || null;
  }

  function createStorage(chromeLike) {
    function call(method, argument) {
      return new Promise((resolve, reject) => {
        try {
          chromeLike.storage.local[method](argument, (result) => {
            const error = runtimeError(chromeLike);
            if (error) {
              reject(new Error(error));
              return;
            }
            resolve(result);
          });
        } catch (error) {
          reject(error);
        }
      });
    }
    return Object.freeze({
      get(keys) {
        return call('get', keys).then((value) => value || {});
      },
      remove(key) {
        return call('remove', key);
      },
      set(value) {
        return call('set', value);
      },
    });
  }

  async function load(storage) {
    const stored = await storage.get([
      shared.STORAGE_KEYS.preferencesV1,
      shared.STORAGE_KEYS.preferencesV2,
    ]);
    const result = migrate({
      v1: stored[shared.STORAGE_KEYS.preferencesV1],
      v2: stored[shared.STORAGE_KEYS.preferencesV2],
    });
    if (result.shouldPersist) {
      await storage.set({ [shared.STORAGE_KEYS.preferencesV2]: result.preferences });
    }
    return result;
  }

  async function save(storage, preferences, patch) {
    const next = normalize({ ...preferences, ...patch }, preferences || defaults());
    await storage.set({ [shared.STORAGE_KEYS.preferencesV2]: next });
    return next;
  }

  shared.install('preferences', {
    createStorage,
    defaults,
    load,
    migrate,
    normalize,
    save,
  });
})();

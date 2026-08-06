(() => {
  'use strict';

  const modules = globalThis.__instaAioOverlayModules;
  const shared = modules?.shared;
  if (!shared || modules.preferences) return;

  const DOCKS = new Set(['left', 'right']);
  const WIDTHS = new Set(['compact', 'standard', 'wide']);
  const THEMES = new Set(['auto', 'light', 'dark']);
  const DENSITIES = new Set(['comfortable', 'compact']);
  const MIN_PANEL_WIDTH = 320;
  const MAX_PANEL_WIDTH = 560;
  const MIN_PANEL_HEIGHT = 280;
  const MAX_PANEL_HEIGHT = 1_200;
  const MIN_OPACITY = 0.55;
  const MAX_OPACITY = 1;

  function boundedNumber(value, minimum, maximum, fallback = null) {
    const number = Number(value);
    if (!Number.isFinite(number)) return fallback;
    return Math.min(maximum, Math.max(minimum, number));
  }

  function optionalInteger(value, minimum, maximum) {
    if (value == null || value === '') return null;
    const number = boundedNumber(value, minimum, maximum);
    return number == null ? null : Math.round(number);
  }

  function normalizePosition(value) {
    if (!value || typeof value !== 'object') return null;
    const x = optionalInteger(value.x, 0, 10_000);
    const y = optionalInteger(value.y, 0, 10_000);
    return x == null || y == null ? null : { x, y };
  }

  function defaults() {
    return {
      schemaVersion: 3,
      open: false,
      section: 'now',
      dock: 'right',
      width: 'standard',
      theme: 'auto',
      density: 'comfortable',
      firstRunComplete: false,
      position: null,
      panelWidth: null,
      panelHeight: null,
      opacity: 0.88,
    };
  }

  function normalize(value, fallback = defaults()) {
    const source = value && typeof value === 'object' ? value : {};
    return {
      schemaVersion: 3,
      open: typeof source.open === 'boolean' ? source.open : fallback.open,
      section: shared.SECTIONS.includes(source.section) ? source.section : fallback.section,
      dock: DOCKS.has(source.dock) ? source.dock : fallback.dock,
      width: WIDTHS.has(source.width) ? source.width : fallback.width,
      theme: THEMES.has(source.theme) ? source.theme : fallback.theme,
      density: DENSITIES.has(source.density) ? source.density : fallback.density,
      firstRunComplete: typeof source.firstRunComplete === 'boolean'
        ? source.firstRunComplete
        : fallback.firstRunComplete,
      position: normalizePosition(source.position),
      panelWidth: optionalInteger(source.panelWidth, MIN_PANEL_WIDTH, MAX_PANEL_WIDTH),
      panelHeight: optionalInteger(source.panelHeight, MIN_PANEL_HEIGHT, MAX_PANEL_HEIGHT),
      opacity: Math.round(
        boundedNumber(source.opacity, MIN_OPACITY, MAX_OPACITY, fallback.opacity) * 100,
      ) / 100,
    };
  }

  function migrate({ v1, v2, v3 }) {
    if (v3 && typeof v3 === 'object') {
      const preferences = normalize(v3);
      return {
        preferences,
        source: 'v3',
        shouldPersist: JSON.stringify(preferences) !== JSON.stringify(v3),
      };
    }
    if (v2 && typeof v2 === 'object') {
      const preferences = normalize(v2);
      return {
        preferences,
        source: 'v2',
        shouldPersist: true,
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
      shared.STORAGE_KEYS.preferencesV3,
    ]);
    const result = migrate({
      v1: stored[shared.STORAGE_KEYS.preferencesV1],
      v2: stored[shared.STORAGE_KEYS.preferencesV2],
      v3: stored[shared.STORAGE_KEYS.preferencesV3],
    });
    if (result.shouldPersist) {
      await storage.set({ [shared.STORAGE_KEYS.preferencesV3]: result.preferences });
    }
    return result;
  }

  async function save(storage, preferences, patch) {
    const next = normalize({ ...preferences, ...patch }, preferences || defaults());
    await storage.set({ [shared.STORAGE_KEYS.preferencesV3]: next });
    return next;
  }

  shared.install('preferences', {
    createStorage,
    defaults,
    limits: Object.freeze({
      MAX_OPACITY,
      MAX_PANEL_HEIGHT,
      MAX_PANEL_WIDTH,
      MIN_OPACITY,
      MIN_PANEL_HEIGHT,
      MIN_PANEL_WIDTH,
    }),
    load,
    migrate,
    normalize,
    save,
  });
})();

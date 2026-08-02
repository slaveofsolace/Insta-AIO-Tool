(() => {
  'use strict';

  const namespace = '__instaAioOverlayModules';
  if (globalThis[namespace]) return;

  const modules = Object.create(null);
  Object.defineProperty(globalThis, namespace, {
    configurable: false,
    enumerable: false,
    value: modules,
    writable: false,
  });

  function install(name, api) {
    if (!name || modules[name]) return false;
    Object.defineProperty(modules, name, {
      configurable: false,
      enumerable: true,
      value: Object.freeze(api),
      writable: false,
    });
    return true;
  }

  const STORAGE_KEYS = Object.freeze({
    capture: 'instaAioOverlayCaptureDraftV1',
    manualQueue: 'instaAioOverlayManualQueueV1',
    preferencesV1: 'instaAioOverlayPreferencesV1',
    preferencesV2: 'instaAioOverlayPreferencesV2',
  });
  const SECTIONS = Object.freeze(['now', 'capture', 'queue', 'messages', 'workspace']);
  const SECTION_COPY = Object.freeze({
    now: Object.freeze(['Review target', 'Current Instagram context and one safe next step.']),
    capture: Object.freeze(['Visible capture', 'Add the rendered account rows to one local draft.']),
    queue: Object.freeze(['Review queue', 'Work one reviewed account at a time.']),
    messages: Object.freeze(['Message evidence', 'Read the open thread or resolve one exact reviewed message.']),
    workspace: Object.freeze(['Workspace', 'Pairing, permissions, and the durable PWA ledger.']),
  });
  const ACTIONABLE_QUEUE_STATUSES = new Set(['pending', 'ready', 'failed', 'paused']);
  const ALLOWED_QUEUE_STATUSES = new Set([
    ...ACTIONABLE_QUEUE_STATUSES,
    'waiting',
    'protected',
    'completed',
    'skipped',
    'removed',
  ]);
  const MAX_CAPTURE_ACCOUNTS = 2_000;
  const MAX_QUEUE_ITEMS = 2_000;
  const MAX_TEXT_LENGTH = 500;

  function safeText(value, fallback = '') {
    const text = String(value ?? '').trim();
    return (text || fallback).slice(0, MAX_TEXT_LENGTH);
  }

  function shortDate(value) {
    const date = new Date(value);
    return Number.isNaN(date.getTime())
      ? 'Unknown time'
      : new Intl.DateTimeFormat(undefined, {
        dateStyle: 'medium',
        timeStyle: 'short',
      }).format(date);
  }

  function normalizeQueueItem(item, index, normalizeUsername) {
    const username = normalizeUsername(item?.account?.username || item?.username);
    if (!username) return null;
    return {
      id: safeText(item?.id, `overlay-${index}-${username}`),
      account: {
        username,
        displayName: safeText(item?.account?.displayName),
        source: safeText(item?.account?.source, 'manual-queue-import'),
      },
      action: ['follow', 'unfollow'].includes(item?.action) ? item.action : 'review',
      status: ALLOWED_QUEUE_STATUSES.has(item?.status) ? item.status : 'pending',
      reason: safeText(item?.reason, 'manual review'),
      scheduledFor: safeText(item?.scheduledFor),
      companionUpdatedAt: safeText(item?.companionUpdatedAt),
    };
  }

  function normalizeManualQueue(value, normalizeUsername) {
    const queue = Array.isArray(value?.queue)
      ? value.queue
        .slice(0, MAX_QUEUE_ITEMS)
        .map((item, index) => normalizeQueueItem(item, index, normalizeUsername))
        .filter(Boolean)
      : [];
    const seenIds = new Set();
    queue.forEach((item, index) => {
      if (seenIds.has(item.id)) item.id = `${item.id}:overlay-${index}`;
      seenIds.add(item.id);
    });
    return {
      queue,
      importedAt: safeText(value?.importedAt || value?.exportedAt) || null,
    };
  }

  function normalizeCapture(value, normalizeUsername, now = () => new Date().toISOString()) {
    const listType = value?.listType === 'followers' ? 'followers' : 'following';
    const sourceAccounts = Array.isArray(value?.[listType]) ? value[listType] : [];
    const accounts = new Map();
    for (const candidate of sourceAccounts.slice(0, MAX_CAPTURE_ACCOUNTS)) {
      const username = normalizeUsername(candidate?.username);
      if (!username) continue;
      accounts.set(username, {
        username,
        profileUrl: `https://www.instagram.com/${username}/`,
        displayName: safeText(candidate?.displayName),
        source: 'extension-visible-dom',
      });
    }
    return {
      schemaVersion: 1,
      kind: 'insta-aio-visible-list',
      listType,
      capturedAt: safeText(value?.capturedAt) || now(),
      [listType]: [...accounts.values()],
      note: 'Only rows rendered in Instagram were captured. Scroll the list manually and capture again to merge more rows.',
    };
  }

  function createModel(extensionVersion) {
    return {
      bridge: {
        controlledAccountActionsAvailable: false,
        controlledDmUnsendAvailable: false,
        dmArm: null,
        extensionVersion,
        liveExecutionEnabled: false,
        liveArm: null,
        pairings: [],
        pendingLiveIntent: null,
        pendingDmIntent: null,
        recentRuns: [],
      },
      capture: null,
      collision: { active: false, kind: null, rectangles: [] },
      context: null,
      executionGuard: null,
      manualQueue: { queue: [], importedAt: null },
      messages: null,
      open: false,
      preferences: null,
      section: 'now',
    };
  }

  function currentQueueItem(model) {
    return model.manualQueue.queue.find((item) => ACTIONABLE_QUEUE_STATUSES.has(item.status)) || null;
  }

  function queueRemaining(model) {
    return model.manualQueue.queue.filter((item) => ACTIONABLE_QUEUE_STATUSES.has(item.status)).length;
  }

  function sessionState(context) {
    if (context?.sessionExpired) {
      return ['Login required', 'Sign in manually before inspecting again.', 'danger'];
    }
    if (context?.challenge) {
      return ['Challenge detected', 'Resolve Instagram’s challenge manually before continuing.', 'danger'];
    }
    if (context?.actionBlocked) {
      return ['Activity restricted', 'Stop here and follow Instagram’s guidance.', 'danger'];
    }
    if (context?.rateLimited) {
      return ['Rate limit detected', 'Wait before doing more work in this session.', 'warning'];
    }
    return ['Page ready', 'Identity and state were read without clicking.', 'good'];
  }

  function armRemainingMs(arm, now = Date.now()) {
    const expiresAt = new Date(arm?.expiresAt).getTime();
    return Number.isFinite(expiresAt) ? Math.max(0, expiresAt - now) : 0;
  }

  function countdownLabel(arm, now = Date.now()) {
    const remaining = Math.ceil(armRemainingMs(arm, now) / 1_000);
    return remaining > 0 ? `${remaining}s remaining` : 'Expired';
  }

  install('shared', {
    ACTIONABLE_QUEUE_STATUSES,
    ALLOWED_QUEUE_STATUSES,
    MAX_CAPTURE_ACCOUNTS,
    MAX_QUEUE_ITEMS,
    SECTION_COPY,
    SECTIONS,
    STORAGE_KEYS,
    armRemainingMs,
    countdownLabel,
    createModel,
    currentQueueItem,
    install,
    normalizeCapture,
    normalizeManualQueue,
    normalizeQueueItem,
    queueRemaining,
    safeText,
    sessionState,
    shortDate,
  });
})();

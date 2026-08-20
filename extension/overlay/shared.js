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
    captureV2: 'instaAioOverlayCaptureWorkspaceV2',
    manualQueue: 'instaAioOverlayManualQueueV1',
    preferencesV1: 'instaAioOverlayPreferencesV1',
    preferencesV2: 'instaAioOverlayPreferencesV2',
    preferencesV3: 'instaAioOverlayPreferencesV3',
  });
  const SECTIONS = Object.freeze(['now', 'capture', 'queue', 'messages', 'workspace']);
  const SECTION_COPY = Object.freeze({
    now: Object.freeze(['Instagram tools', 'The follower checker, account review, and DM Unsend entry points.']),
    capture: Object.freeze(['Follower checker', 'Capture Followers and Following, then compare the rendered rows locally.']),
    queue: Object.freeze(['Follow / Unfollow', 'Review one exact account with a true no-click check first.']),
    messages: Object.freeze(['DM Unsend', 'Inspect visible evidence or resolve one exact reviewed sent message.']),
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
  const COMPARISON_CATEGORIES = Object.freeze({
    'i-do-not-follow-back': 'iDoNotFollowBack',
    mutuals: 'mutuals',
    'not-following-me-back': 'notFollowingMeBack',
  });

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

  function captureWorkspaceDefaults() {
    return {
      schemaVersion: 3,
      kind: 'insta-aio-visible-checker-workspace',
      followers: [],
      following: [],
      capturedAt: {
        followers: null,
        following: null,
      },
      complete: {
        followers: false,
        following: false,
      },
      verified: {
        followers: false,
        following: false,
      },
    };
  }

  function normalizeCaptureAccounts(value, normalizeUsername) {
    const accounts = new Map();
    for (const candidate of (Array.isArray(value) ? value : []).slice(0, MAX_CAPTURE_ACCOUNTS)) {
      const username = normalizeUsername(candidate?.username || candidate?.profileUrl || candidate);
      if (!username) continue;
      accounts.set(username, {
        username,
        profileUrl: `https://www.instagram.com/${username}/`,
        displayName: safeText(candidate?.displayName),
        source: 'extension-visible-dom',
      });
    }
    return [...accounts.values()].sort((left, right) => left.username.localeCompare(right.username));
  }

  function normalizeCaptureWorkspace(value, normalizeUsername) {
    const source = value && typeof value === 'object' ? value : {};
    const migratedFromUnsafeDialogFallback = Number(source.schemaVersion) < 3;
    const capturedAt = source.capturedAt && typeof source.capturedAt === 'object'
      ? source.capturedAt
      : {};
    return {
      schemaVersion: 3,
      kind: 'insta-aio-visible-checker-workspace',
      followers: normalizeCaptureAccounts(source.followers, normalizeUsername),
      following: normalizeCaptureAccounts(source.following, normalizeUsername),
      capturedAt: {
        followers: safeText(capturedAt.followers) || null,
        following: safeText(capturedAt.following) || null,
      },
      complete: {
        followers: !migratedFromUnsafeDialogFallback
          && source.verified?.followers === true
          && source.complete?.followers === true,
        following: !migratedFromUnsafeDialogFallback
          && source.verified?.following === true
          && source.complete?.following === true,
      },
      verified: {
        followers: !migratedFromUnsafeDialogFallback && source.verified?.followers === true,
        following: !migratedFromUnsafeDialogFallback && source.verified?.following === true,
      },
    };
  }

  function migrateCaptureWorkspace({ v1, v2 }, normalizeUsername) {
    if (v2 && typeof v2 === 'object') {
      const workspace = normalizeCaptureWorkspace(v2, normalizeUsername);
      return {
        source: 'v2',
        workspace,
        shouldPersist: JSON.stringify(workspace) !== JSON.stringify(v2),
      };
    }
    if (v1 && typeof v1 === 'object') {
      const listType = v1.listType === 'followers' ? 'followers' : 'following';
      const workspace = normalizeCaptureWorkspace({
        [listType]: v1[listType],
        capturedAt: { [listType]: v1.capturedAt },
      }, normalizeUsername);
      return { source: 'v1', workspace, shouldPersist: true };
    }
    return { source: 'fresh', workspace: captureWorkspaceDefaults(), shouldPersist: true };
  }

  function captureRecord(workspace, listType, now = () => new Date().toISOString()) {
    const normalizedType = listType === 'followers' ? 'followers' : 'following';
    const source = workspace && typeof workspace === 'object'
      ? workspace
      : captureWorkspaceDefaults();
    return {
      schemaVersion: 1,
      kind: 'insta-aio-visible-list',
      listType: normalizedType,
      capturedAt: safeText(source.capturedAt?.[normalizedType]) || now(),
      [normalizedType]: Array.isArray(source[normalizedType]) ? source[normalizedType] : [],
      verifiedDialog: source.verified?.[normalizedType] === true,
      note: 'Only rows rendered in Instagram were captured. Scroll the list manually and capture again to merge more rows.',
    };
  }

  function verifiedCaptureAccounts(workspace, listType) {
    const normalizedType = listType === 'followers' ? 'followers' : 'following';
    return workspace?.verified?.[normalizedType] === true && Array.isArray(workspace?.[normalizedType])
      ? workspace[normalizedType]
      : [];
  }

  function compareCaptureWorkspace(workspace) {
    const followers = verifiedCaptureAccounts(workspace, 'followers');
    const following = verifiedCaptureAccounts(workspace, 'following');
    const followerNames = new Set(followers.map((account) => account.username));
    const followingNames = new Set(following.map((account) => account.username));
    return {
      mutuals: following.filter((account) => followerNames.has(account.username)),
      iDoNotFollowBack: followers.filter((account) => !followingNames.has(account.username)),
      notFollowingMeBack: following.filter((account) => !followerNames.has(account.username)),
    };
  }

  function filterComparisonResults(
    comparison,
    category = 'not-following-me-back',
    query = '',
    limit = 100,
  ) {
    const normalizedCategory = Object.hasOwn(COMPARISON_CATEGORIES, category)
      ? category
      : 'not-following-me-back';
    const source = Array.isArray(comparison?.[COMPARISON_CATEGORIES[normalizedCategory]])
      ? comparison[COMPARISON_CATEGORIES[normalizedCategory]]
      : [];
    const normalizedQuery = safeText(query).replace(/^@+/, '').toLocaleLowerCase();
    const matches = normalizedQuery
      ? source.filter((account) => (
        safeText(account?.username).toLocaleLowerCase().includes(normalizedQuery)
        || safeText(account?.displayName).toLocaleLowerCase().includes(normalizedQuery)
      ))
      : source;
    const requestedLimit = Number.isFinite(Number(limit)) ? Math.trunc(Number(limit)) : 100;
    const boundedLimit = Math.max(1, Math.min(100, requestedLimit));
    return {
      accounts: matches.slice(0, boundedLimit),
      category: normalizedCategory,
      total: matches.length,
      truncated: matches.length > boundedLimit,
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
      armNotice: null,
      capture: captureWorkspaceDefaults(),
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
    COMPARISON_CATEGORIES,
    MAX_CAPTURE_ACCOUNTS,
    MAX_QUEUE_ITEMS,
    SECTION_COPY,
    SECTIONS,
    STORAGE_KEYS,
    armRemainingMs,
    captureRecord,
    captureWorkspaceDefaults,
    compareCaptureWorkspace,
    countdownLabel,
    createModel,
    currentQueueItem,
    filterComparisonResults,
    install,
    migrateCaptureWorkspace,
    normalizeCapture,
    normalizeCaptureWorkspace,
    normalizeManualQueue,
    normalizeQueueItem,
    queueRemaining,
    safeText,
    sessionState,
    shortDate,
    verifiedCaptureAccounts,
  });
})();

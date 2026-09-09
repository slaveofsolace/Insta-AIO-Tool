(async () => {
  'use strict';

  const EXTENSION_ROOT_ID = 'insta-toolbox-sidecar-root';
  const ROOT_ID = 'insta-toolbox-userscript-root';
  const STATE_KEY = 'instaToolboxUserscriptStateV2';
  const PREFERENCES_KEY = 'instaToolboxUserscriptPreferencesV1';
  const LEGACY_QUEUE_KEY = 'instaToolboxManualQueueV1';
  const TAB_RUN_FIELD = 'instaToolboxAccountRunV1';
  const ACTIONABLE_STATUSES = new Set(['pending', 'ready', 'failed', 'paused']);
  const RESERVED = new Set([
    'accounts', 'about', 'api', 'developer', 'direct', 'emails', 'explore',
    'legal', 'privacy', 'reels', 'settings', 'stories', 'terms', 'web',
  ]);
  const VIEWS = ['checker', 'account', 'messages'];
  const ACCENTS = new Set(['rose', 'violet', 'blue']);
  const BLURS = new Set(['none', 'soft', 'strong']);
  const LAUNCHER_SIZES = new Set(['standard', 'large']);
  const WIDTH_MIN = 320;
  const WIDTH_MAX = 560;
  const HEIGHT_MIN = 320;
  const HEIGHT_MAX = 1_100;
  const INSET = 8;
  const RUN_CAPABILITY_MS = 20 * 60 * 1_000;
  const DM_PLAN_CAPABILITY_MS = 15 * 60 * 1_000;
  const CAPTURE_ACCOUNT_SOURCES = new Set([
    'authenticated-instagram-web',
    'extension-scrolled-dom',
    'extension-visible-dom',
    'tampermonkey-visible-dom',
  ]);

  if (document.getElementById(EXTENSION_ROOT_ID) || document.getElementById(ROOT_ID)) {
    bootstrapClaim.remove();
    return;
  }

  const normalizeUsername = (value) => {
    const username = String(value || '')
      .replace(/^https?:\/\/www\.instagram\.com\//i, '')
      .replace(/^@/, '')
      .replace(/^\/+/, '')
      .split(/[/?#]/)[0]
      .trim()
      .toLowerCase();
    return /^[a-z0-9._]{1,30}$/i.test(username) && !RESERVED.has(username) ? username : '';
  };

  const clamp = (value, minimum, maximum) => Math.min(maximum, Math.max(minimum, Number(value) || 0));
  const safeText = (value, fallback = '') => (String(value ?? '').trim() || fallback).slice(0, 500);
  const nowIso = () => new Date().toISOString();
  const formatCount = (value) => Number(value || 0).toLocaleString('en-US');

  function accountCapabilityDigest(action, usernames) {
    const source = JSON.stringify({
      action,
      usernames: (usernames || []).map(normalizeUsername).filter(Boolean),
    });
    let hash = 0x811c9dc5;
    for (let index = 0; index < source.length; index += 1) {
      hash ^= source.charCodeAt(index);
      hash = Math.imul(hash, 0x01000193);
    }
    return (hash >>> 0).toString(16).padStart(8, '0');
  }

  function visibleText(element) {
    if (!element || element.getAttribute?.('aria-hidden') === 'true') return '';
    const style = getComputedStyle(element);
    if (style.display === 'none' || style.visibility === 'hidden') return '';
    return safeText(element.textContent || element.getAttribute?.('aria-label'));
  }

  function normalizeAccounts(value) {
    const accounts = new Map();
    for (const candidate of (Array.isArray(value) ? value : []).slice(0, 25_000)) {
      const username = normalizeUsername(candidate?.username || candidate?.profileUrl || candidate);
      if (!username) continue;
      accounts.set(username, {
        username,
        profileUrl: `https://www.instagram.com/${username}/`,
        displayName: safeText(candidate?.displayName),
        source: CAPTURE_ACCOUNT_SOURCES.has(candidate?.source)
          ? candidate.source
          : 'tampermonkey-visible-dom',
      });
    }
    return [...accounts.values()].sort((left, right) => left.username.localeCompare(right.username));
  }

  function normalizeQueue(value) {
    const queue = [];
    for (const [index, item] of (Array.isArray(value?.queue) ? value.queue : []).slice(0, 2_000).entries()) {
      const username = normalizeUsername(item?.account?.username || item?.username);
      if (!username) continue;
      queue.push({
        id: safeText(item?.id, `userscript-${index}-${username}`),
        account: { username, displayName: safeText(item?.account?.displayName) },
        action: ['follow', 'unfollow'].includes(item?.action) ? item.action : 'review',
        status: ACTIONABLE_STATUSES.has(item?.status) ? item.status : safeText(item?.status, 'pending'),
        reason: safeText(item?.reason, 'manual review'),
        companionUpdatedAt: safeText(item?.companionUpdatedAt),
      });
    }
    return { queue, importedAt: safeText(value?.importedAt || value?.exportedAt) || null };
  }

  function stateDefaults() {
    return {
      schemaVersion: 6,
      capture: {
        subjectUsername: '',
        followers: [],
        following: [],
        capturedAt: { followers: null, following: null },
        complete: { followers: false, following: false },
        verified: { followers: false, following: false },
        source: { followers: '', following: '' },
      },
      queue: { queue: [], importedAt: null },
      accountCheck: null,
      messageEvidence: null,
      dmTarget: null,
      dmCheck: null,
      history: [],
      sentDms: [],
      sentDmsComplete: false,
      sentDmsChecked: false,
      limits: {
        minDelayMs: 1_000,
        maxDelayMs: 2_000,
      },
      ledger: { day: null, actions: 0, unsends: 0 },
      run: null,
      introDone: false,
    };
  }

  function preferencesDefaults() {
    return {
      schemaVersion: 3,
      open: true,
      view: 'checker',
      position: null,
      launcherPosition: null,
      width: 390,
      height: 620,
      opacity: 0.88,
      accent: 'rose',
      blur: 'soft',
      launcherSize: 'standard',
    };
  }

  function normalizeResumableAccountRun(value) {
    if (!value || value.kind !== 'account' || value.status !== 'running') return null;
    const capabilityExpiresAt = Math.min(
      Number(value.capabilityExpiresAt) || 0,
      Date.now() + RUN_CAPABILITY_MS,
    );
    const queue = [...new Set((Array.isArray(value.queue) ? value.queue : [])
      .map(normalizeUsername)
      .filter(Boolean))].slice(0, 250);
    if (!queue.length || capabilityExpiresAt <= Date.now()) return null;
    const action = value.action === 'follow' ? 'follow' : value.action === 'unfollow' ? 'unfollow' : '';
    if (!action) return null;
    const approvedTargets = [...new Set((Array.isArray(value.approvedTargets) ? value.approvedTargets : [])
      .map(normalizeUsername)
      .filter(Boolean))].slice(0, 250);
    const capabilityId = safeText(value.capabilityId);
    if (!capabilityId
      || !approvedTargets.length
      || queue.some((username) => !approvedTargets.includes(username))
      || safeText(value.capabilityDigest) !== accountCapabilityDigest(action, approvedTargets)) return null;
    const boundedCount = (candidate) => Math.max(0, Math.min(250, Math.round(Number(candidate) || 0)));
    return {
      status: 'running',
      kind: 'account',
      action,
      queue,
      total: Math.max(queue.length, boundedCount(value.total)),
      completed: boundedCount(value.completed),
      skipped: boundedCount(value.skipped),
      failed: boundedCount(value.failed),
      current: safeText(value.current),
      stopReason: null,
      approvedTargets,
      capabilityDigest: accountCapabilityDigest(action, approvedTargets),
      capabilityExpiresAt,
      capabilityId,
      nextAt: Number(value.nextAt) > Date.now() ? Number(value.nextAt) : null,
      results: (Array.isArray(value.results) ? value.results : []).slice(0, 40).map((item) => ({
        label: safeText(item?.label),
        status: safeText(item?.status),
        reason: safeText(item?.reason),
      })),
    };
  }

  function readManagerTab() {
    if (typeof GM_getTab !== 'function' || typeof GM_saveTab !== 'function') return Promise.resolve(null);
    return new Promise((resolve) => {
      let settled = false;
      const finish = (value) => {
        if (settled) return;
        settled = true;
        resolve(value && typeof value === 'object' ? value : null);
      };
      try {
        const pending = GM_getTab(finish);
        if (pending && typeof pending.then === 'function') pending.then(finish, () => finish(null));
      } catch {
        finish(null);
      }
      setTimeout(() => finish(null), 1_000);
    });
  }

  function loadState(tabState) {
    const source = GM_getValue(STATE_KEY, null);
    const defaults = stateDefaults();
    const legacyQueue = GM_getValue(LEGACY_QUEUE_KEY, null);
    const value = source && typeof source === 'object' ? source : defaults;
    // Schema 4 is the first state whose capture completeness is reconciled
    // against an exact list read. Schema 5 records whether that read used
    // bounded authenticated pagination or the list-dialog fallback. Schema 6
    // requires a fresh DOM scan with an exact total, preserving the saved rows.
    const requiresCountReconciledRescan = Number(value.schemaVersion) < 4;
    return {
      schemaVersion: 6,
      capture: {
        subjectUsername: normalizeUsername(value.capture?.subjectUsername),
        followers: normalizeAccounts(value.capture?.followers),
        following: normalizeAccounts(value.capture?.following),
        capturedAt: {
          followers: safeText(value.capture?.capturedAt?.followers) || null,
          following: safeText(value.capture?.capturedAt?.following) || null,
        },
        complete: {
          followers: !requiresCountReconciledRescan
            && (Number(value.schemaVersion) >= 6 || value.capture?.source?.followers === 'authenticated-web')
            && value.capture?.verified?.followers === true
            && value.capture?.complete?.followers === true,
          following: !requiresCountReconciledRescan
            && (Number(value.schemaVersion) >= 6 || value.capture?.source?.following === 'authenticated-web')
            && value.capture?.verified?.following === true
            && value.capture?.complete?.following === true,
        },
        verified: {
          followers: !requiresCountReconciledRescan && value.capture?.verified?.followers === true,
          following: !requiresCountReconciledRescan && value.capture?.verified?.following === true,
        },
        source: {
          followers: ['authenticated-web', 'list-dialog'].includes(value.capture?.source?.followers)
            ? value.capture.source.followers
            : '',
          following: ['authenticated-web', 'list-dialog'].includes(value.capture?.source?.following)
            ? value.capture.source.following
            : '',
        },
      },
      queue: normalizeQueue(value.queue?.queue?.length ? value.queue : legacyQueue),
      accountCheck: value.accountCheck && typeof value.accountCheck === 'object' ? value.accountCheck : null,
      messageEvidence: value.messageEvidence && typeof value.messageEvidence === 'object' ? value.messageEvidence : null,
      dmTarget: value.dmTarget && typeof value.dmTarget === 'object' ? value.dmTarget : null,
      dmCheck: value.dmCheck && typeof value.dmCheck === 'object' ? value.dmCheck : null,
      history: Array.isArray(value.history) ? value.history.slice(0, 20) : [],
      sentDms: Array.isArray(value.sentDms) ? value.sentDms.slice(0, 500) : [],
      sentDmsComplete: value.sentDmsComplete === true,
      sentDmsChecked: value.sentDmsChecked === true,
      introDone: value.introDone === true,
      limits: { ...defaults.limits, ...(value.limits && typeof value.limits === 'object' ? value.limits : {}) },
      ledger: value.ledger && typeof value.ledger === 'object' ? value.ledger : defaults.ledger,
      // Only an account run survives a reload, because navigating between
      // profiles is how it advances and every target is re-resolved on arrival.
      // A DM run is dropped: it drives one open conversation, so after a reload
      // the thread it was working in is gone.
      run: normalizeResumableAccountRun(tabState?.[TAB_RUN_FIELD]),
    };
  }

  function normalizePreferences(value) {
    const source = value && typeof value === 'object' ? value : {};
    // Version 1 shipped at 94% opacity even though the extension and the
    // documented design system use 88%. Migrate only that old default; every
    // other saved opacity remains an explicit user choice.
    const opacity = source.schemaVersion === 1 && Number(source.opacity) === 0.94
      ? 0.88
      : source.opacity;
    const position = source.position && Number.isFinite(Number(source.position.x))
      && Number.isFinite(Number(source.position.y))
      ? { x: Math.max(0, Math.round(source.position.x)), y: Math.max(0, Math.round(source.position.y)) }
      : null;
    const launcherPosition = source.launcherPosition
      && Number.isFinite(Number(source.launcherPosition.x))
      && Number.isFinite(Number(source.launcherPosition.y))
      ? {
        x: Math.max(0, Math.round(source.launcherPosition.x)),
        y: Math.max(0, Math.round(source.launcherPosition.y)),
      }
      : null;
    return {
      schemaVersion: 3,
      open: typeof source.open === 'boolean' ? source.open : true,
      view: VIEWS.includes(source.view) ? source.view : 'checker',
      position,
      launcherPosition,
      width: Math.round(clamp(source.width || 390, WIDTH_MIN, WIDTH_MAX)),
      height: Math.round(clamp(source.height || 620, HEIGHT_MIN, HEIGHT_MAX)),
      opacity: Math.round(clamp(opacity ?? 0.88, 0.55, 1) * 100) / 100,
      accent: ACCENTS.has(source.accent) ? source.accent : 'rose',
      blur: BLURS.has(source.blur) ? source.blur : 'soft',
      launcherSize: LAUNCHER_SIZES.has(source.launcherSize)
        ? source.launcherSize
        : 'standard',
    };
  }

  let managerTab = await readManagerTab();
  if (document.getElementById(EXTENSION_ROOT_ID) || document.getElementById(ROOT_ID)) {
    bootstrapClaim.remove();
    return;
  }
  const managerTabStorageAvailable = managerTab !== null;
  let state = loadState(managerTab);
  let preferences = normalizePreferences(GM_getValue(PREFERENCES_KEY, preferencesDefaults()));
  let lastFocusedElement = null;
  const CHECKER_RESULTS_PAGE_SIZE = 25;
  const CHECKER_CATEGORY_KEYS = Object.freeze({
    'not-following-me-back': 'notFollowingMeBack',
    'i-do-not-follow-back': 'iDoNotFollowBack',
    mutuals: 'mutuals',
  });
  let checkerResultLimit = CHECKER_RESULTS_PAGE_SIZE;
  let checkerResultKey = '';
  let checkerResultAnnouncement = '';
  let checkerResultAnnouncementTimer = null;

  function saveState() {
    GM_setValue(STATE_KEY, { ...state, run: null });
    if (!managerTabStorageAvailable) return;
    const resumable = normalizeResumableAccountRun(state.run);
    managerTab = { ...managerTab };
    if (resumable) managerTab[TAB_RUN_FIELD] = resumable;
    else delete managerTab[TAB_RUN_FIELD];
    try {
      GM_saveTab(managerTab);
    } catch {
      // If the manager cannot persist tab state, the run will stop safely on
      // navigation instead of leaking authority into userscript-wide storage.
    }
  }

  function savePreferences(patch) {
    preferences = normalizePreferences({ ...preferences, ...patch });
    GM_setValue(PREFERENCES_KEY, preferences);
    applyLayout();
    renderShellState();
  }

  function currentQueueItem() {
    return state.queue.queue.find((item) => ACTIONABLE_STATUSES.has(item.status)) || null;
  }

  function verifiedCapture(listType) {
    return state.capture.verified?.[listType] === true ? state.capture[listType] : [];
  }

  function completeCapture(listType) {
    return state.capture.verified?.[listType] === true
      && state.capture.complete?.[listType] === true
      ? state.capture[listType]
      : [];
  }

  function compareCapture() {
    if (!comparisonIsReady()) return { mutuals: [], iDoNotFollowBack: [], notFollowingMeBack: [] };
    const followers = verifiedCapture('followers');
    const following = verifiedCapture('following');
    const followerNames = new Set(followers.map((account) => account.username));
    const followingNames = new Set(following.map((account) => account.username));
    return {
      mutuals: following.filter((account) => followerNames.has(account.username)),
      iDoNotFollowBack: followers.filter((account) => !followingNames.has(account.username)),
      notFollowingMeBack: following.filter((account) => !followerNames.has(account.username)),
    };
  }

  function comparisonIsReady() {
    return ['followers', 'following'].every((type) => (
      state.capture.verified?.[type] === true && state.capture.complete?.[type] === true
    ));
  }

  function comparisonBrowserSelection(comparison) {
    const categoryControl = query('[data-role="comparison-category"]');
    const searchControl = query('[data-role="result-filter"]');
    const category = Object.hasOwn(CHECKER_CATEGORY_KEYS, categoryControl?.value)
      ? categoryControl.value
      : 'not-following-me-back';
    const search = safeText(searchControl?.value).replace(/^@+/, '').toLocaleLowerCase();
    const source = Array.isArray(comparison?.[CHECKER_CATEGORY_KEYS[category]])
      ? comparison[CHECKER_CATEGORY_KEYS[category]]
      : [];
    const matches = search
      ? source.filter((account) => (
        safeText(account?.username).toLocaleLowerCase().includes(search)
        || safeText(account?.displayName).toLocaleLowerCase().includes(search)
      ))
      : source;
    const viewKey = [
      category,
      search,
      state.capture.capturedAt?.followers || '',
      state.capture.capturedAt?.following || '',
    ].join('|');
    if (checkerResultKey !== viewKey) {
      checkerResultKey = viewKey;
      checkerResultLimit = CHECKER_RESULTS_PAGE_SIZE;
    }
    return {
      accounts: matches.slice(0, checkerResultLimit),
      category,
      total: matches.length,
    };
  }

  function captureVisibleAccounts(expectedListType = '') {
    const listContext = openFollowerListContext();
    if (!listContext || listContext.listType !== expectedListType) return [];
    const roots = [listContext.dialog];
    const accounts = new Map();
    for (const root of roots) {
      for (const anchor of root.querySelectorAll('a[href^="/"]')) {
        const username = normalizeUsername(anchor.getAttribute('href'));
        if (!username) continue;
        accounts.set(username, {
          username,
          profileUrl: `https://www.instagram.com/${username}/`,
          displayName: visibleText(anchor) === username ? '' : visibleText(anchor),
          source: 'tampermonkey-visible-dom',
        });
      }
    }
    return [...accounts.values()].sort((left, right) => left.username.localeCompare(right.username));
  }

  function inspectProfile() {
    const username = normalizeUsername(location.pathname);
    if (!username) return { ok: false, reason: 'Open an Instagram profile first.' };
    const headers = [...document.querySelectorAll('main header')].filter((header) => (
      visibleText(header)
      && [...header.querySelectorAll('a[href], h1, h2, [role="heading"]')].some((element) => (
        normalizeUsername(element.getAttribute?.('href')) === username
        || normalizeUsername(visibleText(element)) === username
      ))
    ));
    if (headers.length !== 1) return { ok: false, username, reason: 'Exact profile header is ambiguous.' };
    const labels = new Map([
      ['follow', 'not-following'],
      ['following', 'following'],
      ['requested', 'requested'],
    ]);
    const controls = [...headers[0].querySelectorAll('button, [role="button"]')]
      .map((element) => ({ element, label: visibleText(element).normalize('NFKC').toLocaleLowerCase() }))
      .filter(({ label }) => labels.has(label));
    if (controls.length !== 1) {
      return { ok: false, username, reason: 'Exact relationship control is unavailable or ambiguous.' };
    }
    return {
      ok: true,
      username,
      relationship: labels.get(controls[0].label),
      observedLabel: controls[0].label,
      checkedAt: nowIso(),
      noClick: true,
    };
  }

  function inspectAccountQueueItem() {
    const item = currentQueueItem();
    const observation = inspectProfile();
    const expectedRelationship = item?.action === 'follow' ? 'not-following' : 'following';
    const exact = item
      ? Boolean(
        observation.ok
        && observation.username === item.account.username
        && observation.relationship === expectedRelationship
      )
      : observation.ok === true;
    state.accountCheck = {
      checkedAt: nowIso(),
      exact,
      noClick: true,
      target: item?.account?.username || observation.username || null,
      action: item?.action || null,
      observation,
      result: item
        ? exact
          ? `Resolved ${item.action} for @${item.account.username} without clicking.`
          : observation.reason || `Open @${item.account.username} on the expected relationship state.`
        : observation.ok
          ? `Observed @${observation.username} as ${observation.relationship.replace('-', ' ')} without clicking.`
          : observation.reason || 'Open an Instagram profile first.',
    };
    state.history.unshift({ kind: 'account-dry-run', ...state.accountCheck });
    state.history = state.history.slice(0, 20);
    saveState();
  }

  function inspectVisibleMessages() {
    const threadId = currentDirectThreadId();
    if (!threadId) {
      return {
        capturedAt: nowIso(),
        threadId: '',
        fragments: [],
        reason: 'Open an Instagram conversation first.',
      };
    }
    const main = document.querySelector('main');
    const nodes = [...(main?.querySelectorAll?.('[role="row"] [dir="auto"]') || [])];
    const candidates = (nodes.length ? nodes : [...(main?.querySelectorAll?.('div[dir="auto"]') || [])])
      .filter((element) => !element.querySelector?.('[dir="auto"]'))
      .filter((element) => !element.closest?.('header, nav, button, [role="button"], a'))
      .map(visibleText)
      .filter(Boolean);
    return {
      capturedAt: nowIso(),
      threadId,
      fragments: [...new Set(candidates)].slice(-30).map((text, index) => ({ index, text })),
      reason: candidates.length ? 'Visible text evidence only; sender ownership is unknown.' : 'No visible message text was resolved.',
    };
  }

  function fnvDigest(value) {
    let hash = 0x811c9dc5;
    const text = String(value ?? '');
    for (let index = 0; index < text.length; index += 1) {
      hash ^= text.charCodeAt(index);
      hash = Math.imul(hash, 0x01000193);
    }
    return (hash >>> 0).toString(16).padStart(8, '0');
  }

  function directThreadId(value) {
    const text = String(value || '').replaceAll('\\', '/');
    const directMatch = text.match(/\/direct\/t\/([^/?#]+)/i);
    if (directMatch) return directMatch[1];
    const finalSegment = text.split('/').filter(Boolean).at(-1) || '';
    const exportMatch = finalSegment.match(/_([0-9]+)$/);
    return exportMatch?.[1] || (/^[0-9]+$/.test(finalSegment) ? finalSegment : null);
  }

  function currentDirectThreadId() {
    const pathname = String(location.pathname || '').replaceAll('\\', '/');
    if (/^\/direct\/t\/[^/?#]+\/?$/i.test(pathname)) return directThreadId(pathname);
    const visible = (element) => {
      if (!element) return false;
      const style = getComputedStyle(element);
      if (style.display === 'none' || style.visibility === 'hidden') return false;
      const rectangle = element.getBoundingClientRect?.();
      return !rectangle || (rectangle.width > 0 && rectangle.height > 0);
    };
    const roots = [...document.querySelectorAll("[data-pagelet='IGDMessagesList']")].filter(visible);
    if (roots.length !== 1) return null;
    const links = [...document.querySelectorAll("a[href*='/direct/t/']")].filter(visible);
    if (links.length !== 1) return null;
    return directThreadId(links[0].getAttribute?.('href'));
  }

  function sentMessagesForThread(messages, threadId = currentDirectThreadId()) {
    if (!threadId) return [];
    return (Array.isArray(messages) ? messages : [])
      .filter((message) => directThreadId(message?.conversationId) === threadId);
  }

  function inspectExactDmTarget() {
    const threadId = currentDirectThreadId();
    const item = state.dmTarget;
    if (!item) {
      return {
        exact: false,
        reason: 'Import one reviewed DM job first.',
        noClick: true,
        threadId: threadId || '',
      };
    }
    const expectedThread = directThreadId(item.conversationId);
    if (!threadId || !expectedThread || expectedThread !== threadId) {
      return {
        exact: false,
        reason: 'Wrong or unresolved conversation.',
        noClick: true,
        threadId: threadId || '',
      };
    }
    const scope = document.querySelector('[data-pagelet="IGDMessagesList"]') || document.querySelector('main');
    const candidates = [...(scope?.querySelectorAll?.('[data-message-id], [data-item-id]') || [])]
      .map((identity) => {
        const row = identity.closest?.('[role="row"], [role="listitem"]') || identity;
        const messageId = safeText(identity.getAttribute('data-message-id') || identity.getAttribute('data-item-id'));
        const timestamp = Number(identity.getAttribute('data-timestamp-ms') || row.getAttribute?.('data-timestamp-ms'));
        const content = [...row.querySelectorAll('[data-insta-toolbox-message-content], [dir="auto"]')]
          .filter((element) => !element.querySelector?.('[dir="auto"]'))
          .map(visibleText)
          .find((text) => fnvDigest(text) === item.contentDigest);
        const sentByMe = String(row.getAttribute?.('data-sent-by-me')).toLowerCase() === 'true';
        return { messageId, timestamp, content, sentByMe };
      })
      .filter((candidate) => (
        candidate.messageId === item.messageId
        && candidate.timestamp === Number(item.timestamp)
        && candidate.content
        && candidate.sentByMe
      ));
    return candidates.length === 1
      ? {
        exact: true,
        reason: 'One exact sent-message identity resolved without opening a menu.',
        noClick: true,
        checkedAt: nowIso(),
        threadId,
      }
      : {
        exact: false,
        reason: candidates.length ? 'Exact message identity is ambiguous.' : 'Exact sent-message identity is unavailable.',
        noClick: true,
        checkedAt: nowIso(),
        threadId,
      };
  }

  function downloadJson(filename, payload) {
    const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1_000);
  }

  function downloadText(filename, contents) {
    const url = URL.createObjectURL(new Blob([String(contents)], { type: 'text/plain;charset=utf-8' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1_000);
  }

  const sharedTokenCss = globalThis.InstaToolboxTokens?.css({ density: 'compact' }) || '';
  const host = document.createElement('div');
  host.id = ROOT_ID;
  const shadow = host.attachShadow({ mode: 'open' });
  shadow.innerHTML = `
    <style>
      ${sharedTokenCss}
      :host { all: initial; --insta-toolbox-alpha: 88%; --insta-toolbox-alpha-strong: 96%; --insta-toolbox-width: 390px; --insta-toolbox-height: 620px; --insta-toolbox-backdrop-blur: 10px; --insta-toolbox-launcher-size: 46px; color-scheme: light dark; color: var(--insta-toolbox-text, #1b211c); font-family: var(--insta-toolbox-font, "Segoe UI Variable", "Segoe UI", system-ui, sans-serif); }
      :host([data-accent="violet"]) { --insta-toolbox-accent: var(--insta-toolbox-accent-violet); --insta-toolbox-focus: var(--insta-toolbox-accent-violet); }
      :host([data-accent="blue"]) { --insta-toolbox-accent: var(--insta-toolbox-accent-blue); --insta-toolbox-focus: var(--insta-toolbox-accent-blue); }
      :host([data-blur="none"]) { --insta-toolbox-backdrop-blur: 0px; }
      :host([data-blur="strong"]) { --insta-toolbox-backdrop-blur: 18px; }
      :host([data-launcher-size="large"]) { --insta-toolbox-launcher-size: 54px; }
      *, *::before, *::after { box-sizing: border-box; }
      button, input, select { font: inherit; }
      button, label, summary { cursor: pointer; }
      [hidden] { display: none !important; }
      .launcher { position: fixed; z-index: 2147482900; right: 16px; bottom: 16px; width: var(--insta-toolbox-launcher-size); height: var(--insta-toolbox-launcher-size); border: 1px solid var(--insta-toolbox-line, #cfd5cc); border-radius: 14px; background: color-mix(in srgb, var(--insta-toolbox-bg, #fff) var(--insta-toolbox-alpha), transparent); color: var(--insta-toolbox-text, #172018); box-shadow: var(--insta-toolbox-shadow-popover, 0 10px 32px rgba(0,0,0,.2)); font-weight: 850; cursor: grab; touch-action: none; }
      :host([data-launcher-floating="true"]) .launcher { top: var(--insta-toolbox-launcher-top); right: auto; bottom: auto; left: var(--insta-toolbox-launcher-left); }
      :host([data-layout-interaction="launcher"]) .launcher { cursor: grabbing; }
      .panel { animation: insta-toolbox-in var(--insta-toolbox-motion-fast, 120ms) var(--insta-toolbox-ease, ease) both; position: fixed; z-index: 2147482900; top: 62px; right: 16px; width: min(var(--insta-toolbox-width), calc(100vw - 24px)); height: min(var(--insta-toolbox-height), calc(100dvh - 74px)); display: flex; flex-direction: column; overflow: hidden; container-type: inline-size; border: 1px solid var(--insta-toolbox-line, #cfd5cc); border-radius: var(--insta-toolbox-radius-lg, 14px); background: color-mix(in srgb, var(--insta-toolbox-bg, #f7f8f5) var(--insta-toolbox-alpha), transparent); color: var(--insta-toolbox-text, #1b211c); box-shadow: var(--insta-toolbox-shadow-panel, 0 20px 60px rgba(0,0,0,.24)); backdrop-filter: blur(var(--insta-toolbox-backdrop-blur)) saturate(.95); -webkit-backdrop-filter: blur(var(--insta-toolbox-backdrop-blur)) saturate(.95); font: var(--insta-toolbox-text-md, 14px)/var(--insta-toolbox-leading-md, 20px) var(--insta-toolbox-font, "Segoe UI Variable", "Segoe UI", system-ui, sans-serif); }
      :host([data-floating="true"]) .panel { top: var(--insta-toolbox-top); right: auto; left: var(--insta-toolbox-left); }
      .header { display: grid; grid-template-columns: auto minmax(0,1fr) auto; gap: 4px; align-items: center; height: 52px; min-height: 52px; padding: 4px 6px; border-bottom: 1px solid var(--insta-toolbox-line, #d8ddd4); background: color-mix(in srgb, var(--insta-toolbox-bg, #fff) var(--insta-toolbox-alpha-strong), transparent); }
      .handle, .icon { width: 44px; height: 44px; display: grid; place-items: center; border: 0; border-radius: 9px; background: transparent; color: inherit; }
      .handle { cursor: grab; touch-action: none; font-size: 20px; min-width: 44px; min-height: 44px; display: inline-flex; align-items: center; justify-content: center; border-radius: 8px; }
      .handle:hover { background: color-mix(in srgb, var(--insta-toolbox-text, #000) 8%, transparent); }
      .handle:active { cursor: grabbing; background: color-mix(in srgb, var(--insta-toolbox-text, #000) 14%, transparent); }
      /* The whole header bar drags, so the grip is a hint rather than the only target. */
      .header { cursor: grab; }
      .header:active { cursor: grabbing; }
      .header button, .header select, .header summary, .header input { cursor: default; }
      .header h1 { margin: 0; min-width: 0; overflow-wrap: normal; word-break: keep-all; font-size: 16px; line-height: 1.15; white-space: nowrap; }
      .tabs { display: grid; grid-template-columns: repeat(3,minmax(44px,1fr)); border-bottom: 1px solid var(--insta-toolbox-line, #d8ddd4); background: color-mix(in srgb, var(--insta-toolbox-bg-sunken, #eef1ec) var(--insta-toolbox-alpha-strong), transparent); }
      .tab { position: relative; transition: background var(--insta-toolbox-motion-fast, 120ms) var(--insta-toolbox-ease, ease), color var(--insta-toolbox-motion-fast, 120ms) var(--insta-toolbox-ease, ease); min-height: 48px; border: 0; border-bottom: 3px solid transparent; padding: 6px 3px; background: transparent; color: var(--insta-toolbox-text-muted, #616a61); font-size: 11px; font-weight: 700; }
      .tab[aria-selected="true"] { border-bottom-color: var(--insta-toolbox-accent, #b83d67); color: var(--insta-toolbox-text, #172018); background: color-mix(in srgb, var(--insta-toolbox-bg-raised, #fff) 72%, transparent); }
      .scroll { flex: 1 1 auto; min-height: 0; overflow: auto; overscroll-behavior: contain; }
      .view { padding: 14px; }
      .lead { margin: 0 0 12px; color: var(--insta-toolbox-text-muted, #606960); font-size: 12px; }
      .card { margin-bottom: 10px; border: 1px solid var(--insta-toolbox-line, #d8ddd4); border-radius: 10px; padding: 12px; background: color-mix(in srgb, var(--insta-toolbox-bg-raised, #fff) var(--insta-toolbox-alpha-strong), transparent); }
      .card h2, .card h3 { margin: 0 0 6px; font-size: 15px; }
      .card p { margin: 4px 0 0; color: var(--insta-toolbox-text-muted, #687068); font-size: 12px; overflow-wrap: break-word; word-break: normal; }
      .card > strong, .card > span { display: block; }
      .card > strong + span { margin-top: 4px; }
      .metrics { display: grid; grid-template-columns: repeat(2,minmax(0,1fr)); gap: 8px; margin: 10px 0; }
      .metric { border: 1px solid var(--insta-toolbox-line, #d8ddd4); border-radius: 9px; padding: 10px; background: color-mix(in srgb, var(--insta-toolbox-bg-raised, #fff) var(--insta-toolbox-alpha-strong), transparent); }
      .metric span, .metric strong { display: block; }
      .metric span { color: var(--insta-toolbox-text-muted, #687068); font-size: 11px; }
      .metric strong { margin-top: 2px; font-size: 21px; }
      .field { display: grid; gap: 5px; margin: 10px 0; }
      .field label { color: var(--insta-toolbox-text-muted, #687068); font-size: 12px; }
      select, input[type="range"] { width: 100%; }
      select { min-height: 44px; border: 1px solid var(--insta-toolbox-line, #cfd5cc); border-radius: 8px; padding: 8px; background: var(--insta-toolbox-bg, #fff); color: var(--insta-toolbox-text, #1b211c); }
      select option { background: var(--insta-toolbox-bg, #fff); color: var(--insta-toolbox-text, #1b211c); }
      input, textarea { background: var(--insta-toolbox-bg, #fff); color: var(--insta-toolbox-text, #1b211c); border: 1px solid var(--insta-toolbox-line, #cfd5cc); border-radius: 8px; padding: 8px; }
      .toolbar { display: flex; flex-wrap: wrap; gap: 7px; margin: 10px 0; }
      .button, .file { min-height: 44px; display: inline-flex; align-items: center; justify-content: center; border: 1px solid var(--insta-toolbox-line, #243027); border-radius: 8px; padding: 8px 11px; background: var(--insta-toolbox-bg-sunken, #26362a); color: var(--insta-toolbox-text, #1b211c); font-weight: 720; text-decoration: none; }
      .button.quiet, .file.quiet { border-color: var(--insta-toolbox-line, #cfd5cc); background: color-mix(in srgb, var(--insta-toolbox-bg-raised, #fff) 72%, transparent); color: var(--insta-toolbox-text, #1b211c); }
      .file { position: relative; overflow: hidden; }
      .file input { position: absolute; inset: 0; opacity: 0; }
      .list { margin: 10px 0 0; padding: 0; border-top: 1px solid var(--insta-toolbox-line, #d8ddd4); list-style: none; }
      .list li { padding: 8px 0; border-bottom: 1px solid var(--insta-toolbox-line, #d8ddd4); overflow-wrap: break-word; word-break: normal; font-size: 12px; }
      .list small { display: block; margin-top: 2px; color: var(--insta-toolbox-text-muted, #687068); }
      .comparison-browser[hidden] { display: none; }
      .comparison-controls { display: grid; grid-template-columns: repeat(2,minmax(0,1fr)); gap: 8px; }
      .comparison-controls .field { margin: 0; }
      .comparison-count { margin: 10px 0 0; color: var(--insta-toolbox-text-muted, #687068); font-size: 12px; }
      .comparison-list strong { display: block; }
      .comparison-more { width: 100%; margin-top: 10px; }
      .notice { padding: 10px; border-left: 4px solid var(--insta-toolbox-warning, #ad7823); background: var(--insta-toolbox-bg-sunken, #fff4d6); color: var(--insta-toolbox-text, #62490f); font-size: 12px; }
      .range-row { display:grid; grid-template-columns: minmax(0,1fr) auto; gap: 8px; align-items:center; }
      .footer { height: 28px; min-height: 28px; display: flex; align-items: center; justify-content: center; padding: 3px 52px; border-top: 1px solid var(--insta-toolbox-line, #d8ddd4); background: color-mix(in srgb, var(--insta-toolbox-bg, #fff) var(--insta-toolbox-alpha-strong), transparent); color: var(--insta-toolbox-text-muted, #687068); font-size: 10px; line-height: 1; }
      .footer a { color: inherit; text-decoration: none; }
      .footer a:hover, .footer a:focus-visible { color: var(--insta-toolbox-text, #1b211c); text-decoration: underline; text-underline-offset: 2px; }
      .resize { position: absolute; bottom: 0; display: block; width: 44px; height: 44px; z-index: 5; border: 0; padding: 0; background: transparent; color: var(--insta-toolbox-text-muted, #687068); touch-action: none; }
      .resize.end { right: 0; border-radius: 10px 0 12px 0; cursor: nwse-resize; }
      .resize.start { left: 0; border-radius: 0 10px 0 12px; cursor: nesw-resize; }
      .resize::before { content:""; position:absolute; right:9px; bottom:9px; width:12px; height:12px; border-right:2px solid currentColor; border-bottom:2px solid currentColor; opacity:.9; }
      .resize.start::before { right:auto; left:9px; border-right:0; border-left:2px solid currentColor; }
      .resize:hover { background: color-mix(in srgb, var(--insta-toolbox-accent, #b83d67) 12%, transparent); color: var(--insta-toolbox-text, #1b211c); }
      button:focus-visible, select:focus-visible, input:focus-visible, summary:focus-visible, .file:focus-within { outline: 3px solid var(--insta-toolbox-focus, #b83d67); outline-offset: 2px; }
      .tab:focus-visible { outline: 0; outline-offset: 0; box-shadow: inset 0 -3px 0 var(--insta-toolbox-focus, #b83d67); }
      @media (max-width: 600px) { .panel { top:auto; right:0; bottom:0; left:0; width:100%; height:min(78dvh,720px); border-radius:14px 14px 0 0; } .handle,.resize { display:none; } .header { grid-template-columns:minmax(0,1fr) auto; } }
      @container (max-width: 420px) { .comparison-controls { grid-template-columns: minmax(0,1fr); } }
      @container (max-width: 330px) { .header h1 { font-size:14px; } }
      @media (prefers-reduced-motion: reduce) { * { scroll-behavior:auto !important; } }
      .step, .context, .review, .card { transition: border-color var(--insta-toolbox-motion-base, 180ms) var(--insta-toolbox-ease, ease); }
      .scan-progress .run-bar span { transition: width var(--insta-toolbox-motion-base, 180ms) var(--insta-toolbox-ease, ease); }
      .scan-progress .run-bar[data-indeterminate="true"] span { width: 100% !important; background: repeating-linear-gradient(135deg, var(--insta-toolbox-accent, #b83d67) 0 8px, transparent 8px 14px); opacity: .72; }
      /* A finished run should register without stealing attention. */
      .run-panel[data-finished="true"] .run-bar span { transition: width var(--insta-toolbox-motion-slow, 240ms) var(--insta-toolbox-ease, ease); }
      @media (prefers-reduced-motion: reduce) {
        .step, .context, .review, .card, .settings-inline > summary::after, .scan-progress .run-bar span, .run-panel[data-finished="true"] .run-bar span { transition: none; }
      }
      .review { margin-bottom: 12px; padding: 10px; border: 1px solid var(--insta-toolbox-line, #d8ddd4); border-radius: 10px; }
      .review strong { display: block; margin-bottom: 6px; font-size: 13px; }
      .list--compact { max-height: 132px; overflow-y: auto; }
      .steps { display: grid; gap: 8px; margin: 0 0 12px; padding: 0; list-style: none; }
      .step { display: grid; grid-template-columns: auto minmax(0,1fr) auto; gap: 10px; align-items: center; padding: 10px; border: 1px solid var(--insta-toolbox-line, #d8ddd4); border-radius: 10px; }
      .step[data-state="done"] { border-color: var(--insta-toolbox-success, #0a7d3f); }
      .step[data-state="partial"] { border-color: var(--insta-toolbox-warning, #b26a00); }
      .step-num { display: inline-flex; width: 24px; height: 24px; align-items: center; justify-content: center; border-radius: 50%; background: var(--insta-toolbox-bg-sunken, #eef1ec); font-size: 12px; font-weight: 600; }
      .step[data-state="done"] .step-num { background: var(--insta-toolbox-success, #0a7d3f); color: #fff; }
      .step-body strong { display: block; font-size: 13px; }
      .step-body span { display: block; color: var(--insta-toolbox-text-muted, #687068); font-size: 12px; }
      .scan-progress { margin-bottom: 12px; }
      .settings-inline { margin-top: 10px; border-top: 1px solid var(--insta-toolbox-line, #d8ddd4); }
      .settings-inline > summary { min-height: 44px; display: flex; align-items: center; justify-content: space-between; gap: 10px; font-size: 13px; cursor: pointer; list-style: none; }
      .settings-inline > summary::-webkit-details-marker { display: none; }
      .settings-inline > summary::after { content: ""; flex: 0 0 auto; width: 0; height: 0; border-top: 5px solid transparent; border-bottom: 5px solid transparent; border-left: 7px solid currentColor; color: var(--insta-toolbox-text-muted, #687068); transition: transform var(--insta-toolbox-motion-fast, 120ms) var(--insta-toolbox-ease, ease); }
      .settings-inline[open] > summary::after { transform: rotate(90deg); }
      .header, .context, .tabs, .run-panel, .footer { flex: 0 0 auto; }
      .header, .footer { position: relative; z-index: 1; }
      input:not([type="range"]):not([type="checkbox"]), select, textarea { min-height: 44px; box-sizing: border-box; }
      .field input[type="range"] { min-height: 24px; }
      .field input[type="checkbox"] { min-width: 20px; min-height: 20px; }
      /* The checkbox itself stays small; its label carries the 44px target. */
      .field label { display: inline-flex; align-items: center; min-height: 44px; }
      .context { display: grid; grid-template-columns: auto minmax(0,1fr) auto; gap: 8px; min-height: 44px; max-height: 52px; align-items: center; overflow: hidden; padding: 5px 10px; border-bottom: 1px solid var(--insta-toolbox-line, #d8ddd4); background: var(--insta-toolbox-bg-sunken, #eef1ec); color: var(--insta-toolbox-text, #1b211c); }
      .context-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--insta-toolbox-text-muted, #687068); }
      .context[data-tone="ready"] .context-dot { background: var(--insta-toolbox-success, #0a7d3f); }
      .context[data-tone="warning"] .context-dot { background: var(--insta-toolbox-warning, #b26a00); }
      .context[data-tone="blocked"] .context-dot { background: var(--insta-toolbox-danger, #8c1d1d); }
      .context-copy { min-width: 0; }
      .context-copy strong { display: block; overflow: hidden; color: var(--insta-toolbox-text, #1b211c) !important; font-size: 12px; text-overflow: ellipsis; white-space: nowrap; }
      .context-copy span { display: -webkit-box; overflow: hidden; color: var(--insta-toolbox-text-muted, #687068) !important; font-size: 11px; overflow-wrap: break-word; word-break: normal; -webkit-box-orient: vertical; -webkit-line-clamp: 2; }
      .context-cta { white-space: nowrap; }
      .run-panel { padding: 10px 12px; border-top: 1px solid var(--insta-toolbox-line, #d8ddd4); background: color-mix(in srgb, var(--insta-toolbox-bg, #fff) var(--insta-toolbox-alpha-strong), transparent); }
      .run-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
      .run-head strong { font-size: 12px; overflow-wrap: break-word; word-break: normal; }
      .run-bar { overflow: hidden; height: 5px; margin: 8px 0 6px; border-radius: 999px; background: var(--insta-toolbox-line, #d8ddd4); }
      .run-bar span { display: block; width: 0%; height: 100%; border-radius: 999px; background: var(--insta-toolbox-accent, #b83d67); transition: width var(--insta-toolbox-motion-base, 180ms) var(--insta-toolbox-ease, ease); }
      .run-panel .list { max-height: 118px; overflow-y: auto; }
      .button.danger { background: var(--insta-toolbox-danger, #b42318); color: var(--insta-toolbox-on-danger, #fff); }
      .button.primary { background: var(--insta-toolbox-accent, #b83d67); color: var(--insta-toolbox-on-accent, #fff); border: 0; font-weight: 600; }
      .button.primary:hover { filter: brightness(1.08); }
      .button.big { width: 100%; padding: 10px 12px; font-size: var(--system-14-font-size, 14px); line-height: var(--system-14-line-height, 18px); border-radius: 8px; }
      .button:disabled { cursor: not-allowed; filter: none; opacity: .48; }
      .confirm-dialog { width: min(420px, calc(100vw - 28px)); max-height: min(620px, calc(100vh - 28px)); box-sizing: border-box; overflow: auto; border: 1px solid var(--insta-toolbox-line, #d8ddd4); border-radius: 14px; padding: 0; background: var(--insta-toolbox-bg-raised, #fff); color: var(--insta-toolbox-text, #1b211c); box-shadow: var(--insta-toolbox-shadow-panel); }
      .confirm-dialog::backdrop { background: rgba(0, 0, 0, .62); }
      .confirm-dialog form { display: grid; gap: 12px; margin: 0; padding: 18px; }
      .confirm-dialog h2 { margin: 0; font-size: 18px; line-height: 24px; overflow-wrap: break-word; }
      .confirm-dialog p { margin: 0; color: var(--insta-toolbox-text-muted, #687068); font-size: 13px; line-height: 19px; overflow-wrap: anywhere; white-space: pre-line; }
      .confirm-dialog dl { display: grid; grid-template-columns: max-content minmax(0, 1fr); gap: 5px 10px; margin: 0; font-size: 13px; line-height: 19px; }
      .confirm-dialog dt { color: var(--insta-toolbox-text-muted, #687068); font-weight: 600; }
      .confirm-dialog dd { min-width: 0; margin: 0; overflow-wrap: anywhere; }
      .confirm-dialog ul { max-height: 160px; margin: 0; padding: 8px 8px 8px 30px; overflow-y: auto; border: 1px solid var(--insta-toolbox-line, #d8ddd4); border-radius: 8px; font-size: 13px; line-height: 19px; }
      .confirm-dialog .toolbar { justify-content: flex-end; }
      .settings-dialog { width: min(360px, calc(100vw - 28px)); max-height: min(680px, calc(100dvh - 28px)); box-sizing: border-box; overflow: auto; border: 1px solid var(--insta-toolbox-line, #d8ddd4); border-radius: 14px; padding: 0; background: var(--insta-toolbox-bg-raised, #fff); color: var(--insta-toolbox-text, #1b211c); box-shadow: var(--insta-toolbox-shadow-panel); }
      .settings-dialog::backdrop { background: rgba(12,14,12,.44); backdrop-filter: grayscale(.65) blur(1px); }
      .settings-dialog form { display: grid; gap: 12px; margin: 0; padding: 18px; }
      .settings-heading { display:flex; align-items:center; justify-content:space-between; gap:12px; }
      .settings-heading h2 { margin:0; font-size:18px; line-height:24px; }
      .settings-dialog .lead { margin:-4px 0 2px; }
      .settings-dialog .toolbar { margin:0; }
      @keyframes insta-toolbox-in { from { opacity: 0; transform: translateY(-4px); } to { opacity: 1; transform: none; } }
      @media (prefers-reduced-motion: reduce) { .run-bar span, .tab, .button { transition: none; } .panel { animation: none; } }
      @media (forced-colors: active) { .panel,.card,.tool,.metric,.header,.footer,.run-panel,.confirm-dialog,.settings-dialog { background:Canvas; } .panel,.card,.tool,.metric,.confirm-dialog,.settings-dialog { border:2px solid CanvasText; } .tab:focus-visible { outline:2px solid Highlight; outline-offset:-3px; box-shadow:none; } }
    </style>
    <button class="launcher" type="button" data-action="open" aria-label="Open Insta Toolbox; drag or use arrow keys to move" aria-expanded="false" title="Drag to move · Click to open">IT</button>
    <aside class="panel" aria-label="Insta Toolbox" hidden>
      <header class="header">
        <button class="handle" type="button" data-role="move" aria-label="Move toolbox; use arrow keys for precise movement" title="Drag to move">✥</button>
        <h1>Insta Toolbox</h1>
        <div style="display:flex">
          <button class="icon" type="button" data-action="open-settings" data-role="settings-button" aria-label="Customize Insta Toolbox" aria-haspopup="dialog" aria-expanded="false">⚙</button>
          <button class="icon" type="button" data-action="close" aria-label="Collapse Insta Toolbox">×</button>
        </div>
      </header>
      <div class="context" data-role="context">
        <span class="context-dot" data-role="context-dot"></span>
        <div class="context-copy" role="status" aria-live="polite" aria-atomic="true"><strong data-role="context-title">Checking this page…</strong> <span data-role="context-detail"></span></div>
        <button class="button quiet context-cta" type="button" data-action="context-cta" data-role="context-cta" hidden></button>
      </div>
      <nav class="tabs" role="tablist" aria-label="Insta Toolbox tools">
        <button id="insta-toolbox-tab-checker" class="tab" type="button" role="tab" data-view="checker" aria-controls="insta-toolbox-panel-checker" aria-selected="true" tabindex="0">Mutual Checker</button>
        <button id="insta-toolbox-tab-account" class="tab" type="button" role="tab" data-view="account" aria-controls="insta-toolbox-panel-account" aria-selected="false" tabindex="-1">Follow / Unfollow</button>
        <button id="insta-toolbox-tab-messages" class="tab" type="button" role="tab" data-view="messages" aria-controls="insta-toolbox-panel-messages" aria-selected="false" tabindex="-1">DM Unsend</button>
      </nav>
      <div class="scroll">
        <section id="insta-toolbox-panel-checker" class="view" role="tabpanel" aria-labelledby="insta-toolbox-tab-checker" data-panel="checker" hidden><section class="card" aria-labelledby="insta-toolbox-checker-account-title"><h2 id="insta-toolbox-checker-account-title">Check mutuals</h2><p>Read-only. Uses the Instagram session in this tab.</p><div class="field"><label for="insta-toolbox-checker-username">Instagram username</label><input id="insta-toolbox-checker-username" type="text" inputmode="text" autocomplete="username" autocapitalize="none" spellcheck="false" placeholder="your_username" data-role="checker-username"></div><div class="toolbar"><button class="button primary" type="button" data-action="check-account-relationships" data-role="checker-run">Check mutuals</button></div></section>
          <div class="scan-progress" data-role="scan-progress" hidden><div class="run-bar" data-role="scan-bar" role="progressbar" aria-label="Mutual check progress" aria-describedby="insta-toolbox-scan-detail" aria-valuemin="0" aria-valuemax="100"><span data-role="scan-fill"></span></div><p id="insta-toolbox-scan-detail" class="lead" data-role="scan-detail"></p></div>
          <div class="card" data-role="comparison"></div>
          <section class="card comparison-browser" data-role="comparison-browser" aria-labelledby="insta-toolbox-comparison-browser-title" hidden><h2 id="insta-toolbox-comparison-browser-title">Comparison list</h2><div class="comparison-controls"><div class="field"><label for="insta-toolbox-comparison-category">Show accounts</label><select id="insta-toolbox-comparison-category" data-role="comparison-category" aria-controls="insta-toolbox-comparison-list"><option value="not-following-me-back">Don't follow you back</option><option value="i-do-not-follow-back">You don't follow back</option><option value="mutuals">Mutuals</option></select></div><div class="field"><label for="insta-toolbox-filter">Find a username</label><input id="insta-toolbox-filter" type="search" inputmode="search" autocomplete="off" spellcheck="false" placeholder="Search usernames" data-role="result-filter" aria-controls="insta-toolbox-comparison-list"></div></div><p id="insta-toolbox-comparison-count" class="comparison-count" data-role="comparison-count" tabindex="-1"></p><ul id="insta-toolbox-comparison-list" class="list comparison-list" data-role="comparison-list" aria-describedby="insta-toolbox-comparison-count"></ul><button class="button quiet comparison-more" type="button" data-action="show-more-comparison" data-role="comparison-more" hidden>Show more</button></section>
          <details class="settings-inline"><summary>Capture lists and export</summary><p class="lead">If the account check fails, open Followers or Following and scan that list.</p><ol class="steps" data-role="checker-steps"><li class="step" data-step="following"><span class="step-num">1</span><div class="step-body"><strong>Scan Following</strong><span data-role="step-following">Not scanned yet</span></div><button class="button quiet" type="button" data-action="scan-following">Scan Following</button></li><li class="step" data-step="followers"><span class="step-num">2</span><div class="step-body"><strong>Scan Followers</strong><span data-role="step-followers">Not scanned yet</span></div><button class="button quiet" type="button" data-action="scan-followers">Scan Followers</button></li><li class="step" data-step="compare"><span class="step-num">3</span><div class="step-body"><strong>Compare</strong><span data-role="step-compare">Scan both lists first</span></div></li></ol><ul class="list" data-role="capture-list"></ul><div class="toolbar"><button class="button quiet" type="button" data-action="capture">Capture visible rows</button><button class="button quiet" type="button" data-action="download-list">Download raw list</button><button class="button quiet" type="button" data-action="download-comparison-json">Download JSON</button><button class="button quiet" type="button" data-action="clear-capture">Clear checker</button></div><div class="field"><label for="insta-toolbox-list-type">Raw list</label><select id="insta-toolbox-list-type" data-role="list-type"><option value="following">Following</option><option value="followers">Followers</option></select></div></details></section>
        <section id="insta-toolbox-panel-account" class="view" role="tabpanel" aria-labelledby="insta-toolbox-tab-account" data-panel="account" hidden><p class="lead"><strong>Follow / Unfollow.</strong> Choose an action, then review the accounts. Review never clicks.</p><div class="card" data-role="queue-current"></div>
          <div class="toolbar"><button class="button primary" type="button" data-action="account-dry-run">Refresh profile status</button><button class="button quiet" type="button" data-action="open-profile">Open profile</button></div><details class="settings-inline"><summary>Queue and files</summary><div class="toolbar"><button class="button quiet" type="button" data-action="queue-complete">Complete</button><button class="button quiet" type="button" data-action="queue-skip">Skip</button></div><div class="toolbar"><label class="file quiet">Import queue JSON<input type="file" accept=".json,application/json" data-file="queue"></label><button class="button quiet" type="button" data-action="export-queue">Export queue state</button></div></details><div class="card" data-role="account-result"></div>
          <div class="field"><label for="insta-toolbox-bot-action">What do you want to do?</label><select id="insta-toolbox-bot-action" data-role="bot-action"><option value="follow">Follow people</option><option value="unfollow">Unfollow people</option></select></div>
          <div class="field"><label for="insta-toolbox-bot-source">Target source</label><select id="insta-toolbox-bot-source" data-role="bot-source"><option value="current-profile">Current profile</option><option value="i-do-not-follow-back">Followers you do not follow</option><option value="scanned-followers">Scanned Followers</option><option value="queue">Queue items</option></select></div>
          <div class="field" data-role="bot-count-field"><label for="insta-toolbox-bot-count">Count</label><input id="insta-toolbox-bot-count" type="number" min="1" max="250" value="20" data-role="bot-count"></div>
          <p class="lead" data-role="account-run-summary">Choose a source, then review the accounts.</p><div class="toolbar"><button class="button primary big" type="button" data-action="review-accounts" data-role="account-run-primary">Review 20 Follow targets</button></div><div class="review" data-role="run-review" hidden><strong data-role="review-title"></strong><ul class="list list--compact" data-role="review-list"></ul><p class="lead" data-role="review-skips"></p></div>
          <p class="notice">One profile at a time. Stops on blocks, rate limits, or unexpected pages.</p></section>
        <section id="insta-toolbox-panel-messages" class="view" role="tabpanel" aria-labelledby="insta-toolbox-tab-messages" data-panel="messages" hidden><p class="lead"><strong>DM Unsend.</strong> Remove messages you sent from this conversation.</p><div class="toolbar"><button class="button danger big" type="button" data-action="run-unsend" data-role="unsend-primary">Unsend DMs</button></div>
          <div class="card" data-role="dm-summary" hidden><strong data-role="dm-summary-title"></strong><span data-role="dm-summary-detail"></span></div>
          <details class="settings-inline"><summary>Message options</summary><div data-role="unsend-plan"><div class="field"><label for="insta-toolbox-unsend-scope">Scope</label><select id="insta-toolbox-unsend-scope" data-role="unsend-scope"><option value="all">All messages you sent</option><option value="newest">Newest N</option><option value="oldest">Oldest N</option></select></div><div class="field" data-role="unsend-count-field"><label for="insta-toolbox-unsend-count">Number of messages</label><input id="insta-toolbox-unsend-count" type="number" min="1" max="250" value="1" data-role="unsend-count"></div></div><div class="toolbar"><button class="button quiet" type="button" data-action="scan-sent">Check conversation</button><button class="button quiet" type="button" data-action="read-messages">Read visible thread</button><label class="file quiet">Import reviewed DM job<input type="file" accept=".json,application/json" data-file="dm"></label><button class="button quiet" type="button" data-action="dm-dry-run">Check exact message</button></div></details><div class="card" data-role="dm-result" hidden></div><ul class="list" data-role="message-list" hidden></ul><p class="notice">Only your messages are touched. The run stops on the wrong thread, an unclear menu, or any Instagram warning.</p></section>
      </div>
      <div class="run-panel" data-role="run-panel" hidden><div class="run-head"><strong data-role="run-title"></strong><button class="button danger" type="button" data-action="stop-run" data-role="stop-run">Stop</button></div><div class="run-bar"><span data-role="run-fill"></span></div><p class="lead" data-role="run-detail"></p><ul class="list" data-role="run-results"></ul></div>
      <footer class="footer"><a href="https://github.com/slaveofsolace" target="_blank" rel="noopener noreferrer">created by @slaveofsolace</a></footer>
      <button class="resize start" type="button" data-role="resize-start" aria-label="Resize Insta Toolbox from the lower-left corner; use arrow keys for precise sizing" title="Drag to resize · Arrow keys resize"></button>
      <button class="resize end" type="button" data-role="resize-end" aria-label="Resize Insta Toolbox from the lower-right corner; use arrow keys for precise sizing" title="Drag to resize · Arrow keys resize"></button>
    </aside>
    <dialog class="settings-dialog" data-role="settings-dialog" aria-labelledby="insta-toolbox-settings-title" aria-describedby="insta-toolbox-settings-note">
      <form>
        <div class="settings-heading"><h2 id="insta-toolbox-settings-title">Customize Insta Toolbox</h2><button class="icon" type="button" data-action="close-settings" aria-label="Close customization">×</button></div>
        <p class="lead" id="insta-toolbox-settings-note">Saved in this browser.</p>
        <div class="field"><label for="insta-toolbox-accent">Accent</label><select id="insta-toolbox-accent" data-preference="accent"><option value="rose">Rose</option><option value="violet">Violet</option><option value="blue">Blue</option></select></div>
        <div class="field"><label for="insta-toolbox-blur">Background blur</label><select id="insta-toolbox-blur" data-preference="blur"><option value="none">Off</option><option value="soft">Soft</option><option value="strong">Strong</option></select></div>
        <div class="field"><label for="insta-toolbox-launcher-size">Collapsed button</label><select id="insta-toolbox-launcher-size" data-preference="launcherSize"><option value="standard">Standard</option><option value="large">Large</option></select></div>
        <div class="field"><label for="insta-toolbox-opacity">Surface transparency</label><div class="range-row"><input id="insta-toolbox-opacity" type="range" min="55" max="100" value="88" data-preference="opacity"><output data-role="opacity-output">88%</output></div></div>
        <div class="field"><label>Size presets</label><div class="toolbar"><button class="button quiet" type="button" data-action="layout-compact">Compact</button><button class="button quiet" type="button" data-action="layout-tall">Tall</button><button class="button quiet" type="button" data-action="layout-wide">Wide</button></div></div>
        <button class="button quiet" type="button" data-action="reset-layout">Reset panel and collapsed button</button>
        <details class="settings-inline"><summary>Advanced controls</summary><strong>Pacing</strong><div class="field"><label for="insta-toolbox-limit-min">Min delay (seconds)</label><input id="insta-toolbox-limit-min" type="number" min="1" max="600" data-role="limit-min"></div><div class="field"><label for="insta-toolbox-limit-max">Max delay (seconds)</label><input id="insta-toolbox-limit-max" type="number" min="1" max="900" data-role="limit-max"></div><button class="button quiet" type="button" data-action="save-limits">Save pacing</button></details>
        <p class="lead">Drag the collapsed IT button anywhere. Resize the open panel from either lower corner. Arrow keys work on the focused control. Shortcut: Alt + Shift + I.</p>
      </form>
    </dialog>
    <dialog class="confirm-dialog" data-role="action-confirmation" aria-labelledby="insta-toolbox-confirm-title" aria-describedby="insta-toolbox-confirm-message insta-toolbox-confirm-detail">
      <form>
        <h2 id="insta-toolbox-confirm-title" data-role="confirm-title">Confirm action</h2>
        <p id="insta-toolbox-confirm-message" data-role="confirm-message"></p>
        <dl data-role="confirm-facts" hidden></dl>
        <ul data-role="confirm-items" aria-label="Reviewed targets" hidden></ul>
        <p id="insta-toolbox-confirm-detail" data-role="confirm-detail"></p>
        <div class="toolbar"><button class="button quiet" type="button" data-action="confirm-cancel" data-role="confirm-cancel">Cancel</button><button class="button danger" type="button" data-action="confirm-accept" data-role="confirm-accept">Confirm</button></div>
      </form>
    </dialog>`;

  const query = (selector) => shadow.querySelector(selector);
  const queryAll = (selector) => [...shadow.querySelectorAll(selector)];
  const setText = (role, value) => {
    const element = query(`[data-role="${role}"]`);
    if (element) element.textContent = String(value ?? '');
  };
  let contextStatus = null;
  let contextStatusTimer = null;
  const statusTone = (message) => {
    const text = safeText(message).toLocaleLowerCase();
    if (/blocked|could not|disabled|error|expired|failed|rate limit|security check|signed out|unclear|unavailable|wrong thread/.test(text)) return 'blocked';
    if (/captured|checked|complete|detected|done|finished|imported|loaded|marked|ready|reviewed|saved|scanned|unsent/.test(text)) return 'ready';
    return 'warning';
  };
  const status = (message, tone = '') => {
    const text = safeText(message);
    contextStatus = text ? { message: text, tone: tone || statusTone(text) } : null;
    clearTimeout(contextStatusTimer);
    contextStatusTimer = null;
    if (contextStatus) {
      contextStatusTimer = setTimeout(() => {
        contextStatus = null;
        contextStatusTimer = null;
        renderContext();
      }, 10_000);
    }
    renderContext();
  };

  function announceComparisonCount() {
    const message = safeText(query('[data-role="comparison-count"]')?.textContent);
    clearTimeout(checkerResultAnnouncementTimer);
    checkerResultAnnouncementTimer = null;
    if (!message || message === checkerResultAnnouncement) return;
    checkerResultAnnouncementTimer = setTimeout(() => {
      checkerResultAnnouncement = message;
      checkerResultAnnouncementTimer = null;
      status(message, 'neutral');
    }, 250);
  }

  const confirmationController = globalThis.InstaToolboxActionConfirmation?.createController({
    root: shadow,
    attribute: 'data-role',
    status,
    unavailableTone: 'blocked',
  });
  const confirmRun = (request) => confirmationController?.confirm(request) ?? Promise.resolve(null);

  function panelSize() {
    return {
      width: Math.min(preferences.width, Math.max(WIDTH_MIN, innerWidth - (INSET * 2))),
      height: Math.min(preferences.height, Math.max(HEIGHT_MIN, innerHeight - (INSET * 2))),
    };
  }

  function constrainedPosition(position, size = panelSize()) {
    return {
      x: Math.round(clamp(position.x, INSET, Math.max(INSET, innerWidth - size.width - INSET))),
      y: Math.round(clamp(position.y, INSET, Math.max(INSET, innerHeight - size.height - INSET))),
    };
  }

  function launcherDimensions() {
    const side = preferences.launcherSize === 'large' ? 54 : 46;
    return { width: side, height: side };
  }

  function applyLayout() {
    const size = panelSize();
    host.style.setProperty('--insta-toolbox-width', `${size.width}px`);
    host.style.setProperty('--insta-toolbox-height', `${size.height}px`);
    const percent = Math.round(preferences.opacity * 100);
    host.style.setProperty('--insta-toolbox-alpha', `${percent}%`);
    host.style.setProperty('--insta-toolbox-alpha-strong', `${Math.min(100, percent + 8)}%`);
    host.dataset.accent = preferences.accent;
    host.dataset.blur = preferences.blur;
    host.dataset.launcherSize = preferences.launcherSize;
    if (preferences.launcherPosition) {
      const launcherPosition = constrainedPosition(
        preferences.launcherPosition,
        launcherDimensions(),
      );
      host.dataset.launcherFloating = 'true';
      host.style.setProperty('--insta-toolbox-launcher-left', `${launcherPosition.x}px`);
      host.style.setProperty('--insta-toolbox-launcher-top', `${launcherPosition.y}px`);
    } else {
      host.dataset.launcherFloating = 'false';
      host.style.removeProperty('--insta-toolbox-launcher-left');
      host.style.removeProperty('--insta-toolbox-launcher-top');
    }
    if (preferences.position && innerWidth > 600) {
      const position = constrainedPosition(preferences.position, size);
      host.dataset.floating = 'true';
      host.style.setProperty('--insta-toolbox-left', `${position.x}px`);
      host.style.setProperty('--insta-toolbox-top', `${position.y}px`);
    } else {
      host.dataset.floating = 'false';
      host.style.removeProperty('--insta-toolbox-left');
      host.style.removeProperty('--insta-toolbox-top');
    }
    const opacity = query('[data-preference="opacity"]');
    if (opacity) opacity.value = String(percent);
    for (const control of queryAll('[data-preference]')) {
      const preference = control.dataset.preference;
      if (preference !== 'opacity' && preferences[preference] !== undefined) {
        control.value = preferences[preference];
      }
    }
    setText('opacity-output', `${percent}%`);
  }

  function renderShellState() {
    const panel = query('.panel');
    const launcher = query('.launcher');
    const opening = preferences.open && panel.hidden;
    const closing = !preferences.open && !panel.hidden;
    if (opening) lastFocusedElement = shadow.activeElement || document.activeElement;
    panel.hidden = !preferences.open;
    launcher.hidden = preferences.open;
    launcher.setAttribute('aria-expanded', String(preferences.open));
    if (!preferences.open) setSettingsOpen(false);
    for (const tab of queryAll('[data-view]')) {
      const selected = tab.dataset.view === preferences.view;
      tab.setAttribute('aria-selected', String(selected));
      tab.tabIndex = selected ? 0 : -1;
    }
    for (const view of queryAll('[data-panel]')) view.hidden = view.dataset.panel !== preferences.view;
    if (opening) {
      requestAnimationFrame(() => {
        if (!preferences.open) return;
        query(`[data-view="${preferences.view}"]`)?.focus({ preventScroll: true });
      });
    } else if (closing) {
      setTimeout(() => {
        if (preferences.open) return;
        const restoreTarget = (
          lastFocusedElement
          && typeof lastFocusedElement.focus === 'function'
          && lastFocusedElement.isConnected
          && lastFocusedElement !== document.body
          && lastFocusedElement !== document.documentElement
        ) ? lastFocusedElement : launcher;
        restoreTarget.focus({ preventScroll: true });
        lastFocusedElement = null;
      }, 0);
    }
  }

  function setSettingsOpen(open) {
    const dialog = query('[data-role="settings-dialog"]');
    const button = query('[data-role="settings-button"]');
    if (!dialog || !button) return;
    const shouldOpen = Boolean(open);
    button.setAttribute('aria-expanded', String(shouldOpen));
    if (shouldOpen && !dialog.open) {
      dialog.showModal();
      requestAnimationFrame(() => query('#insta-toolbox-accent')?.focus({ preventScroll: true }));
    } else if (!shouldOpen && dialog.open) {
      dialog.close();
    }
  }

  function onSettingsDialogClick(event) {
    if (event.target === event.currentTarget) setSettingsOpen(false);
  }

  function onSettingsDialogClose() {
    query('[data-role="settings-button"]')?.setAttribute('aria-expanded', 'false');
  }

  function renderChecker() {
    const verifiedFollowers = verifiedCapture('followers');
    const verifiedFollowing = verifiedCapture('following');
    const comparisonReady = comparisonIsReady();
    const authenticatedCheck = state.capture.source?.followers === 'authenticated-web'
      && state.capture.source?.following === 'authenticated-web';
    const usernameInput = query('[data-role="checker-username"]');
    if (usernameInput && document.activeElement !== usernameInput && !usernameInput.value) {
      usernameInput.value = state.capture.subjectUsername
        || engine?.detectAuthenticatedUsername?.()
        || '';
    }
    const runButton = query('[data-role="checker-run"]');
    if (runButton) {
      runButton.textContent = relationshipController
        ? 'Stop mutual check'
        : 'Check Followers + Following';
      runButton.classList.toggle('danger', Boolean(relationshipController));
      runButton.classList.toggle('primary', !relationshipController);
    }
    setText('followers-count', formatCount(verifiedFollowers.length));
    setText('following-count', formatCount(verifiedFollowing.length));
    const comparison = compareCapture();
    const result = query('[data-role="comparison"]');
    result.replaceChildren();
    const title = document.createElement('h2');
    title.textContent = comparisonReady
      ? authenticatedCheck ? `Account comparison${state.capture.subjectUsername ? ` · @${state.capture.subjectUsername}` : ''}` : 'Scanned-list comparison'
      : 'No comparison loaded';
    const detail = document.createElement('p');
    detail.textContent = comparisonReady
      ? `${formatCount(verifiedFollowers.length)} followers · ${formatCount(verifiedFollowing.length)} following · ${formatCount(comparison.mutuals.length)} mutual · ${formatCount(comparison.notFollowingMeBack.length)} don't follow you back · ${formatCount(comparison.iDoNotFollowBack.length)} you don't follow back.`
      : 'Both lists must be complete before comparing. Run Check mutuals to load them.';
    result.append(title, detail);

    // A scan that stopped early would otherwise be read as the whole list, and
    // every number below it would quietly be wrong.
    const partial = ['followers', 'following']
      .filter((type) => state.capture.verified?.[type] === true
        && state.capture.complete?.[type] !== true);
    if (partial.length) {
      const warning = document.createElement('p');
      warning.className = 'notice';
      warning.textContent = `Incomplete ${partial.join(' and ')}: some accounts may be missing. Comparison withheld to avoid false non-mutuals. Captured rows are under Advanced.`;
      result.append(warning);
    }

    const unverified = ['followers', 'following']
      .filter((type) => state.capture[type].length && state.capture.verified?.[type] !== true);
    if (unverified.length) {
      const warning = document.createElement('p');
      warning.className = 'notice';
      warning.textContent = `Saved ${unverified.join(' and ')} rows were captured before exact dialog verification. They remain available under Advanced for export, but cannot drive comparisons or runs until rescanned.`;
      result.append(warning);
    }

    if (comparisonReady) {
      const actions = document.createElement('div');
      actions.className = 'toolbar';
      const button = document.createElement('button');
      button.className = 'button quiet';
      button.type = 'button';
      button.dataset.role = 'comparison-report-download';
      button.textContent = 'Download comparison report';
      button.addEventListener('click', () => {
        const generatedAt = nowIso();
        downloadText(
          `insta-toolbox-mutual-comparison-${generatedAt.replace(/[:.]/g, '-')}.txt`,
          engine.followerComparisonReport(state.capture, comparison, generatedAt),
        );
      });
      actions.append(button);
      result.append(actions);
    }

    const browser = query('[data-role="comparison-browser"]');
    const comparisonList = query('[data-role="comparison-list"]');
    const comparisonCount = query('[data-role="comparison-count"]');
    const showMore = query('[data-role="comparison-more"]');
    if (browser && comparisonList && comparisonCount && showMore) {
      browser.hidden = !comparisonReady;
      comparisonList.replaceChildren();
      if (comparisonReady) {
        const selection = comparisonBrowserSelection(comparison);
        comparisonCount.textContent = selection.total
          ? `Showing ${formatCount(selection.accounts.length)} of ${formatCount(selection.total)} ${selection.total === 1 ? 'account' : 'accounts'}.`
          : '0 accounts.';
        for (const account of selection.accounts) {
          const row = document.createElement('li');
          const username = document.createElement('strong');
          username.textContent = `@${account.username}`;
          row.append(username);
          if (account.displayName && account.displayName !== account.username) {
            const displayName = document.createElement('small');
            displayName.textContent = account.displayName;
            row.append(displayName);
          }
          comparisonList.append(row);
        }
        if (!selection.total) {
          const empty = document.createElement('li');
          empty.textContent = safeText(query('[data-role="result-filter"]')?.value)
            ? 'No captured account matches this search.'
            : 'No accounts are in this comparison group.';
          comparisonList.append(empty);
        }
        const remaining = Math.max(0, selection.total - selection.accounts.length);
        showMore.hidden = remaining === 0;
        showMore.textContent = remaining
          ? `Show ${formatCount(Math.min(CHECKER_RESULTS_PAGE_SIZE, remaining))} more`
          : 'Show more';
      } else {
        comparisonCount.textContent = '';
        showMore.hidden = true;
      }
    }

    const listType = query('[data-role="list-type"]').value === 'followers' ? 'followers' : 'following';
    const list = query('[data-role="capture-list"]');
    list.replaceChildren();
    for (const account of state.capture[listType].slice(0, 12)) {
      const row = document.createElement('li');
      row.textContent = `@${account.username}`;
      list.append(row);
    }
    if (!state.capture[listType].length) {
      const row = document.createElement('li');
      row.textContent = `No ${listType} rows captured yet.`;
      list.append(row);
    }
  }

  function renderAccount() {
    const item = currentQueueItem();
    const current = query('[data-role="queue-current"]');
    current.replaceChildren();
    const title = document.createElement('h2');
    title.textContent = item ? `@${item.account.username}` : 'No queue item loaded';
    const detail = document.createElement('p');
    detail.textContent = item
      ? `${item.action} · ${item.status} · ${item.reason}`
      : 'Import an insta-toolbox-manual-queue JSON file.';
    current.append(title, detail);
    const result = query('[data-role="account-result"]');
    result.replaceChildren();
    const resultTitle = document.createElement('h3');
    resultTitle.textContent = 'Profile status';
    const resultDetail = document.createElement('p');
    resultDetail.textContent = state.accountCheck?.result
      || (item
        ? 'Open the queued profile, then refresh.'
        : 'Open an Instagram profile, then refresh.');
    result.append(resultTitle, resultDetail);
    syncAccountComposer();
    renderAccountRunPrimary();
  }

  function renderMessages() {
    const activeThreadId = currentDirectThreadId();
    const target = activeThreadId
      && directThreadId(state.dmTarget?.conversationId) === activeThreadId
      ? state.dmTarget
      : null;
    const check = activeThreadId && state.dmCheck?.threadId === activeThreadId
      ? state.dmCheck
      : null;
    const evidence = activeThreadId && state.messageEvidence?.threadId === activeThreadId
      ? state.messageEvidence
      : null;
    const result = query('[data-role="dm-result"]');
    result.replaceChildren();
    const hasEvidence = Boolean(check || target || evidence);
    result.hidden = !hasEvidence;
    const list = query('[data-role="message-list"]');
    list.replaceChildren();
    const fragments = evidence?.fragments || [];
    list.hidden = fragments.length === 0;
    if (!hasEvidence) return;
    const title = document.createElement('h2');
    title.textContent = check?.exact
      ? 'Exact sent message resolved'
      : target
        ? 'Reviewed message ' + target.messageId
        : activeThreadId
          ? 'No reviewed DM target for this conversation'
          : 'Open an Instagram conversation';
    const detail = document.createElement('p');
    detail.textContent = check?.reason
      || evidence?.reason
      || (activeThreadId
        ? 'Read visible evidence or import one reviewed DM job for this conversation.'
        : 'Open an Instagram conversation first.');
    result.append(title, detail);
    for (const fragment of fragments) {
      const row = document.createElement('li');
      row.textContent = fragment.text;
      const meta = document.createElement('small');
      meta.textContent = 'Visible fragment · ownership unknown';
      row.append(meta);
      list.append(row);
    }
  }

  function renderAll() {
    applyLayout();
    renderShellState();
    renderChecker();
    renderAccount();
    renderMessages();
    syncTabs(preferences.view);
    renderCheckerSteps();
    renderDmSummary();
    renderContext();
    renderRun();
    renderLimits();
  }

  function renderLimits() {
    const bounds = limits();
    const set = (role, value) => {
      const field = query(`[data-role="${role}"]`);
      if (field && document.activeElement !== field) field.value = String(value);
    };
    set('limit-min', Math.round(bounds.minDelayMs / 1000));
    set('limit-max', Math.round(bounds.maxDelayMs / 1000));
  }

  function renderRun() {
    const panel = query('[data-role="run-panel"]');
    if (!panel) return;
    const run = state.run;
    panel.hidden = !run;
    if (!run) return;

    const done = (run.completed || 0) + (run.skipped || 0) + (run.failed || 0);
    const total = run.total || 0;
    const title = query('[data-role="run-title"]');
    if (title) {
      if (run.status === 'running') {
        title.textContent = run.current ? `Running · ${run.current}` : 'Running';
      } else if (run.status === 'completed') {
        title.textContent = 'Run finished';
      } else if (run.status === 'aborted') {
        title.textContent = 'Run stopped';
      } else {
        title.textContent = `Stopped · ${run.stopReason || 'safe stop'}`;
      }
    }
    const detail = query('[data-role="run-detail"]');
    if (detail) {
      const parts = [`${done}/${total} processed`, `${run.completed || 0} done`];
      if (run.skipped) parts.push(`${run.skipped} skipped`);
      if (run.failed) parts.push(`${run.failed} failed`);
      detail.textContent = parts.join(' · ');
    }
    const fill = query('[data-role="run-fill"]');
    if (fill) fill.style.width = `${total ? Math.round((done / total) * 100) : 0}%`;
    const stop = query('[data-role="stop-run"]');
    if (stop) stop.hidden = run.status !== 'running';

    const list = query('[data-role="run-results"]');
    if (list) {
      list.replaceChildren();
      for (const entry of (run.results || []).slice(0, 12)) {
        const row = document.createElement('li');
        const strong = document.createElement('strong');
        strong.textContent = entry.label;
        const small = document.createElement('small');
        small.textContent = entry.reason ? `${entry.status} · ${entry.reason}` : entry.status;
        row.append(strong, small);
        list.append(row);
      }
    }
  }

  async function readJsonFile(file) {
    if (!file || file.size > 5_000_000) throw new Error('JSON imports are limited to five megabytes.');
    return JSON.parse(await file.text());
  }

  async function importQueue(file) {
    const parsed = await readJsonFile(file);
    if (parsed?.kind !== 'insta-toolbox-manual-queue' || !Array.isArray(parsed.queue)) {
      throw new Error('Select an Insta Toolbox queue export.');
    }
    state.queue = normalizeQueue({ queue: parsed.queue, importedAt: nowIso() });
    saveState();
    status(`Imported ${state.queue.queue.length} local queue items.`);
  }

  async function importDmJob(file) {
    const parsed = await readJsonFile(file);
    if (parsed?.kind !== 'insta-toolbox-reviewed-dm-job' || parsed.items?.length !== 1) {
      throw new Error('Select one reviewed Insta Toolbox DM job with exactly one message.');
    }
    const item = parsed.items[0];
    if (
      item.sentByMe !== true
      || !safeText(item.conversationId)
      || !safeText(item.messageId)
      || !safeText(item.contentDigest)
      || !Number.isFinite(Number(item.timestamp))
    ) throw new Error('The reviewed DM item is incomplete or is not proven sent by you.');
    state.dmTarget = {
      conversationId: safeText(item.conversationId),
      messageId: safeText(item.messageId),
      contentDigest: safeText(item.contentDigest),
      timestamp: Number(item.timestamp),
      sentByMe: true,
    };
    state.dmCheck = null;
    saveState();
    status(`Loaded reviewed message ${state.dmTarget.messageId} for a no-click identity check.`);
  }

  function updateQueue(statusValue) {
    const item = currentQueueItem();
    if (!item) return;
    state.queue.queue = state.queue.queue.map((candidate) => candidate.id === item.id
      ? { ...candidate, status: statusValue, companionUpdatedAt: nowIso() }
      : candidate);
    saveState();
    status(`Saved @${item.account.username} as ${statusValue}.`);
  }

  // --- Finite confirmed actions ------------------------------------------
  //
  // The engine bundled above is the same one the extension runs. It still mints
  // a one-use resolution token during inspection and refuses to act unless the
  // token matches the element it resolved, so a live run here gets exactly the
  // same exact-target checks the extension gets.

  let batchAbort = false;
  let accountRunDraft = null;
  let relationshipController = null;
  let relationshipProgress = null;
  let dmThreadPreview = null;
  let dmRunnerSnapshot = null;

  const engine = globalThis.InstaToolboxInstagramInspector;
  const dmRunner = globalThis.InstaToolboxDmThreadUnsender;
  if (dmRunner) {
    dmRunnerSnapshot = dmRunner.snapshot();
    dmRunner.subscribe((next) => {
      dmRunnerSnapshot = next;
      renderDmSummary();
      renderShellState();
      if (['preparing', 'running', 'waiting', 'stopping', 'completed', 'stopped', 'error'].includes(next.status)) {
        status(next.message);
      }
    });
  }

  const LIMIT_BOUNDS = {
    minDelayMs: [1_000, 600_000],
    maxDelayMs: [1_000, 900_000],
  };
  const REST_EVERY = 20;
  const REST_MS = 90_000;

  function runCapabilityValid(run = state.run) {
    return Boolean(
      run?.status === 'running'
      && safeText(run.capabilityId)
      && Number(run.capabilityExpiresAt) > Date.now()
      && Array.isArray(run.approvedTargets)
      && run.capabilityDigest === accountCapabilityDigest(run.action, run.approvedTargets)
      && (run.queue || []).every((username) => run.approvedTargets.includes(username)),
    );
  }

  function stopForExpiredCapability() {
    batchAbort = true;
    setRun({
      status: 'stopped',
      stopReason: 'finite run capability expired',
      current: '',
      nextAt: null,
      queue: [],
    });
    status('This run expired. No further Instagram action was made.');
  }

  function clampNumber(value, [minimum, maximum], fallback) {
    const number = Number(value);
    if (!Number.isFinite(number)) return fallback;
    return Math.min(maximum, Math.max(minimum, Math.round(number)));
  }

  function limits() {
    const stored = state.limits || {};
    return {
      minDelayMs: clampNumber(stored.minDelayMs, LIMIT_BOUNDS.minDelayMs, 1_000),
      maxDelayMs: clampNumber(stored.maxDelayMs, LIMIT_BOUNDS.maxDelayMs, 2_000),
    };
  }

  function today() {
    return new Date().toISOString().slice(0, 10);
  }

  function recordAction(kind) {
    const ledger = state.ledger?.day === today()
      ? state.ledger
      : { day: today(), actions: 0, unsends: 0 };
    ledger[kind] = Number(ledger[kind] || 0) + 1;
    state.ledger = ledger;
    saveState();
  }

  let activeUnsendCapability = null;

  function reserveUnsendPlan(plan) {
    const finite = plan?.scope !== 'all';
    const count = Number(plan?.limit);
    const reviewedDigest = String(plan?.reviewedDigest || '');
    if (
      plan?.version !== 2
      || (finite && (!Number.isInteger(count) || count < 1))
      || !/^[0-9a-f]{8}$/.test(reviewedDigest)
      || Number(plan?.expiresAt) <= Date.now()
    ) return { ok: false, reason: 'The reviewed thread plan expired.' };
    if (activeUnsendCapability?.reviewedDigest === reviewedDigest) {
      return { ok: false, reason: 'This reviewed Unsend plan was already reserved.' };
    }
    activeUnsendCapability = {
      expiresAt: Number(plan.expiresAt),
      reviewedDigest,
      threadId: String(plan.threadId || ''),
      recordedProcessed: 0,
    };
    return {
      ok: true,
      minDelayMs: 1_000,
      maxDelayMs: 2_000,
    };
  }

  function recordVerifiedUnsend(plan, outcome) {
    const removed = Math.max(0, Math.floor(Number(outcome?.processed) || 0));
    const recorded = Math.max(0, Math.floor(Number(activeUnsendCapability?.recordedProcessed) || 0));
    const increment = Math.max(0, removed - recorded);
    if (!increment) return;
    const current = state.ledger?.day === today()
      ? state.ledger
      : { day: today(), actions: 0, unsends: 0 };
    current.unsends = Number(current.unsends || 0) + increment;
    current.lastUnsendPlanDigest = String(plan?.reviewedDigest || current.lastUnsendPlanDigest || '');
    current.lastUnsendPlanResult = safeText(outcome?.status, 'running');
    current.lastUnsendPlanProcessed = removed;
    state.ledger = current;
    if (activeUnsendCapability) activeUnsendCapability.recordedProcessed = removed;
    saveState();
  }

  function finalizeUnsendOutcome(plan, outcome) {
    recordVerifiedUnsend(plan, outcome);
    if (!Math.max(0, Math.floor(Number(outcome?.processed) || 0))) return;
    state.ledger.lastUnsendPlanResult = safeText(outcome?.status, 'stopped');
    saveState();
  }

  function sleep(ms) {
    return new Promise((resolve) => { setTimeout(resolve, ms); });
  }

  function sessionStop(observation) {
    if (observation?.sessionExpired) return 'session expired';
    if (observation?.challenge) return 'Instagram asked for a security check';
    if (observation?.actionBlocked) return 'Instagram blocked the action';
    if (observation?.rateLimited) return 'Instagram rate limited this account';
    return null;
  }

  function setRun(patch) {
    state.run = { ...(state.run || {}), ...patch };
    saveState();
    renderAll();
  }

  async function runOneAccount(username, action) {
    const observation = engine.inspectProfile(username);
    const stop = sessionStop(observation);
    if (stop) return { status: 'stopped', reason: stop, fatal: true };
    const expected = action === 'follow' ? 'not-following' : 'following';
    if (
      observation?.username !== username
      || observation?.relationship !== expected
      || observation?.ambiguous
      || observation?.unexpectedUi
      || !observation?.resolutionToken
    ) {
      return {
        status: 'skipped',
        reason: observation?.username !== username
          ? 'a different profile is open'
          : observation?.reason || `not ${expected}`,
        fatal: false,
      };
    }
    const result = await engine.performReviewedProfileAction({
      action,
      expectedRelationship: expected,
      resolutionToken: observation.resolutionToken,
      username,
    });
    const resultStop = sessionStop(result);
    if (resultStop) return { status: 'stopped', reason: resultStop, fatal: true };
    if (!result?.result || result.ambiguous || result.unexpectedUi) {
      return { status: 'failed', reason: result?.reason || 'not confirmed', fatal: false };
    }
    recordAction('actions');
    return { status: 'completed', reason: String(result.result), fatal: false };
  }

  // An account run has to visit each target's profile, and navigating tears this
  // script down and reloads it. So an account run is persisted with its
  // remaining queue and picked up again on the next page load: one profile per
  // load. That is safe because every item is independently re-resolved on
  // arrival and still has to pass the exact-target checks before anything
  // happens — resuming never inherits trust from the previous page.
  function resumableAccountRun() {
    const run = state.run;
    if (!run || run.kind !== 'account' || run.status !== 'running') return null;
    return Array.isArray(run.queue) && run.queue.length ? run : null;
  }

  async function continueAccountRun() {
    const run = resumableAccountRun();
    if (!run) return;
    if (!runCapabilityValid(run)) {
      stopForExpiredCapability();
      return;
    }
    const username = run.queue[0];
    const onTarget = engine.normalizeUsername(location.pathname) === username;

    if (!onTarget) {
      setRun({ current: `@${username}` });
      status(`Opening @${username} to continue the run.`);
      location.href = `https://www.instagram.com/${encodeURIComponent(username)}/`;
      return;
    }

    setRun({ current: `@${username}` });
    let outcome;
    try {
      outcome = await runOneAccount(username, run.action);
    } catch (error) {
      outcome = { status: 'failed', reason: error.message, fatal: false };
    }

    const current = state.run || {};
    const patch = {
      queue: (current.queue || []).slice(1),
      results: [{ label: `@${username}`, status: outcome.status, reason: outcome.reason },
        ...(current.results || [])].slice(0, 40),
    };
    if (outcome.status === 'completed') patch.completed = (current.completed || 0) + 1;
    else if (outcome.status === 'skipped') patch.skipped = (current.skipped || 0) + 1;
    else patch.failed = (current.failed || 0) + 1;
    setRun(patch);

    if (outcome.fatal) {
      setRun({ status: 'stopped', stopReason: outcome.reason, current: '', queue: [] });
      status(`Stopped: ${outcome.reason}. Nothing further was attempted.`);
      return;
    }
    if (!(state.run?.queue || []).length) {
      const done = state.run || {};
      setRun({ status: 'completed', current: '', nextAt: null });
      status(`Run finished: ${done.completed || 0} done, ${done.skipped || 0} skipped, ${done.failed || 0} failed.`);
      return;
    }

    const bounds = limits();
    const processed = (state.run.total || 0) - state.run.queue.length;
    let wait = bounds.minDelayMs
      + Math.floor(Math.random() * (Math.max(bounds.maxDelayMs, bounds.minDelayMs) - bounds.minDelayMs + 1));
    if (processed % REST_EVERY === 0) wait += REST_MS;
    setRun({ nextAt: Date.now() + wait });
    await sleep(wait);
    if (batchAbort || state.run?.status !== 'running') return;
    await continueAccountRun();
  }

  async function startAccountRun({ action, usernames }) {
    if (!managerTabStorageAvailable) {
      status('This userscript manager cannot keep a run active while opening profiles. Account batches are unavailable; scans and no-click checks still work.');
      return;
    }
    if (state.run?.status === 'running') {
      status('A run is already going. Stop it first.');
      return;
    }
    const queue = [...usernames];
    const capabilityId = globalThis.crypto?.randomUUID?.()
      || `run-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    batchAbort = false;
    setRun({
      status: 'running',
      kind: 'account',
      action,
      queue,
      total: queue.length,
      completed: 0,
      skipped: 0,
      failed: 0,
      current: '',
      stopReason: null,
      approvedTargets: [...queue],
      capabilityDigest: accountCapabilityDigest(action, queue),
      capabilityExpiresAt: Date.now() + RUN_CAPABILITY_MS,
      capabilityId,
      results: [],
    });
    await continueAccountRun();
  }

  // --- Section 2: current Instagram context -------------------------------
  //
  // A first-time user cannot tell why a button is inert. Reading the route and
  // session on every render, and naming exactly one useful next action, removes
  // the guesswork. This only describes state; it never unlocks anything.

  function followerListTypeFromText(value) {
    const label = String(value || '')
      .normalize('NFKC')
      .replace(/\s+/g, ' ')
      .trim()
      .toLocaleLowerCase();
    if (/^followers(?:\s|$)/.test(label)) return 'followers';
    if (/^following(?:\s|$)/.test(label)) return 'following';
    return '';
  }

  function openFollowerListContext() {
    for (const dialog of document.querySelectorAll('[role="dialog"]')) {
      const heading = [...dialog.querySelectorAll('[role="heading"], h1, h2')]
        .map(visibleText)
        .find(Boolean);
      const firstLine = visibleText(dialog).split(/\r?\n/).map((line) => line.trim()).find(Boolean);
      const observedTypes = new Set(
        [dialog.getAttribute('aria-label'), heading, firstLine]
          .map(followerListTypeFromText)
          .filter(Boolean),
      );
      if (observedTypes.size !== 1) continue;
      const [observed] = observedTypes;
      if (observed === 'followers') return { dialog, listType: 'followers', label: 'Followers' };
      if (observed === 'following') return { dialog, listType: 'following', label: 'Following' };
    }
    return null;
  }

  function currentContext() {
    const session = engine.inspectSession?.() || {};
    if (session.sessionExpired) {
      return { tone: 'blocked', title: 'Signed out', detail: 'Sign in to Instagram again, then reopen this panel.' };
    }
    if (session.challenge) {
      return { tone: 'blocked', title: 'Instagram wants a security check', detail: 'Finish the check on the page. Runs stay stopped until it clears.' };
    }
    if (session.actionBlocked) {
      return { tone: 'blocked', title: 'Action blocked', detail: 'Instagram is refusing actions on this account right now. Wait before trying again.' };
    }
    if (session.rateLimited) {
      return { tone: 'blocked', title: 'Rate limited', detail: 'Instagram is throttling this account. Runs stop until it passes.' };
    }

    const path = location.pathname.toLowerCase();
    if (path.startsWith('/direct/t/')) {
      return {
        tone: 'ready',
        title: 'Conversation open',
        detail: 'DM Unsend is ready for this conversation.',
        view: 'messages',
      };
    }
    if (path.startsWith('/direct')) {
      return { tone: 'warning', title: 'Inbox open', detail: 'Open a single conversation to use Unsend.' };
    }
    const followerList = openFollowerListContext();
    if (followerList) {
      return {
        tone: 'ready',
        title: `${followerList.label} list open`,
        detail: 'Manual capture is optional.',
        view: 'checker',
      };
    }
    const username = engine.normalizeUsername?.(location.pathname) || '';
    if (username) {
      return {
        tone: 'ready',
        title: `Profile: @${username}`,
        detail: 'Check both lists without opening them.',
        view: 'checker',
      };
    }
    return {
      tone: 'warning',
      title: 'Nothing to work on here',
      detail: 'Open your profile, a follower list, or a conversation.',
    };
  }

  function renderContext() {
    const context = currentContext();
    const strip = query('[data-role="context"]');
    if (!strip) return;
    const blockedContext = context.tone === 'blocked';
    strip.dataset.tone = blockedContext ? 'blocked' : contextStatus?.tone || context.tone;
    setText('context-title', context.title);
    setText('context-detail', blockedContext ? context.detail : contextStatus?.message || context.detail);
    const cta = query('[data-role="context-cta"]');
    if (cta) {
      const show = Boolean(context.cta) && state.run?.status !== 'running';
      cta.hidden = !show;
      if (show) {
        cta.textContent = context.cta.label;
        cta.dataset.ctaAction = context.cta.action;
        cta.dataset.ctaView = context.view || '';
      } else {
        delete cta.dataset.ctaAction;
        delete cta.dataset.ctaView;
      }
    }
  }

  // --- Section 3: guided scan sequence ------------------------------------

  function scanState(listType) {
    const count = state.capture[listType].length;
    if (state.capture.verified?.[listType] !== true) return count ? 'partial' : 'todo';
    return state.capture.complete?.[listType] === true ? 'done' : 'partial';
  }

  function renderCheckerSteps() {
    const comparison = compareCapture();
    for (const listType of ['following', 'followers']) {
      const step = query(`.step[data-step="${listType}"]`);
      const status = scanState(listType);
      const verified = state.capture.verified?.[listType] === true;
      if (step) step.dataset.state = status;
      const count = state.capture[listType].length;
      setText(`step-${listType}`,
        status === 'todo' ? 'Not scanned yet'
          : !verified ? `${formatCount(count)} stored — rescan required`
          : status === 'done' ? `${formatCount(count)} found — complete`
            : `${formatCount(count)} accessible accounts found — partial`);
      const button = query(`[data-action="scan-${listType}"]`);
      const listLabel = listType === 'following' ? 'Following' : 'Followers';
      if (button) button.textContent = `${status === 'todo' ? 'Scan' : 'Rescan'} ${listLabel}`;
    }
    const compareStep = query('.step[data-step="compare"]');
    const both = state.capture.verified?.following === true
      && state.capture.verified?.followers === true;
    const complete = scanState('following') === 'done' && scanState('followers') === 'done';
    if (compareStep) compareStep.dataset.state = both ? (complete ? 'done' : 'partial') : 'todo';
    setText('step-compare', complete
      ? `${formatCount(comparison.mutuals.length)} mutual · ${formatCount(comparison.notFollowingMeBack.length)} don't follow you back`
      : 'Waiting for two complete lists');
  }

  function resetRelationshipProgress() {
    relationshipProgress = {
      expectedCounts: { followers: null, following: null },
      found: { followers: 0, following: 0 },
    };
  }

  function scanProgressPercent(found, expectedCounts, complete = false) {
    const types = ['followers', 'following'];
    const knownTypes = types.filter((type) => Number.isSafeInteger(expectedCounts?.[type]));
    if (!knownTypes.length) return complete ? 100 : null;
    const total = knownTypes.reduce((sum, type) => sum + expectedCounts[type], 0);
    if (total === 0) return complete ? 100 : 0;
    const loaded = knownTypes.reduce(
      (sum, type) => sum + Math.min(expectedCounts[type], Math.max(0, Number(found?.[type]) || 0)),
      0,
    );
    const percent = Math.floor((loaded / total) * 100);
    return complete ? 100 : Math.min(99, Math.max(0, percent));
  }

  function showScanProgress(
    listType,
    found,
    complete,
    settled = false,
    expectedCount = null,
    expectedCounts = null,
  ) {
    const panel = query('[data-role="scan-progress"]');
    if (!panel) return;
    if (!relationshipProgress) resetRelationshipProgress();
    if (expectedCounts && typeof expectedCounts === 'object') {
      for (const type of ['followers', 'following']) {
        if (Number.isSafeInteger(expectedCounts[type])) {
          relationshipProgress.expectedCounts[type] = expectedCounts[type];
        }
      }
    }
    if (listType === 'followers' || listType === 'following') {
      relationshipProgress.found[listType] = Math.max(
        relationshipProgress.found[listType],
        Math.max(0, Number(found) || 0),
      );
      if (Number.isSafeInteger(expectedCount)) {
        relationshipProgress.expectedCounts[listType] = expectedCount;
      }
    }
    panel.hidden = false;
    const fill = query('[data-role="scan-fill"]');
    const bar = query('[data-role="scan-bar"]');
    const percent = scanProgressPercent(
      relationshipProgress.found,
      relationshipProgress.expectedCounts,
      complete,
    );
    if (fill) fill.style.width = percent === null ? '100%' : `${percent}%`;
    if (bar) {
      bar.dataset.indeterminate = String(percent === null);
      if (percent === null) bar.removeAttribute('aria-valuenow');
      else bar.setAttribute('aria-valuenow', String(percent));
      bar.setAttribute(
        'aria-valuetext',
        settled
          ? complete ? 'Mutual check complete' : 'Mutual check finished with a partial result'
          : percent === null
            ? `Scanning ${listType || 'accounts'}; total unknown`
            : `${percent}% of the expected accounts read`,
      );
    }
    setText('scan-detail', complete
      ? `Scanned ${found} ${listType} — complete.`
      : settled
        ? `Scanned ${found} ${listType} — incomplete.`
        : `Scanning ${listType}… ${formatCount(found)} found so far.`);
  }

  function completedRelationshipScanDetail(result) {
    const complete = result?.complete?.followers === true && result?.complete?.following === true;
    return `Checked ${formatCount(result?.followers?.length)} followers and ${formatCount(result?.following?.length)} following — ${complete ? 'complete' : 'partial'}.`;
  }

  function failedRelationshipScanDetail(error) {
    if (error?.code === 'stopped') return 'Mutual check stopped. Saved comparison unchanged.';
    const message = safeText(error?.message, 'Instagram did not return readable relationship data.');
    return `Mutual check failed: ${message} Saved comparison unchanged.`;
  }

  function settleFailedRelationshipProgress(error) {
    const bar = query('[data-role="scan-bar"]');
    const fill = query('[data-role="scan-fill"]');
    if (fill) fill.style.width = '0%';
    if (!bar) return;
    bar.dataset.indeterminate = 'false';
    bar.removeAttribute('aria-valuenow');
    bar.setAttribute(
      'aria-valuetext',
      error?.code === 'stopped' ? 'Mutual check stopped' : 'Mutual check failed',
    );
  }

  async function scanInto(listType) {
    const select = query('[data-role="list-type"]');
    if (select) select.value = listType;
    resetRelationshipProgress();
    showScanProgress(listType, 0, false);
    const outcome = await actions['scan-list']();
    if (!outcome?.applied) {
      const detail = safeText(outcome?.detail, `The ${listType} scan did not start.`);
      const bar = query('[data-role="scan-bar"]');
      const fill = query('[data-role="scan-fill"]');
      if (bar) {
        bar.dataset.indeterminate = 'false';
        bar.removeAttribute('aria-valuenow');
        bar.setAttribute('aria-valuetext', detail);
      }
      if (fill) fill.style.width = '0%';
      setText('scan-detail', detail);
      renderAll();
      return;
    }
    showScanProgress(
      listType,
      outcome.found,
      outcome.complete,
      true,
      outcome.expectedCount,
    );
    renderAll();
  }

  async function checkAccountRelationships() {
    if (relationshipController) {
      relationshipController.abort();
      status('Stopping the mutual check. Saved comparison data was not changed.');
      return;
    }
    if (typeof engine?.fetchFollowerComparison !== 'function') {
      status('Reload Instagram to activate Mutual Checker.');
      return;
    }
    const input = query('[data-role="checker-username"]');
    const username = engine.normalizeUsername(input?.value)
      || engine.detectAuthenticatedUsername?.()
      || '';
    if (!username) {
      status('Enter the Instagram username whose Followers and Following should be checked.');
      input?.focus();
      return;
    }
    if (input) input.value = username;
    const controller = new AbortController();
    relationshipController = controller;
    resetRelationshipProgress();
    renderAll();
    showScanProgress(null, 0, false);
    setText('scan-detail', `Finding the exact @${username} account…`);
    try {
      const result = await engine.fetchFollowerComparison({
        username,
        retryRateLimits: true,
        signal: controller.signal,
        onProgress(progress) {
          if (relationshipController !== controller) return;
          if (progress.phase === 'cooldown') {
            const seconds = Math.ceil(progress.remainingMs / 1000);
            const clock = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
            setText('scan-detail', `Instagram rate limit. Retrying in ${clock}. ${progress.cooldownSource === 'server' ? 'Wait supplied by Instagram.' : 'Automatic backoff; Instagram gave no reset time.'} Stop cancels the retry.`);
            return;
          }
          if (progress.phase === 'resolving') {
            setText('scan-detail', `Finding the exact @${username} account…`);
            return;
          }
          if (progress.phase === 'verifying-profile') {
            setText('scan-detail', `Reading the exact @${username} profile totals…`);
            return;
          }
          if (progress.phase === 'counts-ready') {
            showScanProgress(null, 0, false, false, null, progress.expectedCounts);
            setText(
              'scan-detail',
              `Instagram reports ${formatCount(progress.expectedCounts?.followers)} followers and ${formatCount(progress.expectedCounts?.following)} following.`,
            );
            return;
          }
          if (progress.phase === 'revalidating-profile') {
            setText('scan-detail', `Confirming @${username}'s profile totals did not change…`);
            return;
          }
          if (progress.phase === 'retrying') {
            const label = progress.listType || 'account lookup';
            if (progress.listType) {
              showScanProgress(
                progress.listType,
                progress.found,
                false,
                false,
                progress.expectedCount,
              );
            }
            setText(
              'scan-detail',
              `Retrying ${label}: attempt ${progress.attempt} of ${progress.maxAttempts} in ${(progress.retryDelayMs / 1_000).toFixed(1)}s. ${progress.found} accounts from ${progress.pages} completed pages are preserved.`,
            );
            return;
          }
          if (progress.listType) {
            showScanProgress(
              progress.listType,
              progress.found,
              false,
              false,
              progress.expectedCount,
            );
          }
        },
      });
      const previousCapture = state.capture;
      const nextCapture = {
        ...stateDefaults().capture,
        subjectUsername: result.username,
        followers: normalizeAccounts(result.followers),
        following: normalizeAccounts(result.following),
        capturedAt: { followers: result.capturedAt, following: result.capturedAt },
        complete: { ...result.complete },
        verified: { followers: true, following: true },
        source: { followers: 'authenticated-web', following: 'authenticated-web' },
      };
      state.capture = nextCapture;
      try {
        saveState();
      } catch (error) {
        state.capture = previousCapture;
        throw error;
      }
      const partialDetails = [];
      for (const [listType, accounts] of [
        ['followers', result.followers],
        ['following', result.following],
      ]) {
        const label = listType === 'followers' ? 'Followers' : 'Following';
        const reason = result.reasons[listType];
        const expected = result.expectedCounts[listType];
        if (reason === 'instagram-limited-list' && Number.isSafeInteger(expected)) {
          partialDetails.push(`${label}: Instagram limited this list to ${accounts.length.toLocaleString('en-US')} of ${expected.toLocaleString('en-US')} accounts.`);
        } else if (reason === 'cursor-missing') {
          partialDetails.push(`${label}: Instagram ended pagination without returning the next page.`);
        } else if (reason === 'count-mismatch' && Number.isSafeInteger(expected)) {
          const difference = expected - accounts.length;
          partialDetails.push(difference > 0
            ? `${label}: Instagram returned ${accounts.length.toLocaleString('en-US')} of ${expected.toLocaleString('en-US')}; ${difference.toLocaleString('en-US')} were not returned.`
            : `${label}: the API returned ${accounts.length.toLocaleString('en-US')} unique accounts while the profile shows ${expected.toLocaleString('en-US')}.`);
        } else if (reason === 'count-changed') {
          partialDetails.push(`${label}: the profile total changed during the check.`);
        } else if (reason === 'profile-count-disagreement') {
          partialDetails.push(`${label}: Instagram's profile counters disagreed.`);
        }
      }
      const mismatch = ` ${partialDetails.join(' ') || 'A bounded read limit was reached.'}`;
      status(
        `Checked @${result.username}: ${result.followers.length.toLocaleString('en-US')} followers and ${result.following.length.toLocaleString('en-US')} following.${result.complete.followers && result.complete.following ? '' : mismatch}`,
      );
      relationshipProgress.found.followers = result.followers.length;
      relationshipProgress.found.following = result.following.length;
      showScanProgress(
        null,
        result.followers.length + result.following.length,
        result.complete.followers && result.complete.following,
        true,
        null,
        result.expectedCounts,
      );
      setText('scan-detail', completedRelationshipScanDetail(result));
    } catch (error) {
      const detail = failedRelationshipScanDetail(error);
      settleFailedRelationshipProgress(error);
      setText('scan-detail', detail);
      status(detail);
    } finally {
      if (relationshipController === controller) relationshipController = null;
      renderAll();
    }
  }


  // --- Sections 4 and 5: show the targets before anything runs ------------

  function renderRunReview(items, { omitted = 0, removed = 0, skippedReasons = [] } = {}) {
    const panel = query('[data-role="run-review"]');
    if (!panel) return;
    panel.hidden = !items.length;
    if (!items.length) return;
    setText('review-title', `${items.length} account${items.length === 1 ? '' : 's'} queued`);
    const list = query('[data-role="review-list"]');
    if (list) {
      list.replaceChildren();
      for (const item of items) {
        const row = document.createElement('li');
        row.textContent = `@${item.username}`;
        list.append(row);
      }
      for (const entry of skippedReasons) {
        const skipped = document.createElement('li');
        skipped.textContent = `${entry.count} skipped — ${entry.reason}`;
        list.append(skipped);
      }
    }
    // Naming why targets were dropped is the difference between a trustworthy
    // count and a surprising one.
    setText(
      'review-skips',
      `Duplicates or already-correct targets removed: ${removed}. Outside this run: ${omitted}. Protected or incompatible targets skipped: ${skippedReasons.reduce((total, entry) => total + entry.count, 0)}. Every profile is rechecked before action.`,
    );
  }

  function compatibleAccountSources(action) {
    return action === 'follow'
      ? [
        ['current-profile', 'Current profile'],
        ['i-do-not-follow-back', 'Followers you do not follow'],
        ['scanned-followers', 'Scanned Followers'],
        ['queue', 'Queue items'],
      ]
      : [
        ['current-profile', 'Current profile'],
        ['not-following-me-back', "People who don't follow you back"],
        ['scanned-following', 'Scanned Following'],
        ['queue', 'Queue items'],
      ];
  }

  function syncAccountComposer() {
    const action = query('[data-role="bot-action"]')?.value === 'unfollow' ? 'unfollow' : 'follow';
    const source = query('[data-role="bot-source"]');
    if (!source) return;
    const previous = source.value;
    const options = compatibleAccountSources(action);
    source.replaceChildren();
    for (const [value, label] of options) {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = label;
      source.append(option);
    }
    source.value = options.some(([value]) => value === previous) ? previous : options[0][0];
    const currentProfile = source.value === 'current-profile';
    const countField = query('[data-role="bot-count-field"]');
    if (countField) countField.hidden = currentProfile;
    const count = query('[data-role="bot-count"]');
    if (currentProfile && count) count.value = '1';
  }

  function accountRunPlan() {
    const action = query('[data-role="bot-action"]')?.value === 'follow' ? 'follow' : 'unfollow';
    const source = query('[data-role="bot-source"]')?.value || 'current-profile';
    const requestedCount = clampNumber(query('[data-role="bot-count"]')?.value, [1, 250], 20);
    const count = source === 'current-profile' ? 1 : requestedCount;
    const comparison = compareCapture();
    const names = (list) => (list || []).map((entry) => entry.username || entry).filter(Boolean);
    const skippedReasons = [];
    const requiredLists = source === 'scanned-followers'
      ? ['followers']
      : source === 'scanned-following'
        ? ['following']
        : ['i-do-not-follow-back', 'not-following-me-back'].includes(source)
          ? ['followers', 'following']
          : [];
    const authenticatedUsername = engine.normalizeUsername?.(
      engine.detectAuthenticatedUsername?.(),
    ) || '';
    const captureSubject = engine.normalizeUsername?.(state.capture.subjectUsername) || '';
    const captureBoundToAccount = Boolean(
      captureSubject && authenticatedUsername && captureSubject === authenticatedUsername,
    );
    const captureReady = requiredLists.length === 0 || (
      captureBoundToAccount
      && requiredLists.every((listType) => (
        state.capture.verified?.[listType] === true
        && state.capture.complete?.[listType] === true
      ))
    );
    const capturePool = (list) => {
      if (captureReady) return names(list);
      const reason = captureBoundToAccount
        ? 'Mutual Checker data is partial. Run Mutual Checker again before creating account actions.'
        : 'Run Mutual Checker for your signed-in account before creating account actions.';
      if (!skippedReasons.some((entry) => entry.reason === reason)) {
        skippedReasons.push({
          count: 0,
          reason,
        });
      }
      return [];
    };
    const pools = {
      'current-profile': () => {
        const username = engine.normalizeUsername?.(location.pathname) || '';
        if (!username) return [];
        const observation = engine.inspectProfile?.(username) || {};
        const alreadyCorrect = action === 'follow'
          ? ['following', 'requested'].includes(observation.relationship)
          : observation.relationship === 'not-following';
        if (alreadyCorrect) {
          skippedReasons.push({ count: 1, reason: `@${username} already has the requested relationship.` });
          return [];
        }
        return [username];
      },
      queue: () => {
        const queue = state.queue.queue || [];
        const protectedCount = queue.filter((entry) => entry.status === 'protected').length;
        const incompatibleCount = queue.filter((entry) => (
          ACTIONABLE_STATUSES.has(entry.status) && entry.action !== action
        )).length;
        if (protectedCount) skippedReasons.push({ count: protectedCount, reason: 'Protected queue items stay excluded.' });
        if (incompatibleCount) skippedReasons.push({ count: incompatibleCount, reason: 'Queue items for the opposite action were excluded.' });
        return queue
          .filter((entry) => ACTIONABLE_STATUSES.has(entry.status) && entry.action === action)
          .map((entry) => entry.account?.username)
          .filter(Boolean);
      },
      'i-do-not-follow-back': () => capturePool(comparison.iDoNotFollowBack),
      'not-following-me-back': () => capturePool(comparison.notFollowingMeBack),
      'scanned-followers': () => capturePool(completeCapture('followers')),
      'scanned-following': () => capturePool(completeCapture('following')),
    };
    const pool = (pools[source] || pools['current-profile'])();
    let eligible = pool;
    const verifiedFollowing = completeCapture('following');
    if (source !== 'current-profile' && action === 'follow' && verifiedFollowing.length) {
      const already = new Set(names(verifiedFollowing));
      eligible = eligible.filter((username) => !already.has(username));
    }
    const unique = [...new Set(eligible)];
    const items = unique.slice(0, count).map((username) => ({ username }));
    return Object.freeze({
      action,
      items: Object.freeze(items),
      omitted: Math.max(0, unique.length - items.length),
      removed: Math.max(0, pool.length - unique.length),
      requested: count,
      skippedReasons: Object.freeze(skippedReasons),
      signature: JSON.stringify({ action, count, source, usernames: items.map((item) => item.username) }),
      source,
    });
  }

  function renderAccountRunPrimary() {
    const button = query('[data-role="account-run-primary"]');
    if (!button) return;
    if (accountRunDraft) {
      button.dataset.action = 'run-accounts';
      const label = accountRunDraft.action === 'follow' ? 'Follow' : 'Unfollow';
      button.textContent = `Start ${label} on ${accountRunDraft.items.length} account${accountRunDraft.items.length === 1 ? '' : 's'}`;
      button.classList.add('danger');
      button.classList.remove('primary');
      const preview = accountRunDraft.items.slice(0, 3).map((item) => `@${item.username}`).join(', ');
      setText('account-run-summary', `Reviewed: ${preview}${accountRunDraft.items.length > 3 ? `, +${accountRunDraft.items.length - 3} more` : ''}. Every profile is rechecked before action.`);
    } else {
      button.dataset.action = 'review-accounts';
      button.disabled = false;
      const plan = accountRunPlan();
      const label = plan.action === 'follow' ? 'Follow' : 'Unfollow';
      button.textContent = `Review ${plan.requested} ${label} target${plan.requested === 1 ? '' : 's'}`;
      button.classList.add('primary');
      button.classList.remove('danger');
      setText('account-run-summary', 'Choose a source, then review the accounts.');
    }
  }

  function clearAccountRunDraft() {
    accountRunDraft = null;
    syncAccountComposer();
    renderRunReview([]);
    renderAccountRunPrimary();
  }

  function reviewAccountRun() {
    const plan = accountRunPlan();
    if (!plan.items.length) {
      clearAccountRunDraft();
      status(
        plan.skippedReasons[0]?.reason
          || (plan.source === 'current-profile'
          ? 'Open one Instagram profile first. No target was reviewed.'
          : plan.source.startsWith('scanned')
          ? 'That list is empty. Open the list you want and scan it in the checker first.'
          : 'No targets. Scan both lists in the checker first, or import a queue.'),
      );
      return;
    }
    accountRunDraft = plan;
    renderRunReview(plan.items, plan);
    renderAccountRunPrimary();
    renderShellState();
    const start = query('[data-role="account-run-primary"]');
    const scroll = start?.closest('.scroll');
    const startRect = start?.getBoundingClientRect?.();
    const scrollRect = scroll?.getBoundingClientRect?.();
    if (startRect && scrollRect && startRect.bottom > scrollRect.bottom - 12) {
      scroll.scrollTop += startRect.bottom - scrollRect.bottom + 12;
    }
    start?.focus?.({ preventScroll: true });
    status(`Reviewed ${plan.items.length} ${plan.action} target${plan.items.length === 1 ? '' : 's'}. Nothing has run.`);
  }

  function renderDmSummary() {
    const summary = query('[data-role="dm-summary"]');
    const primary = query('[data-role="unsend-primary"]');
    const found = Number(dmThreadPreview?.detectedCount ?? dmThreadPreview?.eligibleCount) || 0;
    const checked = dmThreadPreview?.ready === true
      && dmThreadPreview.threadId === currentDirectThreadId();
    const active = ['preparing', 'running', 'waiting', 'stopping'].includes(dmRunnerSnapshot?.status);
    if (summary) {
      summary.hidden = !checked;
      setText('dm-summary-title', found
        ? `At least ${found} sent message${found === 1 ? '' : 's'} detected`
        : 'No sent messages found');
      setText('dm-summary-detail', !found
        ? 'No messages in this thread were identified as yours.'
        : 'Read-only estimate. Instagram may load more while Unsend runs.');
    }
    // Never hidden. Progressive disclosure applies to secondary controls, not
    // to the action the tool exists for.
    if (primary) {
      primary.hidden = false;
      primary.textContent = active ? 'Stop DM Unsend' : 'Unsend DMs';
      primary.disabled = active
        ? dmRunnerSnapshot?.canStop !== true
        : !currentDirectThreadId();
    }
    const scope = query('[data-role="unsend-scope"]')?.value || 'all';
    const countField = query('[data-role="unsend-count-field"]');
    if (countField) countField.hidden = scope === 'all';
  }

  async function scanSentConversation() {
    if (!dmRunner) throw new Error('Reload Instagram to load the DM Unsend runner.');
    status('Checking this conversation for messages you sent. Nothing will be removed.');
    const outcome = await dmRunner.inspectAll();
    dmThreadPreview = outcome?.ready ? outcome : null;
    renderAll();
    const detected = Number(outcome?.detectedCount ?? outcome?.eligibleCount) || 0;
    status(outcome?.ready
      ? detected > 0
        ? `Detected at least ${detected} sent message${detected === 1 ? '' : 's'}. No menus opened.`
        : 'No sent messages found. No menus opened.'
      : outcome?.reason || 'Could not check this conversation.');
    return outcome;
  }

  async function runDmUnsend() {
    if (!dmRunner) throw new Error('Reload Instagram to load the DM Unsend runner.');
    if (confirmationController?.isPending()) return;
    const snapshot = dmRunner.snapshot();
    if (snapshot.canStop || ['preparing', 'running', 'waiting', 'stopping'].includes(snapshot.status)) {
      dmRunner.stop();
      return;
    }
    const inspection = dmRunner.inspect();
    if (!inspection?.ready) throw new Error(inspection?.reason || 'Open a conversation first.');
    const scope = query('[data-role="unsend-scope"]')?.value || 'all';
    const requested = Math.floor(Number(query('[data-role="unsend-count"]')?.value) || 1);
    const limit = scope === 'all' ? null : Math.max(1, requested);
    const plan = dmRunner.createPlan({
      threadId: inspection.threadId,
      scope,
      limit,
      detectedCount: Number(dmThreadPreview?.detectedCount ?? dmThreadPreview?.eligibleCount) || null,
      expiresAt: Date.now() + DM_PLAN_CAPABILITY_MS,
    });
    if (!plan) throw new Error('The Unsend plan could not be created. Keep this conversation open and try again.');
    const scopeLabel = scope === 'all'
      ? 'every message you sent'
      : `the ${scope} ${limit} message${limit === 1 ? '' : 's'} you sent`;
    const confirmation = await confirmRun({
      title: 'Unsend DMs?',
      message: `Permanently unsend ${scopeLabel} in this conversation?`,
      detail: 'This cannot be undone. Stop stays available while it runs.',
      confirmLabel: scope === 'all' ? 'Unsend all my messages' : `Unsend ${limit} message${limit === 1 ? '' : 's'}`,
      facts: [
        { label: 'Action', value: 'Permanently unsend messages' },
        { label: 'Conversation', value: `Thread ${plan.threadId}` },
        { label: 'Scope', value: scope === 'all' ? 'All messages you sent' : `${scope} ${limit}` },
      ],
      binding: {
        action: 'unsend',
        expiresAt: plan.expiresAt,
        limit: plan.limit,
        reviewedDigest: plan.reviewedDigest,
        scope: plan.scope,
        threadId: plan.threadId,
      },
    });
    if (!confirmation) {
      status('Canceled. Nothing was removed.');
      return;
    }
    const confirmedInspection = dmRunner.inspect();
    const confirmedScope = query('[data-role="unsend-scope"]')?.value || 'all';
    const confirmedRequested = Math.floor(Number(query('[data-role="unsend-count"]')?.value) || 1);
    const confirmedLimit = confirmedScope === 'all' ? null : Math.max(1, confirmedRequested);
    if (
      !confirmedInspection?.ready
      || confirmedInspection.threadId !== plan.threadId
      || confirmation.action !== 'unsend'
      || confirmation.threadId !== plan.threadId
      || confirmation.scope !== plan.scope
      || confirmation.limit !== plan.limit
      || confirmation.reviewedDigest !== plan.reviewedDigest
      || Number(confirmation.expiresAt) !== plan.expiresAt
      || plan.expiresAt <= Date.now()
      || confirmedScope !== plan.scope
      || confirmedLimit !== plan.limit
    ) {
      status('The conversation or Unsend scope changed after review. Nothing was removed.', 'blocked');
      return;
    }
    const reservation = reserveUnsendPlan(plan);
    if (!reservation.ok) {
      status(reservation.reason);
      return;
    }
    dmThreadPreview = null;
    try {
      const outcome = await dmRunner.start({
        plan,
        minDelayMs: reservation.minDelayMs,
        maxDelayMs: reservation.maxDelayMs,
        onVerifiedRemoval: (progress) => recordVerifiedUnsend(plan, {
          ...progress,
          status: 'running',
        }),
      });
      finalizeUnsendOutcome(plan, outcome);
    } finally {
      activeUnsendCapability = null;
    }
  }


  // --- Section 7: keyboard and screen-reader behaviour --------------------

  function syncTabs(active) {
    const tabs = [...queryAll('[data-view]')];
    for (const tab of tabs) {
      const selected = tab.dataset.view === active;
      tab.setAttribute('aria-selected', String(selected));
      // Roving tabindex: exactly one tab is reachable by Tab, and the arrow
      // keys move between them, which is what a tablist is expected to do.
      tab.tabIndex = selected ? 0 : -1;
    }
    for (const panel of queryAll('[data-panel]')) {
      panel.hidden = panel.dataset.panel !== active;
    }
  }

  function onTabKeydown(event) {
    const tabs = [...queryAll('[data-view]')];
    const index = tabs.indexOf(event.target.closest('[data-view]'));
    if (index < 0) return;
    const keys = { ArrowRight: 1, ArrowLeft: -1, Home: 'first', End: 'last' };
    const move = keys[event.key];
    if (move === undefined) return;
    event.preventDefault();
    const next = move === 'first' ? tabs[0]
      : move === 'last' ? tabs[tabs.length - 1]
        : tabs[(index + move + tabs.length) % tabs.length];
    savePreferences({ view: next.dataset.view });
    syncTabs(next.dataset.view);
    next.focus();
  }

  function currentProfileCaptureSubject() {
    return engine.normalizeUsername?.(location.pathname) || '';
  }

  function prepareCaptureWorkspace(subjectUsername) {
    const currentSubject = engine.normalizeUsername?.(state.capture.subjectUsername) || '';
    const hasAuthenticatedData = state.capture.source?.followers === 'authenticated-web'
      || state.capture.source?.following === 'authenticated-web';
    if (hasAuthenticatedData || currentSubject !== subjectUsername) {
      state.capture = stateDefaults().capture;
    }
  }

  function reconciledRelationshipAccounts(existing, incoming, complete) {
    const merged = new Map(
      (complete === true ? [] : normalizeAccounts(existing))
        .map((account) => [account.username, account]),
    );
    for (const account of normalizeAccounts(incoming)) merged.set(account.username, account);
    return [...merged.values()];
  }

  const actions = {
    'confirm-cancel': () => confirmationController?.cancel(),
    'close-settings': () => setSettingsOpen(false),
    'check-account-relationships': () => checkAccountRelationships(),
    'scan-following': () => scanInto('following'),
    'scan-followers': () => scanInto('followers'),
    'context-cta': () => {
      const cta = query('[data-role="context-cta"]');
      const target = cta?.dataset.ctaAction;
      const view = cta?.dataset.ctaView;
      if (view) savePreferences({ view });
      if (target && actions[target]) actions[target]();
    },
    'open-settings': () => setSettingsOpen(true),
    'review-accounts': () => reviewAccountRun(),
    open: () => savePreferences({ open: true }),
    close: () => {
      confirmationController?.cancel();
      savePreferences({ open: false });
    },
    'stop-run': () => {
      if (dmRunner?.stop?.()) {
        status('Stopping DM Unsend after the current step.');
        return;
      }
      batchAbort = true;
      // Clearing the queue is what actually stops a resumable account run; the
      // in-memory flag alone would not survive the next page load.
      setRun({
        status: 'aborted', stopReason: 'stopped by you', nextAt: null, current: '', queue: [],
      });
      status('Run stopped. It will not resume.');
    },
    'scan-list': async () => {
      const listType = query('[data-role="list-type"]').value === 'followers' ? 'followers' : 'following';
      status(`Scanning the open ${listType} list. Keep the dialog open.`);
      const outcome = await engine.collectAccountList({ listType });
      const stopReason = sessionStop(outcome);
      if (stopReason) {
        const detail = `Stopped: ${stopReason}.`;
        status(detail);
        return { applied: false, detail };
      }
      const accounts = outcome?.accounts || [];
      if (outcome?.listType !== listType) {
        const detail = `No verified ${listType} dialog was open. Open that exact list and scan again.`;
        status(detail);
        return { applied: false, detail };
      }
      if (!accounts.length) {
        const detail = `No rows were readable. Open your ${listType} list first.`;
        status(detail);
        return { applied: false, detail };
      }
      const subjectUsername = currentProfileCaptureSubject();
      prepareCaptureWorkspace(subjectUsername);
      state.capture[listType] = reconciledRelationshipAccounts(
        verifiedCapture(listType),
        accounts,
        outcome.complete === true,
      );
      state.capture.capturedAt[listType] = nowIso();
      state.capture.complete = { ...(state.capture.complete || {}), [listType]: outcome.complete === true };
      state.capture.verified = { ...(state.capture.verified || {}), [listType]: true };
      state.capture.source = { ...(state.capture.source || {}), [listType]: 'list-dialog' };
      state.capture.subjectUsername = subjectUsername;
      saveState();
      renderAll();
      const mismatch = outcome?.reason === 'list-count-mismatch'
        && Number.isSafeInteger(outcome.expectedCount);
      status(
        `Scanned ${accounts.length} ${listType} rows.${outcome.complete
          ? ''
          : mismatch
            ? ` Instagram reports ${outcome.expectedCount}, so this capture stays incomplete.`
            : outcome?.reason === 'list-count-changed'
              ? ' The profile count changed during the scan, so this capture stays incomplete.'
              : ' The list did not reach its end, so some may be missing.'}`,
      );
      return {
        applied: true,
        complete: outcome.complete === true,
        expectedCount: outcome.expectedCount,
        found: state.capture[listType].length,
      };
    },
    'scan-sent': () => scanSentConversation(),
    'run-accounts': async () => {
      if (confirmationController?.isPending()) return;
      const current = accountRunPlan();
      if (!accountRunDraft || accountRunDraft.signature !== current.signature) {
        clearAccountRunDraft();
        status('Targets changed. Review the run again before starting.');
        return;
      }
      const reviewed = accountRunDraft;
      const actionLabel = reviewed.action === 'follow' ? 'Follow' : 'Unfollow';
      const expiresAt = Date.now() + RUN_CAPABILITY_MS;
      const confirmation = await confirmRun({
        title: `${actionLabel} ${reviewed.items.length} reviewed account${reviewed.items.length === 1 ? '' : 's'}?`,
        message: 'Review the exact accounts before starting.',
        detail: 'This tab will move between these exact profiles. Each account is revalidated before the action.',
        confirmLabel: `Start ${actionLabel}`,
        items: reviewed.items.map((item) => `@${item.username}`),
        facts: [
          { label: 'Action', value: actionLabel },
          { label: 'Accounts', value: String(reviewed.items.length) },
        ],
        binding: {
          action: reviewed.action,
          count: reviewed.items.length,
          expiresAt,
          targetDigest: reviewed.signature,
        },
      });
      if (!confirmation) {
        status('Canceled. The reviewed targets were kept. Nothing was changed.');
        return;
      }
      const refreshed = accountRunPlan();
      if (
        !accountRunDraft
        || accountRunDraft.signature !== reviewed.signature
        || refreshed.signature !== reviewed.signature
        || confirmation.action !== reviewed.action
        || confirmation.count !== reviewed.items.length
        || confirmation.targetDigest !== reviewed.signature
        || Number(confirmation.expiresAt) !== expiresAt
        || expiresAt <= Date.now()
      ) {
        clearAccountRunDraft();
        status('Targets changed after review. Review the run again. Nothing was changed.');
        return;
      }
      const approved = reviewed;
      clearAccountRunDraft();
      await startAccountRun({ action: approved.action, usernames: approved.items.map((item) => item.username) });
    },
    'run-unsend': () => runDmUnsend(),
    'save-limits': () => {
      state.limits = {
        ...(state.limits || {}),
        minDelayMs: clampNumber(Number(query('[data-role="limit-min"]')?.value) * 1000, LIMIT_BOUNDS.minDelayMs, 1_000),
        maxDelayMs: clampNumber(Number(query('[data-role="limit-max"]')?.value) * 1000, LIMIT_BOUNDS.maxDelayMs, 2_000),
      };
      saveState();
      status('Pacing saved.');
    },
    'layout-compact': () => savePreferences({ width: 360, height: 520, open: true }),
    'layout-tall': () => savePreferences({
      width: 430,
      height: Math.min(820, Math.max(HEIGHT_MIN, innerHeight - (INSET * 2))),
      open: true,
    }),
    'layout-wide': () => savePreferences({ width: 560, height: 680, open: true }),
    'reset-layout': () => savePreferences({
      ...preferencesDefaults(),
      accent: preferences.accent,
      blur: preferences.blur,
      launcherSize: preferences.launcherSize,
      open: true,
      view: preferences.view,
    }),
    capture: () => {
      const listType = query('[data-role="list-type"]').value === 'followers' ? 'followers' : 'following';
      const visible = captureVisibleAccounts(listType);
      if (!visible.length) {
        status(`No verified ${listType} rows were readable. Open that exact list first.`);
        return;
      }
      const subjectUsername = currentProfileCaptureSubject();
      prepareCaptureWorkspace(subjectUsername);
      const before = verifiedCapture(listType).length;
      state.capture[listType] = reconciledRelationshipAccounts(
        verifiedCapture(listType),
        visible,
        false,
      );
      state.capture.capturedAt[listType] = nowIso();
      state.capture.complete = { ...(state.capture.complete || {}), [listType]: false };
      state.capture.verified = { ...(state.capture.verified || {}), [listType]: true };
      state.capture.source = { ...(state.capture.source || {}), [listType]: 'list-dialog' };
      state.capture.subjectUsername = subjectUsername;
      saveState();
      status(`Captured ${visible.length} rendered ${listType} rows; ${state.capture[listType].length - before} were new.`);
    },
    'clear-capture': () => {
      state.capture = stateDefaults().capture;
      checkerResultKey = '';
      checkerResultLimit = CHECKER_RESULTS_PAGE_SIZE;
      checkerResultAnnouncement = '';
      clearTimeout(checkerResultAnnouncementTimer);
      checkerResultAnnouncementTimer = null;
      relationshipProgress = null;
      const progressPanel = query('[data-role="scan-progress"]');
      const progressBar = query('[data-role="scan-bar"]');
      const progressFill = query('[data-role="scan-fill"]');
      if (progressPanel) progressPanel.hidden = true;
      if (progressFill) progressFill.style.width = '0%';
      if (progressBar) {
        progressBar.dataset.indeterminate = 'false';
        progressBar.removeAttribute('aria-valuenow');
        progressBar.removeAttribute('aria-valuetext');
      }
      saveState();
      status('Mutual Checker cleared.');
    },
    'show-more-comparison': () => {
      const showMore = query('[data-role="comparison-more"]');
      const shouldRestoreFocus = shadow.activeElement === showMore;
      checkerResultLimit += CHECKER_RESULTS_PAGE_SIZE;
      renderChecker();
      if (shouldRestoreFocus && showMore?.hidden) {
        query('[data-role="comparison-count"]')?.focus({ preventScroll: true });
      }
    },
    'download-list': () => {
      const listType = query('[data-role="list-type"]').value === 'followers' ? 'followers' : 'following';
      const method = state.capture.source?.[listType] || '';
      downloadJson(`insta-toolbox-visible-${listType}-${Date.now()}.json`, {
        schemaVersion: 1,
        kind: 'insta-toolbox-visible-list',
        listType,
        capturedAt: state.capture.capturedAt[listType] || nowIso(),
        subjectUsername: state.capture.subjectUsername || '',
        verificationMethod: method,
        complete: state.capture.complete?.[listType] === true,
        verifiedDialog: state.capture.verified?.[listType] === true && method !== 'authenticated-web',
        [listType]: state.capture[listType],
        note: method === 'authenticated-web'
          ? 'Read from bounded authenticated Instagram pagination. No follow, unfollow, message, or click action was performed.'
          : 'Only rows rendered in Instagram were captured. Scroll manually and capture again to merge more rows.',
      });
    },
    'download-comparison-json': () => {
      const comparisonReady = comparisonIsReady();
      if (!comparisonReady) {
        status('Both lists must be complete before downloading a comparison. Captured rows are under Advanced.');
        return;
      }
      const generatedAt = nowIso();
      downloadJson(
        `insta-toolbox-mutual-comparison-${generatedAt.replace(/[:.]/g, '-')}.json`,
        engine.followerComparisonRecord(state.capture, compareCapture(), generatedAt),
      );
    },
    'export-queue': () => downloadJson(`insta-toolbox-companion-state-${Date.now()}.json`, {
      schemaVersion: 2,
      kind: 'insta-toolbox-companion-state',
      exportedAt: nowIso(),
      ...state.queue,
    }),
    'open-profile': () => {
      const item = currentQueueItem();
      if (!item) throw new Error('Import a queue before opening a target profile.');
      location.href = `https://www.instagram.com/${encodeURIComponent(item.account.username)}/`;
    },
    'account-dry-run': () => {
      inspectAccountQueueItem();
      status(state.accountCheck.result);
    },
    'queue-complete': () => updateQueue('completed'),
    'queue-skip': () => updateQueue('skipped'),
    'read-messages': () => {
      state.messageEvidence = inspectVisibleMessages();
      saveState();
      status(state.messageEvidence.reason);
    },
    'dm-dry-run': () => {
      state.dmCheck = inspectExactDmTarget();
      state.history.unshift({ kind: 'dm-dry-run', ...state.dmCheck, messageId: state.dmTarget?.messageId || null });
      state.history = state.history.slice(0, 20);
      saveState();
      status(state.dmCheck.reason);
    },
  };

  shadow.addEventListener('click', async (event) => {
    const goView = event.target.closest?.('[data-go-view]');
    if (goView) {
      savePreferences({ view: goView.dataset.goView, open: true });
      return;
    }
    const tab = event.target.closest?.('[data-view]');
    if (tab) {
      savePreferences({ view: tab.dataset.view });
      return;
    }
    const target = event.target.closest?.('[data-action]');
    if (!target) return;
    try {
      await actions[target.dataset.action]?.();
      renderAll();
    } catch (error) {
      status(`Stopped: ${error.message}`);
    }
  });

  shadow.addEventListener('change', async (event) => {
    try {
      if (event.target.matches('[data-role="bot-source"], [data-role="bot-action"], [data-role="bot-count"]')) {
        clearAccountRunDraft();
        status('Run choices changed. Review the targets again.');
        return;
      }
      if (event.target.matches('[data-role="list-type"]')) {
        renderChecker();
        return;
      }
      if (event.target.matches('[data-role="comparison-category"]')) {
        checkerResultKey = '';
        renderChecker();
        announceComparisonCount();
        return;
      }
      if (event.target.matches('[data-role="unsend-scope"], [data-role="unsend-count"]')) {
        renderDmSummary();
        return;
      }
      if (event.target.matches('[data-preference]')) {
        const preference = event.target.dataset.preference;
        savePreferences({
          [preference]: preference === 'opacity'
            ? Number(event.target.value) / 100
            : event.target.value,
        });
        return;
      }
      const file = event.target.files?.[0];
      if (event.target.dataset.file === 'queue') await importQueue(file);
      if (event.target.dataset.file === 'dm') await importDmJob(file);
      event.target.value = '';
      renderAll();
    } catch (error) {
      status(`Stopped: ${error.message}`);
    }
  });

  shadow.addEventListener('input', (event) => {
    if (event.target.matches('[data-role="result-filter"]')) {
      checkerResultKey = '';
      renderChecker();
      announceComparisonCount();
      return;
    }
    if (!event.target.matches('[data-preference="opacity"]')) return;
    const percent = Number(event.target.value);
    host.style.setProperty('--insta-toolbox-alpha', `${percent}%`);
    host.style.setProperty('--insta-toolbox-alpha-strong', `${Math.min(100, percent + 8)}%`);
    setText('opacity-output', `${percent}%`);
  });

  shadow.addEventListener('keydown', onTabKeydown);
  shadow.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && query('[data-role="settings-dialog"]')?.open) {
      setSettingsOpen(false);
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    const tab = event.target.closest?.('[data-view]');
    if (tab && ['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
      const tabs = queryAll('[data-view]');
      const index = tabs.indexOf(tab);
      const next = event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? tabs.length - 1
          : (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
      savePreferences({ view: tabs[next].dataset.view });
      tabs[next].focus();
      event.preventDefault();
    }
  });

  query('[data-role="settings-dialog"]')?.addEventListener('click', onSettingsDialogClick);
  query('[data-role="settings-dialog"]')?.addEventListener('close', onSettingsDialogClose);

  let interaction = null;
  let suppressLauncherClick = false;
  const panel = query('.panel');
  const launcher = query('.launcher');
  const moveHandle = query('[data-role="move"]');
  const resizeStartHandle = query('[data-role="resize-start"]');
  const resizeEndHandle = query('[data-role="resize-end"]');

  function beginInteraction(event, kind) {
    if (event.button !== 0 || (kind !== 'launcher' && innerWidth <= 600)) return;
    const rectangle = (kind === 'launcher' ? launcher : panel).getBoundingClientRect();
    interaction = {
      kind,
      moved: false,
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      rectangle,
    };
    host.dataset.layoutInteraction = kind;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    event.preventDefault();
  }

  function interactionPatch(event) {
    const deltaX = event.clientX - interaction.x;
    const deltaY = event.clientY - interaction.y;
    interaction.moved ||= Math.hypot(deltaX, deltaY) >= 4;
    if (interaction.kind === 'launcher') {
      return { launcherPosition: constrainedPosition({
        x: interaction.rectangle.left + deltaX,
        y: interaction.rectangle.top + deltaY,
      }, launcherDimensions()) };
    }
    if (interaction.kind === 'move') {
      return { position: constrainedPosition({ x: interaction.rectangle.left + deltaX, y: interaction.rectangle.top + deltaY }) };
    }
    const maxWidth = Math.min(WIDTH_MAX, innerWidth - (INSET * 2));
    const maxHeight = Math.min(HEIGHT_MAX, innerHeight - (INSET * 2));
    const fromStart = interaction.kind === 'resize-start';
    const size = {
      width: Math.round(clamp(
        interaction.rectangle.width + (fromStart ? -deltaX : deltaX),
        WIDTH_MIN,
        maxWidth,
      )),
      height: Math.round(clamp(interaction.rectangle.height + deltaY, HEIGHT_MIN, maxHeight)),
    };
    const patch = { ...size };
    if (fromStart) {
      patch.position = constrainedPosition({
        x: interaction.rectangle.right - size.width,
        y: interaction.rectangle.top,
      }, size);
    }
    return patch;
  }

  function moveInteraction(event) {
    if (!interaction || event.pointerId !== interaction.pointerId) return;
    preferences = normalizePreferences({ ...preferences, ...interactionPatch(event) });
    applyLayout();
    event.preventDefault();
  }

  function endInteraction(event) {
    if (!interaction || event.pointerId !== interaction.pointerId) return;
    const patch = interactionPatch(event);
    const finished = interaction;
    interaction = null;
    delete host.dataset.layoutInteraction;
    if (finished.kind === 'launcher' && !finished.moved) return;
    if (finished.kind === 'launcher') suppressLauncherClick = true;
    savePreferences(patch);
  }

  function keyboardLayout(event, kind) {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
    const step = event.shiftKey ? 40 : 12;
    const rectangle = (kind === 'launcher' ? launcher : panel).getBoundingClientRect();
    if (kind === 'launcher') {
      const size = launcherDimensions();
      savePreferences({ launcherPosition: constrainedPosition({
        x: (preferences.launcherPosition?.x ?? rectangle.left)
          + (event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0),
        y: (preferences.launcherPosition?.y ?? rectangle.top)
          + (event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0),
      }, size) });
    } else if (kind === 'move') {
      savePreferences({ position: constrainedPosition({
        x: (preferences.position?.x ?? rectangle.left) + (event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0),
        y: (preferences.position?.y ?? rectangle.top) + (event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0),
      }) });
    } else if (kind === 'resize-end') {
      savePreferences({
        width: preferences.width + (event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0),
        height: preferences.height + (event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0),
      });
    } else {
      const next = panelSize();
      next.width = Math.round(clamp(
        next.width + (event.key === 'ArrowLeft' ? step : event.key === 'ArrowRight' ? -step : 0),
        WIDTH_MIN,
        Math.min(WIDTH_MAX, innerWidth - (INSET * 2)),
      ));
      next.height = Math.round(clamp(
        next.height + (event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0),
        HEIGHT_MIN,
        Math.min(HEIGHT_MAX, innerHeight - (INSET * 2)),
      ));
      savePreferences({
        width: next.width,
        height: next.height,
        position: constrainedPosition({ x: rectangle.right - next.width, y: rectangle.top }, next),
      });
    }
    event.preventDefault();
  }

  launcher.addEventListener('pointerdown', (event) => beginInteraction(event, 'launcher'));
  launcher.addEventListener('keydown', (event) => keyboardLayout(event, 'launcher'));
  launcher.addEventListener('click', (event) => {
    if (!suppressLauncherClick) return;
    suppressLauncherClick = false;
    event.preventDefault();
    event.stopImmediatePropagation();
  }, true);
  moveHandle.addEventListener('pointerdown', (event) => beginInteraction(event, 'move'));
  // Dragging anywhere on the header is far easier to hit than the grip alone,
  // as long as the real controls in it still behave like controls.
  query('.header')?.addEventListener('pointerdown', (event) => {
    if (event.target.closest('button, select, summary, input, a, label, [data-view], [data-action]')) return;
    beginInteraction(event, 'move');
  });
  resizeStartHandle.addEventListener('pointerdown', (event) => beginInteraction(event, 'resize-start'));
  resizeEndHandle.addEventListener('pointerdown', (event) => beginInteraction(event, 'resize-end'));
  moveHandle.addEventListener('keydown', (event) => keyboardLayout(event, 'move'));
  resizeStartHandle.addEventListener('keydown', (event) => keyboardLayout(event, 'resize-start'));
  resizeEndHandle.addEventListener('keydown', (event) => keyboardLayout(event, 'resize-end'));
  window.addEventListener('pointermove', moveInteraction, { passive: false });
  window.addEventListener('pointerup', endInteraction);
  window.addEventListener('pointercancel', endInteraction);
  window.addEventListener('resize', () => {
    const patch = {};
    if (preferences.position) patch.position = constrainedPosition(preferences.position);
    if (preferences.launcherPosition) {
      patch.launcherPosition = constrainedPosition(
        preferences.launcherPosition,
        launcherDimensions(),
      );
    }
    if (Object.keys(patch).length) savePreferences(patch);
    else applyLayout();
  });

  function toggleToolboxShortcut(event) {
    if (!event.altKey || !event.shiftKey || event.ctrlKey || event.metaKey || event.key.toLowerCase() !== 'i') return;
    if (preferences.open) confirmationController?.cancel();
    savePreferences({ open: !preferences.open });
    event.preventDefault();
  }
  window.addEventListener('keydown', toggleToolboxShortcut, true);

  let lastLocationHref = location.href;
  const duplicateObserver = new MutationObserver((records) => {
    const currentHref = location.href;
    if (currentHref !== lastLocationHref) {
      lastLocationHref = currentHref;
      confirmationController?.cancel();
      contextStatus = null;
      dmThreadPreview = null;
      state.messageEvidence = null;
      state.dmCheck = null;
      state.sentDms = [];
      state.sentDmsComplete = false;
      state.sentDmsChecked = false;
      saveState();
      renderAll();
    } else if (records.some((record) => [...record.addedNodes, ...record.removedNodes].some((node) => (
      node.nodeType === Node.ELEMENT_NODE
      && (node.matches?.('[role="dialog"]') || node.querySelector?.('[role="dialog"]'))
    )))) {
      renderContext();
    }
    if (!document.getElementById(EXTENSION_ROOT_ID)) return;
    duplicateObserver.disconnect();
    window.removeEventListener('keydown', toggleToolboxShortcut, true);
    confirmationController?.destroy();
    host.remove();
  });
  duplicateObserver.observe(document.documentElement, { childList: true, subtree: true });

  document.documentElement.append(host);
  bootstrapClaim.remove();
  saveState();
  savePreferences(preferences);
  renderAll();

  // Pick a paused account run back up after the navigation that advanced it.
  if (resumableAccountRun()) {
    const pending = state.run.queue.length;
    status(`Resuming run: ${pending} account${pending === 1 ? '' : 's'} left. Use Stop to end it.`);
    void continueAccountRun().catch((error) => {
      setRun({ status: 'stopped', stopReason: error.message, current: '' });
      status(`Run stopped: ${error.message}`);
    });
  }
})();

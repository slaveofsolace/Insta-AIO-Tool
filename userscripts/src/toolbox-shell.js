(async () => {
  'use strict';

  const EXTENSION_ROOT_ID = 'insta-aio-sidecar-root';
  const ROOT_ID = 'insta-aio-userscript-root';
  const STATE_KEY = 'instaAioUserscriptStateV2';
  const PREFERENCES_KEY = 'instaAioUserscriptPreferencesV1';
  const LEGACY_QUEUE_KEY = 'instaAioManualQueueV1';
  const TAB_RUN_FIELD = 'instaAioAccountRunV1';
  const ACTIONABLE_STATUSES = new Set(['pending', 'ready', 'failed', 'paused']);
  const RESERVED = new Set([
    'accounts', 'about', 'api', 'developer', 'direct', 'emails', 'explore',
    'legal', 'privacy', 'reels', 'settings', 'stories', 'terms', 'web',
  ]);
  const VIEWS = ['checker', 'account', 'messages'];
  const WIDTH_MIN = 320;
  const WIDTH_MAX = 560;
  const HEIGHT_MIN = 320;
  const HEIGHT_MAX = 1_100;
  const INSET = 8;
  const LIVE_AUTHORIZATION_MS = 15 * 60 * 1_000;
  const LIVE_AUTHORIZATION_PHRASE = 'ENABLE LIVE ACTIONS';

  if (document.getElementById(EXTENSION_ROOT_ID) || document.getElementById(ROOT_ID)) return;

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

  function visibleText(element) {
    if (!element || element.getAttribute?.('aria-hidden') === 'true') return '';
    const style = getComputedStyle(element);
    if (style.display === 'none' || style.visibility === 'hidden') return '';
    return safeText(element.textContent || element.getAttribute?.('aria-label'));
  }

  function normalizeAccounts(value) {
    const accounts = new Map();
    for (const candidate of (Array.isArray(value) ? value : []).slice(0, 2_000)) {
      const username = normalizeUsername(candidate?.username || candidate?.profileUrl || candidate);
      if (!username) continue;
      accounts.set(username, {
        username,
        profileUrl: `https://www.instagram.com/${username}/`,
        displayName: safeText(candidate?.displayName),
        source: 'tampermonkey-visible-dom',
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
      schemaVersion: 2,
      capture: {
        followers: [],
        following: [],
        capturedAt: { followers: null, following: null },
        complete: { followers: false, following: false },
      },
      queue: { queue: [], importedAt: null },
      accountCheck: null,
      messageEvidence: null,
      dmTarget: null,
      dmCheck: null,
      history: [],
      sentDms: [],
      sentDmsComplete: false,
      limits: {
        dailyActions: 100,
        dailyUnsends: 50,
        minDelayMs: 4_000,
        maxDelayMs: 11_000,
      },
      ledger: { day: null, actions: 0, unsends: 0 },
      run: null,
    };
  }

  function preferencesDefaults() {
    return {
      schemaVersion: 1,
      open: true,
      view: 'checker',
      position: null,
      width: 390,
      height: 620,
      opacity: 0.94,
    };
  }

  function normalizeResumableAccountRun(value) {
    if (!value || value.kind !== 'account' || value.status !== 'running') return null;
    const authorizationExpiresAt = Math.min(
      Number(value.authorizationExpiresAt) || 0,
      Date.now() + LIVE_AUTHORIZATION_MS,
    );
    const queue = [...new Set((Array.isArray(value.queue) ? value.queue : [])
      .map(normalizeUsername)
      .filter(Boolean))].slice(0, 250);
    if (!queue.length || authorizationExpiresAt <= Date.now()) return null;
    const action = value.action === 'follow' ? 'follow' : value.action === 'unfollow' ? 'unfollow' : '';
    if (!action) return null;
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
      authorizationExpiresAt,
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
    return {
      schemaVersion: 2,
      capture: {
        followers: normalizeAccounts(value.capture?.followers),
        following: normalizeAccounts(value.capture?.following),
        capturedAt: {
          followers: safeText(value.capture?.capturedAt?.followers) || null,
          following: safeText(value.capture?.capturedAt?.following) || null,
        },
        complete: {
          followers: value.capture?.complete?.followers === true,
          following: value.capture?.complete?.following === true,
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
    const position = source.position && Number.isFinite(Number(source.position.x))
      && Number.isFinite(Number(source.position.y))
      ? { x: Math.max(0, Math.round(source.position.x)), y: Math.max(0, Math.round(source.position.y)) }
      : null;
    return {
      schemaVersion: 1,
      open: typeof source.open === 'boolean' ? source.open : true,
      view: VIEWS.includes(source.view) ? source.view : 'checker',
      position,
      width: Math.round(clamp(source.width || 390, WIDTH_MIN, WIDTH_MAX)),
      height: Math.round(clamp(source.height || 620, HEIGHT_MIN, HEIGHT_MAX)),
      opacity: Math.round(clamp(source.opacity || 0.94, 0.55, 1) * 100) / 100,
    };
  }

  let managerTab = await readManagerTab();
  const managerTabStorageAvailable = managerTab !== null;
  let state = loadState(managerTab);
  let preferences = normalizePreferences(GM_getValue(PREFERENCES_KEY, preferencesDefaults()));

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

  function compareCapture() {
    const followerNames = new Set(state.capture.followers.map((account) => account.username));
    const followingNames = new Set(state.capture.following.map((account) => account.username));
    return {
      mutuals: state.capture.following.filter((account) => followerNames.has(account.username)),
      iDoNotFollowBack: state.capture.followers.filter((account) => !followingNames.has(account.username)),
      notFollowingMeBack: state.capture.following.filter((account) => !followerNames.has(account.username)),
    };
  }

  function captureVisibleAccounts() {
    const roots = [
      ...document.querySelectorAll('div[role="dialog"]'),
      document.querySelector('main'),
    ].filter(Boolean);
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
    const exact = Boolean(
      item
      && observation.ok
      && observation.username === item.account.username
      && observation.relationship === expectedRelationship,
    );
    state.accountCheck = {
      checkedAt: nowIso(),
      exact,
      noClick: true,
      target: item?.account?.username || null,
      action: item?.action || null,
      observation,
      result: !item
        ? 'Import a manual queue first.'
        : exact
          ? `Resolved ${item.action} for @${item.account.username} without clicking.`
          : observation.reason || `Open @${item.account.username} on the expected relationship state.`,
    };
    state.history.unshift({ kind: 'account-dry-run', ...state.accountCheck });
    state.history = state.history.slice(0, 20);
    saveState();
  }

  function inspectVisibleMessages() {
    if (!location.pathname.toLowerCase().startsWith('/direct/')) {
      return { capturedAt: nowIso(), fragments: [], reason: 'Open an Instagram conversation first.' };
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

  function inspectExactDmTarget() {
    const item = state.dmTarget;
    if (!item) return { exact: false, reason: 'Import one reviewed DM job first.', noClick: true };
    const expectedThread = directThreadId(item.conversationId);
    const observedThread = directThreadId(location.pathname);
    if (!expectedThread || expectedThread !== observedThread) {
      return { exact: false, reason: 'Wrong or unresolved conversation.', noClick: true };
    }
    const scope = document.querySelector('[data-pagelet="IGDMessagesList"]') || document.querySelector('main');
    const candidates = [...(scope?.querySelectorAll?.('[data-message-id], [data-item-id]') || [])]
      .map((identity) => {
        const row = identity.closest?.('[role="row"], [role="listitem"]') || identity;
        const messageId = safeText(identity.getAttribute('data-message-id') || identity.getAttribute('data-item-id'));
        const timestamp = Number(identity.getAttribute('data-timestamp-ms') || row.getAttribute?.('data-timestamp-ms'));
        const content = [...row.querySelectorAll('[data-insta-aio-message-content], [dir="auto"]')]
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
      ? { exact: true, reason: 'One exact sent-message identity resolved without opening a menu.', noClick: true, checkedAt: nowIso() }
      : { exact: false, reason: candidates.length ? 'Exact message identity is ambiguous.' : 'Exact sent-message identity is unavailable.', noClick: true, checkedAt: nowIso() };
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

  const host = document.createElement('div');
  host.id = ROOT_ID;
  const shadow = host.attachShadow({ mode: 'open' });
  shadow.innerHTML = `
    <style>
      :host { all: initial; --aio-alpha: 94%; --aio-alpha-strong: 98%; --ig-bg: rgb(var(--ig-primary-background, 255 255 255)); --ig-bg-elevated: rgb(var(--ig-elevated-background, 255 255 255)); --ig-secondary-bg: rgb(var(--ig-secondary-background, 250 250 250)); --ig-text: rgb(var(--ig-primary-text, 0 0 0)); --ig-text-secondary: rgb(var(--ig-secondary-text, 115 115 115)); --ig-line: rgb(var(--ig-separator, 219 219 219)); --ig-accent: rgb(var(--ig-primary-button, 0 149 246)); --aio-ease: 160ms cubic-bezier(.2,.7,.3,1); --aio-width: 390px; --aio-height: 620px; color-scheme: light; font-family: "Segoe UI Variable", "Segoe UI", system-ui, sans-serif; }
      *, *::before, *::after { box-sizing: border-box; }
      button, input, select { font: inherit; }
      button, label, summary { cursor: pointer; }
      [hidden] { display: none !important; }
      .launcher { position: fixed; z-index: 2147482900; right: 16px; bottom: 16px; width: 46px; height: 46px; border: 1px solid #cfd5cc; border-radius: 14px; background: rgba(255,255,255,.9); color: #172018; box-shadow: 0 10px 32px rgba(0,0,0,.2); font-weight: 850; }
      .panel { animation: aio-in var(--aio-ease) both; position: fixed; z-index: 2147482900; top: 62px; right: 16px; width: min(var(--aio-width), calc(100vw - 24px)); height: min(var(--aio-height), calc(100dvh - 74px)); display: grid; grid-template-rows: auto auto minmax(0,1fr) auto; overflow: hidden; border: 1px solid #cfd5cc; border-radius: 14px; background: color-mix(in srgb, #f7f8f5 var(--aio-alpha), transparent); color: #1b211c; box-shadow: 0 20px 60px rgba(0,0,0,.24); backdrop-filter: blur(10px) saturate(.95); -webkit-backdrop-filter: blur(10px) saturate(.95); font: 14px/1.45 "Segoe UI Variable", "Segoe UI", system-ui, sans-serif; }
      :host([data-floating="true"]) .panel { top: var(--aio-top); right: auto; left: var(--aio-left); }
      .header { display: grid; grid-template-columns: auto minmax(0,1fr) auto; gap: 8px; align-items: center; min-height: 66px; padding: 10px; border-bottom: 1px solid #d8ddd4; background: color-mix(in srgb, #fff var(--aio-alpha-strong), transparent); }
      .handle, .icon { width: 44px; height: 44px; display: grid; place-items: center; border: 0; border-radius: 9px; background: transparent; color: inherit; }
      .handle { cursor: grab; touch-action: none; font-size: 20px; min-width: 44px; min-height: 44px; display: inline-flex; align-items: center; justify-content: center; border-radius: 8px; }
      .handle:hover { background: rgba(0,0,0,.06); }
      .handle:active { cursor: grabbing; background: rgba(0,0,0,.1); }
      /* The whole header bar drags, so the grip is a hint rather than the only target. */
      .header { cursor: grab; }
      .header:active { cursor: grabbing; }
      .header button, .header select, .header summary, .header input { cursor: default; }
      .header h1 { margin: 0; font-size: 17px; line-height: 1.15; }
      .header p { margin: 2px 0 0; color: #667067; font-size: 11px; }
      .mode { display: inline-flex; margin-top: 4px; border: 1px solid #8b6a20; border-radius: 999px; padding: 2px 7px; color: #72520d; font-size: 10px; font-weight: 750; }
      .tabs { display: grid; grid-template-columns: repeat(3,minmax(44px,1fr)); border-bottom: 1px solid #d8ddd4; background: color-mix(in srgb, #eef1ec var(--aio-alpha-strong), transparent); }
      .tab { transition: background var(--aio-ease), color var(--aio-ease); min-height: 48px; border: 0; border-bottom: 3px solid transparent; padding: 6px 3px; background: transparent; color: #616a61; font-size: 11px; font-weight: 700; }
      .tab[aria-selected="true"] { border-bottom-color: #347844; color: #172018; background: color-mix(in srgb, #fff 72%, transparent); }
      .scroll { min-height: 0; overflow: auto; overscroll-behavior: contain; }
      .view { padding: 14px; }
      .lead { margin: 0 0 12px; color: #606960; font-size: 12px; }
      .tool-grid { display: grid; gap: 8px; }
      .tool { display: grid; grid-template-columns: minmax(0,1fr) auto; gap: 10px; align-items: center; width: 100%; border: 1px solid #d8ddd4; border-radius: 10px; padding: 12px; background: color-mix(in srgb, #fff var(--aio-alpha-strong), transparent); color: inherit; text-align: left; }
      .tool strong, .tool span { display: block; }
      .tool span { margin-top: 3px; color: #687068; font-size: 12px; }
      .tool em { color: #347844; font-size: 10px; font-style: normal; font-weight: 800; text-transform: uppercase; }
      .card { margin-bottom: 10px; border: 1px solid #d8ddd4; border-radius: 10px; padding: 12px; background: color-mix(in srgb, #fff var(--aio-alpha-strong), transparent); }
      .card h2, .card h3 { margin: 0 0 6px; font-size: 15px; }
      .card p { margin: 4px 0 0; color: #687068; font-size: 12px; overflow-wrap: anywhere; }
      .metrics { display: grid; grid-template-columns: repeat(2,minmax(0,1fr)); gap: 8px; margin: 10px 0; }
      .metric { border: 1px solid #d8ddd4; border-radius: 9px; padding: 10px; background: color-mix(in srgb, #fff var(--aio-alpha-strong), transparent); }
      .metric span, .metric strong { display: block; }
      .metric span { color: #687068; font-size: 11px; }
      .metric strong { margin-top: 2px; font-size: 21px; }
      .field { display: grid; gap: 5px; margin: 10px 0; }
      .field label { color: #687068; font-size: 12px; }
      .live-toggle { display: flex; align-items: flex-start; gap: 8px; color: #1b211c !important; font-weight: 700; }
      .live-toggle input { width: 18px; height: 18px; flex: 0 0 auto; margin: 0; accent-color: #347844; }
      .live-status { margin: 0; color: #687068; font-size: 11px; }
      select, input[type="range"] { width: 100%; }
      select { min-height: 44px; border: 1px solid #cfd5cc; border-radius: 8px; padding: 8px; background: rgba(255,255,255,.86); color: inherit; }
      .toolbar { display: flex; flex-wrap: wrap; gap: 7px; margin: 10px 0; }
      .button, .file { min-height: 44px; display: inline-flex; align-items: center; justify-content: center; border: 1px solid #243027; border-radius: 8px; padding: 8px 11px; background: #26362a; color: #fff; font-weight: 720; text-decoration: none; }
      .button.quiet, .file.quiet { border-color: #cfd5cc; background: rgba(255,255,255,.72); color: #1b211c; }
      .file { position: relative; overflow: hidden; }
      .file input { position: absolute; inset: 0; opacity: 0; }
      .list { margin: 10px 0 0; padding: 0; border-top: 1px solid #d8ddd4; list-style: none; }
      .list li { padding: 8px 0; border-bottom: 1px solid #d8ddd4; overflow-wrap: anywhere; font-size: 12px; }
      .list small { display: block; margin-top: 2px; color: #687068; }
      .notice { padding: 10px; border-left: 4px solid #ad7823; background: rgba(255,244,214,.72); color: #62490f; font-size: 12px; }
      details.settings { position: relative; }
      details.settings > summary { display: grid; width: 44px; height: 44px; place-items: center; border-radius: 9px; list-style: none; font-size: 18px; }
      details.settings > summary::-webkit-details-marker { display:none; }
      .settings-panel { position: absolute; z-index: 5; top: 48px; right: 0; width: 250px; padding: 12px; border: 1px solid #cfd5cc; border-radius: 10px; background: rgba(255,255,255,.97); box-shadow: 0 16px 46px rgba(0,0,0,.2); }
      .range-row { display:grid; grid-template-columns: minmax(0,1fr) auto; gap: 8px; align-items:center; }
      .footer { min-height: 42px; display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 8px 12px; border-top: 1px solid #d8ddd4; background: color-mix(in srgb, #fff var(--aio-alpha-strong), transparent); color: #687068; font-size: 11px; }
      .resize { position: absolute; right: 0; bottom: 0; width: 44px; height: 44px; z-index: 6; border: 0; background: transparent; cursor: nwse-resize; touch-action: none; }
      .resize-tl { right: auto; bottom: auto; left: 0; top: 0; cursor: nwse-resize; }
      .resize::before { content:""; position:absolute; right:8px; bottom:8px; width:12px; height:12px; border-right:2px solid #687068; border-bottom:2px solid #687068; }
      button:focus-visible, select:focus-visible, input:focus-visible, summary:focus-visible, .file:focus-within { outline: 3px solid #168cff; outline-offset: 2px; }
      @media (max-width: 600px) { .panel { top:auto; right:0; bottom:0; left:0; width:100%; height:min(78dvh,720px); border-radius:14px 14px 0 0; } .handle,.resize { display:none; } .header { grid-template-columns:minmax(0,1fr) auto; } }
      @media (prefers-reduced-motion: reduce) { * { scroll-behavior:auto !important; } }
      .run-panel { padding: 10px 12px; border-top: 1px solid #d8ddd4; background: color-mix(in srgb, #fff var(--aio-alpha-strong), transparent); }
      .run-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
      .run-head strong { font-size: 12px; overflow-wrap: anywhere; }
      .run-bar { overflow: hidden; height: 5px; margin: 8px 0 6px; border-radius: 999px; background: #d8ddd4; }
      .run-bar span { display: block; width: 0%; height: 100%; border-radius: 999px; background: #1c6b3c; transition: width 220ms ease; }
      .run-panel .list { max-height: 118px; overflow-y: auto; }
      .button.danger { background: rgb(var(--ig-primary-button, 0 149 246)); color: #fff; }
      .button.primary { background: rgb(var(--ig-primary-button, 0 149 246)); color: #fff; border: 0; font-weight: 600; }
      .button.primary:hover { filter: brightness(1.08); }
      .button.big { width: 100%; padding: 10px 12px; font-size: var(--system-14-font-size, 14px); line-height: var(--system-14-line-height, 18px); border-radius: 8px; }
      .button:disabled { cursor: not-allowed; filter: none; opacity: .48; }
      .mode[data-live="unlocked"] { border-color: #347844; color: #275d34; }
      @keyframes aio-in { from { opacity: 0; transform: translateY(-4px); } to { opacity: 1; transform: none; } }
      @media (prefers-reduced-motion: reduce) { .run-bar span, .tab, .button { transition: none; } .panel { animation: none; } }
      @media (forced-colors: active) { .panel,.card,.tool,.metric,.header,.footer,.run-panel { background:Canvas; } .panel,.card,.tool,.metric { border:2px solid CanvasText; } }
    </style>
    <button class="launcher" type="button" data-action="open" aria-label="Open Insta AIO Instagram toolbox" aria-expanded="false">AIO</button>
    <aside class="panel" aria-label="Insta AIO Tampermonkey Instagram toolbox" hidden>
      <header class="header">
        <button class="handle" type="button" data-role="move" aria-label="Move toolbox; use arrow keys for precise movement" title="Drag to move">✥</button>
        <div><h1>Insta AIO Toolbox</h1><p>Tools injected directly on Instagram</p><span class="mode" data-role="mode-label" data-live="locked">Userscript mode · live actions locked</span></div>
        <div style="display:flex">
          <details class="settings">
            <summary aria-label="Toolbox preferences">⚙</summary>
            <div class="settings-panel">
              <strong>Live controls</strong>
              <div class="field">
                <label class="live-toggle" for="aio-live-actions"><input id="aio-live-actions" type="checkbox" data-role="live-actions"> Enable live actions for 15 minutes</label>
                <p class="live-status" data-role="live-status">Locked by default. Scans and no-click checks still work.</p>
              </div>
              <strong>Layout</strong>
              <div class="field"><label for="aio-opacity">Surface transparency</label><div class="range-row"><input id="aio-opacity" type="range" min="55" max="100" value="94" data-preference="opacity"><output data-role="opacity-output">94%</output></div></div>
              <button class="button quiet" type="button" data-action="reset-layout">Reset position and size</button>
              <strong>Pacing</strong>
              <div class="field"><label for="aio-limit-actions">Follow/unfollow per day</label><input id="aio-limit-actions" type="number" min="1" max="400" data-role="limit-actions"></div>
              <div class="field"><label for="aio-limit-unsends">Unsends per day</label><input id="aio-limit-unsends" type="number" min="1" max="300" data-role="limit-unsends"></div>
              <div class="field"><label for="aio-limit-min">Min delay (seconds)</label><input id="aio-limit-min" type="number" min="2" max="600" data-role="limit-min"></div>
              <div class="field"><label for="aio-limit-max">Max delay (seconds)</label><input id="aio-limit-max" type="number" min="2" max="900" data-role="limit-max"></div>
              <button class="button quiet" type="button" data-action="save-limits">Save pacing</button>
              <p class="lead">Drag the header handle or lower corner. Arrow keys work on both.</p>
            </div>
          </details>
          <button class="icon" type="button" data-action="close" aria-label="Collapse Insta AIO toolbox">×</button>
        </div>
      </header>
      <nav class="tabs" role="tablist" aria-label="Insta AIO userscript tools">
        <button class="tab" type="button" role="tab" data-view="checker" aria-selected="true" aria-selected="false" tabindex="-1">Checker</button>
        <button class="tab" type="button" role="tab" data-view="account" aria-selected="false" tabindex="-1">Follow</button>
        <button class="tab" type="button" role="tab" data-view="messages" aria-selected="false" tabindex="-1">Unsend</button>
      </nav>
      <div class="scroll">
        <section class="view" role="tabpanel" data-panel="checker" hidden><p class="lead"><strong>Follower checker.</strong> Open Followers or Following, scroll manually, and capture each rendered batch. Both drafts are compared locally.</p><div class="metrics"><div class="metric"><span>Followers</span><strong data-role="followers-count">0</strong></div><div class="metric"><span>Following</span><strong data-role="following-count">0</strong></div></div><div class="field"><label for="aio-list-type">List being captured</label><select id="aio-list-type" data-role="list-type"><option value="following">Following</option><option value="followers">Followers</option></select></div><div class="toolbar"><button class="button" type="button" data-action="scan-list">Scan full list</button><button class="button quiet" type="button" data-action="capture">Capture visible rows</button><button class="button quiet" type="button" data-action="download-list">Download selected list</button><button class="button quiet" type="button" data-action="clear-capture">Clear checker</button></div><div class="card" data-role="comparison"></div><ul class="list" data-role="capture-list"></ul></section>
        <section class="view" role="tabpanel" data-panel="account" hidden><p class="lead"><strong>Follow / Unfollow review.</strong> Import the PWA manual queue, open one target, and verify the exact profile state without clicking.</p><div class="toolbar"><label class="file quiet">Import queue JSON<input type="file" accept=".json,application/json" data-file="queue"></label><button class="button quiet" type="button" data-action="export-queue">Export queue state</button></div><div class="card" data-role="queue-current"></div><div class="toolbar"><button class="button" type="button" data-action="open-profile">Open exact profile</button><button class="button quiet" type="button" data-action="account-dry-run">Run no-click check</button><button class="button quiet" type="button" data-action="queue-complete">Complete</button><button class="button quiet" type="button" data-action="queue-skip">Skip</button></div><div class="card" data-role="account-result"></div>
          <div class="field"><label for="aio-bot-source">Targets</label><select id="aio-bot-source" data-role="bot-source"><option value="not-following-me-back">Not following me back</option><option value="i-do-not-follow-back">I don't follow back</option><option value="scanned-followers">Last scanned Followers list</option><option value="scanned-following">Last scanned Following list</option><option value="queue">Imported queue</option></select></div>
          <div class="field"><label for="aio-bot-action">Action</label><select id="aio-bot-action" data-role="bot-action"><option value="unfollow">Unfollow</option><option value="follow">Follow</option></select></div>
          <div class="field"><label for="aio-bot-count">How many this run</label><input id="aio-bot-count" type="number" min="1" max="250" value="20" data-role="bot-count"></div>
          <div class="toolbar"><button class="button danger" type="button" data-action="run-accounts" data-live-action>Start run</button></div>
          <p class="notice">To grow from someone else's audience, open their profile, scan their Followers in the checker, then run with <strong>Last scanned Followers list</strong>. Accounts you already follow are skipped automatically. The run stops itself on any rate limit, security check, or block.</p></section>
        <section class="view" role="tabpanel" data-panel="messages" hidden><p class="lead"><strong>DM Unsend review.</strong> Read visible evidence or import one reviewed DM job and resolve its exact sent-message identity without opening a menu.</p><div class="toolbar"><button class="button primary big" type="button" data-action="unsend-all" data-live-action>Unsend all DMs</button><button class="button quiet" type="button" data-action="scan-sent">Scan first</button><button class="button quiet" type="button" data-action="read-messages">Read visible thread</button><label class="file quiet">Import reviewed DM job<input type="file" accept=".json,application/json" data-file="dm"></label><button class="button quiet" type="button" data-action="dm-dry-run">No-click exact check</button></div><div class="card" data-role="dm-result"></div><ul class="list" data-role="message-list"></ul>
          <div class="field"><label for="aio-unsend-scope">Scope</label><select id="aio-unsend-scope" data-role="unsend-scope"><option value="all">Every sent message found</option><option value="newest">Newest N</option><option value="oldest">Oldest N</option></select></div>
          <div class="field"><label for="aio-unsend-count">How many</label><input id="aio-unsend-count" type="number" min="1" max="250" value="20" data-role="unsend-count"></div>
          <div class="toolbar"><button class="button danger" type="button" data-action="run-unsend" data-live-action>Unsend selected</button></div>
          <p class="notice">Only messages you sent are eligible. Each is re-checked by id, time, and content immediately before removal. Unsending cannot be undone.</p></section>
      </div>
      <div class="run-panel" data-role="run-panel" hidden><div class="run-head"><strong data-role="run-title"></strong><button class="button danger" type="button" data-action="stop-run" data-role="stop-run">Stop</button></div><div class="run-bar"><span data-role="run-fill"></span></div><p class="lead" data-role="run-detail"></p><ul class="list" data-role="run-results"></ul></div>
      <footer class="footer" role="status" aria-live="polite"><span data-role="status">Ready. No Instagram control has been used.</span><strong>Local only</strong></footer>
      <button class="resize resize-tl" type="button" data-role="resize-tl" aria-label="Resize toolbox from the top left; use arrow keys for precise sizing" title="Drag to resize"></button>
      <button class="resize" type="button" data-role="resize" aria-label="Resize toolbox; use arrow keys for precise sizing" title="Drag to resize"></button>
    </aside>`;

  const query = (selector) => shadow.querySelector(selector);
  const queryAll = (selector) => [...shadow.querySelectorAll(selector)];
  const setText = (role, value) => {
    const element = query(`[data-role="${role}"]`);
    if (element) element.textContent = String(value ?? '');
  };
  const status = (message) => setText('status', message);

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

  function applyLayout() {
    const size = panelSize();
    host.style.setProperty('--aio-width', `${size.width}px`);
    host.style.setProperty('--aio-height', `${size.height}px`);
    const percent = Math.round(preferences.opacity * 100);
    host.style.setProperty('--aio-alpha', `${percent}%`);
    host.style.setProperty('--aio-alpha-strong', `${Math.min(100, percent + 8)}%`);
    if (preferences.position && innerWidth > 600) {
      const position = constrainedPosition(preferences.position, size);
      host.dataset.floating = 'true';
      host.style.setProperty('--aio-left', `${position.x}px`);
      host.style.setProperty('--aio-top', `${position.y}px`);
    } else {
      host.dataset.floating = 'false';
      host.style.removeProperty('--aio-left');
      host.style.removeProperty('--aio-top');
    }
    const opacity = query('[data-preference="opacity"]');
    if (opacity) opacity.value = String(percent);
    setText('opacity-output', `${percent}%`);
  }

  function renderShellState() {
    const panel = query('.panel');
    const launcher = query('.launcher');
    const newRunUnlocked = newLiveRunAuthorized();
    const activeRunAuthorized = runAuthorizationValid(state.run);
    const liveAvailable = newRunUnlocked || activeRunAuthorized;
    panel.hidden = !preferences.open;
    launcher.hidden = preferences.open;
    launcher.setAttribute('aria-expanded', String(preferences.open));
    for (const tab of queryAll('[data-view]')) {
      const selected = tab.dataset.view === preferences.view;
      tab.setAttribute('aria-selected', String(selected));
      tab.tabIndex = selected ? 0 : -1;
    }
    for (const view of queryAll('[data-panel]')) view.hidden = view.dataset.panel !== preferences.view;

    const modeLabel = query('[data-role="mode-label"]');
    if (modeLabel) {
      modeLabel.dataset.live = liveAvailable ? 'unlocked' : 'locked';
      modeLabel.textContent = externalLiveRunActive
        ? `Userscript mode · thread Unsend authorized ${authorizationRemainingMinutes(liveActionsUnlockedUntil)}m`
        : activeRunAuthorized
        ? `Userscript mode · active run authorized ${authorizationRemainingMinutes(state.run.authorizationExpiresAt)}m`
        : newRunUnlocked
          ? `Userscript mode · live actions unlocked ${authorizationRemainingMinutes(liveActionsUnlockedUntil)}m`
          : 'Userscript mode · live actions locked';
    }

    const liveToggle = query('[data-role="live-actions"]');
    if (liveToggle) {
      liveToggle.checked = newRunUnlocked;
      liveToggle.disabled = state.run?.status === 'running' || externalLiveRunActive;
    }
    setText(
      'live-status',
      externalLiveRunActive
        ? 'Thread-wide Unsend is active. Use Stop to revoke its remaining authorization.'
        : activeRunAuthorized
        ? 'A reviewed batch is active. Use Stop to revoke its remaining authorization.'
        : newRunUnlocked
          ? 'Unlocked temporarily. Every destructive run still needs a separate confirmation.'
          : 'Locked by default. Scans and no-click checks still work.',
    );
    for (const control of queryAll('[data-live-action]')) {
      control.disabled = !newRunUnlocked || state.run?.status === 'running' || externalLiveRunActive;
    }
  }

  function renderNow() {
    const grid = query('[data-role="tool-grid"]');
    grid.replaceChildren();
    const comparison = compareCapture();
    const item = currentQueueItem();
    const liveBadge = liveAuthorized() ? 'live unlocked' : 'live locked';
    const tools = [
      ['checker', 'Follower checker', `${state.capture.followers.length} followers · ${state.capture.following.length} following · ${comparison.notFollowingMeBack.length} not following back`, 'read only'],
      ['account', 'Follow / Unfollow', item ? `${item.action} @${item.account.username} is next` : 'Import a reviewed manual queue', liveBadge],
      ['messages', 'DM Unsend', state.dmTarget ? `Reviewed message ${state.dmTarget.messageId} loaded` : 'Visible evidence and exact-message review', liveBadge],
    ];
    for (const [view, title, detail, badge] of tools) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'tool';
      button.dataset.goView = view;
      const copy = document.createElement('span');
      const strong = document.createElement('strong');
      strong.textContent = title;
      const description = document.createElement('span');
      description.textContent = detail;
      const stateBadge = document.createElement('em');
      stateBadge.textContent = badge;
      copy.append(strong, description);
      button.append(copy, stateBadge);
      grid.append(button);
    }
  }

  function renderChecker() {
    setText('followers-count', state.capture.followers.length);
    setText('following-count', state.capture.following.length);
    const comparison = compareCapture();
    const result = query('[data-role="comparison"]');
    result.replaceChildren();
    const title = document.createElement('h2');
    title.textContent = state.capture.followers.length && state.capture.following.length
      ? 'Rendered-row comparison'
      : 'Capture both lists';
    const detail = document.createElement('p');
    detail.textContent = state.capture.followers.length && state.capture.following.length
      ? `${comparison.mutuals.length} mutual · ${comparison.notFollowingMeBack.length} not following me back · ${comparison.iDoNotFollowBack.length} I don't follow back.`
      : 'Open your Followers list and choose Scan full list, then do the same for Following.';
    result.append(title, detail);

    // A scan that stopped early would otherwise be read as the whole list, and
    // every number below it would quietly be wrong.
    const partial = ['followers', 'following']
      .filter((type) => state.capture[type].length && state.capture.complete?.[type] !== true);
    if (partial.length) {
      const warning = document.createElement('p');
      warning.className = 'notice';
      warning.textContent = `The ${partial.join(' and ')} ${partial.length === 1 ? 'list' : 'lists'} did not reach the end, so these counts are incomplete. Scan again to finish.`;
      result.append(warning);
    }

    if (state.capture.followers.length && state.capture.following.length) {
      const actions = document.createElement('div');
      actions.className = 'toolbar';
      for (const [label, key, file] of [
        ["Export who doesn't follow me back", 'notFollowingMeBack', 'not-following-me-back'],
        ["Export who I don't follow back", 'iDoNotFollowBack', 'i-do-not-follow-back'],
      ]) {
        const button = document.createElement('button');
        button.className = 'button quiet';
        button.type = 'button';
        button.textContent = `${label} (${comparison[key].length})`;
        button.addEventListener('click', () => downloadJson(`insta-aio-${file}-${Date.now()}.json`, {
          schemaVersion: 1,
          kind: 'insta-aio-comparison',
          list: file,
          generatedAt: nowIso(),
          complete: state.capture.complete || {},
          accounts: comparison[key],
        }));
        actions.append(button);
      }
      result.append(actions);
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
      : 'Import an insta-aio-manual-queue JSON file.';
    current.append(title, detail);
    const result = query('[data-role="account-result"]');
    result.replaceChildren();
    const resultTitle = document.createElement('h3');
    resultTitle.textContent = state.accountCheck?.exact ? 'Exact no-click check passed' : 'No-click check';
    const resultDetail = document.createElement('p');
    resultDetail.textContent = state.accountCheck?.result || 'Open the exact queued profile, then run the check.';
    result.append(resultTitle, resultDetail);
  }

  function renderMessages() {
    const result = query('[data-role="dm-result"]');
    result.replaceChildren();
    const title = document.createElement('h2');
    title.textContent = state.dmCheck?.exact
      ? 'Exact sent message resolved'
      : state.dmTarget
        ? `Reviewed message ${state.dmTarget.messageId}`
        : 'No reviewed DM target loaded';
    const detail = document.createElement('p');
    detail.textContent = state.dmCheck?.reason
      || state.messageEvidence?.reason
      || 'Read visible evidence or import one reviewed DM job.';
    result.append(title, detail);
    const list = query('[data-role="message-list"]');
    list.replaceChildren();
    for (const fragment of (state.messageEvidence?.fragments || [])) {
      const row = document.createElement('li');
      row.textContent = fragment.text;
      const meta = document.createElement('small');
      meta.textContent = 'Visible fragment · ownership unknown';
      row.append(meta);
      list.append(row);
    }
    if (!(state.messageEvidence?.fragments || []).length) {
      const row = document.createElement('li');
      row.textContent = 'No visible thread evidence captured.';
      list.append(row);
    }
  }

  function renderAll() {
    applyLayout();
    renderShellState();
    renderChecker();
    renderAccount();
    renderMessages();
    renderRun();
    renderLimits();
  }

  function renderLimits() {
    const bounds = limits();
    const set = (role, value) => {
      const field = query(`[data-role="${role}"]`);
      if (field && document.activeElement !== field) field.value = String(value);
    };
    set('limit-actions', bounds.dailyActions);
    set('limit-unsends', bounds.dailyUnsends);
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
    if (parsed?.kind !== 'insta-aio-manual-queue' || !Array.isArray(parsed.queue)) {
      throw new Error('Select an Insta AIO manual queue export.');
    }
    state.queue = normalizeQueue({ queue: parsed.queue, importedAt: nowIso() });
    saveState();
    status(`Imported ${state.queue.queue.length} local queue items.`);
  }

  async function importDmJob(file) {
    const parsed = await readJsonFile(file);
    if (parsed?.kind !== 'insta-aio-reviewed-dm-job' || parsed.items?.length !== 1) {
      throw new Error('Select one reviewed Insta AIO DM job containing exactly one message.');
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
    status(`Marked @${item.account.username} ${statusValue} in userscript-local state.`);
  }

  // --- Live actions -------------------------------------------------------
  //
  // The engine bundled above is the same one the extension runs. It still mints
  // a one-use resolution token during inspection and refuses to act unless the
  // token matches the element it resolved, so a live run here gets exactly the
  // same exact-target checks the extension gets.

  const engine = globalThis.InstaAioInstagramInspector;

  const LIMIT_BOUNDS = {
    dailyActions: [1, 400],
    dailyUnsends: [1, 300],
    minDelayMs: [1_500, 600_000],
    maxDelayMs: [1_500, 900_000],
  };
  const REST_EVERY = 20;
  const REST_MS = 90_000;

  let batchAbort = false;
  let liveActionsUnlockedUntil = 0;
  let liveAuthorizationTimer = null;
  let externalLiveRunActive = false;

  function authorizationRemainingMinutes(expiresAt) {
    return Math.max(1, Math.ceil((Number(expiresAt) - Date.now()) / 60_000));
  }

  function newLiveRunAuthorized() {
    return liveActionsUnlockedUntil > Date.now();
  }

  function runAuthorizationValid(run = state.run) {
    return run?.status === 'running' && Number(run.authorizationExpiresAt) > Date.now();
  }

  function liveAuthorized() {
    return newLiveRunAuthorized() || runAuthorizationValid();
  }

  function requireNewRunAuthorization() {
    if (newLiveRunAuthorized() && !externalLiveRunActive) return true;
    if (externalLiveRunActive) {
      status('Thread-wide Unsend is already running. Stop it before starting another live action.');
      renderAll();
      return false;
    }
    status('Live actions are locked. Open preferences and enable the 15-minute live window first.');
    renderAll();
    return false;
  }

  function stopForExpiredAuthorization() {
    batchAbort = true;
    const accountPatch = state.run?.kind === 'account' ? { queue: [] } : {};
    setRun({
      ...accountPatch,
      status: 'stopped',
      stopReason: 'live authorization expired',
      current: '',
      nextAt: null,
    });
    status('Live authorization expired. The run stopped before another Instagram action.');
  }

  function scheduleLiveAuthorizationExpiry() {
    if (liveAuthorizationTimer) clearTimeout(liveAuthorizationTimer);
    if (!newLiveRunAuthorized()) return;
    liveAuthorizationTimer = setTimeout(() => {
      liveActionsUnlockedUntil = 0;
      liveAuthorizationTimer = null;
      if (externalLiveRunActive) {
        globalThis.InstaAioDmThreadUnsender?.stop?.();
        renderAll();
        status('Live authorization expired. Thread-wide Unsend is stopping before another message.');
        return;
      }
      if (state.run?.status === 'running' && !runAuthorizationValid()) {
        stopForExpiredAuthorization();
        return;
      }
      renderAll();
      status('The 15-minute live window expired. Scans and no-click checks remain available.');
    }, Math.max(0, liveActionsUnlockedUntil - Date.now()));
  }

  function setLiveActionsUnlocked(enabled) {
    if (!enabled) {
      liveActionsUnlockedUntil = 0;
      if (liveAuthorizationTimer) clearTimeout(liveAuthorizationTimer);
      liveAuthorizationTimer = null;
      if (externalLiveRunActive) {
        globalThis.InstaAioDmThreadUnsender?.stop?.();
        renderAll();
        status('Live actions locked. Thread-wide Unsend is stopping.');
        return;
      }
      if (state.run?.status === 'running') {
        stopForExpiredAuthorization();
        return;
      }
      renderAll();
      status('Live actions locked. Instagram was not changed.');
      return;
    }

    // A typed phrase prevents an accidental checkbox or synthetic pointer event
    // from granting destructive authority. This tab-only window is never saved
    // as a general preference; only an already-confirmed account run carries its
    // expiry across the profile navigations that the run itself causes.
    const answer = globalThis.prompt(
      `Type ${LIVE_AUTHORIZATION_PHRASE} to unlock Follow, Unfollow, and Unsend for 15 minutes.`,
      '',
    );
    if (answer !== LIVE_AUTHORIZATION_PHRASE) {
      liveActionsUnlockedUntil = 0;
      renderAll();
      status('Live actions stayed locked. The authorization phrase did not match.');
      return;
    }
    liveActionsUnlockedUntil = Date.now() + LIVE_AUTHORIZATION_MS;
    scheduleLiveAuthorizationExpiry();
    renderAll();
    status('Live actions unlocked for 15 minutes. Each run still needs confirmation.');
  }

  function clampNumber(value, [minimum, maximum], fallback) {
    const number = Number(value);
    if (!Number.isFinite(number)) return fallback;
    return Math.min(maximum, Math.max(minimum, Math.round(number)));
  }

  function limits() {
    const stored = state.limits || {};
    return {
      dailyActions: clampNumber(stored.dailyActions, LIMIT_BOUNDS.dailyActions, 100),
      dailyUnsends: clampNumber(stored.dailyUnsends, LIMIT_BOUNDS.dailyUnsends, 50),
      minDelayMs: clampNumber(stored.minDelayMs, LIMIT_BOUNDS.minDelayMs, 4_000),
      maxDelayMs: clampNumber(stored.maxDelayMs, LIMIT_BOUNDS.maxDelayMs, 11_000),
    };
  }

  function today() {
    return new Date().toISOString().slice(0, 10);
  }

  function usedToday(kind) {
    const ledger = state.ledger || {};
    return ledger.day === today() ? Number(ledger[kind] || 0) : 0;
  }

  function recordAction(kind) {
    const ledger = state.ledger?.day === today()
      ? state.ledger
      : { day: today(), actions: 0, unsends: 0 };
    ledger[kind] = Number(ledger[kind] || 0) + 1;
    state.ledger = ledger;
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

  async function runOneUnsend(message) {
    const observation = engine.inspectReviewedDmItem({
      conversationId: message.conversationId,
      contentDigest: message.contentDigest,
      messageId: message.messageId,
      sentByMe: true,
      timestamp: message.timestamp,
    });
    const stop = sessionStop(observation);
    if (stop) return { status: 'stopped', reason: stop, fatal: true };
    if (
      observation?.messageId !== String(message.messageId)
      || Number(observation?.timestamp) !== Number(message.timestamp)
      || observation?.contentDigest !== message.contentDigest
      || observation?.sentByMe !== true
      || observation?.exactIdentityAvailable !== true
      || observation?.ownershipAvailable !== true
      || observation?.ambiguous
      || observation?.unexpectedUi
      || !observation?.resolutionToken
    ) {
      return {
        status: 'skipped',
        reason: observation?.reason || 'could not re-identify this message',
        fatal: false,
      };
    }
    const result = await engine.performReviewedDmUnsend({
      conversationId: String(message.conversationId),
      contentDigest: message.contentDigest,
      messageId: String(message.messageId),
      resolutionToken: observation.resolutionToken,
      sentByMe: true,
      timestamp: Number(message.timestamp),
    });
    const resultStop = sessionStop(result);
    if (resultStop) return { status: 'stopped', reason: resultStop, fatal: true };
    if (result?.result !== 'unsent') {
      return { status: 'failed', reason: result?.reason || 'not confirmed', fatal: false };
    }
    recordAction('unsends');
    return { status: 'completed', reason: 'unsent', fatal: false };
  }

  // An account run has to visit each target's profile, and navigating tears this
  // script down and reloads it. So an account run is persisted with its
  // remaining queue and picked up again on the next page load: one profile per
  // load. That is safe because every item is independently re-resolved on
  // arrival and still has to pass the exact-target checks before anything
  // happens — resuming never inherits trust from the previous page.
  //
  // DM runs stay in-memory: they act inside one already-open conversation and
  // never navigate, so a reload means the thread they were driving is gone.
  function resumableAccountRun() {
    const run = state.run;
    if (!run || run.kind !== 'account' || run.status !== 'running') return null;
    return Array.isArray(run.queue) && run.queue.length ? run : null;
  }

  async function continueAccountRun() {
    const run = resumableAccountRun();
    if (!run) return;
    if (!runAuthorizationValid(run)) {
      stopForExpiredAuthorization();
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
    if (!requireNewRunAuthorization()) return;
    if (!managerTabStorageAvailable) {
      status('This userscript manager does not provide isolated tab storage, so account batches stay disabled. Scans and no-click checks still work.');
      return;
    }
    if (state.run?.status === 'running') {
      status('A run is already going. Stop it first.');
      return;
    }
    const bounds = limits();
    const allowance = Math.max(0, bounds.dailyActions - usedToday('actions'));
    if (!allowance) {
      status(`Daily limit reached (${bounds.dailyActions}). Raise it in preferences or continue tomorrow.`);
      return;
    }
    const queue = usernames.slice(0, allowance);
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
      authorizationExpiresAt: liveActionsUnlockedUntil,
      results: [],
    });
    await continueAccountRun();
  }

  async function runBatch({ kind, action, items }) {
    if (!requireNewRunAuthorization()) return;
    if (state.run?.status === 'running') {
      status('A run is already going. Stop it first.');
      return;
    }
    const bounds = limits();
    const cap = kind === 'dm' ? bounds.dailyUnsends : bounds.dailyActions;
    const already = usedToday(kind === 'dm' ? 'unsends' : 'actions');
    const allowance = Math.max(0, cap - already);
    if (!allowance) {
      status(`Daily limit reached (${cap}). Raise it in preferences or continue tomorrow.`);
      return;
    }
    const queued = items.slice(0, allowance);
    batchAbort = false;
    setRun({
      status: 'running',
      kind,
      action,
      total: queued.length,
      completed: 0,
      skipped: 0,
      failed: 0,
      current: '',
      stopReason: null,
      authorizationExpiresAt: liveActionsUnlockedUntil,
      results: [],
    });

    for (let index = 0; index < queued.length; index += 1) {
      if (batchAbort) break;
      if (!runAuthorizationValid()) {
        stopForExpiredAuthorization();
        return;
      }
      const item = queued[index];
      const label = kind === 'dm' ? (item.preview || item.messageId) : `@${item.username}`;
      setRun({ current: label });

      let outcome;
      try {
        outcome = kind === 'dm'
          ? await runOneUnsend(item)
          : await runOneAccount(item.username, action);
      } catch (error) {
        outcome = { status: 'failed', reason: error.message, fatal: false };
      }

      const run = state.run || {};
      const results = [{
        label,
        status: outcome.status,
        reason: outcome.reason,
      }, ...(run.results || [])].slice(0, 40);
      const patch = { results };
      if (outcome.status === 'completed') patch.completed = (run.completed || 0) + 1;
      else if (outcome.status === 'skipped') patch.skipped = (run.skipped || 0) + 1;
      else patch.failed = (run.failed || 0) + 1;
      setRun(patch);

      if (outcome.fatal) {
        setRun({ status: 'stopped', stopReason: outcome.reason, current: '' });
        status(`Stopped: ${outcome.reason}. Nothing further was attempted.`);
        return;
      }

      if (index < queued.length - 1) {
        let wait = bounds.minDelayMs
          + Math.floor(Math.random() * (Math.max(bounds.maxDelayMs, bounds.minDelayMs) - bounds.minDelayMs + 1));
        if ((index + 1) % REST_EVERY === 0) wait += REST_MS;
        setRun({ nextAt: Date.now() + wait });
        await sleep(wait);
      }
    }

    const run = state.run || {};
    setRun({
      status: batchAbort ? 'aborted' : 'completed',
      stopReason: batchAbort ? 'stopped by you' : null,
      current: '',
      nextAt: null,
    });
    status(
      batchAbort
        ? 'Run stopped. Nothing further was attempted.'
        : `Run finished: ${run.completed || 0} done, ${run.skipped || 0} skipped, ${run.failed || 0} failed.`,
    );
  }

  function confirmRun(message) {
    // eslint-disable-next-line no-alert
    return globalThis.confirm(message);
  }

  const actions = {
    open: () => savePreferences({ open: true }),
    close: () => savePreferences({ open: false }),
    'stop-run': () => {
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
      const outcome = await engine.collectAccountList();
      if (sessionStop(outcome)) {
        status(`Stopped: ${sessionStop(outcome)}.`);
        return;
      }
      const accounts = outcome?.accounts || [];
      if (!accounts.length) {
        status(`No rows were readable. Open your ${listType} list first.`);
        return;
      }
      const merged = new Map(state.capture[listType].map((a) => [a.username, a]));
      for (const account of accounts) merged.set(account.username, account);
      state.capture[listType] = normalizeAccounts([...merged.values()]);
      state.capture.capturedAt[listType] = nowIso();
      state.capture.complete = { ...(state.capture.complete || {}), [listType]: outcome.complete === true };
      saveState();
      renderAll();
      status(
        `Scanned ${accounts.length} ${listType} rows.${outcome.complete ? '' : ' The list did not reach its end, so some may be missing.'}`,
      );
    },
    'scan-sent': async () => {
      status('Scanning this conversation for messages you sent.');
      const outcome = await engine.enumerateSentDms();
      if (sessionStop(outcome)) {
        status(`Stopped: ${sessionStop(outcome)}.`);
        return;
      }
      state.sentDms = outcome?.messages || [];
      state.sentDmsComplete = outcome?.complete === true;
      saveState();
      renderAll();
      status(
        state.sentDms.length
          ? `Found ${state.sentDms.length} of your sent messages.${outcome.complete ? '' : ' Older ones may still be unloaded.'}`
          : 'No exactly identifiable sent messages were found in this thread.',
      );
    },
    'run-accounts': async () => {
      if (!requireNewRunAuthorization()) return;
      const action = query('[data-role="bot-action"]')?.value === 'follow' ? 'follow' : 'unfollow';
      const source = query('[data-role="bot-source"]')?.value || 'not-following-me-back';
      const count = clampNumber(query('[data-role="bot-count"]')?.value, [1, 250], 20);
      const comparison = compareCapture();
      const names = (list) => (list || []).map((entry) => entry.username || entry);
      const pools = {
        queue: () => (state.queue.queue || [])
          .filter((entry) => ACTIONABLE_STATUSES.has(entry.status))
          .map((entry) => entry.account?.username),
        'i-do-not-follow-back': () => names(comparison.iDoNotFollowBack),
        'not-following-me-back': () => names(comparison.notFollowingMeBack),
        // Scanning works on whichever list is open, including another account's,
        // so these two are how you build an audience from someone else's people.
        'scanned-followers': () => names(state.capture.followers),
        'scanned-following': () => names(state.capture.following),
      };
      let pool = (pools[source] || pools['not-following-me-back'])();

      // Following someone you already follow is a wasted action and a needless
      // request, so drop anyone already in the Following draft.
      if (action === 'follow' && state.capture.following.length) {
        const already = new Set(names(state.capture.following));
        pool = pool.filter((username) => !already.has(username));
      }

      const items = [...new Set(pool.filter(Boolean))]
        .slice(0, count)
        .map((username) => ({ username }));
      if (!items.length) {
        status(
          source.startsWith('scanned')
            ? 'That list is empty. Open the list you want and use Scan full list first.'
            : 'No targets. Scan both your lists in the checker first, or import a queue.',
        );
        return;
      }
      if (!confirmRun(
        `${action === 'follow' ? 'Follow' : 'Unfollow'} ${items.length} account${items.length === 1 ? '' : 's'}?\n\n`
        + 'This tab will move between profiles and the run continues across page loads. It changes your account.',
      )) return;
      await startAccountRun({ action, usernames: items.map((item) => item.username) });
    },
    // One button: find everything you sent in this thread, then remove it.
    'unsend-all': async () => {
      if (!requireNewRunAuthorization()) return;
      if (state.run?.status === 'running') {
        status('A run is already going. Stop it first.');
        return;
      }
      status('Reading the whole conversation. This can take a while on a long thread.');
      const outcome = await engine.enumerateSentDms({ limit: 5_000 });
      const stop = sessionStop(outcome);
      if (stop) {
        status(`Stopped: ${stop}.`);
        return;
      }
      const messages = outcome?.messages || [];
      state.sentDms = messages;
      state.sentDmsComplete = outcome?.complete === true;
      saveState();
      renderAll();
      if (!messages.length) {
        status(
          outcome?.reason === 'open-an-instagram-conversation'
            ? 'Open a conversation first.'
            : 'No messages of yours could be identified exactly in this thread, so nothing was touched.',
        );
        return;
      }
      if (!confirmRun(
        `Unsend all ${messages.length} message${messages.length === 1 ? '' : 's'} you sent in this conversation?\n\n`
        + (outcome.complete ? '' : 'Note: the thread did not fully load, so there may be more.\n\n')
        + 'This is permanent and cannot be undone.',
      )) {
        status('Cancelled. Nothing was unsent.');
        return;
      }
      await runBatch({ kind: 'dm', items: messages });
    },
    'run-unsend': async () => {
      if (!requireNewRunAuthorization()) return;
      const found = state.sentDms || [];
      if (!found.length) {
        status('Scan your sent messages first.');
        return;
      }
      const scope = query('[data-role="unsend-scope"]')?.value || 'all';
      const count = clampNumber(query('[data-role="unsend-count"]')?.value, [1, 250], found.length);
      let selected = found;
      if (scope === 'newest') selected = found.slice(0, count);
      if (scope === 'oldest') selected = found.slice(-count);
      if (!confirmRun(
        `Permanently unsend ${selected.length} message${selected.length === 1 ? '' : 's'}?\n\n`
        + 'This cannot be undone.',
      )) return;
      await runBatch({ kind: 'dm', items: selected });
    },
    'save-limits': () => {
      state.limits = {
        dailyActions: clampNumber(query('[data-role="limit-actions"]')?.value, LIMIT_BOUNDS.dailyActions, 100),
        dailyUnsends: clampNumber(query('[data-role="limit-unsends"]')?.value, LIMIT_BOUNDS.dailyUnsends, 50),
        minDelayMs: clampNumber(Number(query('[data-role="limit-min"]')?.value) * 1000, LIMIT_BOUNDS.minDelayMs, 4_000),
        maxDelayMs: clampNumber(Number(query('[data-role="limit-max"]')?.value) * 1000, LIMIT_BOUNDS.maxDelayMs, 11_000),
      };
      saveState();
      status('Pacing saved.');
    },
    'reset-layout': () => savePreferences({ ...preferencesDefaults(), open: true, view: preferences.view }),
    capture: () => {
      const listType = query('[data-role="list-type"]').value === 'followers' ? 'followers' : 'following';
      const visible = captureVisibleAccounts();
      const accounts = new Map(state.capture[listType].map((account) => [account.username, account]));
      const before = accounts.size;
      for (const account of visible) accounts.set(account.username, account);
      state.capture[listType] = normalizeAccounts([...accounts.values()]);
      state.capture.capturedAt[listType] = nowIso();
      saveState();
      status(`Captured ${visible.length} rendered ${listType} rows; ${state.capture[listType].length - before} were new.`);
    },
    'clear-capture': () => {
      state.capture = stateDefaults().capture;
      saveState();
      status('Cleared both follower checker drafts. Instagram was not changed.');
    },
    'download-list': () => {
      const listType = query('[data-role="list-type"]').value === 'followers' ? 'followers' : 'following';
      downloadJson(`insta-aio-visible-${listType}-${Date.now()}.json`, {
        schemaVersion: 1,
        kind: 'insta-aio-visible-list',
        listType,
        capturedAt: state.capture.capturedAt[listType] || nowIso(),
        [listType]: state.capture[listType],
        note: 'Only rows rendered in Instagram were captured. Scroll manually and capture again to merge more rows.',
      });
    },
    'export-queue': () => downloadJson(`insta-aio-companion-state-${Date.now()}.json`, {
      schemaVersion: 2,
      kind: 'insta-aio-companion-state',
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

  shadow.addEventListener('click', (event) => {
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
      actions[target.dataset.action]?.();
      renderAll();
    } catch (error) {
      status(`Stopped: ${error.message}`);
    }
  });

  shadow.addEventListener('change', async (event) => {
    try {
      if (event.target.matches('[data-role="list-type"]')) {
        renderChecker();
        return;
      }
      if (event.target.matches('[data-role="live-actions"]')) {
        setLiveActionsUnlocked(event.target.checked);
        return;
      }
      if (event.target.matches('[data-preference="opacity"]')) {
        savePreferences({ opacity: Number(event.target.value) / 100 });
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
    if (!event.target.matches('[data-preference="opacity"]')) return;
    const percent = Number(event.target.value);
    host.style.setProperty('--aio-alpha', `${percent}%`);
    host.style.setProperty('--aio-alpha-strong', `${Math.min(100, percent + 8)}%`);
    setText('opacity-output', `${percent}%`);
  });

  shadow.addEventListener('keydown', (event) => {
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

  let interaction = null;
  const panel = query('.panel');
  const moveHandle = query('[data-role="move"]');
  const resizeHandle = query('[data-role="resize"]');
  const resizeTopLeftHandle = query('[data-role="resize-tl"]');

  function beginInteraction(event, kind) {
    if (event.button !== 0 || innerWidth <= 600) return;
    const rectangle = panel.getBoundingClientRect();
    interaction = { kind, pointerId: event.pointerId, x: event.clientX, y: event.clientY, rectangle };
    event.currentTarget.setPointerCapture?.(event.pointerId);
    event.preventDefault();
  }

  function interactionPatch(event) {
    const deltaX = event.clientX - interaction.x;
    const deltaY = event.clientY - interaction.y;
    if (interaction.kind === 'move') {
      return { position: constrainedPosition({ x: interaction.rectangle.left + deltaX, y: interaction.rectangle.top + deltaY }) };
    }
    const maxWidth = Math.min(WIDTH_MAX, innerWidth - (INSET * 2));
    const maxHeight = Math.min(HEIGHT_MAX, innerHeight - (INSET * 2));
    if (interaction.kind === 'resize-tl') {
      // Dragging the top-left grip grows the panel toward the top left, so the
      // opposite corner has to stay put while the origin moves with it.
      const width = Math.round(clamp(interaction.rectangle.width - deltaX, WIDTH_MIN, maxWidth));
      const height = Math.round(clamp(interaction.rectangle.height - deltaY, HEIGHT_MIN, maxHeight));
      return {
        width,
        height,
        position: constrainedPosition({
          x: interaction.rectangle.right - width,
          y: interaction.rectangle.bottom - height,
        }),
      };
    }
    return {
      width: Math.round(clamp(interaction.rectangle.width + deltaX, WIDTH_MIN, maxWidth)),
      height: Math.round(clamp(interaction.rectangle.height + deltaY, HEIGHT_MIN, maxHeight)),
    };
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
    interaction = null;
    savePreferences(patch);
  }

  function keyboardLayout(event, kind) {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
    const step = event.shiftKey ? 40 : 12;
    const rectangle = panel.getBoundingClientRect();
    if (kind === 'move') {
      savePreferences({ position: constrainedPosition({
        x: (preferences.position?.x ?? rectangle.left) + (event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0),
        y: (preferences.position?.y ?? rectangle.top) + (event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0),
      }) });
    } else {
      savePreferences({
        width: preferences.width + (event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0),
        height: preferences.height + (event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0),
      });
    }
    event.preventDefault();
  }

  moveHandle.addEventListener('pointerdown', (event) => beginInteraction(event, 'move'));
  // Dragging anywhere on the header is far easier to hit than the grip alone,
  // as long as the real controls in it still behave like controls.
  query('.header')?.addEventListener('pointerdown', (event) => {
    if (event.target.closest('button, select, summary, input, a, label, [data-view], [data-action]')) return;
    beginInteraction(event, 'move');
  });
  resizeHandle.addEventListener('pointerdown', (event) => beginInteraction(event, 'resize'));
  resizeTopLeftHandle?.addEventListener('pointerdown', (event) => beginInteraction(event, 'resize-tl'));
  resizeTopLeftHandle?.addEventListener('keydown', (event) => keyboardLayout(event, 'resize'));
  moveHandle.addEventListener('keydown', (event) => keyboardLayout(event, 'move'));
  resizeHandle.addEventListener('keydown', (event) => keyboardLayout(event, 'resize'));
  window.addEventListener('pointermove', moveInteraction, { passive: false });
  window.addEventListener('pointerup', endInteraction);
  window.addEventListener('pointercancel', endInteraction);
  window.addEventListener('resize', () => {
    if (preferences.position) savePreferences({ position: constrainedPosition(preferences.position) });
    else applyLayout();
  });

  function toggleToolboxShortcut(event) {
    if (!event.altKey || !event.shiftKey || event.ctrlKey || event.metaKey || event.key.toLowerCase() !== 'i') return;
    savePreferences({ open: !preferences.open });
    event.preventDefault();
  }
  window.addEventListener('keydown', toggleToolboxShortcut, true);

  const duplicateObserver = new MutationObserver(() => {
    if (!document.getElementById(EXTENSION_ROOT_ID)) return;
    duplicateObserver.disconnect();
    window.removeEventListener('keydown', toggleToolboxShortcut, true);
    host.remove();
  });
  duplicateObserver.observe(document.documentElement, { childList: true, subtree: true });

  Object.defineProperty(globalThis, 'InstaAioUserscriptLiveAuthority', {
    configurable: false,
    enumerable: false,
    value: Object.freeze({
      canStart: () => newLiveRunAuthorized()
        && state.run?.status !== 'running'
        && !externalLiveRunActive,
      expiresAt: () => (newLiveRunAuthorized() ? liveActionsUnlockedUntil : 0),
      setExternalRunActive: (active) => {
        externalLiveRunActive = active === true;
        renderAll();
      },
    }),
    writable: false,
  });

  document.documentElement.append(host);
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

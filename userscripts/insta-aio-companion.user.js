// ==UserScript==
// @name         Insta AIO Instagram Toolbox
// @namespace    https://github.com/slaveofsolace/Insta-AIO-Tool
// @version      0.5.0
// @description  Follower checker, follow/unfollow review, and sent-message tools that appear in a movable panel directly on Instagram.
// @author       slaveofsolace
// @homepageURL  https://github.com/slaveofsolace/Insta-AIO-Tool
// @supportURL   https://github.com/slaveofsolace/Insta-AIO-Tool/issues
// @downloadURL  https://raw.githubusercontent.com/slaveofsolace/Insta-AIO-Tool/main/userscripts/insta-aio-companion.user.js
// @updateURL    https://raw.githubusercontent.com/slaveofsolace/Insta-AIO-Tool/main/userscripts/insta-aio-companion.user.js
// @icon         data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E%3Crect width='64' height='64' rx='14' fill='%23111'/%3E%3Ctext x='32' y='43' font-family='system-ui,sans-serif' font-size='28' font-weight='700' text-anchor='middle' fill='%23fff'%3EAIO%3C/text%3E%3C/svg%3E
// @license      MIT
// @match        https://www.instagram.com/*
// @grant        GM_getValue
// @grant        GM_setValue
// @run-at       document-idle
// ==/UserScript==

(() => {
  'use strict';

  const EXTENSION_ROOT_ID = 'insta-aio-sidecar-root';
  const ROOT_ID = 'insta-aio-userscript-root';
  const STATE_KEY = 'instaAioUserscriptStateV2';
  const PREFERENCES_KEY = 'instaAioUserscriptPreferencesV1';
  const LEGACY_QUEUE_KEY = 'instaAioManualQueueV1';
  const ACTIONABLE_STATUSES = new Set(['pending', 'ready', 'failed', 'paused']);
  const RESERVED = new Set([
    'accounts', 'about', 'api', 'developer', 'direct', 'emails', 'explore',
    'legal', 'privacy', 'reels', 'settings', 'stories', 'terms', 'web',
  ]);
  const VIEWS = ['now', 'checker', 'account', 'messages'];
  const WIDTH_MIN = 320;
  const WIDTH_MAX = 560;
  const HEIGHT_MIN = 320;
  const HEIGHT_MAX = 1_100;
  const INSET = 8;

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
      },
      queue: { queue: [], importedAt: null },
      accountCheck: null,
      messageEvidence: null,
      dmTarget: null,
      dmCheck: null,
      history: [],
    };
  }

  function preferencesDefaults() {
    return {
      schemaVersion: 1,
      open: true,
      view: 'now',
      position: null,
      width: 390,
      height: 620,
      opacity: 0.88,
    };
  }

  function loadState() {
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
      },
      queue: normalizeQueue(value.queue?.queue?.length ? value.queue : legacyQueue),
      accountCheck: value.accountCheck && typeof value.accountCheck === 'object' ? value.accountCheck : null,
      messageEvidence: value.messageEvidence && typeof value.messageEvidence === 'object' ? value.messageEvidence : null,
      dmTarget: value.dmTarget && typeof value.dmTarget === 'object' ? value.dmTarget : null,
      dmCheck: value.dmCheck && typeof value.dmCheck === 'object' ? value.dmCheck : null,
      history: Array.isArray(value.history) ? value.history.slice(0, 20) : [],
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
      view: VIEWS.includes(source.view) ? source.view : 'now',
      position,
      width: Math.round(clamp(source.width || 390, WIDTH_MIN, WIDTH_MAX)),
      height: Math.round(clamp(source.height || 620, HEIGHT_MIN, HEIGHT_MAX)),
      opacity: Math.round(clamp(source.opacity || 0.88, 0.7, 1) * 100) / 100,
    };
  }

  let state = loadState();
  let preferences = normalizePreferences(GM_getValue(PREFERENCES_KEY, preferencesDefaults()));

  function saveState() {
    GM_setValue(STATE_KEY, state);
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
      :host { all: initial; --aio-alpha: 88%; --aio-alpha-strong: 96%; --aio-width: 390px; --aio-height: 620px; color-scheme: light; font-family: "Segoe UI Variable", "Segoe UI", system-ui, sans-serif; }
      *, *::before, *::after { box-sizing: border-box; }
      button, input, select { font: inherit; }
      button, label, summary { cursor: pointer; }
      [hidden] { display: none !important; }
      .launcher { position: fixed; z-index: 2147482900; right: 16px; bottom: 16px; width: 46px; height: 46px; border: 1px solid #cfd5cc; border-radius: 14px; background: rgba(255,255,255,.9); color: #172018; box-shadow: 0 10px 32px rgba(0,0,0,.2); font-weight: 850; }
      .panel { position: fixed; z-index: 2147482900; top: 62px; right: 16px; width: min(var(--aio-width), calc(100vw - 24px)); height: min(var(--aio-height), calc(100dvh - 74px)); display: grid; grid-template-rows: auto auto minmax(0,1fr) auto; overflow: hidden; border: 1px solid #cfd5cc; border-radius: 14px; background: color-mix(in srgb, #f7f8f5 var(--aio-alpha), transparent); color: #1b211c; box-shadow: 0 20px 60px rgba(0,0,0,.24); backdrop-filter: blur(10px) saturate(.95); -webkit-backdrop-filter: blur(10px) saturate(.95); font: 14px/1.45 "Segoe UI Variable", "Segoe UI", system-ui, sans-serif; }
      :host([data-floating="true"]) .panel { top: var(--aio-top); right: auto; left: var(--aio-left); }
      .header { display: grid; grid-template-columns: auto minmax(0,1fr) auto; gap: 8px; align-items: center; min-height: 66px; padding: 10px; border-bottom: 1px solid #d8ddd4; background: color-mix(in srgb, #fff var(--aio-alpha-strong), transparent); }
      .handle, .icon { width: 44px; height: 44px; display: grid; place-items: center; border: 0; border-radius: 9px; background: transparent; color: inherit; }
      .handle { cursor: grab; touch-action: none; font-size: 18px; }
      .header h1 { margin: 0; font-size: 17px; line-height: 1.15; }
      .header p { margin: 2px 0 0; color: #667067; font-size: 11px; }
      .mode { display: inline-flex; margin-top: 4px; border: 1px solid #8b6a20; border-radius: 999px; padding: 2px 7px; color: #72520d; font-size: 10px; font-weight: 750; }
      .tabs { display: grid; grid-template-columns: repeat(4,minmax(44px,1fr)); border-bottom: 1px solid #d8ddd4; background: color-mix(in srgb, #eef1ec var(--aio-alpha-strong), transparent); }
      .tab { min-height: 48px; border: 0; border-bottom: 3px solid transparent; padding: 6px 3px; background: transparent; color: #616a61; font-size: 11px; font-weight: 700; }
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
      .resize { position: absolute; right: 2px; bottom: 2px; width: 34px; height: 34px; border: 0; background: transparent; cursor: nwse-resize; touch-action: none; }
      .resize::before { content:""; position:absolute; right:8px; bottom:8px; width:12px; height:12px; border-right:2px solid #687068; border-bottom:2px solid #687068; }
      button:focus-visible, select:focus-visible, input:focus-visible, summary:focus-visible, .file:focus-within { outline: 3px solid #168cff; outline-offset: 2px; }
      @media (max-width: 600px) { .panel { top:auto; right:0; bottom:0; left:0; width:100%; height:min(78dvh,720px); border-radius:14px 14px 0 0; } .handle,.resize { display:none; } .header { grid-template-columns:minmax(0,1fr) auto; } }
      @media (prefers-reduced-motion: reduce) { * { scroll-behavior:auto !important; } }
      @media (forced-colors: active) { .panel,.card,.tool,.metric,.header,.footer { background:Canvas; } .panel,.card,.tool,.metric { border:2px solid CanvasText; } }
    </style>
    <button class="launcher" type="button" data-action="open" aria-label="Open Insta AIO Instagram toolbox" aria-expanded="false">AIO</button>
    <aside class="panel" aria-label="Insta AIO Tampermonkey Instagram toolbox" hidden>
      <header class="header">
        <button class="handle" type="button" data-role="move" aria-label="Move toolbox; use arrow keys for precise movement" title="Drag to move">✥</button>
        <div><h1>Insta AIO Toolbox</h1><p>Tools injected directly on Instagram</p><span class="mode">Userscript mode · no live clicks</span></div>
        <div style="display:flex"><details class="settings"><summary aria-label="Toolbox preferences">⚙</summary><div class="settings-panel"><strong>Layout</strong><div class="field"><label for="aio-opacity">Surface transparency</label><div class="range-row"><input id="aio-opacity" type="range" min="70" max="100" value="88" data-preference="opacity"><output data-role="opacity-output">88%</output></div></div><button class="button quiet" type="button" data-action="reset-layout">Reset position and size</button><p class="lead">Drag the header handle or lower corner. Arrow keys work on both.</p></div></details><button class="icon" type="button" data-action="close" aria-label="Collapse Insta AIO toolbox">×</button></div>
      </header>
      <nav class="tabs" role="tablist" aria-label="Insta AIO userscript tools">
        <button class="tab" type="button" role="tab" data-view="now" aria-selected="true">Tools</button>
        <button class="tab" type="button" role="tab" data-view="checker" aria-selected="false" tabindex="-1">Checker</button>
        <button class="tab" type="button" role="tab" data-view="account" aria-selected="false" tabindex="-1">Follow</button>
        <button class="tab" type="button" role="tab" data-view="messages" aria-selected="false" tabindex="-1">Unsend</button>
      </nav>
      <div class="scroll">
        <section class="view" role="tabpanel" data-panel="now"><p class="lead">All three requested workflows are available here in safe userscript mode. Live Instagram controls remain extension-only.</p><div class="tool-grid" data-role="tool-grid"></div></section>
        <section class="view" role="tabpanel" data-panel="checker" hidden><p class="lead"><strong>Follower checker.</strong> Open Followers or Following, scroll manually, and capture each rendered batch. Both drafts are compared locally.</p><div class="metrics"><div class="metric"><span>Followers</span><strong data-role="followers-count">0</strong></div><div class="metric"><span>Following</span><strong data-role="following-count">0</strong></div></div><div class="field"><label for="aio-list-type">List being captured</label><select id="aio-list-type" data-role="list-type"><option value="following">Following</option><option value="followers">Followers</option></select></div><div class="toolbar"><button class="button" type="button" data-action="capture">Capture visible rows</button><button class="button quiet" type="button" data-action="download-list">Download selected list</button><button class="button quiet" type="button" data-action="clear-capture">Clear checker</button></div><div class="card" data-role="comparison"></div><ul class="list" data-role="capture-list"></ul></section>
        <section class="view" role="tabpanel" data-panel="account" hidden><p class="lead"><strong>Follow / Unfollow review.</strong> Import the PWA manual queue, open one target, and verify the exact profile state without clicking.</p><div class="toolbar"><label class="file quiet">Import queue JSON<input type="file" accept=".json,application/json" data-file="queue"></label><button class="button quiet" type="button" data-action="export-queue">Export queue state</button></div><div class="card" data-role="queue-current"></div><div class="toolbar"><button class="button" type="button" data-action="open-profile">Open exact profile</button><button class="button quiet" type="button" data-action="account-dry-run">Run no-click check</button><button class="button quiet" type="button" data-action="queue-complete">Complete</button><button class="button quiet" type="button" data-action="queue-skip">Skip</button></div><div class="card" data-role="account-result"></div><p class="notice">Live Follow and Unfollow are intentionally unavailable in userscript mode. Use the signed extension workflow for one explicitly reviewed item.</p></section>
        <section class="view" role="tabpanel" data-panel="messages" hidden><p class="lead"><strong>DM Unsend review.</strong> Read visible evidence or import one reviewed DM job and resolve its exact sent-message identity without opening a menu.</p><div class="toolbar"><button class="button" type="button" data-action="read-messages">Read visible thread</button><label class="file quiet">Import reviewed DM job<input type="file" accept=".json,application/json" data-file="dm"></label><button class="button quiet" type="button" data-action="dm-dry-run">No-click exact check</button></div><div class="card" data-role="dm-result"></div><ul class="list" data-role="message-list"></ul><p class="notice">Live Unsend is intentionally unavailable in userscript mode. The extension requires a signed, twice-confirmed, one-message intent and independent ledgers.</p></section>
      </div>
      <footer class="footer" role="status" aria-live="polite"><span data-role="status">Ready. No Instagram control has been used.</span><strong>Local only</strong></footer>
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
    panel.hidden = !preferences.open;
    launcher.hidden = preferences.open;
    launcher.setAttribute('aria-expanded', String(preferences.open));
    for (const tab of queryAll('[data-view]')) {
      const selected = tab.dataset.view === preferences.view;
      tab.setAttribute('aria-selected', String(selected));
      tab.tabIndex = selected ? 0 : -1;
    }
    for (const view of queryAll('[data-panel]')) view.hidden = view.dataset.panel !== preferences.view;
  }

  function renderNow() {
    const grid = query('[data-role="tool-grid"]');
    grid.replaceChildren();
    const comparison = compareCapture();
    const item = currentQueueItem();
    const tools = [
      ['checker', 'Follower checker', `${state.capture.followers.length} followers · ${state.capture.following.length} following · ${comparison.notFollowingMeBack.length} not following back`, 'read only'],
      ['account', 'Follow / Unfollow', item ? `${item.action} @${item.account.username} is next` : 'Import a reviewed manual queue', 'no-click first'],
      ['messages', 'DM Unsend', state.dmTarget ? `Reviewed message ${state.dmTarget.messageId} loaded` : 'Visible evidence and exact-message review', 'live locked'],
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
      : 'Open each Instagram list, scroll manually, and capture every rendered batch. No private endpoint or console paste is used.';
    result.append(title, detail);

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
    renderNow();
    renderChecker();
    renderAccount();
    renderMessages();
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

  const actions = {
    open: () => savePreferences({ open: true }),
    close: () => savePreferences({ open: false }),
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
    return {
      width: Math.round(clamp(interaction.rectangle.width + deltaX, WIDTH_MIN, Math.min(WIDTH_MAX, innerWidth - (INSET * 2)))),
      height: Math.round(clamp(interaction.rectangle.height + deltaY, HEIGHT_MIN, Math.min(HEIGHT_MAX, innerHeight - (INSET * 2)))),
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
  resizeHandle.addEventListener('pointerdown', (event) => beginInteraction(event, 'resize'));
  moveHandle.addEventListener('keydown', (event) => keyboardLayout(event, 'move'));
  resizeHandle.addEventListener('keydown', (event) => keyboardLayout(event, 'resize'));
  window.addEventListener('pointermove', moveInteraction, { passive: false });
  window.addEventListener('pointerup', endInteraction);
  window.addEventListener('pointercancel', endInteraction);
  window.addEventListener('resize', () => {
    if (preferences.position) savePreferences({ position: constrainedPosition(preferences.position) });
    else applyLayout();
  });

  const duplicateObserver = new MutationObserver(() => {
    if (!document.getElementById(EXTENSION_ROOT_ID)) return;
    duplicateObserver.disconnect();
    host.remove();
  });
  duplicateObserver.observe(document.documentElement, { childList: true, subtree: true });

  document.documentElement.append(host);
  saveState();
  savePreferences(preferences);
  renderAll();
})();

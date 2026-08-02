(() => {
  'use strict';

  if (globalThis.__instaAioOverlayInstalled) return;
  globalThis.__instaAioOverlayInstalled = true;

  const inspector = globalThis.InstaAioInstagramInspector;
  if (!inspector) return;

  const STORAGE_KEYS = Object.freeze({
    capture: 'instaAioOverlayCaptureDraftV1',
    manualQueue: 'instaAioOverlayManualQueueV1',
    preferences: 'instaAioOverlayPreferencesV1',
  });
  const ACTIONABLE_QUEUE_STATUSES = new Set(['pending', 'ready', 'failed', 'paused']);
  const ALLOWED_QUEUE_STATUSES = new Set([
    ...ACTIONABLE_QUEUE_STATUSES,
    'waiting', 'protected', 'completed', 'skipped', 'removed',
  ]);
  const MAX_CAPTURE_ACCOUNTS = 2_000;
  const MAX_QUEUE_ITEMS = 2_000;
  const MAX_TEXT_LENGTH = 500;

  const model = {
    bridge: {
      controlledAccountActionsAvailable: false,
      extensionVersion: chrome.runtime.getManifest().version,
      liveExecutionEnabled: false,
      liveArm: null,
      pairings: [],
      pendingLiveIntent: null,
      recentRuns: [],
    },
    capture: null,
    context: null,
    manualQueue: { queue: [], importedAt: null },
    messages: null,
    open: true,
    section: 'now',
  };

  let captureObjectUrl = null;
  let messageObjectUrl = null;
  let queueObjectUrl = null;
  let previousLocation = location.href;
  let lastFocusedElement = null;

  const host = document.createElement('div');
  host.id = 'insta-aio-sidecar-root';
  const shadow = host.attachShadow({
    mode: globalThis.__instaAioOverlayTestOpenShadow === true ? 'open' : 'closed',
  });
  shadow.innerHTML = `
    <style>
      :host {
        all: initial;
        color-scheme: light;
      }

      *, *::before, *::after { box-sizing: border-box; }

      button, input, select { font: inherit; }

      .ia-launcher {
        position: fixed;
        right: 16px;
        bottom: 18px;
        z-index: 2147483647;
        width: 62px;
        height: 62px;
        border: 2px solid #151510;
        border-radius: 2px;
        clip-path: polygon(0 0, calc(100% - 13px) 0, 100% 13px, 100% 100%, 0 100%);
        background: #d8ff45;
        color: #151510;
        box-shadow: 6px 6px 0 rgba(21, 21, 16, .25);
        cursor: pointer;
        font-family: "Arial Narrow", "Aptos Narrow", "Segoe UI", sans-serif;
        text-align: left;
        transition: transform 160ms ease, box-shadow 160ms ease;
      }

      .ia-launcher:hover { transform: translate(-2px, -2px); box-shadow: 8px 8px 0 rgba(21, 21, 16, .25); }
      .ia-launcher:focus-visible { outline: 3px solid #168cff; outline-offset: 3px; }
      .ia-launcher strong { display: block; margin-left: 7px; font-size: 20px; line-height: 1; letter-spacing: -.04em; }
      .ia-launcher span { display: block; margin: 4px 0 0 7px; font-size: 10px; font-weight: 750; line-height: 1; }

      .ia-panel {
        position: fixed;
        z-index: 2147483647;
        top: 68px;
        right: 14px;
        bottom: 14px;
        width: min(462px, calc(100vw - 28px));
        min-height: 520px;
        overflow: hidden;
        border: 1px solid #151510;
        border-top: 5px solid #d8ff45;
        border-radius: 2px;
        background: #f3efe4;
        color: #151510;
        box-shadow: 0 24px 80px rgba(0, 0, 0, .34), 7px 7px 0 rgba(21, 21, 16, .16);
        font-family: "Segoe UI Variable", "Segoe UI", system-ui, sans-serif;
        font-size: 14px;
        line-height: 1.45;
        animation: ia-enter 180ms cubic-bezier(.2, .8, .2, 1);
      }

      .ia-panel[hidden], .ia-launcher[hidden], [hidden] { display: none !important; }

      .ia-shell { display: grid; grid-template-columns: 104px minmax(0, 1fr); height: 100%; }

      .ia-rail {
        display: flex;
        min-width: 0;
        flex-direction: column;
        background: #151510;
        color: #f3efe4;
      }

      .ia-brand {
        min-height: 82px;
        padding: 17px 13px 12px;
        border-bottom: 1px solid #34342d;
        font-family: "Arial Narrow", "Aptos Narrow", "Segoe UI", sans-serif;
      }

      .ia-brand strong { display: block; color: #d8ff45; font-size: 22px; line-height: 1; letter-spacing: -.045em; }
      .ia-brand span { display: block; margin-top: 6px; color: #aaa99f; font-size: 10px; line-height: 1.2; }

      .ia-nav { display: grid; gap: 0; padding-top: 8px; }

      .ia-nav button {
        min-height: 52px;
        border: 0;
        border-left: 4px solid transparent;
        border-radius: 0;
        padding: 8px 12px 8px 10px;
        background: transparent;
        color: #aaa99f;
        cursor: pointer;
        font-size: 12px;
        font-weight: 700;
        text-align: left;
      }

      .ia-nav button:hover { background: #20201a; color: #f3efe4; }
      .ia-nav button[aria-selected="true"] { border-left-color: #d8ff45; background: #24241d; color: #fff; }
      .ia-nav button:focus-visible, .ia-icon-button:focus-visible, .ia-button:focus-visible,
      .ia-select:focus-visible, .ia-text-input:focus-visible, .ia-file-label:focus-within, .ia-link-button:focus-visible {
        outline: 3px solid #168cff;
        outline-offset: -3px;
      }

      .ia-rail-lock {
        margin-top: auto;
        padding: 13px 12px 15px;
        border-top: 1px solid #34342d;
        color: #d8ff45;
        font-size: 10px;
        font-weight: 750;
        line-height: 1.35;
      }

      .ia-content { display: grid; min-width: 0; min-height: 0; grid-template-rows: auto 1fr auto; }

      .ia-header {
        display: grid;
        grid-template-columns: minmax(0, 1fr) auto;
        gap: 12px;
        align-items: start;
        padding: 17px 18px 14px;
        border-bottom: 1px solid #c9c3b5;
        background: #f8f5ed;
      }

      .ia-overline { margin: 0 0 4px; color: #5f5b50; font-size: 10px; font-weight: 800; letter-spacing: .08em; text-transform: uppercase; }
      .ia-header h1 { margin: 0; font-family: "Arial Narrow", "Aptos Narrow", "Segoe UI", sans-serif; font-size: 24px; line-height: 1.08; letter-spacing: -.035em; }
      .ia-header p:last-child { margin: 5px 0 0; color: #6c685e; font-size: 12px; }

      .ia-icon-button {
        display: grid;
        width: 38px;
        height: 38px;
        place-items: center;
        border: 1px solid #151510;
        border-radius: 2px;
        background: transparent;
        color: #151510;
        cursor: pointer;
        font-size: 18px;
      }

      .ia-scroll { min-height: 0; overflow: auto; overscroll-behavior: contain; scrollbar-color: #8c887c #e5dfd2; }
      .ia-view { padding: 18px; }
      .ia-view > :first-child { margin-top: 0; }

      .ia-section-head { margin-bottom: 16px; }
      .ia-section-head h2 { margin: 0; font-family: "Arial Narrow", "Aptos Narrow", "Segoe UI", sans-serif; font-size: 21px; line-height: 1.1; letter-spacing: -.025em; }
      .ia-section-head p { margin: 6px 0 0; color: #666156; font-size: 12px; }

      .ia-safety {
        display: grid;
        grid-template-columns: 8px minmax(0, 1fr);
        gap: 11px;
        margin: 0 0 18px;
        padding: 12px 13px;
        border: 1px solid #151510;
        border-left-width: 0;
        background: #ebe6d9;
      }

      .ia-safety::before { content: ""; background: #d8ff45; }
      .ia-safety strong { display: block; font-size: 13px; }
      .ia-safety span { display: block; margin-top: 2px; color: #5d594f; font-size: 11px; }
      .ia-safety[data-tone="danger"]::before { background: #e54735; }
      .ia-safety[data-tone="warning"]::before { background: #ec9b24; }

      .ia-ledger { margin: 0; border-top: 1px solid #aaa497; }
      .ia-ledger-row { display: grid; grid-template-columns: 116px minmax(0, 1fr); gap: 12px; padding: 10px 0; border-bottom: 1px solid #d5cfc2; }
      .ia-ledger dt { color: #716c61; font-size: 11px; }
      .ia-ledger dd { min-width: 0; margin: 0; overflow-wrap: anywhere; font-weight: 650; }

      .ia-toolbar { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 15px; }
      .ia-button, .ia-link-button, .ia-file-label {
        display: inline-flex;
        min-height: 40px;
        align-items: center;
        justify-content: center;
        border: 1px solid #151510;
        border-radius: 2px;
        padding: 8px 11px;
        background: #151510;
        color: #fff;
        cursor: pointer;
        font-size: 12px;
        font-weight: 750;
        line-height: 1.2;
        text-decoration: none;
      }

      .ia-file-label { position: relative; overflow: hidden; }
      .ia-file-label input {
        position: absolute;
        inset: 0;
        width: 100%;
        height: 100%;
        opacity: 0;
        cursor: pointer;
      }

      .ia-button:hover, .ia-link-button:hover, .ia-file-label:hover { background: #2c2c24; }
      .ia-button--signal { background: #d8ff45; color: #151510; }
      .ia-button--signal:hover { background: #c8ef33; }
      .ia-button--danger { border-color: #8e2b21; background: #a9362a; color: #fffdf7; }
      .ia-button--danger:hover { background: #8f2c23; }
      .ia-button--quiet, .ia-link-button--quiet, .ia-file-label--quiet { background: transparent; color: #151510; }
      .ia-button:disabled, .ia-link-button[aria-disabled="true"] { cursor: not-allowed; opacity: .45; }

      .ia-field { display: grid; gap: 6px; margin: 14px 0; }
      .ia-field label { color: #5f5b50; font-size: 11px; font-weight: 750; }
      .ia-select {
        min-height: 42px;
        width: 100%;
        border: 1px solid #151510;
        border-radius: 2px;
        padding: 8px 34px 8px 10px;
        background: #fffdf7;
        color: #151510;
      }

      .ia-rule { height: 1px; margin: 20px 0; border: 0; background: #aaa497; }
      .ia-count { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; margin: 16px 0 8px; }
      .ia-count strong { font-family: "Arial Narrow", "Aptos Narrow", "Segoe UI", sans-serif; font-size: 34px; line-height: 1; letter-spacing: -.05em; }
      .ia-count span { color: #666156; font-size: 11px; text-align: right; }

      .ia-list { margin: 0; padding: 0; border-top: 1px solid #aaa497; list-style: none; }
      .ia-list-item { display: grid; gap: 3px; padding: 10px 0; border-bottom: 1px solid #d5cfc2; }
      .ia-list-item strong { min-width: 0; overflow-wrap: anywhere; font-size: 13px; }
      .ia-list-item small { color: #6b675c; overflow-wrap: anywhere; }
      .ia-list-item--split { grid-template-columns: minmax(0, 1fr) auto; align-items: center; }

      .ia-empty { padding: 18px 0; border-top: 1px solid #aaa497; border-bottom: 1px solid #d5cfc2; color: #6b675c; font-size: 12px; }
      .ia-note { margin: 12px 0 0; color: #6b675c; font-size: 11px; }

      .ia-queue-now {
        margin: 14px 0;
        padding: 14px 0;
        border-top: 2px solid #151510;
        border-bottom: 1px solid #aaa497;
      }

      .ia-queue-now h3, .ia-subhead { margin: 0 0 5px; font-size: 14px; }
      .ia-queue-now p { margin: 0; color: #625e54; font-size: 12px; }
      .ia-queue-now .ia-handle { margin-top: 8px; font-family: "Arial Narrow", "Aptos Narrow", sans-serif; font-size: 25px; font-weight: 800; letter-spacing: -.03em; }

      .ia-live-gate {
        margin: 18px 0;
        border: 2px solid #151510;
        padding: 14px;
        background: #fffdf7;
        box-shadow: 4px 4px 0 #d7d0c2;
      }

      .ia-live-gate-head { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 12px; align-items: start; }
      .ia-live-gate strong { display: block; font-size: 14px; }
      .ia-live-gate span[data-ia-role="live-detail"] { display: block; margin-top: 4px; color: #625e54; font-size: 11px; line-height: 1.45; }

      .ia-dialog {
        width: min(420px, calc(100vw - 28px));
        border: 3px solid #151510;
        border-radius: 2px;
        padding: 0;
        background: #f4efe4;
        color: #151510;
        box-shadow: 10px 10px 0 rgba(21, 21, 16, .32);
      }

      .ia-dialog::backdrop { background: rgba(16, 16, 13, .72); }
      .ia-dialog form { display: grid; gap: 14px; padding: 20px; }
      .ia-dialog h2 { margin: 0; font-family: "Arial Narrow", "Aptos Narrow", sans-serif; font-size: 26px; letter-spacing: -.035em; }
      .ia-dialog p { margin: 0; color: #5f5b50; font-size: 12px; line-height: 1.5; }
      .ia-dialog code { display: block; border: 1px solid #151510; padding: 9px; background: #fffdf7; overflow-wrap: anywhere; font-size: 12px; }
      .ia-text-input { min-height: 44px; width: 100%; border: 2px solid #151510; border-radius: 2px; padding: 9px 10px; background: #fffdf7; color: #151510; }

      .ia-badge {
        display: inline-flex;
        width: fit-content;
        min-height: 24px;
        align-items: center;
        border: 1px solid #7d786e;
        border-radius: 999px;
        padding: 3px 8px;
        background: transparent;
        color: #4f4b42;
        font-size: 10px;
        font-weight: 800;
      }

      .ia-badge[data-tone="good"] { border-color: #28733d; color: #18542b; }
      .ia-badge[data-tone="danger"] { border-color: #bb3f31; color: #9c2f24; }
      .ia-badge[data-tone="warning"] { border-color: #a26a16; color: #82500a; }

      .ia-fragments { display: grid; gap: 0; margin: 14px 0 0; padding: 0; border-top: 1px solid #aaa497; list-style: none; }
      .ia-fragments li { padding: 11px 0; border-bottom: 1px solid #d5cfc2; color: #292820; white-space: pre-wrap; overflow-wrap: anywhere; }

      .ia-capabilities { display: grid; margin-top: 14px; border-top: 1px solid #aaa497; }
      .ia-capability { display: grid; grid-template-columns: 26px minmax(0, 1fr); gap: 10px; padding: 11px 0; border-bottom: 1px solid #d5cfc2; }
      .ia-capability b { color: #5e5a50; font-family: ui-monospace, "Cascadia Mono", monospace; font-size: 11px; }
      .ia-capability strong { display: block; font-size: 13px; }
      .ia-capability span { display: block; margin-top: 2px; color: #6b675c; font-size: 11px; }

      .ia-footer {
        min-height: 38px;
        padding: 10px 18px;
        border-top: 1px solid #c9c3b5;
        background: #e8e2d5;
        color: #5d594f;
        font-size: 10px;
      }

      .ia-footer strong { color: #151510; }
      .ia-sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; }

      @keyframes ia-enter {
        from { opacity: 0; transform: translateX(18px); }
        to { opacity: 1; transform: translateX(0); }
      }

      @media (max-width: 540px) {
        .ia-panel { inset: 0; width: 100vw; min-height: 0; border: 0; border-top: 5px solid #d8ff45; box-shadow: none; }
        .ia-shell { grid-template-columns: 1fr; grid-template-rows: auto 1fr; }
        .ia-rail { display: grid; grid-template-columns: auto minmax(0, 1fr); }
        .ia-brand { min-height: 58px; padding: 12px; border-right: 1px solid #34342d; border-bottom: 1px solid #34342d; }
        .ia-brand strong { font-size: 18px; }
        .ia-brand span { display: none; }
        .ia-nav { display: flex; min-width: 0; overflow-x: auto; padding: 0; border-bottom: 1px solid #34342d; }
        .ia-nav button { min-width: 76px; min-height: 58px; border-bottom: 4px solid transparent; border-left: 0; padding: 8px; text-align: center; }
        .ia-nav button[aria-selected="true"] { border-bottom-color: #d8ff45; border-left-color: transparent; }
        .ia-rail-lock { display: none; }
        .ia-content { min-height: 0; }
      }

      @media (prefers-reduced-motion: reduce) {
        .ia-panel { animation: none; }
        .ia-launcher { transition: none; }
      }
    </style>

    <button class="ia-launcher" type="button" data-ia-action="open" aria-label="Open Insta AIO sidecar" aria-expanded="false">
      <strong>AIO</strong><span>FIELD DESK</span>
    </button>

    <aside class="ia-panel" aria-label="Insta AIO Instagram sidecar">
      <div class="ia-shell">
        <div class="ia-rail">
          <div class="ia-brand"><strong>Insta AIO</strong><span>Local operator sidecar</span></div>
          <nav class="ia-nav" aria-label="Sidecar tools">
            <button type="button" data-ia-section="now" aria-controls="ia-view-now" aria-selected="true">Now</button>
            <button type="button" data-ia-section="capture" aria-controls="ia-view-capture" aria-selected="false">Capture</button>
            <button type="button" data-ia-section="queue" aria-controls="ia-view-queue" aria-selected="false">Queue</button>
            <button type="button" data-ia-section="messages" aria-controls="ia-view-messages" aria-selected="false">Messages</button>
            <button type="button" data-ia-section="workspace" aria-controls="ia-view-workspace" aria-selected="false">Workspace</button>
          </nav>
          <div class="ia-rail-lock">LIVE LOCKED<br>BY DEFAULT</div>
        </div>

        <div class="ia-content">
          <header class="ia-header">
            <div>
              <p class="ia-overline">On Instagram</p>
              <h1 data-ia-role="view-title">This page</h1>
              <p data-ia-role="view-subtitle">Read the current page before doing anything.</p>
            </div>
            <button class="ia-icon-button" type="button" data-ia-action="close" aria-label="Collapse Insta AIO sidecar">×</button>
          </header>

          <div class="ia-scroll">
            <section class="ia-view" id="ia-view-now" data-ia-view="now">
              <div class="ia-safety" data-ia-role="session-banner" data-tone="good">
                <div><strong data-ia-role="session-title">Checking this page…</strong><span data-ia-role="session-detail">No Instagram controls will be clicked.</span></div>
              </div>
              <div class="ia-section-head"><h2>Current context</h2><p>Observed from the page you already have open.</p></div>
              <dl class="ia-ledger">
                <div class="ia-ledger-row"><dt>Page</dt><dd data-ia-role="page-kind">—</dd></div>
                <div class="ia-ledger-row"><dt>Profile</dt><dd data-ia-role="page-profile">—</dd></div>
                <div class="ia-ledger-row"><dt>Relationship</dt><dd data-ia-role="page-relationship">—</dd></div>
                <div class="ia-ledger-row"><dt>Queue match</dt><dd data-ia-role="queue-match">—</dd></div>
                <div class="ia-ledger-row"><dt>Observed</dt><dd data-ia-role="page-observed">—</dd></div>
              </dl>
              <div class="ia-toolbar"><button class="ia-button ia-button--signal" type="button" data-ia-action="refresh-context">Inspect this page</button></div>
            </section>

            <section class="ia-view" id="ia-view-capture" data-ia-view="capture" hidden>
              <div class="ia-section-head"><h2>Visible accounts</h2><p>Scroll Instagram’s list yourself, then capture each rendered batch into one draft.</p></div>
              <div class="ia-field">
                <label for="ia-list-type">What list is open?</label>
                <select class="ia-select" id="ia-list-type" data-ia-role="list-type">
                  <option value="following">Following</option>
                  <option value="followers">Followers</option>
                </select>
              </div>
              <div class="ia-toolbar">
                <button class="ia-button ia-button--signal" type="button" data-ia-action="capture-visible">Capture visible rows</button>
                <button class="ia-button ia-button--quiet" type="button" data-ia-action="reset-capture">New draft</button>
              </div>
              <div class="ia-count"><strong data-ia-role="capture-count">0</strong><span data-ia-role="capture-detail">No draft yet</span></div>
              <ul class="ia-list" data-ia-role="capture-list"></ul>
              <div class="ia-toolbar">
                <a class="ia-link-button ia-link-button--quiet" data-ia-role="capture-download" aria-disabled="true">Download import JSON</a>
              </div>
              <p class="ia-note">Only currently rendered rows are read. Repeated captures merge by username; the page is never auto-scrolled.</p>
            </section>

            <section class="ia-view" id="ia-view-queue" data-ia-view="queue" hidden>
              <div class="ia-section-head"><h2>Manual queue</h2><p>The familiar in-page Open / Complete / Skip loop, backed by extension-local storage.</p></div>
              <div class="ia-toolbar">
                <label class="ia-file-label ia-file-label--quiet">Import queue JSON<input type="file" accept=".json,application/json" aria-label="Import Insta AIO manual queue JSON" data-ia-role="queue-file"></label>
                <a class="ia-link-button ia-link-button--quiet" data-ia-role="queue-download" aria-disabled="true">Download queue state</a>
              </div>
              <div class="ia-queue-now" data-ia-role="queue-current"></div>
              <div class="ia-toolbar" data-ia-role="queue-controls" hidden>
                <a class="ia-link-button" data-ia-role="queue-open" rel="noreferrer">Open profile</a>
                <button class="ia-button ia-button--quiet" type="button" data-ia-action="queue-complete">Mark complete</button>
                <button class="ia-button ia-button--quiet" type="button" data-ia-action="queue-skip">Skip</button>
              </div>
              <div class="ia-live-gate" data-ia-role="account-live-gate">
                <p class="ia-overline">Controlled live gate</p>
                <div class="ia-live-gate-head">
                  <div><strong data-ia-role="live-title">Live actions locked</strong><span data-ia-role="live-detail">A signed one-item intent from the paired PWA is required.</span></div>
                  <span class="ia-badge" data-ia-role="live-badge">locked</span>
                </div>
                <div class="ia-toolbar">
                  <button class="ia-button ia-button--danger" type="button" data-ia-action="arm-account-live" disabled>Arm exact action</button>
                  <button class="ia-button ia-button--quiet" type="button" data-ia-action="cancel-account-live" hidden>Cancel intent</button>
                </div>
                <p class="ia-note">Arming lasts 90 seconds and does not perform the action. The paired PWA must still revalidate the profile, reserve its durable ledger, and send the one-use execution request.</p>
              </div>
              <hr class="ia-rule">
              <h3 class="ia-subhead">Signed run history</h3>
              <p class="ia-note">No-click inspections and one-item controlled live results sent through the paired PWA bridge appear here.</p>
              <ul class="ia-list" data-ia-role="run-list"></ul>
            </section>

            <section class="ia-view" id="ia-view-messages" data-ia-view="messages" hidden>
              <div class="ia-section-head"><h2>Visible message evidence</h2><p>Read the open conversation without opening menus or touching Unsend.</p></div>
              <div class="ia-safety" data-tone="warning">
                <div><strong>Exact identity is required</strong><span>Visible text can support review, but cannot authorize removal without stable conversation, message, timestamp, and ownership identity.</span></div>
              </div>
              <div class="ia-toolbar">
                <button class="ia-button ia-button--signal" type="button" data-ia-action="inspect-messages">Read visible thread</button>
                <a class="ia-link-button ia-link-button--quiet" data-ia-role="message-download" aria-disabled="true">Download evidence JSON</a>
              </div>
              <div class="ia-count"><strong data-ia-role="message-count">0</strong><span data-ia-role="message-detail">Open a conversation first</span></div>
              <ul class="ia-fragments" data-ia-role="message-list"></ul>
            </section>

            <section class="ia-view" id="ia-view-workspace" data-ia-view="workspace" hidden>
              <div class="ia-section-head"><h2>Full workspace</h2><p>Instagram stays the field view; the PWA remains the durable ledger and review room.</p></div>
              <div class="ia-safety" data-ia-role="bridge-banner" data-tone="warning">
                <div><strong data-ia-role="bridge-title">Checking pairing…</strong><span data-ia-role="bridge-detail">The overlay never receives your Instagram credentials or cookies.</span></div>
              </div>
              <div class="ia-toolbar">
                <a class="ia-link-button ia-button--signal" data-ia-role="workspace-link" aria-disabled="true" rel="noreferrer">Open Insta AIO workspace</a>
              </div>
              <div class="ia-capabilities">
                <div class="ia-capability"><b>01</b><div><strong>Import & compare</strong><span>Meta exports, legacy sources, snapshots, mutuals, gains, and losses.</span></div></div>
                <div class="ia-capability"><b>02</b><div><strong>Review & protect</strong><span>Follow/unfollow queue scheduling, whitelists, history, and exact previews.</span></div></div>
                <div class="ia-capability"><b>03</b><div><strong>Message plans</strong><span>Imported DM filtering, ownership review, exact IDs, and safe-stop checkpoints.</span></div></div>
                <div class="ia-capability"><b>04</b><div><strong>Back up locally</strong><span>Workspace exports, activity history, migrations, and offline persistence.</span></div></div>
              </div>
              <p class="ia-note">Shortcut: <strong>Alt + Shift + I</strong> toggles this sidecar.</p>
            </section>
          </div>

          <div class="ia-footer" role="status" aria-live="polite" data-ia-role="status"><strong>Ready.</strong> Live actions are locked until a signed one-item intent is armed.</div>
        </div>
      </div>
    </aside>

    <dialog class="ia-dialog" data-ia-role="arm-dialog" aria-labelledby="ia-arm-title" aria-describedby="ia-arm-description">
      <form method="dialog">
        <div>
          <p class="ia-overline">One use · 90 seconds</p>
          <h2 id="ia-arm-title">Arm controlled action</h2>
        </div>
        <p id="ia-arm-description" data-ia-role="arm-description">Type the exact phrase to arm this reviewed action.</p>
        <code data-ia-role="arm-phrase"></code>
        <div class="ia-field">
          <label for="ia-arm-input">Exact arming phrase</label>
          <input class="ia-text-input" id="ia-arm-input" data-ia-role="arm-input" autocomplete="off" spellcheck="false">
        </div>
        <div class="ia-toolbar">
          <button class="ia-button ia-button--quiet" value="cancel">Cancel</button>
          <button class="ia-button ia-button--danger" value="confirm">Arm for 90 seconds</button>
        </div>
      </form>
    </dialog>
  `;

  const query = (selector) => shadow.querySelector(selector);
  const queryAll = (selector) => [...shadow.querySelectorAll(selector)];
  const setText = (role, value) => {
    const element = query(`[data-ia-role="${role}"]`);
    if (element) element.textContent = String(value ?? '');
  };

  function storageGet(keys) {
    return new Promise((resolve) => {
      chrome.storage.local.get(keys, (result) => resolve(result || {}));
    });
  }

  function storageSet(value) {
    return new Promise((resolve) => {
      chrome.storage.local.set(value, resolve);
    });
  }

  function storageRemove(key) {
    return new Promise((resolve) => {
      chrome.storage.local.remove(key, resolve);
    });
  }

  function runtimeMessage(message) {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage(message, (response) => {
        if (chrome.runtime.lastError) {
          resolve({ error: chrome.runtime.lastError.message });
          return;
        }
        resolve(response || {});
      });
    });
  }

  function status(message, tone = 'neutral') {
    const element = query('[data-ia-role="status"]');
    element.textContent = '';
    const strong = document.createElement('strong');
    strong.textContent = tone === 'error' ? 'Stopped. ' : tone === 'good' ? 'Done. ' : 'Ready. ';
    element.append(strong, document.createTextNode(message));
  }

  function shortDate(value) {
    const date = new Date(value);
    return Number.isNaN(date.getTime())
      ? 'unknown time'
      : new Intl.DateTimeFormat(undefined, {
        dateStyle: 'medium',
        timeStyle: 'short',
      }).format(date);
  }

  function safeText(value, fallback = '') {
    const text = String(value ?? '').trim();
    return (text || fallback).slice(0, MAX_TEXT_LENGTH);
  }

  function liveArmPhrase(intent) {
    return intent
      ? `ARM ${String(intent.action || '').toUpperCase()} @${intent.username}`
      : '';
  }

  function liveContextMatches(intent) {
    const profile = model.context?.profile || {};
    const expectedRelationship = intent?.action === 'follow' ? 'not-following' : 'following';
    return Boolean(
      intent
      && model.context?.pageKind === 'profile'
      && model.context.username === intent.username
      && profile.relationship === expectedRelationship
      && !profile.ambiguous
      && !profile.unexpectedUi
      && !model.context.sessionExpired
      && !model.context.challenge
      && !model.context.actionBlocked
      && !model.context.rateLimited,
    );
  }

  function requestLiveArmPhrase(intent) {
    const dialog = query('[data-ia-role="arm-dialog"]');
    const input = query('[data-ia-role="arm-input"]');
    const phrase = liveArmPhrase(intent);
    setText('arm-description', `This arms one ${intent.action} for @${intent.username}. It still cannot run without the paired PWA ledger.`);
    setText('arm-phrase', phrase);
    input.value = '';
    dialog.returnValue = 'cancel';
    const focusBeforeDialog = shadow.activeElement;
    return new Promise((resolve) => {
      dialog.addEventListener('close', () => {
        requestAnimationFrame(() => focusBeforeDialog?.focus?.());
        resolve(dialog.returnValue === 'confirm' ? input.value : null);
      }, { once: true });
      dialog.showModal();
      requestAnimationFrame(() => input.focus());
    });
  }

  function replaceObjectUrl(previous, payload) {
    if (previous) URL.revokeObjectURL(previous);
    return URL.createObjectURL(new Blob([
      JSON.stringify(payload, null, 2),
    ], { type: 'application/json' }));
  }

  function updateDownload(role, {
    filename,
    payload,
  } = {}) {
    const anchor = query(`[data-ia-role="${role}"]`);
    const currentUrl = role === 'capture-download'
      ? captureObjectUrl
      : role === 'message-download'
        ? messageObjectUrl
        : queueObjectUrl;
    if (!payload) {
      if (currentUrl) URL.revokeObjectURL(currentUrl);
      anchor.removeAttribute('href');
      anchor.removeAttribute('download');
      anchor.setAttribute('aria-disabled', 'true');
      if (role === 'capture-download') captureObjectUrl = null;
      if (role === 'message-download') messageObjectUrl = null;
      if (role === 'queue-download') queueObjectUrl = null;
      return;
    }
    const nextUrl = replaceObjectUrl(currentUrl, payload);
    if (role === 'capture-download') captureObjectUrl = nextUrl;
    if (role === 'message-download') messageObjectUrl = nextUrl;
    if (role === 'queue-download') queueObjectUrl = nextUrl;
    anchor.href = nextUrl;
    anchor.download = filename;
    anchor.removeAttribute('aria-disabled');
  }

  function normalizeQueueItem(item, index) {
    const username = inspector.normalizeUsername(item?.account?.username || item?.username);
    if (!username) return null;
    const action = ['follow', 'unfollow'].includes(item?.action) ? item.action : 'review';
    const statusValue = ALLOWED_QUEUE_STATUSES.has(item?.status) ? item.status : 'pending';
    return {
      id: safeText(item?.id, `overlay-${index}-${username}`),
      account: {
        username,
        displayName: safeText(item?.account?.displayName),
        source: safeText(item?.account?.source, 'manual-queue-import'),
      },
      action,
      status: statusValue,
      reason: safeText(item?.reason, 'manual review'),
      scheduledFor: safeText(item?.scheduledFor),
      companionUpdatedAt: safeText(item?.companionUpdatedAt),
    };
  }

  function normalizeManualQueue(value) {
    const queue = Array.isArray(value?.queue)
      ? value.queue.slice(0, MAX_QUEUE_ITEMS).map(normalizeQueueItem).filter(Boolean)
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

  function normalizeCapture(value) {
    const listType = value?.listType === 'followers' ? 'followers' : 'following';
    const sourceAccounts = Array.isArray(value?.[listType]) ? value[listType] : [];
    const accounts = new Map();
    for (const candidate of sourceAccounts.slice(0, MAX_CAPTURE_ACCOUNTS)) {
      const username = inspector.normalizeUsername(candidate?.username);
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
      capturedAt: safeText(value?.capturedAt) || new Date().toISOString(),
      [listType]: [...accounts.values()],
      note: 'Only rows rendered in Instagram were captured. Scroll the list manually and capture again to merge more rows.',
    };
  }

  function currentQueueItem() {
    return model.manualQueue.queue.find((item) => ACTIONABLE_QUEUE_STATUSES.has(item.status)) || null;
  }

  function queueRemaining() {
    return model.manualQueue.queue.filter((item) => ACTIONABLE_QUEUE_STATUSES.has(item.status)).length;
  }

  function setOpen(open, { restoreFocus = true } = {}) {
    const shouldOpen = Boolean(open);
    const focusBeforeOpen = shouldOpen
      ? shadow.activeElement || document.activeElement
      : null;
    model.open = shouldOpen;
    const panel = query('.ia-panel');
    const launcher = query('.ia-launcher');
    panel.hidden = !model.open;
    launcher.hidden = model.open;
    launcher.setAttribute('aria-expanded', String(model.open));
    storageSet({
      [STORAGE_KEYS.preferences]: {
        open: model.open,
        section: model.section,
      },
    });
    if (model.open) {
      lastFocusedElement = focusBeforeOpen;
      requestAnimationFrame(() => query(`[data-ia-section="${model.section}"]`)?.focus());
    } else if (restoreFocus) {
      requestAnimationFrame(() => {
        if (
          lastFocusedElement instanceof HTMLElement
          && document.contains(lastFocusedElement)
          && lastFocusedElement !== document.body
          && lastFocusedElement !== document.documentElement
        ) {
          lastFocusedElement.focus();
        } else {
          launcher.focus();
        }
      });
    }
  }

  const sectionCopy = Object.freeze({
    now: ['This page', 'Read the current page before doing anything.'],
    capture: ['Visible capture', 'Build a follower or following draft from rendered rows.'],
    queue: ['Manual queue', 'Work one reviewed account at a time on Instagram.'],
    messages: ['Message evidence', 'Inspect the open thread without touching Unsend.'],
    workspace: ['Full workspace', 'Open imports, comparisons, reviews, and local backups.'],
  });

  function setSection(section) {
    if (!sectionCopy[section]) return;
    model.section = section;
    for (const button of queryAll('[data-ia-section]')) {
      button.setAttribute('aria-selected', String(button.dataset.iaSection === section));
    }
    for (const view of queryAll('[data-ia-view]')) {
      view.hidden = view.dataset.iaView !== section;
    }
    setText('view-title', sectionCopy[section][0]);
    setText('view-subtitle', sectionCopy[section][1]);
    storageSet({
      [STORAGE_KEYS.preferences]: { open: model.open, section },
    });
    if (section === 'now') refreshContext();
    if (section === 'messages' && model.messages) renderMessages();
  }

  function sessionState(context) {
    if (context?.sessionExpired) return ['Login required', 'Instagram is showing a login screen. Inspection is paused.', 'danger'];
    if (context?.challenge) return ['Challenge detected', 'Resolve Instagram’s account challenge manually before continuing.', 'danger'];
    if (context?.actionBlocked) return ['Activity restriction detected', 'Stop here and follow Instagram’s guidance.', 'danger'];
    if (context?.rateLimited) return ['Rate limit detected', 'Wait before doing more work in this session.', 'warning'];
    return ['Page ready', 'Inspection is no-click. A live action requires a signed one-item intent plus a 90-second arm.', 'good'];
  }

  function renderContext() {
    const context = model.context || {};
    const profile = context.profile || {};
    const [title, detail, tone] = sessionState(context);
    const banner = query('[data-ia-role="session-banner"]');
    banner.dataset.tone = tone;
    setText('session-title', title);
    setText('session-detail', detail);
    setText('page-kind', safeText(context.pageKind, 'unknown'));
    setText('page-profile', context.username ? `@${context.username}` : 'Not a profile page');
    setText(
      'page-relationship',
      profile.ambiguous
        ? 'Ambiguous — safe stop'
        : safeText(profile.relationship, context.pageKind === 'profile' ? 'Not resolved' : 'Not applicable'),
    );
    const queueItem = currentQueueItem();
    setText(
      'queue-match',
      queueItem && context.username === queueItem.account.username
        ? `Matches ${queueItem.action} item`
        : queueItem
          ? `Next is @${queueItem.account.username}`
          : 'No actionable item loaded',
    );
    setText('page-observed', shortDate(context.capturedAt || Date.now()));
    renderLiveGate();
  }

  async function refreshContext() {
    model.context = inspector.inspectPageContext();
    renderContext();
    status('Current Instagram context refreshed.', 'good');
  }

  function renderCapture() {
    const list = query('[data-ia-role="capture-list"]');
    list.replaceChildren();
    if (!model.capture) {
      setText('capture-count', '0');
      setText('capture-detail', 'No draft yet');
      const empty = document.createElement('li');
      empty.className = 'ia-empty';
      empty.textContent = 'Open a Followers or Following dialog, then capture the rows you can see.';
      list.append(empty);
      updateDownload('capture-download');
      return;
    }
    const accounts = model.capture[model.capture.listType] || [];
    setText('capture-count', accounts.length);
    setText('capture-detail', `${model.capture.listType} · updated ${shortDate(model.capture.capturedAt)}`);
    for (const account of accounts.slice(0, 12)) {
      const row = document.createElement('li');
      row.className = 'ia-list-item';
      const title = document.createElement('strong');
      title.textContent = `@${account.username}`;
      const detail = document.createElement('small');
      detail.textContent = account.displayName || account.profileUrl;
      row.append(title, detail);
      list.append(row);
    }
    if (accounts.length > 12) {
      const more = document.createElement('li');
      more.className = 'ia-list-item';
      more.textContent = `+ ${accounts.length - 12} more in the downloaded draft`;
      list.append(more);
    }
    updateDownload('capture-download', {
      filename: `insta-aio-visible-${model.capture.listType}-${Date.now()}.json`,
      payload: model.capture,
    });
  }

  async function captureVisible() {
    const listType = query('[data-ia-role="list-type"]').value === 'followers' ? 'followers' : 'following';
    const visible = inspector.captureVisibleAccounts();
    if (!visible.length) {
      status('No account rows were visible. Open or scroll the Instagram list and try again.', 'error');
      return;
    }
    const existing = model.capture?.listType === listType ? model.capture[listType] : [];
    const accounts = new Map(existing.map((account) => [account.username, account]));
    for (const account of visible) accounts.set(account.username, account);
    model.capture = normalizeCapture({
      listType,
      capturedAt: new Date().toISOString(),
      [listType]: [...accounts.values()],
    });
    await storageSet({ [STORAGE_KEYS.capture]: model.capture });
    renderCapture();
    status(`Read ${visible.length} rendered account row${visible.length === 1 ? '' : 's'}; ${model.capture[listType].length} unique in this draft.`, 'good');
  }

  async function resetCapture() {
    model.capture = null;
    await storageRemove(STORAGE_KEYS.capture);
    renderCapture();
    status('Visible-list draft cleared. Instagram data was not changed.');
  }

  function renderLiveGate() {
    const intent = model.bridge.pendingLiveIntent;
    const arm = model.bridge.liveArm;
    const armButton = query('[data-ia-action="arm-account-live"]');
    const cancelButton = query('[data-ia-action="cancel-account-live"]');
    const badge = query('[data-ia-role="live-badge"]');
    cancelButton.hidden = !intent;

    if (!intent) {
      setText('live-title', 'Live actions locked');
      setText('live-detail', 'Confirm a one-item live job in the paired PWA, then send its signed intent here.');
      badge.textContent = 'locked';
      badge.dataset.tone = 'warning';
      armButton.textContent = 'Arm exact action';
      armButton.disabled = true;
      return;
    }

    const matchingArm = arm
      && arm.jobId === intent.jobId
      && arm.itemId === intent.itemId;
    setText('live-title', `${intent.action} @${intent.username}`);
    if (matchingArm) {
      setText('live-detail', `Armed until ${shortDate(arm.expiresAt)}. Return to the PWA and continue the same reviewed job before this one-use gate expires.`);
      badge.textContent = 'armed';
      badge.dataset.tone = 'danger';
      armButton.textContent = 'One action armed';
      armButton.disabled = true;
      return;
    }

    const ready = liveContextMatches(intent);
    setText(
      'live-detail',
      ready
        ? `This page exactly matches the signed intent. Arming alone does not click; the PWA must still reserve and execute.`
        : `Open @${intent.username}, inspect the exact ${intent.action === 'follow' ? 'Follow' : 'Following'} control, then arm here.`,
    );
    badge.textContent = ready ? 'ready' : 'open target';
    badge.dataset.tone = ready ? 'warning' : 'danger';
    armButton.textContent = `Arm one ${intent.action}`;
    armButton.disabled = !ready;
  }

  async function armAccountLive() {
    const intent = model.bridge.pendingLiveIntent;
    if (!intent) return;
    model.context = inspector.inspectPageContext();
    renderContext();
    if (!liveContextMatches(intent)) {
      status(`Open @${intent.username} and resolve its exact ${intent.action} control before arming.`, 'error');
      return;
    }
    const phrase = await requestLiveArmPhrase(intent);
    if (phrase == null) return;
    const response = await runtimeMessage({
      kind: 'insta-aio-arm-account-action',
      action: intent.action,
      itemId: intent.itemId,
      jobId: intent.jobId,
      phrase,
      username: intent.username,
    });
    if (response.error) {
      status(`Live arm rejected: ${response.error}.`, 'error');
      return;
    }
    if (response.state) model.bridge = response.state;
    renderBridge();
    status(`Armed one ${intent.action} for @${intent.username} for 90 seconds. No action has run yet.`, 'good');
  }

  async function cancelAccountLive() {
    const response = await runtimeMessage({ kind: 'insta-aio-cancel-account-action' });
    if (response.error) {
      status(`Could not cancel the live intent: ${response.error}.`, 'error');
      return;
    }
    if (response.state) model.bridge = response.state;
    renderBridge();
    status('Canceled the pending live intent. No Instagram action was performed.', 'good');
  }

  function renderManualQueue() {
    const item = currentQueueItem();
    const container = query('[data-ia-role="queue-current"]');
    const controls = query('[data-ia-role="queue-controls"]');
    container.replaceChildren();
    if (!item) {
      const title = document.createElement('h3');
      title.textContent = model.manualQueue.queue.length ? 'Queue reviewed' : 'No queue loaded';
      const detail = document.createElement('p');
      detail.textContent = model.manualQueue.queue.length
        ? 'There are no pending, ready, paused, or failed items.'
        : 'Export a manual queue from the PWA, then import it here.';
      container.append(title, detail);
      controls.hidden = true;
    } else {
      const meta = document.createElement('p');
      meta.textContent = `${queueRemaining()} actionable item${queueRemaining() === 1 ? '' : 's'} remaining`;
      const handle = document.createElement('div');
      handle.className = 'ia-handle';
      handle.textContent = `@${item.account.username}`;
      const detail = document.createElement('p');
      detail.textContent = `${item.action} · ${item.status} · ${item.reason}`;
      container.append(meta, handle, detail);
      const open = query('[data-ia-role="queue-open"]');
      open.href = `https://www.instagram.com/${encodeURIComponent(item.account.username)}/`;
      controls.hidden = false;
    }
    updateDownload('queue-download', model.manualQueue.queue.length ? {
      filename: `insta-aio-companion-state-${Date.now()}.json`,
      payload: {
        schemaVersion: 1,
        kind: 'insta-aio-companion-state',
        exportedAt: new Date().toISOString(),
        ...model.manualQueue,
      },
    } : undefined);
    renderContext();
    renderLiveGate();
  }

  async function importManualQueue(file) {
    try {
      if (file.size > 5_000_000) {
        throw new Error('Queue imports are limited to five megabytes.');
      }
      const parsed = JSON.parse(await file.text());
      if (parsed?.kind !== 'insta-aio-manual-queue' || !Array.isArray(parsed.queue)) {
        throw new Error('Select an Insta AIO manual queue export.');
      }
      const next = normalizeManualQueue({
        queue: parsed.queue,
        importedAt: new Date().toISOString(),
      });
      if (parsed.queue.length && !next.queue.length) {
        throw new Error('The queue contained no valid Instagram usernames.');
      }
      model.manualQueue = next;
      await storageSet({ [STORAGE_KEYS.manualQueue]: next });
      renderManualQueue();
      status(`Imported ${next.queue.length} manual queue item${next.queue.length === 1 ? '' : 's'}.`, 'good');
    } catch (error) {
      status(error.message, 'error');
    }
  }

  async function updateCurrentQueue(statusValue) {
    const item = currentQueueItem();
    if (!item || !['completed', 'skipped'].includes(statusValue)) return;
    model.manualQueue.queue = model.manualQueue.queue.map((candidate) => (
      candidate.id === item.id
        ? { ...candidate, status: statusValue, companionUpdatedAt: new Date().toISOString() }
        : candidate
    ));
    await storageSet({ [STORAGE_KEYS.manualQueue]: model.manualQueue });
    renderManualQueue();
    status(`Marked @${item.account.username} ${statusValue}. This updates the extension-local queue only.`, 'good');
  }

  function renderRuns() {
    const list = query('[data-ia-role="run-list"]');
    list.replaceChildren();
    const runs = model.bridge.recentRuns || [];
    if (!runs.length) {
      const empty = document.createElement('li');
      empty.className = 'ia-empty';
      empty.textContent = 'No signed dry run or controlled live result has reached this extension yet.';
      list.append(empty);
      return;
    }
    for (const run of runs) {
      const row = document.createElement('li');
      row.className = 'ia-list-item ia-list-item--split';
      const copy = document.createElement('div');
      const title = document.createElement('strong');
      const isDm = run.kind === 'insta-aio-reviewed-dm-job';
      title.textContent = isDm
        ? 'DM identity check'
        : run.mode === 'live'
          ? 'Controlled account action'
          : 'Account profile check';
      const detail = document.createElement('small');
      const first = run.results?.[0];
      const target = first?.username ? `@${first.username}` : first?.messageId ? `message ${first.messageId}` : run.jobId;
      detail.textContent = `${target} · ${shortDate(run.receivedAt)}${run.stopReason ? ` · ${run.stopReason}` : ''}`;
      copy.append(title, detail);
      const badge = document.createElement('span');
      badge.className = 'ia-badge';
      const succeeded = run.status === 'dry-run-complete' || run.status === 'completed';
      badge.dataset.tone = succeeded ? 'good' : 'danger';
      badge.textContent = run.status === 'completed'
        ? 'completed'
        : run.status === 'dry-run-complete'
          ? 'resolved'
          : 'safe stop';
      row.append(copy, badge);
      list.append(row);
    }
  }

  function renderMessages() {
    const list = query('[data-ia-role="message-list"]');
    list.replaceChildren();
    const result = model.messages;
    const fragments = result?.fragments || [];
    setText('message-count', fragments.length);
    setText(
      'message-detail',
      result
        ? `${safeText(result.conversationLabel, 'Open conversation')} · ${safeText(result.reason, 'read only')}`
        : 'Open a conversation first',
    );
    for (const fragment of fragments) {
      const row = document.createElement('li');
      row.textContent = fragment.text;
      list.append(row);
    }
    if (!fragments.length) {
      const empty = document.createElement('li');
      empty.className = 'ia-empty';
      empty.textContent = result?.pageKind === 'messages'
        ? 'No stable visible message fragments were found in the open thread.'
        : 'Open an Instagram conversation, then read the visible thread.';
      list.append(empty);
    }
    updateDownload('message-download', result ? {
      filename: `insta-aio-visible-message-evidence-${Date.now()}.json`,
      payload: {
        schemaVersion: 1,
        kind: 'insta-aio-visible-message-evidence',
        ...result,
        note: 'Read-only visible DOM evidence. Exact message identity and sender ownership were not resolved.',
      },
    } : undefined);
  }

  async function inspectMessages() {
    model.messages = inspector.inspectVisibleMessages();
    renderMessages();
    status(
      model.messages.fragments.length
        ? `Captured ${model.messages.fragments.length} visible text fragment${model.messages.fragments.length === 1 ? '' : 's'} without opening a menu.`
        : 'Exact message resolution stopped safely; no Instagram control was used.',
      model.messages.fragments.length ? 'good' : 'error',
    );
  }

  function renderBridge() {
    const paired = (model.bridge.pairings || []).find((pairing) => pairing.pairedAt) || null;
    const banner = query('[data-ia-role="bridge-banner"]');
    const link = query('[data-ia-role="workspace-link"]');
    if (paired) {
      banner.dataset.tone = 'good';
      setText('bridge-title', 'Workspace paired');
      setText(
        'bridge-detail',
        `${paired.origin} · ${paired.permissions.join(' + ')} · extension ${model.bridge.extensionVersion}`,
      );
      link.href = paired.origin;
      link.target = '_blank';
      link.removeAttribute('aria-disabled');
    } else {
      banner.dataset.tone = 'warning';
      setText('bridge-title', 'Workspace not paired');
      setText('bridge-detail', 'Create a code in PWA Settings, then pair the exact PWA tab from the extension popup.');
      link.removeAttribute('href');
      link.removeAttribute('target');
      link.setAttribute('aria-disabled', 'true');
    }
    renderRuns();
    renderLiveGate();
  }

  async function refreshBridge() {
    const response = await runtimeMessage({ kind: 'insta-aio-overlay-state' });
    if (response.state) {
      model.bridge = response.state;
      renderBridge();
      return;
    }
    renderBridge();
    status(`Extension bridge state unavailable: ${response.error || 'unknown error'}.`, 'error');
  }

  async function initialize() {
    const stored = await storageGet(Object.values(STORAGE_KEYS));
    const preferences = stored[STORAGE_KEYS.preferences] || {};
    model.open = typeof preferences.open === 'boolean'
      ? preferences.open
      : window.innerWidth >= 860;
    model.section = sectionCopy[preferences.section] ? preferences.section : 'now';
    model.capture = stored[STORAGE_KEYS.capture]
      ? normalizeCapture(stored[STORAGE_KEYS.capture])
      : null;
    model.manualQueue = normalizeManualQueue(stored[STORAGE_KEYS.manualQueue]);
    setSection(model.section);
    setOpen(model.open, { restoreFocus: false });
    renderCapture();
    renderManualQueue();
    renderMessages();
    await Promise.all([refreshContext(), refreshBridge()]);
  }

  shadow.addEventListener('click', async (event) => {
    const sectionButton = event.target.closest('[data-ia-section]');
    if (sectionButton) {
      setSection(sectionButton.dataset.iaSection);
      return;
    }
    const target = event.target.closest('[data-ia-action]');
    if (!target) return;
    const action = target.dataset.iaAction;
    if (action === 'open') setOpen(true);
    if (action === 'close') setOpen(false);
    if (action === 'refresh-context') await refreshContext();
    if (action === 'capture-visible') await captureVisible();
    if (action === 'reset-capture') await resetCapture();
    if (action === 'queue-complete') await updateCurrentQueue('completed');
    if (action === 'queue-skip') await updateCurrentQueue('skipped');
    if (action === 'arm-account-live') await armAccountLive();
    if (action === 'cancel-account-live') await cancelAccountLive();
    if (action === 'inspect-messages') await inspectMessages();
  });

  shadow.addEventListener('change', async (event) => {
    if (!event.target.matches('[data-ia-role="queue-file"]')) return;
    const file = event.target.files?.[0];
    if (file) await importManualQueue(file);
    event.target.value = '';
  });

  document.addEventListener('keydown', (event) => {
    if (event.altKey && event.shiftKey && event.key.toLowerCase() === 'i') {
      event.preventDefault();
      setOpen(!model.open);
      return;
    }
    if (event.key === 'Escape' && model.open && shadow.activeElement) {
      setOpen(false);
    }
  });

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'local') return;
    if (
      changes.bridgePairings
      || changes.pendingJobs
      || changes.pendingLiveIntent
      || changes.liveArm
    ) refreshBridge();
  });

  setInterval(() => {
    if (location.href === previousLocation) return;
    previousLocation = location.href;
    model.messages = null;
    renderMessages();
    refreshContext();
  }, 1_500);

  document.documentElement.append(host);
  initialize().catch((error) => status(error.message, 'error'));
})();

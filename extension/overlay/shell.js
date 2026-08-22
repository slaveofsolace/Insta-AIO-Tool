(() => {
  'use strict';

  const modules = globalThis.__instaAioOverlayModules;
  const shared = modules?.shared;
  const icons = modules?.icons;
  if (!shared || !icons || modules.shell) return;

  const styles = `
    :host {
      all: initial;
      --ia-surface: #f7f8f5;
      --ia-surface-raised: #ffffff;
      --ia-rail: #eef0eb;
      --ia-ink: #1d211b;
      --ia-muted: #687064;
      --ia-line: #d8ddd4;
      --ia-signal: #b9ef35;
      --ia-signal-ink: #263006;
      --ia-warning: #9b5d09;
      --ia-danger: #ad3025;
      --ia-good: #27753c;
      --ia-focus: #168cff;
      --ia-shadow: 0 18px 54px rgba(0, 0, 0, .18);
      --ia-panel-width: 460px;
      --ia-panel-alpha: 88%;
      --ia-panel-alpha-strong: 96%;
      --ia-panel-inline-start: auto;
      --ia-panel-inline-end: max(14px, env(safe-area-inset-right));
      color-scheme: light;
      font-family: "Segoe UI Variable", "Segoe UI", system-ui, sans-serif;
    }

    :host([data-theme="dark"]) {
      --ia-surface: #151714;
      --ia-surface-raised: #1c1f1b;
      --ia-rail: #10120f;
      --ia-ink: #f3f5ef;
      --ia-muted: #a9afa3;
      --ia-line: #343a31;
      --ia-signal-ink: #182000;
      --ia-warning: #efb55e;
      --ia-danger: #ff968a;
      --ia-good: #8dd39d;
      --ia-shadow: 0 18px 58px rgba(0, 0, 0, .52);
      color-scheme: dark;
    }

    :host([data-width="compact"]) { --ia-panel-width: 380px; }
    :host([data-width="wide"]) { --ia-panel-width: 560px; }
    :host([data-adaptive-width="reviewed-target"]) { --ia-panel-width: 380px; }
    :host([data-dock="left"]) {
      --ia-panel-inline-start: max(14px, env(safe-area-inset-left));
      --ia-panel-inline-end: auto;
    }

    *, *::before, *::after { box-sizing: border-box; }
    button, input, select, summary { font: inherit; }
    button, summary, label { -webkit-tap-highlight-color: transparent; }
    button, summary, .ia-file-label { cursor: pointer; }
    svg { width: 20px; height: 20px; fill: none; stroke: currentColor; stroke-linecap: round; stroke-linejoin: round; stroke-width: 1.7; }
    [hidden] { display: none !important; }

    .ia-launcher {
      position: fixed;
      z-index: 2147483000;
      right: max(14px, env(safe-area-inset-right));
      bottom: max(14px, env(safe-area-inset-bottom));
      display: grid;
      width: 44px;
      height: 44px;
      place-items: center;
      border: 1px solid var(--ia-line);
      border-radius: 12px;
      background: var(--ia-surface-raised);
      color: var(--ia-ink);
      box-shadow: 0 8px 28px rgba(0, 0, 0, .18);
      font-weight: 800;
      transition: transform 140ms ease, box-shadow 140ms ease;
    }
    :host([data-dock="left"]) .ia-launcher { right: auto; left: max(14px, env(safe-area-inset-left)); }
    .ia-launcher:hover { transform: translateY(-1px); box-shadow: 0 10px 32px rgba(0, 0, 0, .22); }
    .ia-launcher-mark { font-size: 15px; letter-spacing: -.03em; }
    .ia-launcher-signal { position: absolute; top: 5px; right: 5px; width: 8px; height: 8px; border: 2px solid var(--ia-surface-raised); border-radius: 50%; background: var(--ia-signal); }

    .ia-panel {
      position: fixed;
      z-index: 2147483000;
      top: max(54px, env(safe-area-inset-top));
      left: var(--ia-panel-inline-start);
      right: var(--ia-panel-inline-end);
      width: min(var(--ia-panel-custom-width, var(--ia-panel-width)), calc(100vw - 28px - env(safe-area-inset-left) - env(safe-area-inset-right)));
      height: var(--ia-panel-custom-height, auto);
      max-height: calc(100dvh - 72px - env(safe-area-inset-top) - env(safe-area-inset-bottom));
      overflow: hidden;
      border: 1px solid var(--ia-line);
      border-radius: 12px;
      background: color-mix(in srgb, var(--ia-surface) var(--ia-panel-alpha), transparent);
      color: var(--ia-ink);
      box-shadow: var(--ia-shadow);
      backdrop-filter: blur(10px) saturate(.94);
      -webkit-backdrop-filter: blur(10px) saturate(.94);
      font-size: 14px;
      line-height: 1.45;
      animation: ia-open 150ms cubic-bezier(.2, .8, .2, 1);
    }

    :host([data-layout="floating"]) .ia-panel {
      top: var(--ia-panel-top);
      right: auto;
      left: var(--ia-panel-left);
    }

    .ia-shell { display: grid; height: 100%; max-height: inherit; grid-template-columns: 124px minmax(0, 1fr); }
    .ia-rail { display: flex; min-height: 0; flex-direction: column; align-items: stretch; gap: 2px; padding: 8px 6px; border-right: 1px solid var(--ia-line); background: color-mix(in srgb, var(--ia-rail) var(--ia-panel-alpha-strong), transparent); }
    .ia-brand-mark { display: grid; width: 38px; height: 38px; margin-bottom: 8px; place-items: center; border-radius: 10px; background: var(--ia-ink); color: var(--ia-surface); font-weight: 800; }
    .ia-tab { position: relative; display: grid; width: 100%; min-height: 44px; grid-template-columns: 22px minmax(0, 1fr); align-items: center; gap: 8px; border: 0; border-radius: 9px; padding: 8px; background: transparent; color: var(--ia-muted); text-align: left; }
    .ia-tab-label { min-width: 0; overflow-wrap: break-word; font-size: 12px; font-weight: 650; line-height: 1.15; }
    .ia-tab:hover { background: var(--ia-surface-raised); color: var(--ia-ink); }
    .ia-tab[aria-selected="true"] { background: var(--ia-surface-raised); color: var(--ia-ink); box-shadow: inset 3px 0 0 var(--ia-signal); }
    .ia-tab[data-ia-section="workspace"] { margin-top: auto; }
    .ia-tab-signal { position: absolute; top: 7px; right: 6px; width: 7px; height: 7px; border: 2px solid var(--ia-rail); border-radius: 50%; background: var(--ia-signal); }

    .ia-body { display: grid; min-width: 0; min-height: 0; max-height: inherit; grid-template-rows: auto minmax(0, 1fr) auto; }
    .ia-header { position: relative; z-index: 2; display: grid; min-height: 66px; grid-template-columns: auto minmax(0, 1fr) auto; align-items: center; gap: 8px; padding: 10px; border-bottom: 1px solid var(--ia-line); background: color-mix(in srgb, var(--ia-surface-raised) var(--ia-panel-alpha-strong), transparent); }
    .ia-header-copy { min-width: 0; }
    .ia-context-label { margin: 0 0 2px; color: var(--ia-muted); font-size: 12px; }
    .ia-header h1 { margin: 0; overflow-wrap: break-word; word-break: normal; font-size: 18px; line-height: 1.2; letter-spacing: -.015em; }
    .ia-header-subtitle { margin: 3px 0 0; color: var(--ia-muted); font-size: 12px; }
    .ia-header-actions { display: flex; flex: 0 0 auto; align-items: center; gap: 2px; }
    .ia-icon-button, .ia-settings summary { display: grid; width: 44px; height: 44px; place-items: center; border: 0; border-radius: 9px; background: transparent; color: var(--ia-ink); list-style: none; }
    .ia-move-handle { width: auto; min-width: 64px; grid-template-columns: 20px auto; gap: 5px; padding: 0 8px; cursor: grab; touch-action: none; }
    .ia-move-handle span { color: var(--ia-muted); font-size: 11px; font-weight: 700; }
    :host([data-layout-interaction="move"]) .ia-move-handle { cursor: grabbing; }
    .ia-settings summary::-webkit-details-marker { display: none; }
    .ia-icon-button:hover, .ia-settings summary:hover, .ia-settings[open] summary { background: var(--ia-surface); }
    .ia-settings { position: relative; }
    .ia-settings-panel { position: absolute; z-index: 5; top: 48px; right: 0; display: grid; width: 260px; max-height: min(520px, calc(100dvh - 92px)); overflow: auto; gap: 12px; padding: 14px; border: 1px solid var(--ia-line); border-radius: 10px; background: color-mix(in srgb, var(--ia-surface-raised) 96%, transparent); box-shadow: var(--ia-shadow); }
    .ia-settings:not([open]) .ia-settings-panel { display: none; }
    .ia-settings-panel strong { font-size: 13px; }
    .ia-field { display: grid; gap: 5px; }
    .ia-field label { color: var(--ia-muted); font-size: 12px; }
    .ia-select, .ia-text-input { min-height: 44px; width: 100%; border: 1px solid var(--ia-line); border-radius: 8px; padding: 8px 10px; background: var(--ia-surface-raised); color: var(--ia-ink); }
    .ia-range-row { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 8px; align-items: center; }
    .ia-range { width: 100%; accent-color: var(--ia-good); }
    .ia-range-output { min-width: 40px; color: var(--ia-muted); font-variant-numeric: tabular-nums; text-align: right; }

    .ia-scroll { min-height: 0; overflow: auto; overscroll-behavior: contain; scrollbar-color: var(--ia-muted) var(--ia-surface); }
    .ia-view { padding: 16px; }
    :host([data-density="compact"]) .ia-view { padding: 12px; }
    .ia-view[role="tabpanel"]:focus { outline: none; }
    .ia-view[role="tabpanel"]:focus-visible { outline: 3px solid var(--ia-focus); outline-offset: -3px; }

    .ia-state-row { display: flex; align-items: flex-start; gap: 9px; margin-bottom: 14px; }
    .ia-state-dot { width: 8px; height: 8px; flex: 0 0 auto; margin-top: 5px; border: 1px solid color-mix(in srgb, var(--ia-signal) 55%, var(--ia-ink)); border-radius: 50%; background: var(--ia-signal); }
    .ia-state-row[data-tone="warning"] .ia-state-dot { background: var(--ia-warning); }
    .ia-state-row[data-tone="danger"] .ia-state-dot { background: var(--ia-danger); }
    .ia-state-row strong, .ia-state-row span { display: block; }
    .ia-state-row strong { font-size: 13px; }
    .ia-state-row span { margin-top: 2px; color: var(--ia-muted); font-size: 12px; }

    .ia-card { border: 1px solid var(--ia-line); border-radius: 10px; background: color-mix(in srgb, var(--ia-surface-raised) var(--ia-panel-alpha-strong), transparent); }
    .ia-card-pad { padding: 14px; }
    .ia-target-top { display: grid; grid-template-columns: 42px minmax(0, 1fr); gap: 8px 10px; align-items: center; padding: 14px; }
    .ia-target-top > .ia-badge { grid-column: 2; justify-self: start; }
    .ia-target-avatar { display: grid; width: 42px; height: 42px; place-items: center; border-radius: 9px; background: var(--ia-rail); color: var(--ia-muted); font-size: 12px; font-weight: 700; }
    .ia-target-top h2 { margin: 0; overflow-wrap: break-word; word-break: normal; font-size: 17px; line-height: 1.2; }
    .ia-target-top p { margin: 3px 0 0; color: var(--ia-muted); font-size: 12px; }
    .ia-badge { display: inline-flex; min-height: 26px; align-items: center; border: 1px solid var(--ia-line); border-radius: 999px; padding: 3px 8px; color: var(--ia-muted); font-size: 11px; font-weight: 650; }
    .ia-badge[data-tone="good"] { border-color: var(--ia-good); color: var(--ia-good); }
    .ia-badge[data-tone="warning"] { border-color: var(--ia-warning); color: var(--ia-warning); }
    .ia-badge[data-tone="danger"] { border-color: var(--ia-danger); color: var(--ia-danger); }
    .ia-facts { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); border-top: 1px solid var(--ia-line); }
    .ia-facts > div { padding: 11px 14px; }
    .ia-facts > div + div { border-left: 1px solid var(--ia-line); }
    .ia-facts dt { color: var(--ia-muted); font-size: 12px; }
    .ia-facts dd { margin: 3px 0 0; overflow-wrap: break-word; word-break: normal; font-size: 13px; font-weight: 650; }

    .ia-next { display: grid; gap: 13px; margin-top: 14px; padding: 14px; border-radius: 10px; background: var(--ia-rail); }
    .ia-next-label { margin: 0; color: var(--ia-muted); font-size: 12px; }
    .ia-next h2, .ia-next h3 { margin: 3px 0 0; font-size: 16px; }
    .ia-next p:last-child { margin: 5px 0 0; color: var(--ia-muted); font-size: 12px; }

    .ia-tool-heading { margin: 18px 0 8px; font-size: 13px; }
    .ia-tool-grid { display: grid; gap: 8px; }
    .ia-tool-card { display: grid; width: 100%; grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: 10px; border: 1px solid var(--ia-line); border-radius: 10px; padding: 12px; background: color-mix(in srgb, var(--ia-surface-raised) var(--ia-panel-alpha-strong), transparent); color: var(--ia-ink); text-align: left; }
    .ia-tool-card:hover { border-color: var(--ia-muted); }
    .ia-tool-card strong, .ia-tool-card span { display: block; }
    .ia-tool-card span { margin-top: 3px; color: var(--ia-muted); font-size: 12px; }
    .ia-tool-card em { color: var(--ia-good); font-size: 11px; font-style: normal; font-weight: 700; white-space: nowrap; }

    .ia-first-run { margin-bottom: 14px; padding: 14px; border: 1px solid var(--ia-line); border-left: 3px solid var(--ia-signal); border-radius: 10px; background: color-mix(in srgb, var(--ia-surface-raised) var(--ia-panel-alpha-strong), transparent); }
    .ia-first-run h2 { margin: 0; font-size: 17px; }
    .ia-first-run > p { margin: 5px 0 0; color: var(--ia-muted); font-size: 12px; }
    .ia-first-run ol { display: grid; gap: 8px; margin: 12px 0 0; padding-left: 22px; }
    .ia-first-run li { padding-left: 3px; font-size: 13px; }
    .ia-first-run li span { display: block; margin-top: 2px; color: var(--ia-muted); font-size: 12px; }

    .ia-checker-metrics { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; margin: 12px 0; }
    .ia-checker-metric { padding: 11px; border: 1px solid var(--ia-line); border-radius: 9px; background: color-mix(in srgb, var(--ia-surface-raised) var(--ia-panel-alpha-strong), transparent); }
    .ia-checker-metric span, .ia-checker-metric strong { display: block; }
    .ia-checker-metric span { color: var(--ia-muted); font-size: 12px; }
    .ia-checker-metric strong { margin-top: 2px; font-size: 20px; }
    .ia-checker-result { margin-top: 12px; padding: 12px; border: 1px solid var(--ia-line); border-radius: 9px; background: color-mix(in srgb, var(--ia-rail) var(--ia-panel-alpha-strong), transparent); }
    .ia-checker-result h2 { margin: 0 0 7px; font-size: 14px; }
    .ia-checker-result dl { display: grid; grid-template-columns: 1fr auto; gap: 5px 12px; margin: 0; }
    .ia-checker-result dt { color: var(--ia-muted); font-size: 12px; }
    .ia-checker-result dd { margin: 0; font-weight: 700; }
    .ia-checker-browser { margin-top: 12px; }
    .ia-filter-grid { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 8px; }
    .ia-checker-browser .ia-count { margin-top: 12px; }
    .ia-checker-browser .ia-list { max-height: 260px; overflow: auto; }
    .ia-flow { display: grid; gap: 8px; margin-top: 12px; }
    .ia-flow-step { display: grid; grid-template-columns: 28px minmax(0, 1fr) auto; align-items: center; gap: 9px; padding: 10px; border: 1px solid var(--ia-line); border-radius: 9px; background: color-mix(in srgb, var(--ia-surface-raised) var(--ia-panel-alpha-strong), transparent); }
    .ia-flow-step-number { display: grid; width: 26px; height: 26px; place-items: center; border-radius: 50%; background: var(--ia-rail); color: var(--ia-muted); font-size: 12px; font-weight: 700; }
    .ia-flow-step-copy { min-width: 0; }
    .ia-flow-step-copy strong, .ia-flow-step-copy span { display: block; }
    .ia-flow-step-copy strong { font-size: 13px; }
    .ia-flow-step-copy span { margin-top: 2px; color: var(--ia-muted); font-size: 12px; overflow-wrap: break-word; word-break: normal; }
    .ia-run-review { margin-top: 12px; padding: 12px; border: 1px solid var(--ia-line); border-radius: 9px; background: var(--ia-rail); }
    .ia-run-review > strong { display: block; font-size: 13px; }
    .ia-run-review .ia-list { margin-top: 8px; }
    .ia-primary-action { margin-top: 12px; padding: 14px; border: 1px solid var(--ia-line); border-radius: 10px; background: color-mix(in srgb, var(--ia-surface-raised) var(--ia-panel-alpha-strong), transparent); }
    .ia-primary-action .ia-gate-summary { justify-content: space-between; }
    .ia-primary-action .ia-gate-summary > span:first-child > strong,
    .ia-primary-action .ia-gate-summary > span:first-child > .ia-note { display: block; }
    .ia-primary-action .ia-gate-summary > span:first-child > .ia-note { margin-top: 3px; }
    .ia-primary-action .ia-gate-detail { margin-top: 8px; }
    .ia-primary-action .ia-button--danger { width: 100%; }

    .ia-toolbar { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 12px; }
    .ia-button, .ia-link-button, .ia-file-label { display: inline-flex; min-height: 44px; align-items: center; justify-content: center; gap: 7px; border: 1px solid var(--ia-line); border-radius: 8px; padding: 9px 12px; background: var(--ia-ink); color: var(--ia-surface); font-size: 14px; font-weight: 700; line-height: 1.2; text-decoration: none; }
    .ia-button:hover, .ia-link-button:hover, .ia-file-label:hover { filter: brightness(.92); }
    .ia-button--quiet, .ia-link-button--quiet, .ia-file-label--quiet { background: var(--ia-surface-raised); color: var(--ia-ink); }
    .ia-button--danger { border-color: var(--ia-danger); background: var(--ia-danger); color: #fff; }
    .ia-button:disabled, .ia-link-button[aria-disabled="true"] { cursor: not-allowed; filter: none; opacity: .5; }
    .ia-file-label { position: relative; overflow: hidden; }
    .ia-file-label input { position: absolute; inset: 0; width: 100%; height: 100%; opacity: 0; }

    .ia-count { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; margin: 14px 0 8px; }
    .ia-count strong { font-size: 26px; line-height: 1; }
    .ia-count span { color: var(--ia-muted); font-size: 12px; text-align: right; }
    .ia-list, .ia-fragments { display: grid; gap: 0; margin: 0; padding: 0; border-top: 1px solid var(--ia-line); list-style: none; }
    .ia-list-item, .ia-fragments li { padding: 10px 0; border-bottom: 1px solid var(--ia-line); }
    .ia-list-item strong, .ia-list-item small { display: block; }
    .ia-list-item strong { overflow-wrap: anywhere; font-size: 13px; }
    .ia-list-item small { margin-top: 2px; color: var(--ia-muted); font-size: 12px; overflow-wrap: anywhere; }
    .ia-list-item--split { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 10px; align-items: center; }
    .ia-empty { padding: 14px 0; color: var(--ia-muted); font-size: 12px; }
    .ia-note { margin: 10px 0 0; color: var(--ia-muted); font-size: 12px; }

    .ia-batch-panel { padding: 12px 16px; border-top: 1px solid var(--ia-line); background: var(--ia-surface-raised, transparent); }
    .ia-batch-panel .ia-state-row { margin-bottom: 8px; align-items: center; }
    .ia-batch-panel .ia-state-row > div { flex: 1 1 auto; min-width: 0; }
    .ia-progress { overflow: hidden; height: 6px; border-radius: 999px; background: var(--ia-line); }
    .ia-progress-bar { display: block; width: 0%; height: 100%; border-radius: 999px; background: var(--ia-signal); transition: width 240ms ease; }
    .ia-list--compact { max-height: 148px; overflow-y: auto; margin-top: 10px; }
    .ia-list--compact .ia-list-item { padding: 6px 0; }
    .ia-list--compact .ia-list-item[data-status="completed"] strong { color: var(--ia-good, inherit); }
    .ia-list--compact .ia-list-item[data-status="failed"] strong,
    .ia-list--compact .ia-list-item[data-status="stopped"] strong { color: var(--ia-danger); }
    @media (prefers-reduced-motion: reduce) { .ia-progress-bar { transition: none; } }

    .ia-disclosure { margin-top: 12px; border-top: 1px solid var(--ia-line); }
    .ia-disclosure > summary { display: flex; min-height: 44px; align-items: center; justify-content: space-between; gap: 12px; color: var(--ia-ink); font-size: 13px; list-style: none; }
    .ia-disclosure > summary::-webkit-details-marker { display: none; }
    .ia-disclosure > summary::after { content: "+"; color: var(--ia-muted); font-size: 16px; }
    .ia-disclosure[open] > summary::after { content: "−"; }
    .ia-disclosure-body { padding: 0 0 13px; }
    .ia-gate[open] { margin-top: 14px; padding: 0 14px; border: 1px solid var(--ia-line); border-radius: 10px; background: var(--ia-surface-raised); }
    .ia-gate[open] > summary { min-height: 50px; }
    .ia-gate-summary { display: flex; min-width: 0; align-items: center; gap: 8px; }
    .ia-gate-summary strong { overflow-wrap: anywhere; }
    .ia-gate-detail { margin: 0; color: var(--ia-muted); font-size: 12px; }

    .ia-message-row { max-width: 88%; margin: 9px 0; padding: 10px 12px; border: 1px solid var(--ia-line); border-radius: 12px 12px 12px 4px; background: var(--ia-surface-raised); white-space: pre-wrap; overflow-wrap: anywhere; }
    .ia-message-row[data-ownership="sent"] { margin-left: auto; border-radius: 12px 12px 4px; background: var(--ia-rail); }
    .ia-message-meta { margin-top: 4px; color: var(--ia-muted); font-size: 12px; }

    .ia-footer { display: flex; min-height: 42px; align-items: center; justify-content: space-between; gap: 10px; padding: 8px 14px; border-top: 1px solid var(--ia-line); background: color-mix(in srgb, var(--ia-surface-raised) var(--ia-panel-alpha-strong), transparent); color: var(--ia-muted); font-size: 12px; }
    .ia-footer-message { min-width: 0; overflow-wrap: anywhere; }
    .ia-footer strong { color: var(--ia-ink); }
    .ia-footer-lock { flex: 0 0 auto; white-space: nowrap; }

    .ia-dialog { width: min(420px, calc(100vw - 28px)); border: 1px solid var(--ia-line); border-radius: 12px; padding: 0; background: var(--ia-surface-raised); color: var(--ia-ink); box-shadow: var(--ia-shadow); }
    .ia-dialog::backdrop { background: rgba(0, 0, 0, .58); }
    .ia-dialog form { display: grid; gap: 14px; padding: 18px; }
    .ia-dialog h2 { margin: 0; font-size: 20px; }
    .ia-dialog p { margin: 0; color: var(--ia-muted); font-size: 13px; }
    .ia-dialog code { display: block; padding: 10px; border: 1px solid var(--ia-line); border-radius: 8px; background: var(--ia-surface); color: var(--ia-ink); overflow-wrap: anywhere; font-size: 13px; }

    .ia-collision-strip { position: fixed; z-index: 2147483000; display: flex; min-height: 52px; width: min(320px, calc(100vw - 28px)); align-items: center; gap: 9px; padding: 8px 10px; border: 1px solid var(--ia-line); border-radius: 12px; background: var(--ia-surface-raised); color: var(--ia-ink); box-shadow: var(--ia-shadow); font-size: 12px; }
    .ia-collision-copy { min-width: 0; }
    .ia-collision-copy strong, .ia-collision-copy span { display: block; overflow-wrap: anywhere; }
    .ia-collision-copy span { margin-top: 1px; color: var(--ia-muted); }
    .ia-collision-strip .ia-button { min-height: 36px; margin-left: auto; padding: 6px 9px; font-size: 12px; }
    :host([data-collision="active"]) .ia-panel, :host([data-collision="active"]) .ia-launcher { display: none !important; }

    .ia-sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; }
    .ia-resize-handle { position: absolute; z-index: 4; right: 4px; bottom: 4px; display: flex; width: 68px; height: 30px; align-items: center; justify-content: flex-start; border: 1px solid var(--ia-line); border-radius: 8px; padding: 0 22px 0 7px; background: var(--ia-surface-raised); color: var(--ia-muted); cursor: nwse-resize; touch-action: none; font-size: 10px; font-weight: 700; }
    .ia-resize-handle::before { content: ""; position: absolute; right: 7px; bottom: 7px; width: 9px; height: 9px; border-right: 2px solid currentColor; border-bottom: 2px solid currentColor; }

    .ia-launcher:focus-visible, .ia-tab:focus-visible, .ia-icon-button:focus-visible,
    .ia-settings summary:focus-visible, .ia-select:focus-visible, .ia-text-input:focus-visible,
    .ia-button:focus-visible, .ia-link-button:focus-visible, .ia-file-label:focus-within,
    .ia-disclosure > summary:focus-visible, .ia-tool-card:focus-visible, .ia-range:focus-visible,
    .ia-resize-handle:focus-visible {
      outline: 3px solid var(--ia-focus);
      outline-offset: 2px;
    }

    @keyframes ia-open {
      from { opacity: 0; transform: translateY(5px); }
      to { opacity: 1; transform: translateY(0); }
    }

    @media (max-width: 860px) {
      :host { --ia-panel-width: auto; }
      .ia-panel {
        top: auto;
        right: max(0px, env(safe-area-inset-right));
        bottom: 0;
        left: max(0px, env(safe-area-inset-left));
        width: auto;
        max-height: min(78dvh, calc(100dvh - env(safe-area-inset-top)));
        border-radius: 14px 14px 0 0;
      }
      .ia-filter-grid { grid-template-columns: 1fr; }
      .ia-move-handle, .ia-resize-handle { display: none; }
      .ia-shell { grid-template-columns: 1fr; grid-template-rows: minmax(0, 1fr) auto; }
      .ia-header { grid-template-columns: minmax(0, 1fr) auto; }
      .ia-rail { grid-row: 2; display: grid; grid-template-columns: repeat(5, minmax(44px, 1fr)); padding: 4px max(4px, env(safe-area-inset-right)) max(4px, env(safe-area-inset-bottom)) max(4px, env(safe-area-inset-left)); border-top: 1px solid var(--ia-line); border-right: 0; }
      .ia-brand-mark { display: none; }
      .ia-tab { width: 100%; min-height: 52px; grid-template-columns: 1fr; grid-template-rows: 20px auto; place-items: center; gap: 2px; padding: 5px 2px; text-align: center; }
      .ia-tab-label { font-size: 10px; }
      .ia-tab[data-ia-section="workspace"] { margin-top: 0; }
      .ia-tab[aria-selected="true"] { box-shadow: inset 0 -3px 0 var(--ia-signal); }
      .ia-body { grid-row: 1; }
      .ia-settings-panel { position: fixed; top: auto; right: 12px; bottom: calc(58px + env(safe-area-inset-bottom)); left: 12px; width: auto; }
      .ia-facts { grid-template-columns: 1fr; }
      .ia-facts > div + div { border-top: 1px solid var(--ia-line); border-left: 0; }
    }

    @media (max-width: 860px) and (max-height: 500px) and (min-aspect-ratio: 2/1) {
      .ia-panel {
        top: 8px;
        right: 8px;
        bottom: 8px;
        left: auto;
        width: min(380px, calc(100vw - 16px));
        height: auto;
        max-height: calc(100dvh - 16px);
        border-radius: 12px;
      }
      :host([data-dock="left"]) .ia-panel { right: auto; left: 8px; }
      .ia-shell { grid-template-columns: 116px minmax(0, 1fr); grid-template-rows: 1fr; }
      .ia-rail { grid-row: auto; display: flex; padding: 8px 6px; border-top: 0; border-right: 1px solid var(--ia-line); }
      .ia-brand-mark { display: grid; }
      .ia-tab { width: 100%; min-height: 44px; grid-template-columns: 22px minmax(0, 1fr); grid-template-rows: 1fr; place-items: center start; gap: 8px; padding: 8px; text-align: left; }
      .ia-tab-label { font-size: 12px; }
      .ia-tab[data-ia-section="workspace"] { margin-top: auto; }
      .ia-tab[aria-selected="true"] { box-shadow: inset 3px 0 0 var(--ia-signal); }
      .ia-body { grid-row: auto; }
      .ia-header { grid-template-columns: minmax(0, 1fr) auto; }
      .ia-move-handle { display: none; }
      .ia-header-subtitle { display: none; }
      .ia-resize-handle { display: flex; }
      .ia-settings-panel { position: absolute; top: 48px; right: 0; bottom: auto; left: auto; width: 260px; }
      .ia-facts { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .ia-facts > div + div { border-top: 0; border-left: 1px solid var(--ia-line); }
    }

    @media (min-width: 861px) and (max-height: 620px) {
      .ia-panel { top: max(8px, env(safe-area-inset-top)); max-height: calc(100dvh - 16px - env(safe-area-inset-top) - env(safe-area-inset-bottom)); }
      .ia-header { min-height: 56px; }
      .ia-header-subtitle { display: none; }
      .ia-view { padding-top: 12px; padding-bottom: 12px; }
    }

    @media (prefers-reduced-motion: reduce) {
      .ia-panel { animation: none; }
      .ia-launcher { transition: none; }
    }

    @media (forced-colors: active) {
      :host { --ia-signal: Highlight; --ia-focus: Highlight; }
      .ia-panel, .ia-launcher, .ia-collision-strip, .ia-settings-panel, .ia-dialog { border: 2px solid CanvasText; box-shadow: none; }
      .ia-tab[aria-selected="true"] { outline: 2px solid Highlight; outline-offset: -3px; box-shadow: none; }
      .ia-state-dot, .ia-launcher-signal, .ia-tab-signal { border: 2px solid CanvasText; }
      .ia-panel, .ia-header, .ia-footer, .ia-card, .ia-tool-card, .ia-checker-metric, .ia-checker-result { background: Canvas; }
    }
  `;

  function tab(section, label, icon, selected = false) {
    return `<button class="ia-tab" id="ia-tab-${section}" type="button" role="tab" aria-controls="ia-view-${section}" aria-selected="${selected}" tabindex="${selected ? '0' : '-1'}" data-ia-section="${section}" aria-label="${label}" title="${label}">${icons.svg(icon)}<span class="ia-tab-label">${label}</span>${section === 'queue' ? '<span class="ia-tab-signal" data-ia-role="queue-signal" hidden></span>' : ''}</button>`;
  }

  function create({ document: targetDocument, openShadow = false }) {
    const host = targetDocument.createElement('div');
    host.id = 'insta-aio-sidecar-root';
    host.dataset.collision = 'inactive';
    host.dataset.density = 'comfortable';
    host.dataset.dock = 'right';
    host.dataset.layout = 'docked';
    host.dataset.theme = 'light';
    host.dataset.width = 'standard';
    const shadow = host.attachShadow({ mode: openShadow ? 'open' : 'closed' });
    shadow.innerHTML = `
      <style>${styles}</style>
      <button class="ia-launcher" type="button" data-ia-action="open" aria-label="Open Insta AIO sidecar" aria-expanded="false">
        <span class="ia-launcher-mark" aria-hidden="true">A</span>
        <span class="ia-launcher-signal" data-ia-role="launcher-signal" hidden></span>
      </button>
      <aside class="ia-panel" aria-label="Insta AIO Instagram sidecar" hidden>
        <div class="ia-shell">
          <nav class="ia-rail" role="tablist" aria-label="Insta AIO tools" aria-orientation="vertical">
            <div class="ia-brand-mark" title="Insta AIO" aria-hidden="true">A</div>
            ${tab('now', 'Toolbox', 'now', true)}
            ${tab('capture', 'Follower checker', 'capture')}
            ${tab('queue', 'Follow / Unfollow', 'queue')}
            ${tab('messages', 'DM Unsend', 'messages')}
            ${tab('workspace', 'Workspace', 'workspace')}
          </nav>
          <div class="ia-body">
            <header class="ia-header">
              <button class="ia-icon-button ia-move-handle" type="button" data-ia-role="move-handle" aria-label="Move sidecar; use arrow keys for precise movement" title="Drag to move · Arrow keys move">${icons.svg('move')}<span>Move</span></button>
              <div class="ia-header-copy">
                <p class="ia-context-label" data-ia-role="view-context">Now · Instagram</p>
                <h1 data-ia-role="view-title">Instagram tools</h1>
                <p class="ia-header-subtitle" data-ia-role="view-subtitle">Follower checker, account review, and DM Unsend.</p>
              </div>
              <div class="ia-header-actions">
                <details class="ia-settings" data-ia-role="settings">
                  <summary aria-label="Overlay preferences">${icons.svg('preferences')}</summary>
                  <div class="ia-settings-panel">
                    <strong>Overlay preferences</strong>
                    <div class="ia-field"><label for="ia-pref-dock">Dock side</label><select class="ia-select" id="ia-pref-dock" data-ia-preference="dock"><option value="right">Right</option><option value="left">Left</option></select></div>
                    <div class="ia-field"><label for="ia-pref-width">Panel width</label><select class="ia-select" id="ia-pref-width" data-ia-preference="width"><option value="compact">Compact</option><option value="standard">Standard</option><option value="wide">Wide</option></select></div>
                    <div class="ia-field"><label for="ia-pref-theme">Theme</label><select class="ia-select" id="ia-pref-theme" data-ia-preference="theme"><option value="auto">Match Instagram</option><option value="light">Light</option><option value="dark">Dark</option></select></div>
                    <div class="ia-field"><label for="ia-pref-density">Density</label><select class="ia-select" id="ia-pref-density" data-ia-preference="density"><option value="comfortable">Comfortable</option><option value="compact">Compact</option></select></div>
                    <div class="ia-field"><label for="ia-pref-opacity">Surface transparency</label><div class="ia-range-row"><input class="ia-range" id="ia-pref-opacity" type="range" min="55" max="100" step="1" value="88" data-ia-preference="opacity"><output class="ia-range-output" for="ia-pref-opacity" data-ia-role="opacity-output">88%</output></div></div>
                    <div class="ia-field"><label>Size presets</label><div class="ia-toolbar"><button class="ia-button ia-button--quiet" type="button" data-ia-action="layout-preset" data-layout-preset="compact">Compact</button><button class="ia-button ia-button--quiet" type="button" data-ia-action="layout-preset" data-layout-preset="tall">Tall</button><button class="ia-button ia-button--quiet" type="button" data-ia-action="layout-preset" data-layout-preset="wide">Wide</button></div></div>
                    <button class="ia-button ia-button--quiet" type="button" data-ia-action="reset-layout">Reset position and size</button>
                    <details class="ia-disclosure" data-ia-role="advanced-settings"><summary>Advanced controls</summary><div class="ia-disclosure-body" data-ia-role="advanced-settings-body"></div></details>
                    <p class="ia-note">Drag the header handle or resize from the lower corner. Arrow keys work on both controls. Shortcut: Alt + Shift + I.</p>
                  </div>
                </details>
                <button class="ia-icon-button" type="button" data-ia-action="close" aria-label="Collapse Insta AIO sidecar">${icons.svg('close')}</button>
              </div>
            </header>
            <div class="ia-scroll">
              <section class="ia-view" id="ia-view-now" role="tabpanel" aria-labelledby="ia-tab-now" tabindex="0" data-ia-view="now"><div data-ia-role="first-run-slot"></div><div data-ia-role="now-content"></div></section>
              <section class="ia-view" id="ia-view-capture" role="tabpanel" aria-labelledby="ia-tab-capture" tabindex="0" data-ia-view="capture" hidden>
                <div class="ia-state-row" data-ia-role="capture-state" data-tone="neutral"><span class="ia-state-dot"></span><div><strong data-ia-role="capture-state-title">Ready for a read-only check</strong><span data-ia-role="capture-state-detail">Confirm your Instagram username, then load Followers and Following.</span></div></div>
                <section class="ia-primary-action" aria-labelledby="ia-checker-account-title"><div class="ia-gate-summary"><span><strong id="ia-checker-account-title">Check an account</strong><span class="ia-note">Uses the Instagram session already open in this tab.</span></span><span class="ia-badge">read only</span></div><div class="ia-disclosure-body"><div class="ia-field"><label for="ia-checker-username">Instagram username</label><input class="ia-text-input" id="ia-checker-username" type="text" inputmode="text" autocomplete="username" autocapitalize="none" spellcheck="false" placeholder="your_username" data-ia-role="checker-username"></div><button class="ia-button" type="button" data-ia-action="check-account-relationships" data-ia-role="checker-run">Check Followers + Following</button><p class="ia-note">Loads paginated relationship data from Instagram, compares it on this device, and never follows, unfollows, sends, unsends, or opens account controls.</p></div></section>
                <div class="ia-checker-metrics" aria-label="Follower checker draft counts"><div class="ia-checker-metric"><span>Followers captured</span><strong data-ia-role="followers-count">0</strong></div><div class="ia-checker-metric"><span>Following captured</span><strong data-ia-role="following-count">0</strong></div></div>
                <div class="ia-checker-result" data-ia-role="checker-result"></div>
                <div data-ia-role="checker-browser-slot"></div>
                <details class="ia-disclosure"><summary>Advanced: list-dialog fallback and export</summary><div class="ia-disclosure-body"><p class="ia-note">If Instagram rejects the account check, open your own Following or Followers dialog and use the matching fallback scan. Starting a fallback scan clears authenticated results first so accounts from different profiles cannot mix.</p><ol class="ia-flow" aria-label="Follower checker fallback steps"><li class="ia-flow-step" data-ia-role="following-step"><span class="ia-flow-step-number">1</span><span class="ia-flow-step-copy"><strong>Scan open Following dialog</strong><span data-ia-role="following-step-detail">Open your Following list first</span></span><button class="ia-button ia-button--quiet" type="button" data-ia-action="scan-full-list" data-list-type="following">Scan</button></li><li class="ia-flow-step" data-ia-role="followers-step"><span class="ia-flow-step-number">2</span><span class="ia-flow-step-copy"><strong>Scan open Followers dialog</strong><span data-ia-role="followers-step-detail">Open your Followers list next</span></span><button class="ia-button ia-button--quiet" type="button" data-ia-action="scan-full-list" data-list-type="followers">Scan</button></li><li class="ia-flow-step" data-ia-role="compare-step"><span class="ia-flow-step-number">3</span><span class="ia-flow-step-copy"><strong>Compare</strong><span data-ia-role="compare-step-detail">Scan both lists first</span></span><span class="ia-badge" data-ia-role="compare-step-badge">waiting</span></li></ol><div class="ia-count"><strong data-ia-role="capture-count">0</strong><span data-ia-role="capture-detail">No draft yet</span></div><ul class="ia-list" data-ia-role="capture-list"></ul><div class="ia-field"><label for="ia-list-type-manual">List for manual capture</label><select class="ia-select" id="ia-list-type-manual" data-ia-role="list-type"><option value="following">Following</option><option value="followers">Followers</option></select></div><div class="ia-toolbar"><button class="ia-button ia-button--quiet" type="button" data-ia-action="capture-visible">Capture visible rows</button><a class="ia-link-button ia-link-button--quiet" data-ia-role="capture-download" aria-disabled="true">Download selected list</a><button class="ia-button ia-button--quiet" type="button" data-ia-action="reset-capture">Clear checker</button></div></div></details>
              </section>
              <section class="ia-view" id="ia-view-queue" role="tabpanel" aria-labelledby="ia-tab-queue" tabindex="0" data-ia-view="queue" hidden>
                <div data-ia-role="queue-current"></div>
                <div data-ia-role="queue-controls" hidden><div class="ia-toolbar"><a class="ia-link-button" data-ia-role="queue-open" rel="noreferrer">Open profile</a></div><details class="ia-disclosure"><summary>Queue item options</summary><div class="ia-disclosure-body"><div class="ia-toolbar"><button class="ia-button ia-button--quiet" type="button" data-ia-action="queue-complete">Mark complete</button><button class="ia-button ia-button--quiet" type="button" data-ia-action="queue-skip">Skip item</button></div></div></details></div>
                <details class="ia-disclosure ia-gate" data-ia-role="account-live-disclosure"><summary><span class="ia-gate-summary"><span class="ia-state-dot"></span><strong data-ia-role="live-title">Live action locked</strong></span><span class="ia-badge" data-ia-role="live-badge">locked</span></summary><div class="ia-disclosure-body"><p class="ia-gate-detail" data-ia-role="live-detail">A signed one-item intent from the paired PWA is required.</p><p class="ia-gate-detail" data-ia-role="live-countdown" hidden></p><div class="ia-toolbar"><button class="ia-button ia-button--danger" type="button" data-ia-action="arm-account-live" disabled>Arm exact action</button><button class="ia-button ia-button--quiet" type="button" data-ia-action="cancel-account-live" hidden>Cancel intent</button></div><p class="ia-note">Arming does not perform the action. The PWA must revalidate and reserve the same reviewed item.</p></div></details>
                <section class="ia-primary-action" data-ia-role="bot-disclosure" aria-labelledby="ia-bot-composer-title"><div class="ia-gate-summary"><span><strong id="ia-bot-composer-title">Run composer</strong><span class="ia-note">Inspect exact profiles before any live action.</span></span><span class="ia-badge" data-ia-role="bot-badge">idle</span></div><div class="ia-disclosure-body">
                  <div class="ia-field"><label for="ia-bot-source">Targets</label><select class="ia-select" id="ia-bot-source" data-ia-role="bot-source"><option value="current-profile">Current exact profile</option><option value="not-following-me-back">Not following me back (from checker)</option><option value="i-do-not-follow-back">I don't follow back (from checker)</option><option value="queue">Manual queue</option></select></div>
                  <div class="ia-field"><label for="ia-bot-action">Action</label><select class="ia-select" id="ia-bot-action" data-ia-role="bot-action"><option value="unfollow">Unfollow</option><option value="follow">Follow</option></select></div>
                  <div class="ia-field"><label for="ia-bot-count">How many this run</label><input class="ia-text-input" id="ia-bot-count" type="number" min="1" max="250" value="20" data-ia-role="bot-count"></div>
                  <p class="ia-gate-detail" data-ia-role="bot-detail">Each target is opened, verified, and acted on one at a time with randomised pacing.</p>
                  <div class="ia-toolbar"><button class="ia-button" type="button" data-ia-action="bot-review">Review targets</button><button class="ia-button ia-button--danger" type="button" data-ia-action="bot-start" hidden>Start reviewed run</button></div>
                  <div class="ia-run-review" data-ia-role="bot-review" hidden><strong data-ia-role="bot-review-title"></strong><ul class="ia-list ia-list--compact" data-ia-role="bot-review-list"></ul><p class="ia-note" data-ia-role="bot-review-detail"></p></div>
                  <p class="ia-note">The run stops itself on any rate limit, checkpoint, block, or unexpected screen. Instagram's terms discourage automated following; you are responsible for how you pace it.</p>
                </div></section>
                <details class="ia-disclosure"><summary>Queue files</summary><div class="ia-disclosure-body"><div class="ia-toolbar"><label class="ia-file-label ia-file-label--quiet">Import queue JSON<input type="file" accept=".json,application/json" aria-label="Import Insta AIO manual queue JSON" data-ia-role="queue-file"></label><a class="ia-link-button ia-link-button--quiet" data-ia-role="queue-download" aria-disabled="true">Download queue state</a></div></div></details>
                <details class="ia-disclosure"><summary>Signed run history</summary><div class="ia-disclosure-body"><ul class="ia-list" data-ia-role="run-list"></ul></div></details>
              </section>
              <section class="ia-view" id="ia-view-messages" role="tabpanel" aria-labelledby="ia-tab-messages" tabindex="0" data-ia-view="messages" hidden>
                <div class="ia-state-row" data-ia-role="message-state" data-tone="neutral"><span class="ia-state-dot"></span><div><strong data-ia-role="message-state-title">Open a conversation</strong><span data-ia-role="message-state-detail">Visible evidence is read-only until exact identity is available.</span></div></div>
                <div class="ia-primary-action" data-ia-role="unsend-disclosure"><div class="ia-gate-summary"><span><strong>Conversation plan</strong></span><span class="ia-badge" data-ia-role="unsend-badge">check first</span></div><div class="ia-disclosure-body">
                  <p class="ia-gate-detail" data-ia-role="unsend-detail">Check conversation loads sent-message history without opening a menu or removing anything.</p>
                  <div class="ia-toolbar"><button class="ia-button" type="button" data-ia-action="scan-sent-dms">Check conversation</button></div>
                  <p class="ia-note" data-ia-role="unsend-eligible">Check this conversation to resolve the eligible count</p>
                  <div data-ia-role="unsend-plan"><div class="ia-field"><label for="ia-unsend-scope">Scope</label><select class="ia-select" id="ia-unsend-scope" data-ia-role="unsend-scope"><option value="all">All eligible sent messages</option><option value="newest">Newest N</option><option value="oldest">Oldest N</option></select></div><div class="ia-field"><label for="ia-unsend-count">Number of messages</label><input class="ia-text-input" id="ia-unsend-count" type="number" min="1" max="250" value="1" data-ia-role="unsend-count"></div><div class="ia-toolbar"><button class="ia-button ia-button--danger" type="button" data-ia-action="mass-unsend" disabled>Check conversation first</button></div><p class="ia-note">Unsending is permanent. The exact thread, scope, count, digest, and expiry are revalidated before the first message menu opens.</p></div>
                </div></div>
                <div class="ia-count"><strong data-ia-role="message-count">0</strong><span data-ia-role="message-detail">No evidence yet</span></div>
                <ul class="ia-fragments" data-ia-role="message-list"></ul>
                <details class="ia-disclosure"><summary>Visible evidence</summary><div class="ia-disclosure-body"><div class="ia-toolbar"><button class="ia-button ia-button--quiet" type="button" data-ia-action="inspect-messages">Read visible thread</button><a class="ia-link-button ia-link-button--quiet" data-ia-role="message-download" aria-disabled="true">Download evidence</a></div></div></details>
                <details class="ia-disclosure ia-gate" data-ia-role="dm-live-disclosure"><summary><span class="ia-gate-summary"><span class="ia-state-dot"></span><strong data-ia-role="dm-live-title">Live Unsend locked</strong></span><span class="ia-badge" data-ia-role="dm-live-badge">locked</span></summary><div class="ia-disclosure-body"><p class="ia-gate-detail" data-ia-role="dm-live-detail">A twice-confirmed exact sent-message intent is required.</p><p class="ia-gate-detail" data-ia-role="dm-live-countdown" hidden></p><div class="ia-toolbar"><button class="ia-button ia-button--danger" type="button" data-ia-action="arm-dm-live" disabled>Arm exact message</button><button class="ia-button ia-button--quiet" type="button" data-ia-action="cancel-dm-live" hidden>Cancel intent</button></div><p class="ia-note">Arming does not open a menu or remove anything.</p></div></details>
                <details class="ia-disclosure"><summary>Identity and ownership details</summary><div class="ia-disclosure-body"><p class="ia-note" data-ia-role="message-identity-detail">Visible text alone cannot authorize removal.</p></div></details>
              </section>
              <section class="ia-view" id="ia-view-workspace" role="tabpanel" aria-labelledby="ia-tab-workspace" tabindex="0" data-ia-view="workspace" hidden>
                <div class="ia-state-row" data-ia-role="bridge-state" data-tone="warning"><span class="ia-state-dot"></span><div><strong data-ia-role="bridge-title">Checking pairing</strong><span data-ia-role="bridge-detail">The overlay never receives Instagram credentials or cookies.</span></div></div>
                <dl class="ia-card ia-facts" data-ia-role="bridge-facts"></dl>
                <div class="ia-toolbar"><a class="ia-link-button" data-ia-role="workspace-link" aria-disabled="true" rel="noreferrer">Open workspace</a></div>
                <details class="ia-disclosure"><summary>Privacy and pairing guidance</summary><div class="ia-disclosure-body"><p class="ia-note" data-ia-role="workspace-guidance">Create a code in PWA Settings, then pair the exact PWA tab from the extension setup popup.</p></div></details>
              </section>
            </div>
            <div class="ia-batch-panel" data-ia-role="batch-panel" hidden>
              <div class="ia-state-row" data-ia-role="batch-state" data-tone="neutral"><span class="ia-state-dot"></span><div><strong data-ia-role="batch-title">Batch idle</strong><span data-ia-role="batch-detail"></span></div><button class="ia-button ia-button--danger" type="button" data-ia-action="batch-stop" hidden>Stop</button></div>
              <div class="ia-progress" role="progressbar" aria-valuemin="0" aria-valuenow="0" aria-valuemax="0" data-ia-role="batch-meter"><span class="ia-progress-bar" data-ia-role="batch-bar"></span></div>
              <p class="ia-note" data-ia-role="batch-next" hidden></p>
              <ul class="ia-list ia-list--compact" data-ia-role="batch-results"></ul>
            </div>
            <footer class="ia-footer" role="status" aria-live="polite" data-ia-role="status"><span class="ia-footer-message"><strong data-ia-role="status-lead">Ready.</strong> <span data-ia-role="status-text">Live actions remain locked.</span></span><span class="ia-footer-lock">Local only</span></footer>
          </div>
        </div>
        <button class="ia-resize-handle" type="button" data-ia-role="resize-handle" aria-label="Resize sidecar; use arrow keys for precise sizing" title="Drag to resize · Arrow keys resize">Resize</button>
      </aside>
      <div class="ia-collision-strip" role="status" aria-live="polite" data-ia-role="collision-strip" hidden>
        <span class="ia-state-dot"></span><div class="ia-collision-copy"><strong data-ia-role="collision-target">Exact target</strong><span data-ia-role="collision-state">Native action surface is visible</span></div><button class="ia-button ia-button--quiet" type="button" data-ia-action="cancel-current-live" hidden>Cancel</button>
      </div>
      <dialog class="ia-dialog" data-ia-role="arm-dialog" aria-labelledby="ia-arm-title" aria-describedby="ia-arm-description">
        <form method="dialog"><div><h2 id="ia-arm-title">Arm controlled action</h2><p id="ia-arm-description" data-ia-role="arm-description">Type the exact phrase for this reviewed item.</p></div><code data-ia-role="arm-phrase"></code><div class="ia-field"><label for="ia-arm-input">Exact arming phrase</label><input class="ia-text-input" id="ia-arm-input" data-ia-role="arm-input" autocomplete="off" spellcheck="false"></div><div class="ia-toolbar"><button class="ia-button ia-button--quiet" value="cancel">Cancel</button><button class="ia-button ia-button--danger" value="confirm">Arm for 90 seconds</button></div></form>
      </dialog>
      <template data-ia-template="advanced-settings"><strong>Batch pacing and limits</strong><div class="ia-field"><label for="ia-limit-actions">Follow/unfollow per day</label><input class="ia-text-input" id="ia-limit-actions" type="number" min="1" max="400" data-ia-role="limit-actions"></div><div class="ia-field"><label for="ia-limit-dms">Unsends per day</label><input class="ia-text-input" id="ia-limit-dms" type="number" min="1" max="300" data-ia-role="limit-dms"></div><div class="ia-field"><label for="ia-limit-min-delay">Min delay (seconds)</label><input class="ia-text-input" id="ia-limit-min-delay" type="number" min="2" max="600" data-ia-role="limit-min-delay"></div><div class="ia-field"><label for="ia-limit-max-delay">Max delay (seconds)</label><input class="ia-text-input" id="ia-limit-max-delay" type="number" min="2" max="900" data-ia-role="limit-max-delay"></div><button class="ia-button ia-button--quiet" type="button" data-ia-action="save-limits">Save pacing</button></template>
      <template data-ia-template="first-run"><section class="ia-first-run" data-ia-role="first-run" aria-labelledby="ia-first-run-title"><h2 id="ia-first-run-title">Start with a read-only check</h2><p>Insta AIO adds three tools to Instagram without sending account data elsewhere.</p><ol><li><strong>Follower checker</strong><span>Scan Followers and Following, then compare usernames on this device.</span></li><li><strong>Follow / Unfollow</strong><span>Build and review an exact target list. Live actions stay locked by default.</span></li><li><strong>DM Unsend</strong><span>Inspect one conversation before reviewing exact sent messages. Live removal stays locked.</span></li></ol><div class="ia-toolbar"><button class="ia-button" type="button" data-ia-action="first-run-start">Open follower checker</button><button class="ia-button ia-button--quiet" type="button" data-ia-action="first-run-dismiss">Not now</button></div></section></template>
      <template data-ia-template="checker-browser"><section class="ia-checker-browser" data-ia-role="checker-browser" aria-label="Follower comparison accounts"><div class="ia-filter-grid"><div class="ia-field"><label for="ia-checker-category">Show accounts</label><select class="ia-select" id="ia-checker-category" data-ia-role="checker-category"><option value="not-following-me-back">Not following me back</option><option value="i-do-not-follow-back">I do not follow back</option><option value="mutuals">Mutual followers</option></select></div><div class="ia-field"><label for="ia-checker-search">Find a username</label><input class="ia-text-input" id="ia-checker-search" type="search" inputmode="search" autocomplete="off" spellcheck="false" placeholder="Search usernames" data-ia-role="checker-search"></div></div><div class="ia-count" aria-live="polite"><strong data-ia-role="checker-filter-count">0</strong><span data-ia-role="checker-filter-detail">accounts</span></div><ul class="ia-list" data-ia-role="checker-filtered-list"></ul></section></template>
    `;
    return Object.freeze({ host, shadow });
  }

  shared.install('shell', { create, styles });
})();

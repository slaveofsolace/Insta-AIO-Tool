(() => {
  'use strict';

  const modules = globalThis.__instaToolboxOverlayModules;
  const shared = modules?.shared;
  const icons = modules?.icons;
  if (!shared || !icons || modules.shell) return;

  const styles = `
    :host {
      all: initial;
      --insta-toolbox-surface: #f7f8f5;
      --insta-toolbox-surface-raised: #ffffff;
      --insta-toolbox-rail: #eef0eb;
      --insta-toolbox-ink: #1d211b;
      --insta-toolbox-muted: #687064;
      --insta-toolbox-line: #d8ddd4;
      --insta-toolbox-signal: #b83d67;
      --insta-toolbox-signal-ink: #ffffff;
      --insta-toolbox-warning: #9b5d09;
      --insta-toolbox-danger: #ad3025;
      --insta-toolbox-good: #27753c;
      --insta-toolbox-focus: #168cff;
      --insta-toolbox-shadow: 0 18px 54px rgba(0, 0, 0, .18);
      --insta-toolbox-panel-width: 460px;
      --insta-toolbox-panel-alpha: 88%;
      --insta-toolbox-panel-alpha-strong: 96%;
      --insta-toolbox-backdrop-blur: 10px;
      --insta-toolbox-launcher-size: 44px;
      --insta-toolbox-panel-inline-start: auto;
      --insta-toolbox-panel-inline-end: max(14px, env(safe-area-inset-right));
      color-scheme: light;
      font-family: "Segoe UI Variable", "Segoe UI", system-ui, sans-serif;
    }

    :host([data-accent="violet"]) { --insta-toolbox-signal: var(--insta-toolbox-accent-violet); --insta-toolbox-focus: var(--insta-toolbox-accent-violet); }
    :host([data-accent="blue"]) { --insta-toolbox-signal: var(--insta-toolbox-accent-blue); --insta-toolbox-focus: var(--insta-toolbox-accent-blue); }
    :host([data-blur="none"]) { --insta-toolbox-backdrop-blur: 0px; }
    :host([data-blur="strong"]) { --insta-toolbox-backdrop-blur: 18px; }
    :host([data-launcher-size="large"]) { --insta-toolbox-launcher-size: 52px; }

    :host([data-theme="dark"]) {
      --insta-toolbox-surface: #151714;
      --insta-toolbox-surface-raised: #1c1f1b;
      --insta-toolbox-rail: #10120f;
      --insta-toolbox-ink: #f3f5ef;
      --insta-toolbox-muted: #a9afa3;
      --insta-toolbox-line: #343a31;
      --insta-toolbox-signal-ink: #ffffff;
      --insta-toolbox-warning: #efb55e;
      --insta-toolbox-danger: #ff968a;
      --insta-toolbox-good: #8dd39d;
      --insta-toolbox-shadow: 0 18px 58px rgba(0, 0, 0, .52);
      color-scheme: dark;
    }

    :host([data-width="compact"]) { --insta-toolbox-panel-width: 380px; }
    :host([data-width="wide"]) { --insta-toolbox-panel-width: 560px; }
    :host([data-adaptive-width="reviewed-target"]) { --insta-toolbox-panel-width: 380px; }
    :host([data-dock="left"]) {
      --insta-toolbox-panel-inline-start: max(14px, env(safe-area-inset-left));
      --insta-toolbox-panel-inline-end: auto;
    }

    *, *::before, *::after { box-sizing: border-box; }
    button, input, select, summary { font: inherit; }
    button, summary, label { -webkit-tap-highlight-color: transparent; }
    button, summary, .insta-toolbox-file-label { cursor: pointer; }
    svg { width: 20px; height: 20px; fill: none; stroke: currentColor; stroke-linecap: round; stroke-linejoin: round; stroke-width: 1.7; }
    [hidden] { display: none !important; }

    .insta-toolbox-launcher {
      position: fixed;
      z-index: 2147483000;
      right: max(14px, env(safe-area-inset-right));
      bottom: max(14px, env(safe-area-inset-bottom));
      display: grid;
      width: var(--insta-toolbox-launcher-size);
      height: var(--insta-toolbox-launcher-size);
      place-items: center;
      border: 1px solid var(--insta-toolbox-line);
      border-radius: 12px;
      background: var(--insta-toolbox-surface-raised);
      color: var(--insta-toolbox-ink);
      box-shadow: 0 8px 28px rgba(0, 0, 0, .18);
      font-weight: 800;
      cursor: grab;
      touch-action: none;
      transition: transform 140ms ease, box-shadow 140ms ease;
    }
    :host([data-layout-interaction="launcher"]) .insta-toolbox-launcher { cursor: grabbing; }
    :host([data-dock="left"]) .insta-toolbox-launcher { right: auto; left: max(14px, env(safe-area-inset-left)); }
    :host([data-launcher-layout="floating"]) .insta-toolbox-launcher { top: var(--insta-toolbox-launcher-top); right: auto; bottom: auto; left: var(--insta-toolbox-launcher-left); }
    .insta-toolbox-launcher:hover { transform: translateY(-1px); box-shadow: 0 10px 32px rgba(0, 0, 0, .22); }
    .insta-toolbox-launcher-mark { font-size: 15px; letter-spacing: -.03em; }
    .insta-toolbox-launcher-signal { position: absolute; top: 5px; right: 5px; width: 8px; height: 8px; border: 2px solid var(--insta-toolbox-surface-raised); border-radius: 50%; background: var(--insta-toolbox-signal); }

    .insta-toolbox-panel {
      position: fixed;
      z-index: 2147483000;
      top: max(54px, env(safe-area-inset-top));
      left: var(--insta-toolbox-panel-inline-start);
      right: var(--insta-toolbox-panel-inline-end);
      width: min(var(--insta-toolbox-panel-custom-width, var(--insta-toolbox-panel-width)), calc(100vw - 28px - env(safe-area-inset-left) - env(safe-area-inset-right)));
      height: var(--insta-toolbox-panel-custom-height, auto);
      max-height: calc(100dvh - 72px - env(safe-area-inset-top) - env(safe-area-inset-bottom));
      overflow: hidden;
      border: 1px solid var(--insta-toolbox-line);
      border-radius: 12px;
      background: color-mix(in srgb, var(--insta-toolbox-surface) var(--insta-toolbox-panel-alpha), transparent);
      color: var(--insta-toolbox-ink);
      box-shadow: var(--insta-toolbox-shadow);
      backdrop-filter: blur(var(--insta-toolbox-backdrop-blur)) saturate(.94);
      -webkit-backdrop-filter: blur(var(--insta-toolbox-backdrop-blur)) saturate(.94);
      font-size: 14px;
      line-height: 1.45;
      animation: insta-toolbox-open 150ms cubic-bezier(.2, .8, .2, 1);
    }

    :host([data-layout="floating"]) .insta-toolbox-panel {
      top: var(--insta-toolbox-panel-top);
      right: auto;
      left: var(--insta-toolbox-panel-left);
    }

    .insta-toolbox-shell { display: grid; height: 100%; max-height: inherit; grid-template-columns: 124px minmax(0, 1fr); }
    .insta-toolbox-rail { display: flex; min-height: 0; flex-direction: column; align-items: stretch; gap: 2px; padding: 8px 6px; border-right: 1px solid var(--insta-toolbox-line); background: color-mix(in srgb, var(--insta-toolbox-rail) var(--insta-toolbox-panel-alpha-strong), transparent); }
    .insta-toolbox-brand-mark { display: grid; width: 38px; height: 38px; margin-bottom: 8px; place-items: center; border-radius: 10px; background: var(--insta-toolbox-ink); color: var(--insta-toolbox-surface); font-weight: 800; }
    .insta-toolbox-tab { position: relative; display: grid; width: 100%; min-height: 44px; grid-template-columns: 22px minmax(0, 1fr); align-items: center; gap: 8px; border: 0; border-radius: 9px; padding: 8px; background: transparent; color: var(--insta-toolbox-muted); text-align: left; }
    .insta-toolbox-tab-label { min-width: 0; overflow-wrap: break-word; font-size: 12px; font-weight: 650; line-height: 1.15; }
    .insta-toolbox-tab:hover { background: var(--insta-toolbox-surface-raised); color: var(--insta-toolbox-ink); }
    .insta-toolbox-tab[aria-selected="true"] { background: var(--insta-toolbox-surface-raised); color: var(--insta-toolbox-ink); box-shadow: inset 3px 0 0 var(--insta-toolbox-signal); }
    .insta-toolbox-tab[data-insta-toolbox-section="workspace"] { margin-top: auto; }
    .insta-toolbox-tab-signal { position: absolute; top: 7px; right: 6px; width: 7px; height: 7px; border: 2px solid var(--insta-toolbox-rail); border-radius: 50%; background: var(--insta-toolbox-signal); }

    .insta-toolbox-body { position: relative; display: grid; min-width: 0; min-height: 0; max-height: inherit; grid-template-rows: auto minmax(0, 1fr) auto auto; container: insta-toolbox-body / inline-size; }
    .insta-toolbox-header { position: relative; z-index: 2; display: grid; min-height: 52px; grid-template-columns: auto minmax(0, 1fr) auto; align-items: center; gap: 6px; padding: 4px 8px; border-bottom: 1px solid var(--insta-toolbox-line); background: color-mix(in srgb, var(--insta-toolbox-surface-raised) var(--insta-toolbox-panel-alpha-strong), transparent); }
    .insta-toolbox-header-copy { min-width: 0; }
    .insta-toolbox-header h1 { margin: 0; overflow: hidden; color: var(--insta-toolbox-ink); font-size: 16px; line-height: 1.2; letter-spacing: -.015em; text-overflow: ellipsis; white-space: nowrap; }
    .insta-toolbox-header-actions { display: flex; flex: 0 0 auto; align-items: center; gap: 2px; }
    .insta-toolbox-icon-button { display: grid; width: 44px; height: 44px; place-items: center; border: 0; border-radius: 9px; background: transparent; color: var(--insta-toolbox-ink); }
    .insta-toolbox-move-handle { min-width: 44px; padding: 0; cursor: grab; touch-action: none; }
    :host([data-layout-interaction="move"]) .insta-toolbox-move-handle { cursor: grabbing; }
    .insta-toolbox-icon-button:hover, .insta-toolbox-icon-button[aria-expanded="true"] { background: var(--insta-toolbox-surface); }
    .insta-toolbox-field { display: grid; gap: 5px; }
    .insta-toolbox-field label { color: var(--insta-toolbox-muted); font-size: 12px; }
    .insta-toolbox-select, .insta-toolbox-text-input { min-height: 44px; width: 100%; border: 1px solid var(--insta-toolbox-line); border-radius: 8px; padding: 8px 10px; background: var(--insta-toolbox-surface-raised); color: var(--insta-toolbox-ink); }
    .insta-toolbox-range-row { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 8px; align-items: center; }
    .insta-toolbox-range { width: 100%; accent-color: var(--insta-toolbox-signal); }
    .insta-toolbox-range-output { min-width: 40px; color: var(--insta-toolbox-muted); font-variant-numeric: tabular-nums; text-align: right; }

    .insta-toolbox-scroll { min-height: 0; overflow: auto; padding-bottom: 10px; overscroll-behavior: contain; scrollbar-color: var(--insta-toolbox-muted) var(--insta-toolbox-surface); }
    .insta-toolbox-view { padding: 16px; }
    :host([data-density="compact"]) .insta-toolbox-view { padding: 12px; }
    .insta-toolbox-view[role="tabpanel"]:focus { outline: none; }
    .insta-toolbox-view[role="tabpanel"]:focus-visible { outline: 3px solid var(--insta-toolbox-focus); outline-offset: -3px; }

    .insta-toolbox-state-row { display: flex; align-items: flex-start; gap: 9px; margin-bottom: 14px; }
    .insta-toolbox-state-dot { width: 8px; height: 8px; flex: 0 0 auto; margin-top: 5px; border: 1px solid color-mix(in srgb, var(--insta-toolbox-muted) 55%, var(--insta-toolbox-ink)); border-radius: 50%; background: var(--insta-toolbox-muted); }
    .insta-toolbox-state-row[data-tone="good"] .insta-toolbox-state-dot { background: var(--insta-toolbox-good); }
    .insta-toolbox-state-row[data-tone="warning"] .insta-toolbox-state-dot { background: var(--insta-toolbox-warning); }
    .insta-toolbox-state-row[data-tone="danger"] .insta-toolbox-state-dot { background: var(--insta-toolbox-danger); }
    .insta-toolbox-collision-strip .insta-toolbox-state-dot { border-color: color-mix(in srgb, var(--insta-toolbox-signal) 55%, var(--insta-toolbox-ink)); background: var(--insta-toolbox-signal); }
    .insta-toolbox-state-row strong, .insta-toolbox-state-row span { display: block; }
    .insta-toolbox-state-row strong { font-size: 13px; }
    .insta-toolbox-state-row span { margin-top: 2px; color: var(--insta-toolbox-muted); font-size: 12px; }

    .insta-toolbox-card { border: 1px solid var(--insta-toolbox-line); border-radius: 10px; background: color-mix(in srgb, var(--insta-toolbox-surface-raised) var(--insta-toolbox-panel-alpha-strong), transparent); }
    .insta-toolbox-card-pad { padding: 14px; }
    .insta-toolbox-target-top { display: grid; grid-template-columns: 42px minmax(0, 1fr); gap: 8px 10px; align-items: center; padding: 14px; }
    .insta-toolbox-target-top > .insta-toolbox-badge { grid-column: 2; justify-self: start; }
    .insta-toolbox-target-avatar { display: grid; width: 42px; height: 42px; place-items: center; border-radius: 9px; background: var(--insta-toolbox-rail); color: var(--insta-toolbox-muted); font-size: 12px; font-weight: 700; }
    .insta-toolbox-target-top h2 { margin: 0; overflow-wrap: break-word; word-break: normal; font-size: 17px; line-height: 1.2; }
    .insta-toolbox-target-top p { margin: 3px 0 0; color: var(--insta-toolbox-muted); font-size: 12px; }
    .insta-toolbox-badge { display: inline-flex; min-height: 26px; align-items: center; border: 1px solid var(--insta-toolbox-line); border-radius: 999px; padding: 3px 8px; color: var(--insta-toolbox-muted); font-size: 11px; font-weight: 650; }
    .insta-toolbox-badge[data-tone="good"] { border-color: var(--insta-toolbox-good); color: var(--insta-toolbox-good); }
    .insta-toolbox-badge[data-tone="warning"] { border-color: var(--insta-toolbox-warning); color: var(--insta-toolbox-warning); }
    .insta-toolbox-badge[data-tone="danger"] { border-color: var(--insta-toolbox-danger); color: var(--insta-toolbox-danger); }
    .insta-toolbox-facts { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); border-top: 1px solid var(--insta-toolbox-line); }
    .insta-toolbox-facts > div { padding: 11px 14px; }
    .insta-toolbox-facts > div + div { border-left: 1px solid var(--insta-toolbox-line); }
    .insta-toolbox-facts dt { color: var(--insta-toolbox-muted); font-size: 12px; }
    .insta-toolbox-facts dd { margin: 3px 0 0; overflow-wrap: break-word; word-break: normal; font-size: 13px; font-weight: 650; }

    .insta-toolbox-next { display: grid; gap: 13px; margin-top: 14px; padding: 14px; border-radius: 10px; background: var(--insta-toolbox-rail); }
    .insta-toolbox-next-label { margin: 0; color: var(--insta-toolbox-muted); font-size: 12px; }
    .insta-toolbox-next h2, .insta-toolbox-next h3 { margin: 3px 0 0; font-size: 16px; }
    .insta-toolbox-next p:last-child { margin: 5px 0 0; color: var(--insta-toolbox-muted); font-size: 12px; }

    .insta-toolbox-tool-heading { margin: 18px 0 8px; font-size: 13px; }
    .insta-toolbox-tool-grid { display: grid; gap: 8px; }
    .insta-toolbox-tool-card { display: grid; width: 100%; grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: 10px; border: 1px solid var(--insta-toolbox-line); border-radius: 10px; padding: 12px; background: color-mix(in srgb, var(--insta-toolbox-surface-raised) var(--insta-toolbox-panel-alpha-strong), transparent); color: var(--insta-toolbox-ink); text-align: left; }
    .insta-toolbox-tool-card:hover { border-color: var(--insta-toolbox-muted); }
    .insta-toolbox-tool-card strong, .insta-toolbox-tool-card span { display: block; }
    .insta-toolbox-tool-card span { margin-top: 3px; color: var(--insta-toolbox-muted); font-size: 12px; }
    .insta-toolbox-tool-card em { color: var(--insta-toolbox-muted); font-size: 11px; font-style: normal; font-weight: 700; white-space: nowrap; }


    .insta-toolbox-checker-metrics { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; margin: 12px 0; }
    .insta-toolbox-checker-metric { padding: 11px; border: 1px solid var(--insta-toolbox-line); border-radius: 9px; background: color-mix(in srgb, var(--insta-toolbox-surface-raised) var(--insta-toolbox-panel-alpha-strong), transparent); }
    .insta-toolbox-checker-metric span, .insta-toolbox-checker-metric strong { display: block; }
    .insta-toolbox-checker-metric span { color: var(--insta-toolbox-muted); font-size: 12px; }
    .insta-toolbox-checker-metric strong { margin-top: 2px; font-size: 20px; }
    .insta-toolbox-checker-result { margin-top: 12px; padding: 12px; border: 1px solid var(--insta-toolbox-line); border-radius: 9px; background: color-mix(in srgb, var(--insta-toolbox-rail) var(--insta-toolbox-panel-alpha-strong), transparent); }
    .insta-toolbox-checker-result h2 { margin: 0 0 7px; font-size: 14px; }
    .insta-toolbox-checker-result dl { display: grid; grid-template-columns: 1fr auto; gap: 5px 12px; margin: 0; }
    .insta-toolbox-checker-result dt { color: var(--insta-toolbox-muted); font-size: 12px; }
    .insta-toolbox-checker-result dd { margin: 0; font-weight: 700; }
    .insta-toolbox-checker-browser { margin-top: 12px; }
    .insta-toolbox-filter-grid { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 8px; }
    .insta-toolbox-checker-browser .insta-toolbox-count { margin-top: 12px; }
    .insta-toolbox-checker-browser .insta-toolbox-list { max-height: 260px; overflow: auto; }
    .insta-toolbox-flow { display: grid; gap: 8px; margin-top: 12px; }
    .insta-toolbox-flow-step { display: grid; grid-template-columns: 28px minmax(0, 1fr) auto; align-items: center; gap: 9px; padding: 10px; border: 1px solid var(--insta-toolbox-line); border-radius: 9px; background: color-mix(in srgb, var(--insta-toolbox-surface-raised) var(--insta-toolbox-panel-alpha-strong), transparent); }
    .insta-toolbox-flow-step-number { display: grid; width: 26px; height: 26px; place-items: center; border-radius: 50%; background: var(--insta-toolbox-rail); color: var(--insta-toolbox-muted); font-size: 12px; font-weight: 700; }
    .insta-toolbox-flow-step-copy { min-width: 0; }
    .insta-toolbox-flow-step-copy strong, .insta-toolbox-flow-step-copy span { display: block; }
    .insta-toolbox-flow-step-copy strong { font-size: 13px; }
    .insta-toolbox-flow-step-copy span { margin-top: 2px; color: var(--insta-toolbox-muted); font-size: 12px; overflow-wrap: break-word; word-break: normal; }
    .insta-toolbox-run-review { margin-top: 12px; padding: 12px; border: 1px solid var(--insta-toolbox-line); border-radius: 9px; background: var(--insta-toolbox-rail); }
    .insta-toolbox-run-review > strong { display: block; font-size: 13px; }
    .insta-toolbox-run-review .insta-toolbox-list { margin-top: 8px; }
    .insta-toolbox-primary-action { margin-top: 12px; padding: 14px; border: 1px solid var(--insta-toolbox-line); border-radius: 10px; background: color-mix(in srgb, var(--insta-toolbox-surface-raised) var(--insta-toolbox-panel-alpha-strong), transparent); }
    .insta-toolbox-primary-action .insta-toolbox-gate-summary { justify-content: space-between; }
    .insta-toolbox-primary-action .insta-toolbox-gate-summary > span:first-child > strong,
    .insta-toolbox-primary-action .insta-toolbox-gate-summary > span:first-child > .insta-toolbox-note { display: block; }
    .insta-toolbox-primary-action .insta-toolbox-gate-summary > span:first-child > .insta-toolbox-note { margin-top: 3px; }
    .insta-toolbox-primary-action .insta-toolbox-gate-detail { margin-top: 8px; }
    .insta-toolbox-primary-action .insta-toolbox-button--danger { width: 100%; }

    .insta-toolbox-toolbar { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 12px; }
    .insta-toolbox-button, .insta-toolbox-link-button, .insta-toolbox-file-label { display: inline-flex; min-height: 44px; align-items: center; justify-content: center; gap: 7px; border: 1px solid var(--insta-toolbox-line); border-radius: 8px; padding: 9px 12px; background: var(--insta-toolbox-ink); color: var(--insta-toolbox-surface); font-size: 14px; font-weight: 700; line-height: 1.2; text-decoration: none; }
    .insta-toolbox-button:hover, .insta-toolbox-link-button:hover, .insta-toolbox-file-label:hover { filter: brightness(.92); }
    .insta-toolbox-button--quiet, .insta-toolbox-link-button--quiet, .insta-toolbox-file-label--quiet { background: var(--insta-toolbox-surface-raised); color: var(--insta-toolbox-ink); }
    .insta-toolbox-button--danger { border-color: var(--insta-toolbox-danger); background: var(--insta-toolbox-danger); color: #fff; }
    .insta-toolbox-button:disabled, .insta-toolbox-link-button[aria-disabled="true"] { cursor: not-allowed; filter: none; opacity: .5; }
    .insta-toolbox-file-label { position: relative; overflow: hidden; }
    .insta-toolbox-file-label input { position: absolute; inset: 0; width: 100%; height: 100%; opacity: 0; }

    .insta-toolbox-count { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; margin: 14px 0 8px; }
    .insta-toolbox-count strong { font-size: 26px; line-height: 1; }
    .insta-toolbox-count span { color: var(--insta-toolbox-muted); font-size: 12px; text-align: right; }
    .insta-toolbox-list, .insta-toolbox-fragments { display: grid; gap: 0; margin: 0; padding: 0; border-top: 1px solid var(--insta-toolbox-line); list-style: none; }
    .insta-toolbox-list-item, .insta-toolbox-fragments li { padding: 10px 0; border-bottom: 1px solid var(--insta-toolbox-line); }
    .insta-toolbox-list-item strong, .insta-toolbox-list-item small { display: block; }
    .insta-toolbox-list-item strong { overflow-wrap: anywhere; font-size: 13px; }
    .insta-toolbox-list-item small { margin-top: 2px; color: var(--insta-toolbox-muted); font-size: 12px; overflow-wrap: anywhere; }
    .insta-toolbox-list-item--split { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 10px; align-items: center; }
    .insta-toolbox-empty { padding: 14px 0; color: var(--insta-toolbox-muted); font-size: 12px; }
    .insta-toolbox-note { margin: 10px 0 0; color: var(--insta-toolbox-muted); font-size: 12px; }

    .insta-toolbox-batch-panel { padding: 12px 16px; border-top: 1px solid var(--insta-toolbox-line); background: var(--insta-toolbox-surface-raised, transparent); }
    .insta-toolbox-batch-panel .insta-toolbox-state-row { margin-bottom: 8px; align-items: center; }
    .insta-toolbox-batch-panel .insta-toolbox-state-row > div { flex: 1 1 auto; min-width: 0; }
    .insta-toolbox-progress { overflow: hidden; height: 6px; border-radius: 999px; background: var(--insta-toolbox-line); }
    .insta-toolbox-progress-bar { display: block; width: 0%; height: 100%; border-radius: 999px; background: var(--insta-toolbox-signal); transition: width 240ms ease; }
    .insta-toolbox-list--compact { max-height: 148px; overflow-y: auto; margin-top: 10px; }
    .insta-toolbox-list--compact .insta-toolbox-list-item { padding: 6px 0; }
    .insta-toolbox-list--compact .insta-toolbox-list-item[data-status="completed"] strong { color: var(--insta-toolbox-good, inherit); }
    .insta-toolbox-list--compact .insta-toolbox-list-item[data-status="failed"] strong,
    .insta-toolbox-list--compact .insta-toolbox-list-item[data-status="stopped"] strong { color: var(--insta-toolbox-danger); }
    @media (prefers-reduced-motion: reduce) { .insta-toolbox-progress-bar, .insta-toolbox-disclosure > summary::after { transition: none; } }

    .insta-toolbox-disclosure { margin-top: 12px; border-top: 1px solid var(--insta-toolbox-line); }
    .insta-toolbox-disclosure > summary { display: flex; min-height: 44px; align-items: center; justify-content: space-between; gap: 12px; color: var(--insta-toolbox-ink); font-size: 13px; list-style: none; }
    .insta-toolbox-disclosure > summary::-webkit-details-marker { display: none; }
    .insta-toolbox-disclosure > summary::after { content: ""; flex: 0 0 auto; width: 0; height: 0; border-top: 5px solid transparent; border-bottom: 5px solid transparent; border-left: 7px solid currentColor; color: var(--insta-toolbox-muted); transition: transform var(--insta-toolbox-motion-fast) var(--insta-toolbox-ease); }
    .insta-toolbox-disclosure[open] > summary::after { transform: rotate(90deg); }
    .insta-toolbox-disclosure-body { padding: 0 0 13px; }
    .insta-toolbox-gate[open] { margin-top: 14px; padding: 0 14px; border: 1px solid var(--insta-toolbox-line); border-radius: 10px; background: var(--insta-toolbox-surface-raised); }
    .insta-toolbox-gate[open] > summary { min-height: 50px; }
    .insta-toolbox-gate-summary { display: flex; min-width: 0; align-items: center; gap: 8px; }
    .insta-toolbox-gate-summary strong { overflow-wrap: anywhere; }
    .insta-toolbox-gate-detail { margin: 0; color: var(--insta-toolbox-muted); font-size: 12px; }

    .insta-toolbox-message-row { max-width: 88%; margin: 9px 0; padding: 10px 12px; border: 1px solid var(--insta-toolbox-line); border-radius: 12px 12px 12px 4px; background: var(--insta-toolbox-surface-raised); white-space: pre-wrap; overflow-wrap: anywhere; }
    .insta-toolbox-message-row[data-ownership="sent"] { margin-left: auto; border-radius: 12px 12px 4px; background: var(--insta-toolbox-rail); }
    .insta-toolbox-message-meta { margin-top: 4px; color: var(--insta-toolbox-muted); font-size: 12px; }

    .insta-toolbox-operational-status { position: absolute; z-index: 6; right: 8px; bottom: 31px; left: 8px; display: flex; min-height: 36px; max-height: 52px; align-items: center; gap: 5px; overflow: hidden; border: 1px solid var(--insta-toolbox-line); border-radius: 8px; padding: 7px 9px; background: color-mix(in srgb, var(--insta-toolbox-surface-raised) 98%, transparent); color: var(--insta-toolbox-muted); box-shadow: 0 6px 20px rgba(0, 0, 0, .16); font-size: 11px; line-height: 1.25; pointer-events: none; }
    .insta-toolbox-operational-status strong { flex: 0 0 auto; color: var(--insta-toolbox-ink); font-size: inherit; }
    .insta-toolbox-operational-status[data-tone="good"] { border-color: color-mix(in srgb, var(--insta-toolbox-good) 52%, var(--insta-toolbox-line)); }
    .insta-toolbox-operational-status[data-tone="error"] { border-color: color-mix(in srgb, var(--insta-toolbox-danger) 62%, var(--insta-toolbox-line)); }
    .insta-toolbox-status-message { display: -webkit-box; min-width: 0; overflow: hidden; overflow-wrap: anywhere; -webkit-box-orient: vertical; -webkit-line-clamp: 2; }
    .insta-toolbox-credit { display: flex; min-height: 27px; align-items: center; justify-content: center; padding: 3px 50px; border-top: 1px solid var(--insta-toolbox-line); background: color-mix(in srgb, var(--insta-toolbox-surface-raised) var(--insta-toolbox-panel-alpha-strong), transparent); color: var(--insta-toolbox-muted); font-size: 10px; line-height: 1.2; }
    .insta-toolbox-credit-link { color: inherit; text-decoration: none; }
    .insta-toolbox-credit-link:hover { color: var(--insta-toolbox-ink); text-decoration: underline; text-underline-offset: 2px; }

    .insta-toolbox-dialog { width: min(420px, calc(100vw - 28px)); border: 1px solid var(--insta-toolbox-line); border-radius: 12px; padding: 0; background: var(--insta-toolbox-surface-raised); color: var(--insta-toolbox-ink); box-shadow: var(--insta-toolbox-shadow); }
    .insta-toolbox-dialog::backdrop { background: rgba(0, 0, 0, .58); }
    .insta-toolbox-dialog form { display: grid; gap: 14px; padding: 18px; }
    .insta-toolbox-dialog h2 { margin: 0; font-size: 20px; }
    .insta-toolbox-dialog p { margin: 0; color: var(--insta-toolbox-muted); font-size: 13px; line-height: 19px; overflow-wrap: anywhere; white-space: pre-line; }
    .insta-toolbox-dialog dl { display: grid; grid-template-columns: max-content minmax(0, 1fr); gap: 5px 10px; margin: 0; font-size: 13px; line-height: 19px; }
    .insta-toolbox-dialog dt { color: var(--insta-toolbox-muted); font-weight: 700; }
    .insta-toolbox-dialog dd { min-width: 0; margin: 0; overflow-wrap: anywhere; }
    .insta-toolbox-dialog ul { max-height: 160px; margin: 0; padding: 8px 8px 8px 30px; overflow-y: auto; border: 1px solid var(--insta-toolbox-line); border-radius: 8px; font-size: 13px; line-height: 19px; }
    .insta-toolbox-dialog code { display: block; padding: 10px; border: 1px solid var(--insta-toolbox-line); border-radius: 8px; background: var(--insta-toolbox-surface); color: var(--insta-toolbox-ink); overflow-wrap: anywhere; font-size: 13px; }
    .insta-toolbox-dialog .insta-toolbox-toolbar { justify-content: flex-end; }
    .insta-toolbox-settings-dialog { width: min(360px, calc(100vw - 28px)); max-height: min(680px, calc(100dvh - 28px)); overflow: auto; }
    .insta-toolbox-settings-dialog::backdrop { background: rgba(12, 14, 12, .44); backdrop-filter: grayscale(.65) blur(1px); }
    .insta-toolbox-settings-dialog form { gap: 12px; }
    .insta-toolbox-settings-heading { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
    .insta-toolbox-settings-heading .insta-toolbox-icon-button { flex: 0 0 auto; }
    .insta-toolbox-settings-dialog .insta-toolbox-note { margin: -4px 0 2px; }

    .insta-toolbox-collision-strip { position: fixed; z-index: 2147483000; display: flex; min-height: 52px; width: min(320px, calc(100vw - 28px)); align-items: center; gap: 9px; padding: 8px 10px; border: 1px solid var(--insta-toolbox-line); border-radius: 12px; background: var(--insta-toolbox-surface-raised); color: var(--insta-toolbox-ink); box-shadow: var(--insta-toolbox-shadow); font-size: 12px; }
    .insta-toolbox-collision-copy { min-width: 0; }
    .insta-toolbox-collision-copy strong, .insta-toolbox-collision-copy span { display: block; overflow-wrap: anywhere; }
    .insta-toolbox-collision-copy span { margin-top: 1px; color: var(--insta-toolbox-muted); }
    .insta-toolbox-collision-strip .insta-toolbox-button { min-height: 36px; margin-left: auto; padding: 6px 9px; font-size: 12px; }
    :host([data-collision="active"]) .insta-toolbox-panel, :host([data-collision="active"]) .insta-toolbox-launcher { display: none !important; }

    .insta-toolbox-sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; }
    .insta-toolbox-resize-handle { position: absolute; z-index: 4; bottom: 0; display: block; width: 44px; height: 44px; border: 0; padding: 0; background: transparent; color: var(--insta-toolbox-muted); touch-action: none; }
    .insta-toolbox-resize-handle--end { right: 0; border-radius: 10px 0 12px 0; cursor: nwse-resize; }
    .insta-toolbox-resize-handle--start { left: 0; border-radius: 0 10px 0 12px; cursor: nesw-resize; }
    .insta-toolbox-resize-handle::before { content: ""; position: absolute; right: 9px; bottom: 9px; width: 12px; height: 12px; border-right: 2px solid currentColor; border-bottom: 2px solid currentColor; opacity: .9; }
    .insta-toolbox-resize-handle--start::before { right: auto; left: 9px; border-right: 0; border-left: 2px solid currentColor; }
    .insta-toolbox-resize-handle:hover { background: color-mix(in srgb, var(--insta-toolbox-signal-soft) 72%, transparent); color: var(--insta-toolbox-ink); }

    .insta-toolbox-launcher:focus-visible, .insta-toolbox-tab:focus-visible, .insta-toolbox-icon-button:focus-visible,
    .insta-toolbox-select:focus-visible, .insta-toolbox-text-input:focus-visible,
    .insta-toolbox-button:focus-visible, .insta-toolbox-link-button:focus-visible, .insta-toolbox-file-label:focus-within,
    .insta-toolbox-disclosure > summary:focus-visible, .insta-toolbox-tool-card:focus-visible, .insta-toolbox-range:focus-visible,
    .insta-toolbox-resize-handle:focus-visible, .insta-toolbox-credit-link:focus-visible {
      outline: 3px solid var(--insta-toolbox-focus);
      outline-offset: 2px;
    }

    @container insta-toolbox-body (max-width: 340px) {
      .insta-toolbox-header { gap: 3px; padding-inline: 6px; }
      .insta-toolbox-header h1 { font-size: 15px; }
      .insta-toolbox-header-actions { gap: 0; }
      .insta-toolbox-filter-grid { grid-template-columns: 1fr; }
      .insta-toolbox-credit { padding-inline: 48px; }
    }

    @keyframes insta-toolbox-open {
      from { opacity: 0; transform: translateY(5px); }
      to { opacity: 1; transform: translateY(0); }
    }

    @media (max-width: 860px) {
      :host { --insta-toolbox-panel-width: auto; }
      .insta-toolbox-panel {
        top: auto;
        right: max(0px, env(safe-area-inset-right));
        bottom: 0;
        left: max(0px, env(safe-area-inset-left));
        width: auto;
        max-height: min(78dvh, calc(100dvh - env(safe-area-inset-top)));
        border-radius: 14px 14px 0 0;
      }
      .insta-toolbox-filter-grid { grid-template-columns: 1fr; }
      .insta-toolbox-move-handle, .insta-toolbox-resize-handle { display: none; }
      .insta-toolbox-shell { grid-template-columns: 1fr; grid-template-rows: minmax(0, 1fr) auto; }
      .insta-toolbox-header { grid-template-columns: minmax(0, 1fr) auto; }
      .insta-toolbox-credit { padding-inline: 12px; }
      .insta-toolbox-rail { grid-row: 2; display: grid; grid-template-columns: repeat(5, minmax(44px, 1fr)); padding: 4px max(4px, env(safe-area-inset-right)) max(4px, env(safe-area-inset-bottom)) max(4px, env(safe-area-inset-left)); border-top: 1px solid var(--insta-toolbox-line); border-right: 0; }
      .insta-toolbox-brand-mark { display: none; }
      .insta-toolbox-tab { width: 100%; min-height: 52px; grid-template-columns: 1fr; grid-template-rows: 20px auto; place-items: center; gap: 2px; padding: 5px 2px; text-align: center; }
      .insta-toolbox-tab-label { font-size: 10px; }
      .insta-toolbox-tab[data-insta-toolbox-section="workspace"] { margin-top: 0; }
      .insta-toolbox-tab[aria-selected="true"] { box-shadow: inset 0 -3px 0 var(--insta-toolbox-signal); }
      .insta-toolbox-body { grid-row: 1; }
      .insta-toolbox-facts { grid-template-columns: 1fr; }
      .insta-toolbox-facts > div + div { border-top: 1px solid var(--insta-toolbox-line); border-left: 0; }
    }

    @media (max-width: 860px) and (max-height: 500px) and (min-aspect-ratio: 2/1) {
      .insta-toolbox-panel {
        top: 8px;
        right: 8px;
        bottom: 8px;
        left: auto;
        width: min(380px, calc(100vw - 16px));
        height: auto;
        max-height: calc(100dvh - 16px);
        border-radius: 12px;
      }
      :host([data-dock="left"]) .insta-toolbox-panel { right: auto; left: 8px; }
      .insta-toolbox-shell { grid-template-columns: 116px minmax(0, 1fr); grid-template-rows: 1fr; }
      .insta-toolbox-rail { grid-row: auto; display: flex; padding: 8px 6px; border-top: 0; border-right: 1px solid var(--insta-toolbox-line); }
      .insta-toolbox-brand-mark { display: grid; }
      .insta-toolbox-tab { width: 100%; min-height: 44px; grid-template-columns: 22px minmax(0, 1fr); grid-template-rows: 1fr; place-items: center start; gap: 8px; padding: 8px; text-align: left; }
      .insta-toolbox-tab-label { font-size: 12px; }
      .insta-toolbox-tab[data-insta-toolbox-section="workspace"] { margin-top: auto; }
      .insta-toolbox-tab[aria-selected="true"] { box-shadow: inset 3px 0 0 var(--insta-toolbox-signal); }
      .insta-toolbox-body { grid-row: auto; }
      .insta-toolbox-header { grid-template-columns: minmax(0, 1fr) auto; }
      .insta-toolbox-move-handle { display: none; }
      .insta-toolbox-resize-handle { display: flex; }
      .insta-toolbox-credit { padding-inline: 50px; }
      .insta-toolbox-facts { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .insta-toolbox-facts > div + div { border-top: 0; border-left: 1px solid var(--insta-toolbox-line); }
    }

    @media (min-width: 861px) and (max-height: 620px) {
      .insta-toolbox-panel { top: max(8px, env(safe-area-inset-top)); max-height: calc(100dvh - 16px - env(safe-area-inset-top) - env(safe-area-inset-bottom)); }
      .insta-toolbox-view { padding-top: 12px; padding-bottom: 12px; }
    }

    @media (prefers-reduced-motion: reduce) {
      .insta-toolbox-panel { animation: none; }
      .insta-toolbox-launcher { transition: none; }
    }

    @media (forced-colors: active) {
      :host { --insta-toolbox-signal: Highlight; --insta-toolbox-focus: Highlight; }
      .insta-toolbox-panel, .insta-toolbox-launcher, .insta-toolbox-collision-strip, .insta-toolbox-dialog { border: 2px solid CanvasText; box-shadow: none; }
      .insta-toolbox-tab[aria-selected="true"] { outline: 2px solid Highlight; outline-offset: -3px; box-shadow: none; }
      .insta-toolbox-state-dot, .insta-toolbox-launcher-signal, .insta-toolbox-tab-signal { border: 2px solid CanvasText; }
      .insta-toolbox-panel, .insta-toolbox-header, .insta-toolbox-operational-status, .insta-toolbox-credit, .insta-toolbox-card, .insta-toolbox-tool-card, .insta-toolbox-checker-metric, .insta-toolbox-checker-result { background: Canvas; }
    }
  `;

  function tab(section, label, icon, selected = false) {
    return `<button class="insta-toolbox-tab" id="insta-toolbox-tab-${section}" type="button" role="tab" aria-controls="insta-toolbox-view-${section}" aria-selected="${selected}" tabindex="${selected ? '0' : '-1'}" data-insta-toolbox-section="${section}" aria-label="${label}" title="${label}">${icons.svg(icon)}<span class="insta-toolbox-tab-label">${label}</span>${section === 'queue' ? '<span class="insta-toolbox-tab-signal" data-insta-toolbox-role="queue-signal" hidden></span>' : ''}</button>`;
  }

  function create({ document: targetDocument, openShadow = false }) {
    const host = targetDocument.createElement('div');
    host.id = 'insta-toolbox-sidecar-root';
    host.dataset.collision = 'inactive';
    host.dataset.accent = 'rose';
    host.dataset.blur = 'soft';
    host.dataset.density = 'comfortable';
    host.dataset.dock = 'right';
    host.dataset.launcherLayout = 'docked';
    host.dataset.launcherSize = 'standard';
    host.dataset.layout = 'docked';
    host.dataset.theme = 'light';
    host.dataset.width = 'standard';
    const shadow = host.attachShadow({ mode: openShadow ? 'open' : 'closed' });
    shadow.innerHTML = `
      <style>${styles}</style>
      <button class="insta-toolbox-launcher" type="button" data-insta-toolbox-action="open" aria-label="Open Insta Toolbox; drag or use arrow keys to move" aria-expanded="false" title="Drag to move · Click to open">
        <span class="insta-toolbox-launcher-mark" aria-hidden="true">IT</span>
        <span class="insta-toolbox-launcher-signal" data-insta-toolbox-role="launcher-signal" hidden></span>
      </button>
      <aside class="insta-toolbox-panel" aria-label="Insta Toolbox" hidden>
        <div class="insta-toolbox-shell">
          <nav class="insta-toolbox-rail" role="tablist" aria-label="Insta Toolbox tools" aria-orientation="vertical">
            <div class="insta-toolbox-brand-mark" title="Insta Toolbox" aria-hidden="true">IT</div>
            ${tab('now', 'Toolbox', 'now', true)}
            ${tab('capture', 'Mutual Checker', 'capture')}
            ${tab('queue', 'Follow / Unfollow', 'queue')}
            ${tab('messages', 'DM Unsend', 'messages')}
            ${tab('workspace', 'Workspace', 'workspace')}
          </nav>
          <div class="insta-toolbox-body">
            <header class="insta-toolbox-header">
              <button class="insta-toolbox-icon-button insta-toolbox-move-handle" type="button" data-insta-toolbox-role="move-handle" aria-label="Move Insta Toolbox; use arrow keys for precise movement" title="Drag to move · Arrow keys move">${icons.svg('move')}</button>
              <div class="insta-toolbox-header-copy">
                <h1 data-insta-toolbox-role="view-title">Insta Toolbox</h1>
              </div>
              <div class="insta-toolbox-header-actions">
                <button class="insta-toolbox-icon-button" type="button" data-insta-toolbox-action="open-settings" data-insta-toolbox-role="settings-button" aria-label="Customize Insta Toolbox" aria-haspopup="dialog" aria-expanded="false">${icons.svg('preferences')}</button>
                <button class="insta-toolbox-icon-button" type="button" data-insta-toolbox-action="close" aria-label="Collapse Insta Toolbox">${icons.svg('close')}</button>
              </div>
            </header>
            <div class="insta-toolbox-scroll">
              <section class="insta-toolbox-view" id="insta-toolbox-view-now" role="tabpanel" aria-labelledby="insta-toolbox-tab-now" tabindex="0" data-insta-toolbox-view="now"><div data-insta-toolbox-role="now-content"></div></section>
              <section class="insta-toolbox-view" id="insta-toolbox-view-capture" role="tabpanel" aria-labelledby="insta-toolbox-tab-capture" tabindex="0" data-insta-toolbox-view="capture" hidden>
                <div class="insta-toolbox-state-row" data-insta-toolbox-role="capture-state" data-tone="neutral"><span class="insta-toolbox-state-dot"></span><div><strong data-insta-toolbox-role="capture-state-title">Ready</strong><span data-insta-toolbox-role="capture-state-detail">Enter a username to compare Followers and Following.</span></div></div>
                <section class="insta-toolbox-primary-action" aria-labelledby="insta-toolbox-checker-account-title"><div class="insta-toolbox-gate-summary"><span><strong id="insta-toolbox-checker-account-title">Check mutuals</strong><span class="insta-toolbox-note">Opens Followers, then Following. Please leave this tab open and untouched while the check runs.</span></span><span class="insta-toolbox-badge">read only</span></div><div class="insta-toolbox-disclosure-body"><div class="insta-toolbox-field"><label for="insta-toolbox-checker-username">Instagram username</label><input class="insta-toolbox-text-input" id="insta-toolbox-checker-username" type="text" inputmode="text" autocomplete="username" autocapitalize="none" spellcheck="false" placeholder="your_username" data-insta-toolbox-role="checker-username"></div><button class="insta-toolbox-button" type="button" data-insta-toolbox-action="check-account-relationships" data-insta-toolbox-role="checker-run">Check mutuals</button></div></section>
                <div class="insta-toolbox-checker-metrics" aria-label="Mutual Checker counts"><div class="insta-toolbox-checker-metric"><span>Followers</span><strong data-insta-toolbox-role="followers-count">0</strong></div><div class="insta-toolbox-checker-metric"><span>Following</span><strong data-insta-toolbox-role="following-count">0</strong></div></div>
                <div class="insta-toolbox-checker-result" data-insta-toolbox-role="checker-result"></div>
                <div class="insta-toolbox-toolbar"><a class="insta-toolbox-link-button" data-insta-toolbox-role="comparison-report-download" aria-disabled="true">Download comparison report</a></div>
                <div data-insta-toolbox-role="checker-browser-slot"></div>
                <details class="insta-toolbox-disclosure"><summary>Capture lists and export</summary><div class="insta-toolbox-disclosure-body"><p class="insta-toolbox-note">Check without opening the lists. Keep your profile open; both lists must match its totals.</p><button class="insta-toolbox-button insta-toolbox-button--quiet" type="button" data-insta-toolbox-action="check-account-background" data-insta-toolbox-role="checker-background">Check in background</button><p class="insta-toolbox-note">If the account check fails, open Followers or Following and scan that list.</p><ol class="insta-toolbox-flow" aria-label="Mutual Checker fallback steps"><li class="insta-toolbox-flow-step" data-insta-toolbox-role="following-step"><span class="insta-toolbox-flow-step-number">1</span><span class="insta-toolbox-flow-step-copy"><strong>Scan Following</strong><span data-insta-toolbox-role="following-step-detail">Open your Following list</span></span><button class="insta-toolbox-button insta-toolbox-button--quiet" type="button" data-insta-toolbox-action="scan-full-list" data-list-type="following">Scan</button></li><li class="insta-toolbox-flow-step" data-insta-toolbox-role="followers-step"><span class="insta-toolbox-flow-step-number">2</span><span class="insta-toolbox-flow-step-copy"><strong>Scan Followers</strong><span data-insta-toolbox-role="followers-step-detail">Open your Followers list</span></span><button class="insta-toolbox-button insta-toolbox-button--quiet" type="button" data-insta-toolbox-action="scan-full-list" data-list-type="followers">Scan</button></li><li class="insta-toolbox-flow-step" data-insta-toolbox-role="compare-step"><span class="insta-toolbox-flow-step-number">3</span><span class="insta-toolbox-flow-step-copy"><strong>Compare</strong><span data-insta-toolbox-role="compare-step-detail">Scan both lists first</span></span><span class="insta-toolbox-badge" data-insta-toolbox-role="compare-step-badge">waiting</span></li></ol><div class="insta-toolbox-count"><strong data-insta-toolbox-role="capture-count">0</strong><span data-insta-toolbox-role="capture-detail">No draft yet</span></div><ul class="insta-toolbox-list" data-insta-toolbox-role="capture-list"></ul><div class="insta-toolbox-field"><label for="insta-toolbox-list-type-manual">List for manual capture</label><select class="insta-toolbox-select" id="insta-toolbox-list-type-manual" data-insta-toolbox-role="list-type"><option value="following">Following</option><option value="followers">Followers</option></select></div><div class="insta-toolbox-toolbar"><button class="insta-toolbox-button insta-toolbox-button--quiet" type="button" data-insta-toolbox-action="capture-visible">Capture visible rows</button><a class="insta-toolbox-link-button insta-toolbox-link-button--quiet" data-insta-toolbox-role="capture-download" aria-disabled="true">Download selected list</a><a class="insta-toolbox-link-button insta-toolbox-link-button--quiet" data-insta-toolbox-role="comparison-json-download" aria-disabled="true">Download JSON</a><button class="insta-toolbox-button insta-toolbox-button--quiet" type="button" data-insta-toolbox-action="reset-capture">Clear checker</button></div></div></details>
              </section>
              <section class="insta-toolbox-view" id="insta-toolbox-view-queue" role="tabpanel" aria-labelledby="insta-toolbox-tab-queue" tabindex="0" data-insta-toolbox-view="queue" hidden>
                <div data-insta-toolbox-role="queue-current"></div>
                <div data-insta-toolbox-role="queue-controls" hidden><div class="insta-toolbox-toolbar"><a class="insta-toolbox-link-button" data-insta-toolbox-role="queue-open" rel="noreferrer">Open profile</a></div><details class="insta-toolbox-disclosure"><summary>Queue item options</summary><div class="insta-toolbox-disclosure-body"><div class="insta-toolbox-toolbar"><button class="insta-toolbox-button insta-toolbox-button--quiet" type="button" data-insta-toolbox-action="queue-complete">Mark complete</button><button class="insta-toolbox-button insta-toolbox-button--quiet" type="button" data-insta-toolbox-action="queue-skip">Skip item</button></div></div></details></div>
                <section class="insta-toolbox-primary-action" data-insta-toolbox-role="bot-disclosure" aria-labelledby="insta-toolbox-bot-composer-title"><div class="insta-toolbox-gate-summary"><span><strong id="insta-toolbox-bot-composer-title">Follow or unfollow people</strong><span class="insta-toolbox-note">Choose an action, then review the accounts.</span></span><span class="insta-toolbox-badge" data-insta-toolbox-role="bot-badge">idle</span></div><div class="insta-toolbox-disclosure-body">
                  <div class="insta-toolbox-field"><label for="insta-toolbox-bot-action">What do you want to do?</label><select class="insta-toolbox-select" id="insta-toolbox-bot-action" data-insta-toolbox-role="bot-action"><option value="follow">Follow people</option><option value="unfollow">Unfollow people</option></select></div>
                  <div class="insta-toolbox-field"><label for="insta-toolbox-bot-source">Target source</label><select class="insta-toolbox-select" id="insta-toolbox-bot-source" data-insta-toolbox-role="bot-source"><option value="current-profile">Current profile</option><option value="i-do-not-follow-back">Followers you do not follow</option><option value="scanned-followers">Scanned Followers</option><option value="queue">Queue items</option></select></div>
                  <div class="insta-toolbox-field" data-insta-toolbox-role="bot-count-field"><label for="insta-toolbox-bot-count">How many this run</label><input class="insta-toolbox-text-input" id="insta-toolbox-bot-count" type="number" min="1" max="250" value="20" data-insta-toolbox-role="bot-count"></div>
                  <p class="insta-toolbox-gate-detail" data-insta-toolbox-role="bot-detail">Each target is verified before action.</p>
                  <div class="insta-toolbox-toolbar"><button class="insta-toolbox-button" type="button" data-insta-toolbox-action="bot-review">Review 20 Follow targets</button><button class="insta-toolbox-button insta-toolbox-button--danger" type="button" data-insta-toolbox-action="bot-start" hidden>Start Follow on reviewed accounts</button></div>
                  <div class="insta-toolbox-run-review" data-insta-toolbox-role="bot-review" hidden><strong data-insta-toolbox-role="bot-review-title"></strong><ul class="insta-toolbox-list insta-toolbox-list--compact" data-insta-toolbox-role="bot-review-list"></ul><p class="insta-toolbox-note" data-insta-toolbox-role="bot-review-detail"></p></div>
                  <p class="insta-toolbox-note">Stops on blocks, rate limits, or unexpected pages. Pacing is under Advanced controls.</p>
                </div></section>
                <details class="insta-toolbox-disclosure"><summary>Queue files</summary><div class="insta-toolbox-disclosure-body"><div class="insta-toolbox-toolbar"><label class="insta-toolbox-file-label insta-toolbox-file-label--quiet">Import queue JSON<input type="file" accept=".json,application/json" aria-label="Import Insta Toolbox queue JSON" data-insta-toolbox-role="queue-file"></label><a class="insta-toolbox-link-button insta-toolbox-link-button--quiet" data-insta-toolbox-role="queue-download" aria-disabled="true">Download queue state</a></div></div></details>
                <details class="insta-toolbox-disclosure"><summary>Signed run history</summary><div class="insta-toolbox-disclosure-body"><ul class="insta-toolbox-list" data-insta-toolbox-role="run-list"></ul></div></details>
              </section>
              <section class="insta-toolbox-view" id="insta-toolbox-view-messages" role="tabpanel" aria-labelledby="insta-toolbox-tab-messages" tabindex="0" data-insta-toolbox-view="messages" hidden>
                <div class="insta-toolbox-state-row" data-insta-toolbox-role="message-state" data-tone="neutral"><span class="insta-toolbox-state-dot"></span><div><strong data-insta-toolbox-role="message-state-title">Open a conversation</strong><span data-insta-toolbox-role="message-state-detail">Visible evidence is read-only until exact identity is available.</span></div></div>
                <div class="insta-toolbox-primary-action" data-insta-toolbox-role="unsend-disclosure"><div class="insta-toolbox-gate-summary"><span><strong>DM Unsend</strong></span><span class="insta-toolbox-badge" data-insta-toolbox-role="unsend-badge">ready</span></div><div class="insta-toolbox-disclosure-body">
                  <p class="insta-toolbox-gate-detail" data-insta-toolbox-role="unsend-detail">Confirm the open conversation to begin.</p>
                  <p class="insta-toolbox-note" data-insta-toolbox-role="unsend-eligible">All messages you sent</p>
                  <div class="insta-toolbox-toolbar"><button class="insta-toolbox-button insta-toolbox-button--danger" type="button" data-insta-toolbox-action="mass-unsend">Unsend DMs</button></div>
                </div></div>
                <div data-insta-toolbox-role="message-evidence" hidden><div class="insta-toolbox-count"><strong data-insta-toolbox-role="message-count">0</strong><span data-insta-toolbox-role="message-detail"></span></div><ul class="insta-toolbox-fragments" data-insta-toolbox-role="message-list"></ul></div>
                <details class="insta-toolbox-disclosure"><summary>Advanced message options</summary><div class="insta-toolbox-disclosure-body"><div data-insta-toolbox-role="unsend-plan"><div class="insta-toolbox-field"><label for="insta-toolbox-unsend-scope">Scope</label><select class="insta-toolbox-select" id="insta-toolbox-unsend-scope" data-insta-toolbox-role="unsend-scope"><option value="all">All messages you sent</option><option value="newest">Newest N</option><option value="oldest">Oldest N</option></select></div><div class="insta-toolbox-field"><label for="insta-toolbox-unsend-count">Number of messages</label><input class="insta-toolbox-text-input" id="insta-toolbox-unsend-count" type="number" min="1" max="250" value="1" data-insta-toolbox-role="unsend-count"></div></div><div class="insta-toolbox-toolbar"><button class="insta-toolbox-button insta-toolbox-button--quiet" type="button" data-insta-toolbox-action="scan-sent-dms">Check conversation only</button><button class="insta-toolbox-button insta-toolbox-button--quiet" type="button" data-insta-toolbox-action="inspect-messages">Read visible thread</button><a class="insta-toolbox-link-button insta-toolbox-link-button--quiet" data-insta-toolbox-role="message-download" aria-disabled="true">Download evidence</a></div></div></details>
                <details class="insta-toolbox-disclosure"><summary>Identity and ownership details</summary><div class="insta-toolbox-disclosure-body"><p class="insta-toolbox-note" data-insta-toolbox-role="message-identity-detail">Visible text alone cannot authorize removal.</p></div></details>
              </section>
              <section class="insta-toolbox-view" id="insta-toolbox-view-workspace" role="tabpanel" aria-labelledby="insta-toolbox-tab-workspace" tabindex="0" data-insta-toolbox-view="workspace" hidden>
                <div class="insta-toolbox-state-row" data-insta-toolbox-role="bridge-state" data-tone="warning"><span class="insta-toolbox-state-dot"></span><div><strong data-insta-toolbox-role="bridge-title">Checking pairing</strong><span data-insta-toolbox-role="bridge-detail">The overlay never receives Instagram credentials or cookies.</span></div></div>
                <dl class="insta-toolbox-card insta-toolbox-facts" data-insta-toolbox-role="bridge-facts"></dl>
                <div class="insta-toolbox-toolbar"><a class="insta-toolbox-link-button" data-insta-toolbox-role="workspace-link" aria-disabled="true" rel="noreferrer">Open workspace</a></div>
                <details class="insta-toolbox-disclosure"><summary>Privacy and pairing guidance</summary><div class="insta-toolbox-disclosure-body"><p class="insta-toolbox-note" data-insta-toolbox-role="workspace-guidance">Create a code in PWA Settings, then pair the exact PWA tab from the extension setup popup.</p></div></details>
              </section>
            </div>
            <div class="insta-toolbox-batch-panel" data-insta-toolbox-role="batch-panel" hidden>
              <div class="insta-toolbox-state-row" data-insta-toolbox-role="batch-state" data-tone="neutral"><span class="insta-toolbox-state-dot"></span><div><strong data-insta-toolbox-role="batch-title">Batch idle</strong><span data-insta-toolbox-role="batch-detail"></span></div><button class="insta-toolbox-button insta-toolbox-button--danger" type="button" data-insta-toolbox-action="batch-stop" hidden>Stop</button></div>
              <div class="insta-toolbox-progress" role="progressbar" aria-valuemin="0" aria-valuenow="0" aria-valuemax="0" data-insta-toolbox-role="batch-meter"><span class="insta-toolbox-progress-bar" data-insta-toolbox-role="batch-bar"></span></div>
              <p class="insta-toolbox-note" data-insta-toolbox-role="batch-next" hidden></p>
              <ul class="insta-toolbox-list insta-toolbox-list--compact" data-insta-toolbox-role="batch-results"></ul>
            </div>
            <div class="insta-toolbox-operational-status" role="status" aria-live="polite" aria-atomic="true" data-insta-toolbox-role="status" data-tone="neutral" hidden><strong data-insta-toolbox-role="status-lead">Note.</strong> <span class="insta-toolbox-status-message" data-insta-toolbox-role="status-text"></span></div>
            <footer class="insta-toolbox-credit"><a class="insta-toolbox-credit-link" href="https://github.com/slaveofsolace" target="_blank" rel="noopener noreferrer">created by @slaveofsolace</a></footer>
          </div>
        </div>
        <button class="insta-toolbox-resize-handle insta-toolbox-resize-handle--start" type="button" data-insta-toolbox-role="resize-handle-start" aria-label="Resize Insta Toolbox from the lower-left corner; use arrow keys for precise sizing" title="Drag to resize · Arrow keys resize"></button>
        <button class="insta-toolbox-resize-handle insta-toolbox-resize-handle--end" type="button" data-insta-toolbox-role="resize-handle-end" aria-label="Resize Insta Toolbox from the lower-right corner; use arrow keys for precise sizing" title="Drag to resize · Arrow keys resize"></button>
      </aside>
      <dialog class="insta-toolbox-dialog insta-toolbox-settings-dialog" data-insta-toolbox-role="settings-dialog" aria-labelledby="insta-toolbox-settings-title" aria-describedby="insta-toolbox-settings-note">
        <form>
          <div class="insta-toolbox-settings-heading"><h2 id="insta-toolbox-settings-title">Customize Insta Toolbox</h2><button class="insta-toolbox-icon-button" type="button" data-insta-toolbox-action="close-settings" aria-label="Close customization">${icons.svg('close')}</button></div>
          <p class="insta-toolbox-note" id="insta-toolbox-settings-note">Saved in this browser.</p>
          <div class="insta-toolbox-field"><label for="insta-toolbox-pref-dock">Dock side</label><select class="insta-toolbox-select" id="insta-toolbox-pref-dock" data-insta-toolbox-preference="dock"><option value="right">Right</option><option value="left">Left</option></select></div>
          <div class="insta-toolbox-field"><label for="insta-toolbox-pref-width">Panel width</label><select class="insta-toolbox-select" id="insta-toolbox-pref-width" data-insta-toolbox-preference="width"><option value="compact">Compact</option><option value="standard">Standard</option><option value="wide">Wide</option></select></div>
          <div class="insta-toolbox-field"><label for="insta-toolbox-pref-theme">Theme</label><select class="insta-toolbox-select" id="insta-toolbox-pref-theme" data-insta-toolbox-preference="theme"><option value="auto">Match Instagram</option><option value="light">Light</option><option value="dark">Dark</option></select></div>
          <div class="insta-toolbox-field"><label for="insta-toolbox-pref-density">Spacing</label><select class="insta-toolbox-select" id="insta-toolbox-pref-density" data-insta-toolbox-preference="density"><option value="comfortable">Comfortable</option><option value="compact">Compact</option></select></div>
          <div class="insta-toolbox-field"><label for="insta-toolbox-pref-accent">Accent</label><select class="insta-toolbox-select" id="insta-toolbox-pref-accent" data-insta-toolbox-preference="accent"><option value="rose">Rose</option><option value="violet">Violet</option><option value="blue">Blue</option></select></div>
          <div class="insta-toolbox-field"><label for="insta-toolbox-pref-blur">Background blur</label><select class="insta-toolbox-select" id="insta-toolbox-pref-blur" data-insta-toolbox-preference="blur"><option value="none">Off</option><option value="soft">Soft</option><option value="strong">Strong</option></select></div>
          <div class="insta-toolbox-field"><label for="insta-toolbox-pref-launcher-size">Collapsed button</label><select class="insta-toolbox-select" id="insta-toolbox-pref-launcher-size" data-insta-toolbox-preference="launcherSize"><option value="standard">Standard</option><option value="large">Large</option></select></div>
          <div class="insta-toolbox-field"><label for="insta-toolbox-pref-opacity">Surface transparency</label><div class="insta-toolbox-range-row"><input class="insta-toolbox-range" id="insta-toolbox-pref-opacity" type="range" min="55" max="100" step="1" value="88" data-insta-toolbox-preference="opacity"><output class="insta-toolbox-range-output" for="insta-toolbox-pref-opacity" data-insta-toolbox-role="opacity-output">88%</output></div></div>
          <div class="insta-toolbox-field"><label>Size presets</label><div class="insta-toolbox-toolbar"><button class="insta-toolbox-button insta-toolbox-button--quiet" type="button" data-insta-toolbox-action="layout-preset" data-layout-preset="compact">Compact</button><button class="insta-toolbox-button insta-toolbox-button--quiet" type="button" data-insta-toolbox-action="layout-preset" data-layout-preset="tall">Tall</button><button class="insta-toolbox-button insta-toolbox-button--quiet" type="button" data-insta-toolbox-action="layout-preset" data-layout-preset="wide">Wide</button></div></div>
          <button class="insta-toolbox-button insta-toolbox-button--quiet" type="button" data-insta-toolbox-action="reset-layout">Reset panel and collapsed button</button>
          <details class="insta-toolbox-disclosure" data-insta-toolbox-role="advanced-settings"><summary>Advanced controls</summary><div class="insta-toolbox-disclosure-body" data-insta-toolbox-role="advanced-settings-body"></div></details>
          <p class="insta-toolbox-note">Drag the collapsed IT button anywhere. Resize the open panel from either lower corner. Arrow keys work on the focused control. Shortcut: Alt + Shift + I.</p>
        </form>
      </dialog>
      <div class="insta-toolbox-collision-strip" data-insta-toolbox-role="collision-strip" hidden>
        <span class="insta-toolbox-state-dot"></span><div class="insta-toolbox-collision-copy"><strong data-insta-toolbox-role="collision-target">Exact target</strong><span data-insta-toolbox-role="collision-state">Native action surface is visible</span></div>
      </div>
      <dialog class="insta-toolbox-dialog" data-insta-toolbox-role="action-confirmation" aria-labelledby="insta-toolbox-confirm-title" aria-describedby="insta-toolbox-confirm-message insta-toolbox-confirm-detail">
        <form>
          <h2 id="insta-toolbox-confirm-title" data-insta-toolbox-role="confirm-title">Confirm action</h2>
          <p id="insta-toolbox-confirm-message" data-insta-toolbox-role="confirm-message"></p>
          <dl data-insta-toolbox-role="confirm-facts" hidden></dl>
          <ul data-insta-toolbox-role="confirm-items" aria-label="Reviewed targets" hidden></ul>
          <p id="insta-toolbox-confirm-detail" data-insta-toolbox-role="confirm-detail"></p>
          <div class="insta-toolbox-toolbar"><button class="insta-toolbox-button insta-toolbox-button--quiet" type="button" data-insta-toolbox-action="confirm-cancel" data-insta-toolbox-role="confirm-cancel">Cancel</button><button class="insta-toolbox-button insta-toolbox-button--danger" type="button" data-insta-toolbox-action="confirm-accept" data-insta-toolbox-role="confirm-accept">Confirm</button></div>
        </form>
      </dialog>
      <template data-insta-toolbox-template="advanced-settings"><strong>Batch pacing</strong><div class="insta-toolbox-field"><label for="insta-toolbox-limit-min-delay">Min delay (seconds)</label><input class="insta-toolbox-text-input" id="insta-toolbox-limit-min-delay" type="number" min="2" max="600" data-insta-toolbox-role="limit-min-delay"></div><div class="insta-toolbox-field"><label for="insta-toolbox-limit-max-delay">Max delay (seconds)</label><input class="insta-toolbox-text-input" id="insta-toolbox-limit-max-delay" type="number" min="2" max="900" data-insta-toolbox-role="limit-max-delay"></div><button class="insta-toolbox-button insta-toolbox-button--quiet" type="button" data-insta-toolbox-action="save-limits">Save pacing</button></template>
      <template data-insta-toolbox-template="checker-browser"><section class="insta-toolbox-checker-browser" data-insta-toolbox-role="checker-browser" aria-label="Mutual Checker results"><div class="insta-toolbox-filter-grid"><div class="insta-toolbox-field"><label for="insta-toolbox-checker-category">Show accounts</label><select class="insta-toolbox-select" id="insta-toolbox-checker-category" data-insta-toolbox-role="checker-category"><option value="not-following-me-back">Don't follow you back</option><option value="i-do-not-follow-back">You don't follow back</option><option value="mutuals">Mutuals</option></select></div><div class="insta-toolbox-field"><label for="insta-toolbox-checker-search">Find a username</label><input class="insta-toolbox-text-input" id="insta-toolbox-checker-search" type="search" inputmode="search" autocomplete="off" spellcheck="false" placeholder="Search usernames" data-insta-toolbox-role="checker-search"></div></div><div class="insta-toolbox-count"><strong data-insta-toolbox-role="checker-filter-count">0</strong><span data-insta-toolbox-role="checker-filter-detail">accounts</span></div><ul class="insta-toolbox-list" data-insta-toolbox-role="checker-filtered-list"></ul></section></template>
    `;
    return Object.freeze({ host, shadow });
  }

  shared.install('shell', { create, styles });
})();

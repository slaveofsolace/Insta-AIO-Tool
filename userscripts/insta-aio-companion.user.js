// ==UserScript==
// @name         Insta AIO Instagram Toolbox
// @namespace    https://github.com/slaveofsolace/Insta-AIO-Tool
// @version      0.11.0
// @description  Follower checker, follow/unfollow review, and DM tools in a movable Instagram-style panel.
// @homepageURL  https://github.com/slaveofsolace/Insta-AIO-Tool
// @supportURL   https://github.com/slaveofsolace/Insta-AIO-Tool/issues
// @downloadURL  https://raw.githubusercontent.com/slaveofsolace/Insta-AIO-Tool/main/userscripts/insta-aio-companion.user.js
// @updateURL    https://raw.githubusercontent.com/slaveofsolace/Insta-AIO-Tool/main/userscripts/insta-aio-companion.user.js
// @icon         data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E%3Crect width='64' height='64' rx='16' fill='%23ffffff'/%3E%3Crect x='1' y='1' width='62' height='62' rx='15' fill='none' stroke='%23dbdbdb' stroke-width='2'/%3E%3Ctext x='32' y='42' font-family='system-ui,sans-serif' font-size='25' font-weight='700' text-anchor='middle' fill='%23262626'%3EAIO%3C/text%3E%3C/svg%3E
// @license      MIT
// @match        https://www.instagram.com/*
// @sandbox      DOM
// @grant        GM_getTab
// @grant        GM_getValue
// @grant        GM_saveTab
// @grant        GM_setValue
// @run-at       document-idle
// ==/UserScript==
// ---------------------------------------------------------------------------
// Generated file. Do not edit.
//
// Built by scripts/build-userscript.mjs from:
//   extension/action-labels.js           <- labels and thread-wide DM runner
//   extension/content-instagram.js       <- shared exact-target engine
//   userscripts/src/toolbox-shell.js     <- userscript UI and batch runner
//
// Edit those sources and run: pnpm run build:userscript
// ---------------------------------------------------------------------------
(() => {
  'use strict';

  // Single source of visual truth for the extension overlay and the
  // Tampermonkey toolbox. See docs/DESIGN_SYSTEM.md.
  //
  // Both surfaces previously carried their own palette — 104 colour literals
  // between them and no shared name — so a fix in one never reached the other.
  // Everything visual now resolves to a role defined here.
  //
  // Instagram publishes its palette as CSS custom properties on the document.
  // Each role reads Instagram's value first and falls back to a fixed one, so
  // the panel follows the page's light and dark treatment without detecting it,
  // and stays readable if Instagram renames a variable. This is visual
  // compatibility only; the project is independent of Instagram and Meta.

  const SPACE = ['0', '4px', '8px', '12px', '16px', '20px', '24px'];

  function palette() {
    return {
      '--aio-bg': 'rgb(var(--ig-primary-background, 255 255 255))',
      '--aio-bg-raised': 'rgb(var(--ig-elevated-background, 255 255 255))',
      '--aio-bg-sunken': 'rgb(var(--ig-secondary-background, 250 250 250))',
      '--aio-text': 'rgb(var(--ig-primary-text, 0 0 0))',
      '--aio-text-muted': 'rgb(var(--ig-secondary-text, 115 115 115))',
      '--aio-line': 'rgb(var(--ig-separator, 219 219 219))',
      '--aio-accent': 'rgb(var(--ig-primary-button, 0 149 246))',
      '--aio-on-accent': '#fff',
      '--aio-success': 'rgb(var(--ig-success, 0 148 84))',
      '--aio-warning': '#b26a00',
      '--aio-danger': 'rgb(var(--ig-error-or-destructive, 237 73 86))',
      // Deliberately not the danger colour: an uncertain outcome may well have
      // succeeded, and colouring it as a failure would assert what we do not know.
      '--aio-uncertain': '#7a5cc4',
      '--aio-focus': 'rgb(var(--ig-primary-button, 0 149 246))',
    };
  }

  function scale(density) {
    const tight = density === 'compact';
    return {
      '--aio-space-1': SPACE[1],
      '--aio-space-2': SPACE[2],
      '--aio-space-3': SPACE[3],
      '--aio-space-4': SPACE[4],
      '--aio-space-5': SPACE[5],
      '--aio-space-6': SPACE[6],
      // Compact trims vertical rhythm only. Hit targets and font sizes are
      // never reduced, so a denser panel stays as usable as a roomy one.
      '--aio-pad-y': tight ? SPACE[2] : SPACE[3],
      '--aio-pad-x': tight ? SPACE[3] : SPACE[4],
      '--aio-gap': tight ? SPACE[2] : SPACE[3],
      '--aio-radius-sm': '6px',
      '--aio-radius-md': '8px',
      '--aio-radius-lg': '16px',
      '--aio-border': '1px',
      '--aio-target': '44px',
      '--aio-text-lg': '15px',
      '--aio-text-md': '14px',
      '--aio-text-sm': '13px',
      '--aio-text-xs': '12px',
      '--aio-leading-lg': '20px',
      '--aio-leading-md': '20px',
      '--aio-leading-sm': '18px',
      '--aio-leading-xs': '16px',
      '--aio-weight-normal': '400',
      '--aio-weight-strong': '600',
      '--aio-font': 'var(--ig-font-family, "Segoe UI Variable", "Segoe UI", system-ui, -apple-system, sans-serif)',
      '--aio-shadow-panel': '0 12px 40px rgba(0, 0, 0, .18)',
      '--aio-shadow-popover': '0 8px 24px rgba(0, 0, 0, .16)',
      '--aio-shadow-none': 'none',
      '--aio-motion-fast': '120ms',
      '--aio-motion-base': '180ms',
      '--aio-motion-slow': '240ms',
      '--aio-ease': 'cubic-bezier(.2, .7, .3, 1)',
    };
  }

  function declarations(density) {
    return Object.entries({ ...palette(), ...scale(density) })
      .map(([name, value]) => `${name}: ${value};`)
      .join(' ');
  }

  // Shared primitives. Component styles live with their surface; anything that
  // decides colour, focus, target size, or motion lives here.
  function primitives() {
    return `
    .aio-focusable:focus { outline: none; }
    .aio-focusable:focus-visible {
      outline: 2px solid var(--aio-focus);
      outline-offset: 2px;
    }
    /* A control may look small but must never be small to hit. */
    .aio-target { min-width: var(--aio-target); min-height: var(--aio-target); }
    .aio-state-locked { color: var(--aio-text-muted); }
    .aio-state-armed { border-color: var(--aio-danger); color: var(--aio-danger); }
    .aio-state-running { border-color: var(--aio-warning); color: var(--aio-warning); }
    .aio-state-paused { border-color: var(--aio-line); color: var(--aio-text-muted); }
    .aio-state-stopped { border-color: var(--aio-danger); color: var(--aio-danger); }
    .aio-state-uncertain { border-color: var(--aio-uncertain); color: var(--aio-uncertain); }
    .aio-state-success { color: var(--aio-success); }
    .aio-state-selected { color: var(--aio-accent); }
    [disabled], [aria-disabled="true"] { opacity: .45; cursor: not-allowed; }

    @media (prefers-reduced-motion: reduce) {
      /* State still changes; it simply arrives without travel. */
      *, *::before, *::after {
        animation-duration: 1ms !important;
        animation-iteration-count: 1 !important;
        transition-duration: 1ms !important;
        scroll-behavior: auto !important;
      }
    }

    @media (forced-colors: active) {
      /* Structure has to survive without colour, so every edge becomes real. */
      .aio-surface, .aio-raised, .aio-sunken { background: Canvas; color: CanvasText; }
      .aio-surface, .aio-raised, .aio-sunken, .aio-card { border: 1px solid CanvasText; }
      .aio-focusable:focus-visible { outline-color: Highlight; }
      .aio-state-selected { color: Highlight; }
    }`;
  }

  const api = Object.freeze({
    css(options = {}) {
      const density = options.density === 'compact' ? 'compact' : 'comfortable';
      const scope = options.scope || ':host';
      return `${scope} { ${declarations(density)} }\n${primitives()}`;
    },
    declarations,
    palette,
    scale,
    // Exposed so tests can assert the contract rather than re-reading strings.
    roles: Object.freeze(Object.keys(palette())),
    steps: Object.freeze(Object.keys(scale('comfortable'))),
  });

  Object.defineProperty(globalThis, 'InstaAioTokens', {
    configurable: false,
    enumerable: false,
    value: api,
    writable: false,
  });
})();

(() => {
  'use strict';

  const namespace = '__instaAioActionLabels';
  if (globalThis[namespace]) return;

  const relationshipEntries = Object.freeze([
    Object.freeze(['follow', 'not-following']),
    Object.freeze(['follow back', 'not-following']),
    Object.freeze(['following', 'following']),
    Object.freeze(['requested', 'requested']),
  ]);
  const dmUnsendLabels = Object.freeze([
    'annulla invio',
    'deshacer',
    'retirar',
    'retirer',
    'unsend',
    'zurücknehmen',
  ]);
  const dmActionSelectors = Object.freeze([
    "[aria-label^='See more options for message']",
    "[aria-label*='more options']",
    "[aria-label*='More']",
    "[aria-label*='Altre opzioni']",
    "[aria-label*='opzioni']",
    "[aria-label*='opciones']",
    "[aria-label*='options']",
    "[role='button'][aria-haspopup='menu']",
  ]);
  const relationshipByLabel = new Map(relationshipEntries);
  const dmUnsendLabelSet = new Set(dmUnsendLabels);

  function normalizeActionLabel(value) {
    return String(value ?? '')
      .normalize('NFKC')
      .trim()
      .replace(/\s+/gu, ' ')
      .toLowerCase();
  }

  const api = Object.freeze({
    dmActionSelectors,
    dmUnsendLabels,
    relationshipLabels: Object.freeze(relationshipEntries.map(([label]) => label)),
    isDmUnsendLabel(value) {
      return dmUnsendLabelSet.has(normalizeActionLabel(value));
    },
    normalizeActionLabel,
    relationshipForLabel(value) {
      return relationshipByLabel.get(normalizeActionLabel(value)) || null;
    },
  });

  Object.defineProperty(globalThis, namespace, {
    configurable: false,
    enumerable: false,
    value: api,
    writable: false,
  });
})();

(() => {
  'use strict';

  if (globalThis.InstaAioDmThreadUnsender) return;
  const actionLabels = globalThis.__instaAioActionLabels;
  if (!actionLabels) return;

  const ACTIVE_ATTRIBUTE = 'data-insta-aio-unsend-active';
  const DONE_ATTRIBUTE = 'data-insta-aio-unsent';
  const DEFAULT_MIN_DELAY_MS = 4_000;
  const DEFAULT_MAX_DELAY_MS = 11_000;
  const DEFAULT_MAX_FAILURES = 5;
  const MIN_USABLE_VISIBLE_PX = 24;
  const MAX_HOVER_DEPTH = 8;
  const MAX_SCAN_PASSES = 3;
  const MAX_PLAN_MESSAGES = 5_000;
  const PLAN_SCOPES = new Set(['all', 'newest', 'oldest']);
  const listeners = new Set();

  let activeController = null;
  let currentState = Object.freeze({
    status: 'idle',
    processed: 0,
    failed: 0,
    consecutiveFailures: 0,
    current: null,
    message: 'Ready',
    startedAt: null,
    finishedAt: null,
    canStop: false,
  });

  function snapshot() {
    return { ...currentState };
  }

  function publish(patch) {
    currentState = Object.freeze({ ...currentState, ...patch });
    for (const listener of listeners) {
      try {
        listener(snapshot());
      } catch {
        // A view listener must not be able to interrupt the thread workflow.
      }
    }
    return snapshot();
  }

  function subscribe(listener) {
    if (typeof listener !== 'function') return () => {};
    listeners.add(listener);
    listener(snapshot());
    return () => listeners.delete(listener);
  }

  function delay(ms, signal) {
    return new Promise((resolve, reject) => {
      if (signal?.aborted) {
        reject(new DOMException('The operation was stopped.', 'AbortError'));
        return;
      }
      const timer = setTimeout(resolve, Math.max(0, ms));
      signal?.addEventListener('abort', () => {
        clearTimeout(timer);
        reject(new DOMException('The operation was stopped.', 'AbortError'));
      }, { once: true });
    });
  }

  function randomDelay(minimum, maximum) {
    const min = Math.max(1_500, Number(minimum) || DEFAULT_MIN_DELAY_MS);
    const max = Math.max(min, Number(maximum) || DEFAULT_MAX_DELAY_MS);
    return min + Math.floor(Math.random() * (max - min + 1));
  }

  function digestText(value) {
    let hash = 0x811c9dc5;
    const text = String(value || '');
    for (let index = 0; index < text.length; index += 1) {
      hash ^= text.charCodeAt(index);
      hash = Math.imul(hash, 0x01000193);
    }
    return (hash >>> 0).toString(16).padStart(8, '0');
  }

  function planDigest({ threadId, scope, limit, eligibleCount, expiresAt }) {
    return digestText(JSON.stringify({
      threadId: String(threadId || ''),
      scope: String(scope || ''),
      limit: Number(limit),
      eligibleCount: Number(eligibleCount),
      expiresAt: Number(expiresAt),
    }));
  }

  function createPlan(value = {}) {
    const threadId = String(value.threadId || '').trim();
    const scope = PLAN_SCOPES.has(value.scope) ? value.scope : 'all';
    const eligibleCount = Math.min(
      MAX_PLAN_MESSAGES,
      Math.max(0, Math.floor(Number(value.eligibleCount) || 0)),
    );
    const requestedLimit = Math.floor(Number(value.limit));
    const limit = scope === 'all'
      ? eligibleCount
      : Math.min(eligibleCount, Math.max(1, Number.isFinite(requestedLimit) ? requestedLimit : 1));
    const expiresAt = Math.floor(Number(value.expiresAt) || 0);
    if (!threadId || eligibleCount < 1 || limit < 1 || expiresAt <= Date.now()) return null;
    const plan = { threadId, scope, limit, eligibleCount, expiresAt };
    return Object.freeze({ ...plan, reviewedDigest: planDigest(plan) });
  }

  function validatePlan(value) {
    const normalized = createPlan(value);
    return normalized && normalized.reviewedDigest === String(value?.reviewedDigest || '')
      ? normalized
      : null;
  }

  function visibleText(element) {
    if (!element || element.getAttribute?.('aria-hidden') === 'true') return '';
    const style = element.ownerDocument?.defaultView?.getComputedStyle?.(element);
    if (style?.display === 'none' || style?.visibility === 'hidden' || style?.opacity === '0') return '';
    const rectangle = element.getBoundingClientRect?.();
    if (rectangle && rectangle.width === 0 && rectangle.height === 0) return '';
    return String(element.textContent || element.getAttribute?.('aria-label') || '').trim();
  }

  function overflowClips(value) {
    return /^(auto|scroll|hidden|clip)$/i.test(String(value || '').trim());
  }

  function hasUsableIntersection(start, end, clipStart, clipEnd) {
    const size = Math.max(0, Number(end) - Number(start));
    const visible = Math.max(
      0,
      Math.min(Number(end), Number(clipEnd)) - Math.max(Number(start), Number(clipStart)),
    );
    return visible >= Math.min(MIN_USABLE_VISIBLE_PX, size);
  }

  function clippedByAncestor(element, rectangle) {
    const documentElement = element.ownerDocument?.documentElement;
    const view = element.ownerDocument?.defaultView;

    for (let ancestor = element.parentElement;
      ancestor && ancestor !== documentElement;
      ancestor = ancestor.parentElement) {
      const style = view?.getComputedStyle?.(ancestor);
      const shorthand = String(style?.overflow || '').trim().split(/\s+/).filter(Boolean);
      const overflowX = style?.overflowX || shorthand[0] || '';
      const overflowY = style?.overflowY || shorthand[1] || shorthand[0] || '';
      const clipsX = overflowClips(overflowX);
      const clipsY = overflowClips(overflowY);
      if (!clipsX && !clipsY) continue;

      const bounds = ancestor.getBoundingClientRect?.();
      if (!bounds) continue;
      if (clipsX
        && !hasUsableIntersection(rectangle.left, rectangle.right, bounds.left, bounds.right)) return true;
      if (clipsY
        && !hasUsableIntersection(rectangle.top, rectangle.bottom, bounds.top, bounds.bottom)) return true;
    }

    return false;
  }

  function isVisible(element) {
    if (!element?.isConnected) return false;
    if (typeof element.checkVisibility === 'function') {
      try {
        if (!element.checkVisibility({
          visibilityProperty: true,
          contentVisibilityAuto: true,
          opacityProperty: true,
        })) return false;
      } catch {
        // Older Chromium versions may not accept the options object.
      }
    }
    const rectangle = element.getBoundingClientRect?.();
    const viewportHeight = Number(element.ownerDocument?.defaultView?.innerHeight || globalThis.innerHeight || 0);
    const viewportWidth = Number(element.ownerDocument?.defaultView?.innerWidth || globalThis.innerWidth || 0);
    if (!rectangle || rectangle.height <= 0 || rectangle.width <= 0) return false;
    if (viewportHeight > 0
      && !hasUsableIntersection(rectangle.top, rectangle.bottom, 0, viewportHeight)) return false;
    if (viewportWidth > 0
      && !hasUsableIntersection(rectangle.left, rectangle.right, 0, viewportWidth)) return false;
    return !clippedByAncestor(element, rectangle);
  }

  function currentThreadId() {
    const match = String(location.pathname || '').match(/^\/direct\/t\/([^/?#]+)/i);
    if (!match) return '';
    try {
      return decodeURIComponent(match[1]);
    } catch {
      return '';
    }
  }

  function sessionStop(expectedThreadId = '') {
    const observation = globalThis.InstaAioInstagramInspector?.inspectSession?.() || {};
    if (observation.sessionExpired) return 'Instagram signed you out';
    if (observation.challenge) return 'Instagram opened a security check';
    if (observation.actionBlocked) return 'Instagram blocked the action';
    if (observation.rateLimited) return 'Instagram asked you to slow down';
    const threadId = currentThreadId();
    if (!threadId) return 'The conversation is no longer open';
    if (expectedThreadId && threadId !== expectedThreadId) return 'The armed conversation changed';
    return null;
  }

  function findScrollableChild(parent, view = globalThis) {
    if (!parent) return null;
    let best = null;
    const queue = [{ element: parent, depth: 0 }];
    while (queue.length) {
      const { element, depth } = queue.shift();
      if (depth > 10) continue;
      const style = view.getComputedStyle?.(element);
      const slack = Number(element.scrollHeight) - Number(element.clientHeight);
      if ((style?.overflowY === 'auto' || style?.overflowY === 'scroll') && slack > 8) {
        if (!best || slack > best.slack) best = { element, slack };
      }
      for (const child of element.children || []) queue.push({ element: child, depth: depth + 1 });
    }
    return best?.element || null;
  }

  function threadContext() {
    const threadId = currentThreadId();
    if (!threadId) {
      return { ok: false, reason: 'Open an Instagram conversation first.' };
    }
    const root = document.querySelector("[data-pagelet='IGDMessagesList']");
    if (!root) {
      return { ok: false, reason: 'The message list is still loading. Keep the conversation open and try again.' };
    }
    const scroller = findScrollableChild(root, root.ownerDocument.defaultView);
    if (!scroller) {
      // Short conversations can fit without producing a scrollable descendant.
      return { ok: true, root, scroller: root, threadId };
    }
    return { ok: true, root, scroller, threadId };
  }

  function deepestMessageContainer(scroller) {
    let best = scroller;
    let bestCount = scroller?.children?.length || 0;
    const queue = [{ element: scroller, depth: 0 }];
    while (queue.length) {
      const { element, depth } = queue.shift();
      if (depth > 4) continue;
      const count = element?.children?.length || 0;
      if (count > bestCount) {
        best = element;
        bestCount = count;
      }
      for (const child of element?.children || []) queue.push({ element: child, depth: depth + 1 });
    }
    return best;
  }

  function hasMessageContent(row) {
    return Boolean(
      row?.querySelector?.('[role="none"], [role="presentation"], [dir="auto"], img, video, audio'),
    );
  }

  function sentByCurrentUser(row, view = globalThis) {
    const explicit = String(row?.getAttribute?.('data-sent-by-me') || '').toLowerCase();
    if (explicit === 'true') return true;
    if (explicit === 'false') return false;
    const queue = [{ element: row, depth: 0 }];
    while (queue.length) {
      const { element, depth } = queue.shift();
      if (view.getComputedStyle?.(element)?.justifyContent === 'flex-end') return true;
      if (depth < MAX_HOVER_DEPTH) {
        for (const child of element.children || []) queue.push({ element: child, depth: depth + 1 });
      }
    }
    return false;
  }

  function candidateRows(scroller) {
    const container = deepestMessageContainer(scroller);
    let rows = [...(container?.children || [])];
    if (!rows.length) {
      rows = [...(scroller?.querySelectorAll?.('[role="row"], [role="listitem"]') || [])];
    }
    return rows
      .filter((row) => !row.hasAttribute?.(DONE_ATTRIBUTE))
      .filter((row) => !row.hasAttribute?.(ACTIVE_ATTRIBUTE))
      .filter(hasMessageContent)
      .filter((row) => sentByCurrentUser(row, row.ownerDocument.defaultView));
  }

  function orderedCandidates(scroller, order = 'oldest') {
    const rows = candidateRows(scroller);
    return order === 'newest' ? rows : rows.reverse();
  }

  function firstVisibleCandidate(scroller, order = 'oldest') {
    const rows = orderedCandidates(scroller, order);
    return rows.find(isVisible) || null;
  }

  async function waitForElement(target, getter, signal, timeoutMs = 3_000) {
    const immediate = getter();
    if (immediate) return immediate;
    return new Promise((resolve, reject) => {
      let timer;
      const observer = new MutationObserver(() => {
        const value = getter();
        if (!value) return;
        cleanup();
        resolve(value);
      });
      const onAbort = () => {
        cleanup();
        reject(new DOMException('The operation was stopped.', 'AbortError'));
      };
      const cleanup = () => {
        observer.disconnect();
        clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
      };
      observer.observe(target, { childList: true, subtree: true, attributes: true });
      timer = setTimeout(() => {
        cleanup();
        resolve(null);
      }, timeoutMs);
      signal?.addEventListener('abort', onAbort, { once: true });
    });
  }

  function dispatch(target, event) {
    EventTarget.prototype.dispatchEvent.call(target, event);
  }

  function hoverOptions(target) {
    const rectangle = target.getBoundingClientRect?.() || { x: 0, y: 0, width: 0, height: 0 };
    return {
      bubbles: true,
      cancelable: true,
      clientX: rectangle.x + (rectangle.width / 2),
      clientY: rectangle.y + (rectangle.height / 2),
      pointerId: 1,
      pointerType: 'mouse',
    };
  }

  function hoverIn(target) {
    const options = hoverOptions(target);
    if (typeof PointerEvent === 'function') {
      dispatch(target, new PointerEvent('pointerenter', { ...options, bubbles: false }));
      dispatch(target, new PointerEvent('pointerover', options));
      dispatch(target, new PointerEvent('pointermove', options));
    }
    dispatch(target, new MouseEvent('mouseenter', { ...options, bubbles: false }));
    dispatch(target, new MouseEvent('mouseover', options));
    dispatch(target, new MouseEvent('mousemove', options));
  }

  function hoverOut(target) {
    const options = hoverOptions(target);
    if (typeof PointerEvent === 'function') {
      dispatch(target, new PointerEvent('pointerout', options));
      dispatch(target, new PointerEvent('pointerleave', { ...options, bubbles: false }));
    }
    dispatch(target, new MouseEvent('mouseout', options));
    dispatch(target, new MouseEvent('mouseleave', { ...options, bubbles: false }));
  }

  function hoverTargets(row) {
    const targets = [];
    const queue = [{ element: row, depth: 0 }];
    while (queue.length) {
      const { element, depth } = queue.shift();
      targets.push(element);
      if (depth < MAX_HOVER_DEPTH) {
        for (const child of element.children || []) queue.push({ element: child, depth: depth + 1 });
      }
    }
    return targets;
  }

  function clickable(element, scope = document) {
    const control = element?.closest?.('button, [role="button"], [role="menuitem"]');
    return control && scope.contains(control) ? control : null;
  }

  function actionButton(row) {
    const matches = [];
    for (const selector of actionLabels.dmActionSelectors) {
      for (const element of row.querySelectorAll?.(selector) || []) {
        const control = clickable(element, row) || (element.matches?.('button, [role="button"]') ? element : null);
        if (control) matches.push(control);
      }
    }
    return [...new Set(matches)].find(isVisible) || null;
  }

  function activateControl(control) {
    HTMLElement.prototype.click.call(control);
  }

  function visibleSurfaces(selector) {
    return [...document.querySelectorAll(selector)].filter((element) => visibleText(element));
  }

  // Instagram renders the message menu in a portal near the end of <body>, and
  // that container does not reliably carry role="menu". Scoping the search to
  // newly added menu surfaces therefore finds nothing and every message times
  // out, so the search runs over the whole document.
  //
  // Only leaf elements are considered — ones whose own first child is a text
  // node. An ancestor's textContent also reads "Unsend", and matching those
  // produced several candidates for one item.
  function unsendCandidates(scope = document) {
    const found = [];
    for (const element of scope?.querySelectorAll?.('span, div, button, [role="button"], [role="menuitem"]') || []) {
      if (element.firstChild?.nodeType !== 3) continue;
      if (!actionLabels.isDmUnsendLabel(visibleText(element))) continue;
      if (!isVisible(element)) continue;
      found.push(clickable(element, document) || element);
    }
    return [...new Set(found)];
  }

  async function dismissStaleSurfaces(signal) {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      if (!visibleSurfaces('[role="dialog"], [role="menu"], [role="listbox"]').length) return;
      dispatch(document.body, new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      await delay(160, signal);
    }
  }

  async function revealActionButton(row, signal) {
    await dismissStaleSurfaces(signal);
    const targets = hoverTargets(row);
    for (let attempt = 0; attempt < 3; attempt += 1) {
      for (const target of targets) hoverIn(target);
      await delay(110, signal);
      const control = actionButton(row);
      if (control) return control;
      for (const target of targets) hoverOut(target);
      await delay(60, signal);
    }
    for (const target of targets) hoverIn(target);
    return waitForElement(row, () => actionButton(row), signal, 3_000);
  }

  function authorizationFailure(expectedThreadId, authorizationExpiresAt) {
    if (!(Number(authorizationExpiresAt) > Date.now())) return 'Live authorization expired before the next Instagram control.';
    return sessionStop(expectedThreadId);
  }

  function requireAuthorization(expectedThreadId, authorizationExpiresAt) {
    const reason = authorizationFailure(expectedThreadId, authorizationExpiresAt);
    if (reason) throw new Error(reason);
  }

  async function openUnsendMenu(control, signal, expectedThreadId, authorizationExpiresAt) {
    const existing = new Set(unsendCandidates(document));
    const pending = waitForElement(document.body, () => {
      const candidates = unsendCandidates(document).filter((candidate) => !existing.has(candidate));
      if (candidates.length > 1) return { ambiguous: true };
      return candidates.length === 1 ? { control: candidates[0] } : null;
    }, signal, 3_000);
    requireAuthorization(expectedThreadId, authorizationExpiresAt);
    activateControl(control);
    const result = await pending;
    requireAuthorization(expectedThreadId, authorizationExpiresAt);
    if (result?.ambiguous) throw new Error('Instagram showed more than one new Unsend option.');
    return result;
  }

  function dialogControlHasUnsendLabel(control) {
    if (actionLabels.isDmUnsendLabel(visibleText(control))) return true;
    return [...control.querySelectorAll?.('span, div') || []].some((element) => (
      element.firstChild?.nodeType === 3
      && actionLabels.isDmUnsendLabel(visibleText(element))
    ));
  }

  function dialogUnsendCandidates(existing = new Set()) {
    return [...document.querySelectorAll(
      '[role="dialog"] button, [role="dialog"] [role="button"]',
    )]
      .filter(isVisible)
      .filter((candidate) => !existing.has(candidate))
      .filter(dialogControlHasUnsendLabel);
  }

  async function confirmUnsend(menuControl, row, signal, expectedThreadId, authorizationExpiresAt) {
    // A normal confirmation dialog may contain both Cancel and Unsend. Accept
    // exactly one newly surfaced, localized Unsend control while ignoring
    // unrelated dialog buttons and every control that pre-dated this step.
    const existing = new Set(
      [...document.querySelectorAll(
        '[role="dialog"] button, [role="dialog"] [role="button"]',
      )].filter(isVisible),
    );
    const pending = waitForElement(
      document.body,
      () => {
        const candidates = dialogUnsendCandidates(existing);
        if (candidates.length > 1) return { ambiguous: true };
        return candidates.length === 1 ? { control: candidates[0] } : null;
      },
      signal,
      3_000,
    );
    requireAuthorization(expectedThreadId, authorizationExpiresAt);
    activateControl(menuControl);
    const result = await pending;
    requireAuthorization(expectedThreadId, authorizationExpiresAt);
    if (result?.ambiguous) throw new Error('Instagram showed more than one new Unsend confirmation.');
    const dialogButton = result?.control;
    if (!dialogButton) return false;

    const closed = waitForElement(
      document.body,
      () => (!dialogButton.isConnected || !isVisible(dialogButton) ? true : null),
      signal,
      5_000,
    );
    requireAuthorization(expectedThreadId, authorizationExpiresAt);
    activateControl(dialogButton);
    // Parenthesised deliberately: `await closed !== true` binds as
    // `await (closed !== true)`, which is always true for a promise and made
    // every successful removal report as a failure.
    if ((await closed) !== true) return false;

    // Instagram usually leaves the row in place and swaps its content for an
    // "unsent" note rather than removing it, so requiring the row to disappear
    // would mark successful removals as failures. Either outcome counts.
    if (!row.isConnected) return true;
    await delay(250, signal);
    return !row.isConnected || !hasMessageContent(row) || actionButton(row) === null;
  }

  async function unsendRow(row, signal, expectedThreadId, authorizationExpiresAt) {
    row.setAttribute(ACTIVE_ATTRIBUTE, '');
    let success = false;
    try {
      const control = await revealActionButton(row, signal);
      if (!control) throw new Error('The message menu did not appear.');
      const menu = await openUnsendMenu(
        control,
        signal,
        expectedThreadId,
        authorizationExpiresAt,
      );
      if (!menu?.control) throw new Error('Instagram did not show an Unsend option.');
      success = await confirmUnsend(
        menu.control,
        row,
        signal,
        expectedThreadId,
        authorizationExpiresAt,
      );
      if (!success) throw new Error('The message was not confirmed as removed.');
      row.setAttribute(DONE_ATTRIBUTE, '');
      return true;
    } finally {
      row.removeAttribute(ACTIVE_ATTRIBUTE);
      if (!success) await dismissStaleSurfaces(signal).catch(() => {});
    }
  }

  function reversedLayout(scroller) {
    return scroller?.ownerDocument?.defaultView?.getComputedStyle?.(scroller)?.flexDirection === 'column-reverse'
      || Number(scroller?.scrollTop) < 0;
  }

  function oldestOffset(scroller, reversed) {
    return reversed ? -(scroller.scrollHeight - scroller.clientHeight) : 0;
  }

  function newestOffset(scroller, reversed) {
    return reversed ? 0 : Math.max(0, scroller.scrollHeight - scroller.clientHeight);
  }

  function visibleLoader(root) {
    return [...root.querySelectorAll?.('[role="progressbar"], svg[aria-label*="Loading" i]') || []]
      .find(isVisible) || null;
  }

  async function waitForLoader(root, signal) {
    if (!visibleLoader(root)) return;
    await Promise.race([
      waitForElement(root, () => visibleLoader(root) === null, signal, 5_000),
      delay(5_000, signal),
    ]).catch(() => {});
  }

  async function loadAllHistory(context, signal) {
    const { root, scroller } = context;
    if (!scroller || scroller.scrollHeight <= scroller.clientHeight + 50) {
      return { complete: true, pagesChecked: 0 };
    }
    const reversed = reversedLayout(scroller);
    let quietRounds = 0;
    let topNudgeUsed = false;
    let pagesChecked = 0;
    // Instagram pauses between pages on a long thread, so a few quiet rounds
    // does not mean the history ended. Giving up after three left most of a
    // long conversation unloaded, which is the same impatience the follower
    // scan had.
    for (let page = 0; page < 600 && quietRounds < 10; page += 1) {
      pagesChecked = page + 1;
      const stop = sessionStop(context.threadId);
      if (stop) throw new Error(stop);
      const beforeHeight = scroller.scrollHeight;
      const beforeRows = candidateRows(scroller).length;
      const target = oldestOffset(scroller, reversed);
      if (Math.abs(scroller.scrollTop - target) > 5) {
        scroller.scrollTop = target;
        dispatch(scroller, new Event('scroll', { bubbles: true }));
      } else if (!topNudgeUsed && quietRounds >= 2) {
        // Some Instagram builds only restart lazy history loading after real
        // movement at the oldest edge. Wake that loader once per loaded page,
        // not on every quiet poll: repeated nudges made the conversation look
        // as though the run was permanently fighting the user's scroll.
        scroller.scrollTop = target + (reversed ? 1 : -1) * Math.max(80, Math.floor(scroller.clientHeight / 2));
        dispatch(scroller, new Event('scroll', { bubbles: true }));
        await delay(80, signal);
        scroller.scrollTop = target;
        dispatch(scroller, new Event('scroll', { bubbles: true }));
        topNudgeUsed = true;
      } else {
        // A synthetic edge notification is enough while waiting for a loader
        // that is already in flight and does not visibly move the thread.
        dispatch(scroller, new Event('scroll', { bubbles: true }));
      }
      await delay(500, signal);
      await waitForLoader(root, signal);
      const grew = scroller.scrollHeight > beforeHeight || candidateRows(scroller).length > beforeRows;
      quietRounds = grew ? 0 : quietRounds + 1;
      if (grew) topNudgeUsed = false;
      publish({
        status: 'preparing',
        message: grew ? 'Loading older messages…' : 'Checking for older messages…',
        canStop: true,
      });
    }
    // Stay at the oldest end. Jumping back to the newest message made the run
    // start from the bottom and work upward, which is slower and re-renders
    // the thread constantly. Loading to the top and then working down from
    // there is both faster and easier to watch.
    scroller.scrollTop = oldestOffset(scroller, reversed);
    dispatch(scroller, new Event('scroll', { bubbles: true }));
    await delay(100, signal);
    return {
      complete: quietRounds >= 10,
      pagesChecked,
    };
  }

  function rowNeedsReposition(row, scroller) {
    if (!isVisible(row)) return true;
    const rowRect = row.getBoundingClientRect?.();
    const scrollerRect = scroller?.getBoundingClientRect?.();
    if (!rowRect || !scrollerRect) return false;
    const inset = Math.min(16, Math.max(4, Math.floor(scrollerRect.height * 0.04)));
    return rowRect.top < scrollerRect.top + inset
      || rowRect.bottom > scrollerRect.bottom - inset;
  }

  async function exposeRow(row, scroller, signal) {
    if (!rowNeedsReposition(row, scroller)) return isVisible(row);
    row.scrollIntoView({ block: 'center', inline: 'nearest' });
    dispatch(scroller, new Event('scroll', { bubbles: true }));
    await delay(60, signal);
    return isVisible(row);
  }

  async function nextSentRow(context, signal, order = 'oldest') {
    const { scroller } = context;
    // Leave a comfortably visible row in place. Re-centering every message made
    // the processing phase continually fight the thread position. Partially
    // clipped rows are still exposed before hover so their menu affordance is
    // reachable on other platforms and font stacks.
    const visible = firstVisibleCandidate(scroller, order);
    if (visible) {
      if (await exposeRow(visible, scroller, signal)) return visible;
    }

    for (let pass = 0; pass < MAX_SCAN_PASSES; pass += 1) {
      if (signal.aborted) return null;
      const [row] = orderedCandidates(scroller, order);
      if (row) {
        if (await exposeRow(row, scroller, signal)) return row;
        // Still hidden: hand it back anyway on the final pass so a row that
        // simply cannot be scrolled into view is attempted rather than skipped.
        if (pass === MAX_SCAN_PASSES - 1) return row;
      }
      // Nothing actionable is visible here; return to the reviewed edge.
      const reversed = reversedLayout(scroller);
      scroller.scrollTop = order === 'newest'
        ? newestOffset(scroller, reversed)
        : oldestOffset(scroller, reversed);
      dispatch(scroller, new Event('scroll', { bubbles: true }));
      await delay(120, signal);
    }
    return null;
  }

  function preview(row) {
    const text = [...row.querySelectorAll?.('[dir="auto"]') || []]
      .filter((element) => !element.querySelector?.('[dir="auto"]'))
      .map(visibleText)
      .find(Boolean);
    return (text || 'Sent message').slice(0, 90);
  }

  async function inspectAll() {
    if (activeController && !activeController.signal.aborted) {
      return { ready: false, reason: 'Another message check or run is already active.' };
    }
    const context = threadContext();
    if (!context.ok) return { ready: false, reason: context.reason };
    const controller = new AbortController();
    activeController = controller;
    publish({
      status: 'preparing',
      processed: 0,
      failed: 0,
      message: 'Checking the full conversation without opening a message menu…',
      startedAt: new Date().toISOString(),
      finishedAt: null,
      canStop: true,
    });
    try {
      const history = await loadAllHistory(context, controller.signal);
      const resolvedCount = candidateRows(context.scroller).length;
      const capped = resolvedCount > MAX_PLAN_MESSAGES;
      const eligibleCount = Math.min(MAX_PLAN_MESSAGES, resolvedCount);
      const complete = history.complete && !capped;
      const result = Object.freeze({
        ready: true,
        threadId: context.threadId,
        eligibleCount,
        complete,
        capped,
        pagesChecked: history.pagesChecked,
        reason: complete
          ? 'Full conversation check complete.'
          : capped
            ? `More than ${MAX_PLAN_MESSAGES} eligible sent messages were found. No destructive plan was created.`
            : 'The bounded history check reached its page limit before completeness could be proven.',
        checkedAt: new Date().toISOString(),
      });
      publish({
        status: 'reviewed',
        message: complete
          ? `${eligibleCount} sent message${eligibleCount === 1 ? '' : 's'} eligible in this conversation. Nothing was changed.`
          : `${result.reason} Nothing was changed.`,
        current: null,
        canStop: false,
        finishedAt: result.checkedAt,
      });
      return result;
    } catch (error) {
      const reason = error?.name === 'AbortError' || controller.signal.aborted
        ? 'Conversation check stopped. Nothing was changed.'
        : error.message || 'The conversation could not be checked.';
      publish({
        status: error?.name === 'AbortError' || controller.signal.aborted ? 'stopped' : 'error',
        message: reason,
        current: null,
        canStop: false,
        finishedAt: new Date().toISOString(),
      });
      return { ready: false, reason };
    } finally {
      if (activeController === controller) activeController = null;
    }
  }

  async function start(options = {}) {
    if (activeController && !activeController.signal.aborted) return snapshot();
    const plan = validatePlan(options.plan);
    if (!plan) {
      publish({
        status: 'error',
        message: 'A fresh, count-specific reviewed plan is required before Unsend can start.',
        canStop: false,
        finishedAt: new Date().toISOString(),
      });
      return snapshot();
    }
    const context = threadContext();
    if (!context.ok) {
      publish({ status: 'error', message: context.reason, canStop: false, finishedAt: new Date().toISOString() });
      return snapshot();
    }
    const expectedThreadId = plan.threadId;
    if (!expectedThreadId || context.threadId !== expectedThreadId) {
      publish({
        status: 'error',
        message: 'Thread-specific live authorization is required before Unsend can start.',
        canStop: false,
        finishedAt: new Date().toISOString(),
      });
      return snapshot();
    }

    const controller = new AbortController();
    activeController = controller;
    const signal = controller.signal;
    const maxFailures = Math.max(1, Math.min(10, Number(options.maxConsecutiveFailures) || DEFAULT_MAX_FAILURES));
    const authorizationExpiresAt = plan.expiresAt;
    const maxMessages = plan.limit;
    let processed = 0;
    let failed = 0;
    let consecutiveFailures = 0;
    let lastUnsendAt = 0;

    publish({
      status: 'preparing',
      processed: 0,
      failed: 0,
      consecutiveFailures: 0,
      current: null,
      message: 'Loading the conversation…',
      startedAt: new Date().toISOString(),
      finishedAt: null,
      canStop: true,
    });

    try {
      const history = await loadAllHistory(context, signal);
      const resolvedCount = candidateRows(context.scroller).length;
      if (!history.complete || resolvedCount > MAX_PLAN_MESSAGES) {
        throw new Error('The full conversation could not be revalidated within the bounded history check.');
      }
      const currentEligibleCount = resolvedCount;
      if (currentEligibleCount !== plan.eligibleCount) {
        throw new Error('The eligible sent-message count changed after review. Check the conversation again.');
      }
      if (plan.scope === 'newest') {
        const reversed = reversedLayout(context.scroller);
        context.scroller.scrollTop = newestOffset(context.scroller, reversed);
        dispatch(context.scroller, new Event('scroll', { bubbles: true }));
        await delay(100, signal);
      }
      while (!signal.aborted && processed < maxMessages && consecutiveFailures < maxFailures) {
        if (authorizationExpiresAt <= Date.now()) {
          throw new Error('Live authorization expired before the next message.');
        }
        const stop = sessionStop(expectedThreadId);
        if (stop) throw new Error(stop);
        const row = await nextSentRow(
          context,
          signal,
          plan.scope === 'newest' ? 'newest' : 'oldest',
        );
        if (!row) break;
        const label = preview(row);
        const elapsed = Date.now() - lastUnsendAt;
        const wait = lastUnsendAt
          ? Math.max(0, randomDelay(options.minDelayMs, options.maxDelayMs) - elapsed)
          : 0;
        if (wait) {
          publish({
            status: 'waiting',
            current: label,
            message: `Waiting ${(wait / 1_000).toFixed(1)}s before the next message…`,
          });
          await delay(wait, signal);
        }
        if (authorizationExpiresAt <= Date.now()) {
          throw new Error('Live authorization expired before the next message.');
        }

        publish({ status: 'running', current: label, message: `Unsending message ${processed + 1}…` });
        try {
          // unsendRow already proves the removal: the confirmation dialog
          // closed and the row either went away or lost its content and menu.
          // Re-checking isConnected here rejected every success, because
          // Instagram leaves an "unsent" placeholder row in the thread.
          await unsendRow(row, signal, expectedThreadId, authorizationExpiresAt);
          processed += 1;
          consecutiveFailures = 0;
          lastUnsendAt = Date.now();
          publish({
            status: 'running',
            processed,
            failed,
            consecutiveFailures,
            current: null,
            message: `${processed} message${processed === 1 ? '' : 's'} unsent`,
          });
        } catch (error) {
          if (signal.aborted) throw error;
          failed += 1;
          consecutiveFailures += 1;
          const backoff = Math.min(60_000, 3_000 * (2 ** (consecutiveFailures - 1)));
          publish({
            status: 'waiting',
            failed,
            consecutiveFailures,
            current: label,
            message: `Message could not be removed. Retrying after ${Math.round(backoff / 1_000)}s (${consecutiveFailures}/${maxFailures})…`,
          });
          await delay(backoff, signal);
        }
      }

      if (signal.aborted) {
        publish({
          status: 'stopped',
          message: `Stopped. ${processed} message${processed === 1 ? '' : 's'} unsent.`,
          processed,
          failed,
          current: null,
          canStop: false,
          finishedAt: new Date().toISOString(),
        });
      } else if (consecutiveFailures >= maxFailures) {
        publish({
          status: 'error',
          message: `Stopped after ${consecutiveFailures} consecutive failures. ${processed} message${processed === 1 ? '' : 's'} unsent.`,
          processed,
          failed,
          current: null,
          canStop: false,
          finishedAt: new Date().toISOString(),
        });
      } else {
        publish({
          status: 'completed',
          message: `Done. ${processed} message${processed === 1 ? '' : 's'} unsent.`,
          processed,
          failed,
          current: null,
          canStop: false,
          finishedAt: new Date().toISOString(),
        });
      }
    } catch (error) {
      if (error?.name === 'AbortError' || signal.aborted) {
        publish({
          status: 'stopped',
          message: `Stopped. ${processed} message${processed === 1 ? '' : 's'} unsent.`,
          processed,
          failed,
          current: null,
          canStop: false,
          finishedAt: new Date().toISOString(),
        });
      } else {
        publish({
          status: 'error',
          message: `${error.message || 'The conversation changed unexpectedly.'} ${processed} message${processed === 1 ? '' : 's'} unsent.`,
          processed,
          failed,
          current: null,
          canStop: false,
          finishedAt: new Date().toISOString(),
        });
      }
    } finally {
      if (activeController === controller) activeController = null;
      for (const row of document.querySelectorAll(`[${ACTIVE_ATTRIBUTE}]`)) row.removeAttribute(ACTIVE_ATTRIBUTE);
    }
    return snapshot();
  }

  function stop() {
    if (!activeController || activeController.signal.aborted) return false;
    publish({ status: 'stopping', message: 'Stopping after the current step…', canStop: false });
    activeController.abort('Stopped by user');
    return true;
  }

  function inspect() {
    const context = threadContext();
    if (!context.ok) return { ready: false, reason: context.reason, visibleSent: 0 };
    return {
      ready: true,
      reason: 'Conversation ready',
      threadId: context.threadId,
      visibleSent: candidateRows(context.scroller).filter(isVisible).length,
      scrollable: context.scroller.scrollHeight > context.scroller.clientHeight + 50,
    };
  }

  const publicApi = { createPlan, inspect, inspectAll, snapshot, start, stop, subscribe };
  if (globalThis.__instaAioTestHooks === true) {
    publicApi.__test = Object.freeze({
      deepestMessageContainer,
      hasMessageContent,
      isVisible,
      nextSentRow,
      reversedLayout,
      rowNeedsReposition,
      sentByCurrentUser,
    });
  }
  Object.defineProperty(globalThis, 'InstaAioDmThreadUnsender', {
    configurable: false,
    enumerable: false,
    value: Object.freeze(publicApi),
    writable: false,
  });
})();

(() => {
  'use strict';

  // The generated userscript uses the existing toolbox shell. This small layer
  // swaps its DM controls to the shared thread runner and applies Instagram's
  // own design tokens without duplicating the toolbox implementation.
  if (typeof document === 'undefined' || typeof MutationObserver === 'undefined') return;
  const ROOT_ID = 'insta-aio-userscript-root';
  let installed = false;

  function applyUserscriptEnhancement(host) {
    if (installed || !host?.shadowRoot || !globalThis.InstaAioDmThreadUnsender) return;
    installed = true;
    const shadow = host.shadowRoot;
    const runner = globalThis.InstaAioDmThreadUnsender;
    const liveAuthority = globalThis.InstaAioUserscriptLiveAuthority;
    let reviewedPreview = null;
    const query = (selector) => shadow.querySelector(selector);
    const setText = (role, value) => {
      const element = query(`[data-role="${role}"]`);
      if (element) element.textContent = String(value ?? '');
    };

    const style = document.createElement('style');
    style.id = 'insta-aio-instagram-design-v2';
    style.textContent = `
      :host {
        color-scheme: light dark;
        font-family: var(--aio-font, var(--font-family-system, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif));
      }
      .panel {
        border-color: var(--aio-line) !important;
        border-radius: 16px !important;
        background: color-mix(in srgb, var(--aio-bg) var(--aio-alpha), transparent) !important;
        color: var(--aio-text) !important;
        box-shadow: 0 12px 38px rgba(0,0,0,.18) !important;
        font-family: inherit !important;
        animation: aio-instagram-enter 160ms cubic-bezier(.2,.8,.2,1);
      }
      .header, .footer, .tabs, .run-panel {
        border-color: var(--aio-line) !important;
        background: color-mix(in srgb, var(--aio-bg) var(--aio-alpha-strong), transparent) !important;
      }
      .header p, .lead, .card p, .metric span, .field label, .footer, .list small, .tool span {
        color: var(--aio-text-muted) !important;
      }
      .tab { color: var(--aio-text-muted) !important; transition: color 140ms ease, background 140ms ease; }
      .tab[aria-selected="true"] {
        border-bottom-color: var(--aio-text) !important;
        background: transparent !important;
        color: var(--aio-text) !important;
      }
      .card, .tool, .metric, select, input {
        border-color: var(--aio-line) !important;
        background: color-mix(in srgb, var(--aio-bg-raised) var(--aio-alpha-strong), transparent) !important;
        color: var(--aio-text) !important;
      }
      .tool, .card, .metric { border-radius: 12px !important; }
      .tool { transition: transform 140ms ease, background 140ms ease; }
      .tool:hover { transform: translateY(-1px); background: var(--aio-bg-sunken) !important; }
      .button, .file {
        min-height: 44px !important;
        border-color: var(--aio-line) !important;
        border-radius: 8px !important;
        background: var(--aio-bg-sunken) !important;
        color: var(--aio-text) !important;
        font-size: var(--system-14-font-size, 14px) !important;
        font-weight: 600 !important;
        transition: filter 140ms ease, transform 140ms ease, opacity 140ms ease !important;
      }
      .button:hover, .file:hover { filter: brightness(.97); }
      .button.primary {
        border-color: var(--aio-accent) !important;
        background: var(--aio-accent) !important;
        color: var(--aio-on-accent) !important;
      }
      .button.danger {
        border-color: var(--aio-danger, #c9362b) !important;
        background: var(--aio-danger, #c9362b) !important;
        color: #fff !important;
      }
      .launcher {
        border-color: var(--aio-line) !important;
        border-radius: 50% !important;
        background: var(--aio-bg) !important;
        color: var(--aio-text) !important;
        box-shadow: 0 6px 20px rgba(0,0,0,.16) !important;
        transition: transform 140ms ease, box-shadow 140ms ease !important;
      }
      .launcher:hover { transform: translateY(-1px); box-shadow: 0 8px 24px rgba(0,0,0,.2) !important; }
      .mode { border-color: var(--aio-line) !important; color: var(--aio-text-muted) !important; }
      .notice { border-left: 0 !important; border: 1px solid var(--aio-line) !important; border-radius: 10px; background: var(--aio-bg-sunken) !important; color: var(--aio-text) !important; }
      .run-bar { background: var(--aio-line) !important; }
      .run-bar span { background: var(--aio-accent) !important; }
      @keyframes aio-instagram-enter { from { opacity: 0; transform: translateY(6px) scale(.99); } to { opacity: 1; transform: none; } }
      @media (prefers-color-scheme: dark) {
        :host { color-scheme: dark; }
      }
      @media (prefers-reduced-motion: reduce) {
        .panel, .tool, .button, .file, .launcher { animation: none !important; transition: none !important; }
      }
    `;
    shadow.append(style);

    const headerTitle = query('.header h1');
    if (headerTitle) headerTitle.textContent = 'Instagram Toolbox';
    const headerSubtitle = query('.header p');
    if (headerSubtitle) headerSubtitle.textContent = 'Follower, account, and message tools';
    const nowLead = query('[data-panel="now"] .lead');
    if (nowLead) nowLead.textContent = 'Choose a tool. Your lists and progress stay in this browser.';
    const messageLead = query('[data-panel="messages"] .lead');
    if (messageLead) messageLead.innerHTML = '<strong>DM Unsend.</strong> Resolve this conversation and its eligible sent-message count before reviewing any permanent action.';

    const scanButton = query('[data-action="scan-sent"]');
    if (scanButton) scanButton.textContent = 'Check conversation';
    const executeButton = query('[data-action="run-unsend"]');
    const planPanel = query('[data-role="unsend-plan"]');
    const countField = query('[data-role="unsend-count"]')?.closest('.field');
    const renderScope = () => {
      if (countField) countField.hidden = (query('[data-role="unsend-scope"]')?.value || 'all') === 'all';
    };
    renderScope();
    const messageNotice = query('[data-panel="messages"] .notice');
    if (messageNotice) {
      messageNotice.textContent = 'Only messages sent by this account are processed. You can stop at any time. Unsending is permanent.';
    }

    function renderRun(next) {
      const running = ['preparing', 'running', 'waiting', 'stopping'].includes(next.status);
      const panel = query('[data-role="run-panel"]');
      if (panel) panel.hidden = !running && !['completed', 'error', 'stopped'].includes(next.status);
      setText('run-title', running ? 'DM Unsend in progress' : 'DM Unsend');
      setText('run-detail', next.message);
      const fill = query('[data-role="run-fill"]');
      if (fill) fill.style.width = running ? `${Math.min(94, 12 + (next.processed * 4))}%` : '100%';
      const results = query('[data-role="run-results"]');
      if (results) {
        results.replaceChildren();
        const item = document.createElement('li');
        item.textContent = `${next.processed} unsent${next.failed ? ` · ${next.failed} failed attempt${next.failed === 1 ? '' : 's'}` : ''}`;
        results.append(item);
      }
      if (executeButton) {
        executeButton.textContent = running ? 'Stop unsending' : 'Review Unsend plan';
        executeButton.disabled = next.status === 'stopping' || (!running && !reviewedPreview);
      }
      setText('status', next.message);
    }

    runner.subscribe((next) => {
      const running = ['preparing', 'running', 'waiting', 'stopping'].includes(next.status);
      liveAuthority?.setExternalRunActive?.(running);
      renderRun(next);
    });

    shadow.addEventListener('click', async (event) => {
      const target = event.target.closest?.('[data-action]');
      if (!target) return;
      const action = target.dataset.action;
      if (!['scan-sent', 'run-unsend', 'stop-run'].includes(action)) return;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();

      if (action === 'stop-run' || (action === 'run-unsend' && runner.snapshot().canStop)) {
        runner.stop();
        return;
      }
      if (action === 'scan-sent') {
        reviewedPreview = null;
        if (planPanel) planPanel.hidden = true;
        const result = await runner.inspectAll();
        if (!result.ready) {
          setText('status', result.reason);
          return;
        }
        reviewedPreview = result.complete ? result : null;
        if (planPanel) planPanel.hidden = !result.complete || result.eligibleCount < 1;
        if (executeButton) executeButton.disabled = !result.complete || result.eligibleCount < 1;
        const summary = query('[data-role="dm-summary"]');
        if (summary) summary.hidden = false;
        setText('dm-summary-title', `Thread ${result.threadId}`);
        setText('dm-summary-detail', result.complete
          ? `${result.eligibleCount} sent message${result.eligibleCount === 1 ? '' : 's'} eligible · read-only check complete`
          : `${result.eligibleCount} found · completeness not proven · destructive plan locked`);
        setText('status', result.complete
          ? `${result.eligibleCount} sent message${result.eligibleCount === 1 ? '' : 's'} eligible. Nothing was changed.`
          : `${result.reason} Nothing was changed.`);
        return;
      }
      if (!liveAuthority?.canStart?.()) {
        setText('status', 'Live actions are locked. Open toolbox preferences and enable the 15-minute live window first.');
        return;
      }
      const inspection = runner.inspect();
      if (!reviewedPreview || !inspection.ready || inspection.threadId !== reviewedPreview.threadId) {
        reviewedPreview = null;
        if (planPanel) planPanel.hidden = true;
        setText('status', inspection.reason || 'The conversation changed. Check it again before reviewing an Unsend plan.');
        return;
      }
      const scope = query('[data-role="unsend-scope"]')?.value || 'all';
      const requested = Math.max(1, Math.floor(Number(query('[data-role="unsend-count"]')?.value) || 1));
      const limit = scope === 'all'
        ? reviewedPreview.eligibleCount
        : Math.min(reviewedPreview.eligibleCount, requested);
      const plan = runner.createPlan({
        threadId: reviewedPreview.threadId,
        scope,
        limit,
        eligibleCount: reviewedPreview.eligibleCount,
        expiresAt: liveAuthority.expiresAt(),
      });
      if (!plan) {
        setText('status', 'The live window or conversation review expired. Check the conversation again.');
        return;
      }
      const scopeLabel = scope === 'all'
        ? 'all eligible sent messages'
        : `${scope} ${limit} sent message${limit === 1 ? '' : 's'}`;
      const phrase = `UNSEND ${limit} ${plan.reviewedDigest}`;
      // eslint-disable-next-line no-alert
      const entered = globalThis.prompt(
        `Type this count-specific phrase to continue for thread ${plan.threadId}:\n\n${phrase}`,
        '',
      );
      if (entered == null) {
        setText('status', 'Cancelled. Nothing was changed.');
        return;
      }
      if (String(entered).trim() !== phrase) {
        setText('status', 'Unsend stayed locked because the count-specific phrase did not match.');
        return;
      }
      // eslint-disable-next-line no-alert
      const confirmed = globalThis.confirm(
        `Permanently unsend ${scopeLabel} from thread ${plan.threadId}?\n\n`
        + `Reviewed digest: ${plan.reviewedDigest}. The eligible count is revalidated before any message menu opens.`,
      );
      if (!confirmed) {
        setText('status', 'Cancelled. Nothing was changed.');
        return;
      }
      const reservation = liveAuthority.reserveUnsendPlan?.(plan);
      if (!reservation?.ok) {
        setText('status', `${reservation?.reason || 'The reviewed plan could not be reserved.'} Nothing was changed.`);
        return;
      }
      reviewedPreview = null;
      if (planPanel) planPanel.hidden = true;
      await runner.start({
        plan,
        minDelayMs: reservation.minDelayMs,
        maxDelayMs: reservation.maxDelayMs,
      });
    }, true);

    shadow.addEventListener('change', (event) => {
      if (event.target.matches?.('[data-role="unsend-scope"]')) renderScope();
    });
  }

  function findRoot() {
    const host = document.getElementById(ROOT_ID);
    if (host) applyUserscriptEnhancement(host);
  }

  const observer = new MutationObserver(findRoot);
  observer.observe(document.documentElement, { childList: true, subtree: true });
  queueMicrotask(findRoot);
})();

(() => {
  if (globalThis.__instaAioInspectorInstalled) return;
  const actionLabels = globalThis.__instaAioActionLabels;
  if (
    !actionLabels
    || typeof actionLabels.isDmUnsendLabel !== 'function'
    || typeof actionLabels.normalizeActionLabel !== 'function'
    || typeof actionLabels.relationshipForLabel !== 'function'
  ) return;
  globalThis.__instaAioInspectorInstalled = true;

  const RESERVED = new Set([
    'accounts', 'about', 'api', 'developer', 'direct', 'emails', 'explore',
    'challenge', 'directory', 'graphql', 'legal', 'p', 'privacy', 'reel',
    'reels', 'settings', 'static', 'stories', 'terms', 'tv', 'web',
  ]);
  const PROFILE_RESOLUTION_TTL_MS = 20_000;
  const DM_RESOLUTION_TTL_MS = 20_000;
  const profileResolutions = new Map();
  const dmResolutions = new Map();
  const DM_MESSAGE_ID_ATTRIBUTES = Object.freeze([
    'data-message-id',
    'data-item-id',
  ]);
  const DM_TIMESTAMP_ATTRIBUTES = Object.freeze([
    'data-timestamp-ms',
    'data-timestamp',
  ]);
  const DM_ACTION_LABEL_SELECTORS = Object.freeze([
    "[aria-label^='See more options for message']",
    "[aria-label*='more options']",
    "[aria-label*='More']",
    "[aria-label*='Altre opzioni']",
    "[aria-label*='opzioni']",
    "[aria-label*='opciones']",
    "[aria-label*='options']",
  ]);

  function normalizeUsername(value) {
    const username = String(value || '')
      .replace(/^https?:\/\/www\.instagram\.com\//i, '')
      .replace(/^@/, '')
      .replace(/^\/+/, '')
      .split(/[/?#]/)[0]
      .trim()
      .toLowerCase();
    return /^[a-z0-9._]{1,30}$/i.test(username) && !RESERVED.has(username)
      ? username
      : '';
  }

  function visibleText(element) {
    if (!element || element.getAttribute('aria-hidden') === 'true') return '';
    const style = getComputedStyle(element);
    if (style.display === 'none' || style.visibility === 'hidden') return '';
    return String(element.textContent || element.getAttribute('aria-label') || '').trim();
  }

  function resolutionToken() {
    try {
      const secureCrypto = globalThis.crypto;
      if (typeof secureCrypto?.randomUUID === 'function') {
        const token = secureCrypto.randomUUID();
        if (/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(token)) {
          return token;
        }
      }
      if (typeof secureCrypto?.getRandomValues !== 'function') return null;
      const bytes = new Uint8Array(16);
      secureCrypto.getRandomValues(bytes);
      if (bytes.every((byte) => byte === 0)) return null;
      return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
    } catch {
      return null;
    }
  }

  function dmContentDigest(value) {
    const text = String(value ?? '');
    let hash = 0x811c9dc5;
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
    if (!/^\/direct\/t\/[^/?#]+\/?$/i.test(pathname)) return null;
    return directThreadId(pathname);
  }

  function normalizedDmTimestamp(value) {
    if (value == null || value === '') return null;
    const numeric = Number(value);
    if (Number.isFinite(numeric)) {
      if (numeric > 100_000_000_000_000) return Math.floor(numeric / 1000);
      return numeric < 10_000_000_000 ? numeric * 1000 : numeric;
    }
    const parsed = Date.parse(String(value));
    return Number.isFinite(parsed) ? parsed : null;
  }

  function dmMessageId(element) {
    for (const attribute of DM_MESSAGE_ID_ATTRIBUTES) {
      const value = String(element?.getAttribute?.(attribute) || '').trim();
      if (value) return { attribute, value };
    }
    return null;
  }

  function dmMessageTimestamp(identityNode, row) {
    for (const element of [identityNode, row]) {
      for (const attribute of DM_TIMESTAMP_ATTRIBUTES) {
        const timestamp = normalizedDmTimestamp(element?.getAttribute?.(attribute));
        if (timestamp != null) return { basis: attribute, timestamp };
      }
    }
    const time = row?.querySelector?.('time[datetime]');
    const timestamp = normalizedDmTimestamp(time?.getAttribute?.('datetime'));
    return timestamp == null ? null : { basis: 'time[datetime]', timestamp };
  }

  function dmOwnership(row, identityNode) {
    const explicit = String(row?.getAttribute?.('data-sent-by-me') || '').toLowerCase();
    if (explicit === 'true') return { sentByMe: true, basis: 'data-sent-by-me' };
    if (explicit === 'false') return { sentByMe: false, basis: 'data-sent-by-me' };

    // The source script used flex-end as sent-message evidence. Keep that evidence
    // only on the exact identity-to-row ancestor chain; unrelated descendant
    // toolbars must never confer ownership on a received message.
    const ownershipChain = [];
    let element = identityNode;
    while (element && row?.contains?.(element)) {
      ownershipChain.push(element);
      if (element === row) break;
      element = element.parentElement || element.parentNode || element.parent || null;
    }
    if (ownershipChain.at(-1) !== row) return { sentByMe: null, basis: null };
    for (const element of ownershipChain) {
      if (getComputedStyle(element).justifyContent === 'flex-end') {
        return { sentByMe: true, basis: 'identity-ancestor-flex-end-layout' };
      }
    }
    return { sentByMe: null, basis: null };
  }

  function dmContentCandidates(row) {
    const explicitlyMarked = [...(row?.querySelectorAll?.('[data-insta-aio-message-content]') || [])];
    const nodes = explicitlyMarked.length
      ? explicitlyMarked
      : [...(row?.querySelectorAll?.('[dir="auto"]') || [])]
        .filter((element) => !element.querySelector?.('[dir="auto"]'))
        .filter((element) => !element.closest?.('header, nav, button, [role="button"], a, time'));
    return [...new Set(nodes.map(visibleText).filter((text) => text && text.length <= 500))];
  }

  function resolveReviewedDmItem(item) {
    const session = inspectSession();
    if (session.sessionExpired || session.challenge || session.actionBlocked || session.rateLimited) {
      return { observation: session, candidate: null };
    }
    const observedThreadId = currentDirectThreadId();
    if (!observedThreadId) {
      return {
        observation: { ...session, unexpectedUi: true, reason: 'open-an-instagram-conversation' },
        candidate: null,
      };
    }

    const expectedThreadId = directThreadId(item?.conversationId);
    if (!expectedThreadId) {
      return {
        observation: { ...session, ambiguous: true, reason: 'conversation-id-unresolved' },
        candidate: null,
      };
    }
    if (expectedThreadId !== observedThreadId) {
      return {
        observation: {
          ...session,
          ambiguous: true,
          reason: 'wrong-conversation',
          evidence: { expectedThreadId, observedThreadId },
        },
        candidate: null,
      };
    }

    const scope = document.querySelector('[data-pagelet="IGDMessagesList"]')
      || document.querySelector('main');
    const identitySelector = DM_MESSAGE_ID_ATTRIBUTES
      .map((attribute) => `[${attribute}]`)
      .join(', ');
    const identityNodes = [...(scope?.querySelectorAll?.(identitySelector) || [])]
      .filter((element) => visibleText(element));
    if (!identityNodes.length) {
      return {
        observation: {
          ...session,
          conversationId: String(item?.conversationId || ''),
          messageId: String(item?.messageId || ''),
          missing: true,
          exactIdentityAvailable: false,
          ownershipAvailable: false,
          reason: 'exact-message-identity-unavailable',
          evidence: { observedThreadId, stableIdentityNodeCount: 0 },
        },
        candidate: null,
      };
    }

    const candidates = identityNodes.map((identityNode) => {
      const row = identityNode.closest?.('[role="row"], [role="listitem"]') || identityNode;
      const identity = dmMessageId(identityNode) || dmMessageId(row);
      const timestamp = dmMessageTimestamp(identityNode, row);
      const ownership = dmOwnership(row, identityNode);
      const contents = dmContentCandidates(row);
      return {
        contentMatches: contents.filter((content) => dmContentDigest(content) === item?.contentDigest),
        identity,
        identityNode,
        ownership,
        row,
        timestamp,
      };
    }).filter((candidate) => (
      candidate.identity?.value === String(item?.messageId || '')
      && candidate.timestamp?.timestamp === Number(item?.timestamp)
      && candidate.contentMatches.length === 1
    ));

    if (!candidates.length) {
      return {
        observation: {
          ...session,
          conversationId: String(item?.conversationId || ''),
          messageId: String(item?.messageId || ''),
          missing: true,
          exactIdentityAvailable: true,
          reason: 'exact-message-not-found',
          evidence: { observedThreadId, stableIdentityNodeCount: identityNodes.length },
        },
        candidate: null,
      };
    }
    if (candidates.length !== 1) {
      return {
        observation: {
          ...session,
          ambiguous: true,
          exactIdentityAvailable: true,
          reason: 'exact-message-ambiguous',
          evidence: { observedThreadId, exactCandidateCount: candidates.length },
        },
        candidate: null,
      };
    }

    const candidate = candidates[0];
    if (candidate.ownership.sentByMe !== true) {
      return {
        observation: {
          ...session,
          sentByMe: candidate.ownership.sentByMe,
          exactIdentityAvailable: true,
          ownershipAvailable: candidate.ownership.sentByMe === false,
          reason: candidate.ownership.sentByMe === false
            ? 'received-message'
            : 'message-ownership-unavailable',
        },
        candidate: null,
      };
    }

    return {
      observation: {
        ...session,
        ambiguous: false,
        unexpectedUi: false,
        conversationId: String(item.conversationId),
        messageId: String(item.messageId),
        timestamp: Number(item.timestamp),
        contentDigest: String(item.contentDigest),
        contentLength: candidate.contentMatches[0].length,
        sentByMe: true,
        exactIdentityAvailable: true,
        ownershipAvailable: true,
        evidence: {
          source: 'extension-stable-visible-message-identity',
          observedThreadId,
          identityAttribute: candidate.identity.attribute,
          timestampBasis: candidate.timestamp.basis,
          ownershipBasis: candidate.ownership.basis,
          capturedAt: new Date().toISOString(),
        },
      },
      candidate,
    };
  }

  function pruneDmResolutions(now = Date.now()) {
    for (const [token, resolution] of dmResolutions) {
      if (now - resolution.createdAt > DM_RESOLUTION_TTL_MS) {
        dmResolutions.delete(token);
      }
    }
  }

  function inspectReviewedDmItem(item) {
    const resolved = resolveReviewedDmItem(item);
    if (!resolved.candidate) return resolved.observation;
    pruneDmResolutions();
    const token = resolutionToken();
    if (!token) {
      return {
        ...resolved.observation,
        unexpectedUi: true,
        reason: 'secure-random-unavailable',
        resolutionToken: null,
      };
    }
    dmResolutions.set(token, {
      contentDigest: String(item.contentDigest),
      conversationId: String(item.conversationId),
      createdAt: Date.now(),
      identityNode: resolved.candidate.identityNode,
      messageId: String(item.messageId),
      pathname: location.pathname,
      row: resolved.candidate.row,
      timestamp: Number(item.timestamp),
    });
    return { ...resolved.observation, resolutionToken: token };
  }

  function reviewedTargetElement({ accountIntent = null, dmIntent = null } = {}) {
    if (dmIntent) {
      const exact = resolveReviewedDmItem(dmIntent).candidate?.row || null;
      if (exact) return exact;
      const scope = document.querySelector('[data-pagelet="IGDMessagesList"]')
        || document.querySelector('main');
      const identitySelector = DM_MESSAGE_ID_ATTRIBUTES
        .map((attribute) => `[${attribute}]`)
        .join(', ');
      const rows = new Set(
        [...(scope?.querySelectorAll?.(identitySelector) || [])]
          .filter((element) => visibleText(element))
          .filter((element) => {
            const row = element.closest?.('[role="row"], [role="listitem"]') || element;
            return (dmMessageId(element) || dmMessageId(row))?.value === String(dmIntent.messageId || '');
          })
          .map((element) => element.closest?.('[role="row"], [role="listitem"]') || element),
      );
      return rows.size === 1 ? [...rows][0] : null;
    }
    if (pageKind() === 'messages') {
      const scope = document.querySelector('[data-pagelet="IGDMessagesList"]')
        || document.querySelector('main');
      const row = [...(scope?.querySelectorAll?.('[role="row"], [role="listitem"]') || [])]
        .find((element) => visibleText(element));
      if (row) return row;
    }
    const usernames = [...new Set([
      normalizeUsername(accountIntent?.username),
      normalizeUsername(location.pathname),
    ].filter(Boolean))];
    for (const username of usernames) {
      const relationship = relationshipFromButtons(username);
      if (!relationship.ambiguous && relationship.control) return relationship.control;
    }
    return null;
  }

  function dmResolutionMatches(resolution, item) {
    if (
      !resolution
      || !resolution.row?.isConnected
      || !resolution.identityNode?.isConnected
      || resolution.pathname !== location.pathname
      || resolution.conversationId !== String(item?.conversationId || '')
      || resolution.messageId !== String(item?.messageId || '')
      || resolution.timestamp !== Number(item?.timestamp)
      || resolution.contentDigest !== String(item?.contentDigest || '')
      || item?.sentByMe !== true
    ) return false;
    const current = resolveReviewedDmItem(item);
    return Boolean(
      current.candidate
      && current.candidate.row === resolution.row
      && current.candidate.identityNode === resolution.identityNode,
    );
  }

  function pruneProfileResolutions(now = Date.now()) {
    for (const [token, resolution] of profileResolutions) {
      if (now - resolution.createdAt > PROFILE_RESOLUTION_TTL_MS) {
        profileResolutions.delete(token);
      }
    }
  }

  function inspectSession() {
    const path = location.pathname.toLowerCase();
    const pageText = String(document.body?.innerText || '').toLowerCase();
    return {
      sessionExpired: path.startsWith('/accounts/login') || Boolean(document.querySelector('input[name="username"]')),
      challenge: path.startsWith('/challenge') || path.startsWith('/accounts/suspended'),
      actionBlocked: pageText.includes('we restrict certain activity'),
      rateLimited: pageText.includes('please wait a few minutes'),
      capturedAt: new Date().toISOString(),
    };
  }

  function verifiedProfileHeader(username) {
    const normalized = normalizeUsername(username);
    if (!normalized) return { root: null, observedProfileCount: 0 };
    const headers = [...document.querySelectorAll('main header')]
      .filter((header) => {
        if (!visibleText(header)) return false;
        return [...header.querySelectorAll('a[href], h1, h2, [role="heading"]')]
          .some((element) => {
            const hrefUsername = normalizeUsername(element.getAttribute?.('href'));
            const textUsername = normalizeUsername(visibleText(element));
            return hrefUsername === normalized || textUsername === normalized;
          });
      });
    return {
      root: headers.length === 1 ? headers[0] : null,
      observedProfileCount: headers.length,
    };
  }

  function relationshipFromButtons(expectedUsername) {
    const profile = verifiedProfileHeader(expectedUsername);
    if (!profile.root) {
      return {
        relationship: null,
        ambiguous: true,
        observedLabels: [],
        observedControlCount: 0,
        observedProfileCount: profile.observedProfileCount,
        profileIdentityVerified: false,
        profileRoot: null,
        control: null,
      };
    }
    const candidates = [...profile.root.querySelectorAll('button, [role="button"]')]
      .map((element) => ({
        element,
        label: actionLabels.normalizeActionLabel(visibleText(element)),
      }))
      .filter(({ label }) => actionLabels.relationshipForLabel(label));
    const uniqueLabels = [...new Set(candidates.map(({ label }) => label))];
    if (candidates.length !== 1 || uniqueLabels.length !== 1) {
      return {
        relationship: null,
        ambiguous: true,
        observedLabels: uniqueLabels,
        observedControlCount: candidates.length,
        observedProfileCount: profile.observedProfileCount,
        profileIdentityVerified: true,
        profileRoot: profile.root,
        control: null,
      };
    }
    const label = uniqueLabels[0];
    return {
      relationship: actionLabels.relationshipForLabel(label),
      ambiguous: false,
      observedLabels: uniqueLabels,
      observedControlCount: 1,
      observedProfileCount: profile.observedProfileCount,
      profileIdentityVerified: true,
      profileRoot: profile.root,
      control: candidates[0].element,
    };
  }

  function inspectProfile(expectedUsername) {
    const session = inspectSession();
    if (session.sessionExpired || session.challenge || session.actionBlocked || session.rateLimited) {
      return session;
    }
    const username = normalizeUsername(location.pathname);
    const relationship = relationshipFromButtons(username);
    pruneProfileResolutions();
    let token = null;
    let secureRandomUnavailable = false;
    if (!relationship.ambiguous && username && relationship.control) {
      token = resolutionToken();
      if (token) {
        profileResolutions.set(token, {
          control: relationship.control,
          createdAt: Date.now(),
          pathname: location.pathname,
          profileRoot: relationship.profileRoot,
          relationship: relationship.relationship,
          username,
        });
      } else {
        secureRandomUnavailable = true;
      }
    }
    return {
      ...session,
      relationship: relationship.relationship,
      ambiguous: relationship.ambiguous,
      observedLabels: relationship.observedLabels,
      observedControlCount: relationship.observedControlCount,
      observedProfileCount: relationship.observedProfileCount,
      profileIdentityVerified: relationship.profileIdentityVerified,
      username,
      unexpectedUi: secureRandomUnavailable
        || !document.querySelector('main')
        || !relationship.profileIdentityVerified,
      reason: secureRandomUnavailable ? 'secure-random-unavailable' : null,
      evidence: {
        url: location.href,
        expectedUsername: normalizeUsername(expectedUsername),
        observedUsername: username,
        observedLabels: relationship.observedLabels,
        observedControlCount: relationship.observedControlCount,
        observedProfileCount: relationship.observedProfileCount,
        profileIdentityVerified: relationship.profileIdentityVerified,
        capturedAt: new Date().toISOString(),
      },
      resolutionToken: token,
    };
  }

  function waitFor(check, timeoutMs) {
    const startedAt = Date.now();
    return new Promise((resolve) => {
      const inspect = () => {
        const value = check();
        if (value || Date.now() - startedAt >= timeoutMs) {
          resolve(value || null);
          return;
        }
        setTimeout(inspect, 100);
      };
      inspect();
    });
  }

  function visibleDialogs() {
    return [...document.querySelectorAll('[role="dialog"]')]
      .filter((dialog) => visibleText(dialog));
  }

  function dialogNamesUsername(dialog, username) {
    const normalized = normalizeUsername(username);
    if (!normalized) return false;
    if ([...dialog.querySelectorAll('a[href]')].some((anchor) => (
      normalizeUsername(anchor.getAttribute('href')) === normalized
    ))) return true;
    const escaped = normalized.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(^|[^a-z0-9._])@?${escaped}(?=$|[^a-z0-9._])`, 'i')
      .test(visibleText(dialog));
  }

  function exactUnfollowConfirmation(username, excludedDialogs = new Set()) {
    const dialogs = visibleDialogs()
      .filter((dialog) => !excludedDialogs.has(dialog))
      .filter((dialog) => dialogNamesUsername(dialog, username));
    if (dialogs.length !== 1) return null;
    const controls = [...dialogs[0].querySelectorAll('button, [role="button"]')]
      .filter((element) => visibleText(element).toLocaleLowerCase() === 'unfollow');
    return controls.length === 1 ? controls[0] : null;
  }

  function activateLiveControl(control) {
    control.click();
  }

  function visibleMenus() {
    return [...document.querySelectorAll('[role="menu"], [role="listbox"]')]
      .filter((menu) => visibleText(menu));
  }

  function liveControlWithin(element, scope) {
    const control = element?.closest?.('button, [role="button"], [role="menuitem"]');
    return control && scope?.contains?.(control) ? control : null;
  }

  function idReferences(element, attribute) {
    return new Set(String(element?.getAttribute?.(attribute) || '').split(/\s+/).filter(Boolean));
  }

  function surfaceBoundToControl(surface, control) {
    const surfaceId = String(surface?.getAttribute?.('id') || '').trim();
    const controlId = String(control?.getAttribute?.('id') || '').trim();
    return Boolean(
      (surfaceId && (
        idReferences(control, 'aria-controls').has(surfaceId)
        || idReferences(control, 'aria-owns').has(surfaceId)
      ))
      || (controlId && idReferences(surface, 'aria-labelledby').has(controlId)),
    );
  }

  function exactBoundSurface(surfaces, control, excluded = new Set()) {
    const matches = surfaces.filter((surface) => (
      !excluded.has(surface)
      && surfaceBoundToControl(surface, control)
    ));
    return matches.length === 1 ? matches[0] : null;
  }

  function exactDmActionControls(row) {
    const matches = [];
    for (const selector of DM_ACTION_LABEL_SELECTORS) {
      for (const element of row?.querySelectorAll?.(selector) || []) {
        const control = liveControlWithin(element, row);
        if (control) matches.push(control);
      }
    }
    for (const control of row?.querySelectorAll?.('[role="button"][aria-haspopup="menu"]') || []) {
      matches.push(control);
    }
    return [...new Set(matches)].filter((control) => visibleText(control));
  }

  function exactDmUnsendControls(scope) {
    const controls = [];
    for (const element of scope?.querySelectorAll?.(
      'button, [role="button"], [role="menuitem"], span, div',
    ) || []) {
      if (!actionLabels.isDmUnsendLabel(visibleText(element))) continue;
      const control = liveControlWithin(element, scope);
      if (control) controls.push(control);
    }
    return [...new Set(controls)];
  }

  function hoverExactDmRow(row) {
    const eventTargets = [];
    const queue = [{ element: row, depth: 0 }];
    while (queue.length) {
      const { element, depth } = queue.shift();
      eventTargets.push(element);
      if (depth < 8) {
        for (const child of element.children || []) {
          queue.push({ element: child, depth: depth + 1 });
        }
      }
    }
    for (const target of eventTargets) {
      const rect = target.getBoundingClientRect?.() || { x: 0, y: 0, width: 0, height: 0 };
      const options = {
        bubbles: true,
        cancelable: true,
        clientX: rect.x + (rect.width / 2),
        clientY: rect.y + (rect.height / 2),
        pointerId: 1,
        pointerType: 'mouse',
      };
      if (typeof PointerEvent === 'function') {
        target.dispatchEvent?.(new PointerEvent('pointerenter', { ...options, bubbles: false }));
        target.dispatchEvent?.(new PointerEvent('pointerover', options));
        target.dispatchEvent?.(new PointerEvent('pointermove', options));
      }
      if (typeof MouseEvent === 'function') {
        target.dispatchEvent?.(new MouseEvent('mouseenter', { ...options, bubbles: false }));
        target.dispatchEvent?.(new MouseEvent('mouseover', options));
        target.dispatchEvent?.(new MouseEvent('mousemove', options));
      }
    }
  }

  async function performReviewedDmUnsend(item) {
    const token = String(item?.resolutionToken || '');
    if (
      !token
      || !String(item?.conversationId || '')
      || !String(item?.messageId || '')
      || !Number.isFinite(Number(item?.timestamp))
      || !String(item?.contentDigest || '')
      || item?.sentByMe !== true
    ) {
      return { unexpectedUi: true, reason: 'invalid-live-dm-request' };
    }

    const session = inspectSession();
    if (session.sessionExpired || session.challenge || session.actionBlocked || session.rateLimited) {
      return session;
    }

    pruneDmResolutions();
    const resolution = dmResolutions.get(token);
    dmResolutions.delete(token);
    if (!dmResolutionMatches(resolution, item)) {
      return { ambiguous: true, reason: 'dm-resolution-expired-or-changed' };
    }
    if (visibleDialogs().length || visibleMenus().length) {
      return { unexpectedUi: true, reason: 'preexisting-surface-before-live-unsend' };
    }

    hoverExactDmRow(resolution.row);
    const actionControl = await waitFor(() => {
      const controls = exactDmActionControls(resolution.row);
      return controls.length === 1 ? controls[0] : null;
    }, 1_500);
    if (!actionControl) {
      return { ambiguous: true, reason: 'dm-action-control-not-exact' };
    }
    if (
      !dmResolutionMatches(resolution, item)
      || visibleDialogs().length
      || visibleMenus().length
    ) {
      return { ambiguous: true, reason: 'dm-message-changed-before-menu' };
    }

    const menusBeforeAction = new Set(visibleMenus());
    activateLiveControl(actionControl);
    const menuResult = await waitFor(() => {
      const newMenus = visibleMenus().filter((menu) => !menusBeforeAction.has(menu));
      if (!newMenus.length) return null;
      const menu = exactBoundSurface(newMenus, actionControl);
      if (!menu) return { invalid: true };
      const controls = exactDmUnsendControls(menu);
      return controls.length === 1
        ? { menu, control: controls[0] }
        : { invalid: true };
    }, 3_000);
    if (!menuResult?.menu) {
      return { unexpectedUi: true, reason: 'dm-unsend-menu-not-exact' };
    }
    if (!dmResolutionMatches(resolution, item) || visibleDialogs().length) {
      return { ambiguous: true, reason: 'dm-message-changed-before-unsend-choice' };
    }

    const dialogsBeforeChoice = new Set(visibleDialogs());
    activateLiveControl(menuResult.control);
    const confirmation = await waitFor(() => {
      const newDialogs = visibleDialogs().filter((dialog) => !dialogsBeforeChoice.has(dialog));
      if (!newDialogs.length) return null;
      const dialog = exactBoundSurface(
        newDialogs,
        menuResult.control,
      );
      if (!dialog) return { invalid: true };
      const controls = exactDmUnsendControls(dialog);
      return controls.length === 1 ? { control: controls[0] } : { invalid: true };
    }, 3_000);
    if (!confirmation?.control) {
      return { unexpectedUi: true, reason: 'dm-unsend-confirmation-not-exact' };
    }
    if (!dmResolutionMatches(resolution, item)) {
      return { ambiguous: true, reason: 'dm-message-changed-before-final-confirmation' };
    }

    activateLiveControl(confirmation.control);
    const completion = await waitFor(() => {
      const currentSession = inspectSession();
      if (
        currentSession.sessionExpired
        || currentSession.challenge
        || currentSession.actionBlocked
        || currentSession.rateLimited
      ) return { sessionStop: currentSession };
      const expectedThreadId = directThreadId(item.conversationId);
      const observedThreadId = directThreadId(location.pathname);
      if (!expectedThreadId || expectedThreadId !== observedThreadId) {
        return {
          uncertain: true,
          observation: {
            ambiguous: true,
            reason: 'wrong-conversation-after-unsend',
            evidence: { expectedThreadId, observedThreadId },
          },
        };
      }
      const retainedRowDisconnected = resolution.row?.isConnected === false;
      const retainedIdentityNodeDisconnected = resolution.identityNode?.isConnected === false;
      const current = resolveReviewedDmItem(item);
      if (current.candidate) return null;
      if (!retainedRowDisconnected || !retainedIdentityNodeDisconnected) {
        return current.observation?.missing || current.observation?.reason
          ? { uncertain: true, observation: current.observation }
          : null;
      }
      if (
        current.observation?.ambiguous
        || current.observation?.unexpectedUi
        || current.observation?.exactIdentityAvailable !== true
        || current.observation?.reason !== 'exact-message-not-found'
      ) {
        return { uncertain: true, observation: current.observation };
      }
      return {
        confirmed: true,
        observation: current.observation,
        postcondition: {
          exactCandidateAbsent: true,
          exactThread: true,
          expectedThreadId,
          observedThreadId,
          observationReason: current.observation.reason,
          retainedIdentityNodeDisconnected: true,
          retainedRowDisconnected: true,
        },
      };
    }, 5_000);
    if (completion?.sessionStop) return completion.sessionStop;
    if (!completion?.confirmed) {
      return {
        unexpectedUi: true,
        reason: 'dm-unsend-not-confirmed',
        observation: completion?.observation || null,
      };
    }
    return {
      result: 'unsent',
      conversationId: String(item.conversationId),
      messageId: String(item.messageId),
      postcondition: completion.postcondition,
    };
  }

  async function waitForRelationship(expectedRelationships, username, timeoutMs = 5_000) {
    return waitFor(() => {
      const session = inspectSession();
      if (session.sessionExpired || session.challenge || session.actionBlocked || session.rateLimited) {
        return { sessionStop: session };
      }
      const observed = relationshipFromButtons(username);
      if (!observed.ambiguous && expectedRelationships.includes(observed.relationship)) {
        return { relationship: observed.relationship };
      }
      return null;
    }, timeoutMs);
  }

  async function performReviewedProfileAction(item) {
    const username = normalizeUsername(item?.username);
    const action = String(item?.action || '');
    const token = String(item?.resolutionToken || '');
    if (!username || !['follow', 'unfollow'].includes(action) || !token) {
      return { unexpectedUi: true, reason: 'invalid-live-action-request' };
    }

    const session = inspectSession();
    if (session.sessionExpired || session.challenge || session.actionBlocked || session.rateLimited) {
      return session;
    }

    pruneProfileResolutions();
    const resolution = profileResolutions.get(token);
    profileResolutions.delete(token);
    if (
      !resolution
      || resolution.username !== username
      || resolution.pathname !== location.pathname
      || resolution.relationship !== item.expectedRelationship
      || !resolution.control?.isConnected
    ) {
      return { ambiguous: true, reason: 'profile-resolution-expired-or-changed' };
    }

    const current = relationshipFromButtons(username);
    const expectedRelationship = action === 'follow' ? 'not-following' : 'following';
    if (
      current.ambiguous
      || current.relationship !== expectedRelationship
      || current.relationship !== resolution.relationship
      || current.profileRoot !== resolution.profileRoot
      || current.control !== resolution.control
      || normalizeUsername(location.pathname) !== username
    ) {
      return { ambiguous: true, reason: 'profile-control-changed-before-action' };
    }

    const dialogsBeforeAction = visibleDialogs();
    if (dialogsBeforeAction.length) {
      return { unexpectedUi: true, reason: 'preexisting-dialog-before-live-action' };
    }

    activateLiveControl(current.control);
    if (action === 'follow') {
      const completion = await waitForRelationship(['following', 'requested'], username);
      if (completion?.sessionStop) return completion.sessionStop;
      if (!completion) return { unexpectedUi: true, reason: 'follow-not-confirmed' };
      return {
        result: completion.relationship === 'requested' ? 'follow-requested' : 'followed',
        relationship: completion.relationship,
      };
    }

    const excludedDialogs = new Set(dialogsBeforeAction);
    const confirmation = await waitFor(
      () => exactUnfollowConfirmation(username, excludedDialogs),
      3_000,
    );
    if (!confirmation) {
      return { unexpectedUi: true, reason: 'unfollow-confirmation-not-exact' };
    }
    activateLiveControl(confirmation);
    const completion = await waitForRelationship(['not-following'], username);
    if (completion?.sessionStop) return completion.sessionStop;
    if (!completion) return { unexpectedUi: true, reason: 'unfollow-not-confirmed' };
    return { result: 'unfollowed', relationship: completion.relationship };
  }

  function captureVisibleAccounts() {
    const roots = [
      ...document.querySelectorAll('[role="dialog"]'),
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
          source: 'extension-visible-dom',
        });
      }
    }
    return [...accounts.values()].sort((left, right) => left.username.localeCompare(right.username));
  }

  function scrollableWithin(root) {
    if (!root) return null;
    const candidates = [root, ...root.querySelectorAll('div, ul, section')];
    let best = null;
    for (const element of candidates) {
      const overflowY = getComputedStyle(element).overflowY;
      if (overflowY !== 'auto' && overflowY !== 'scroll') continue;
      const slack = element.scrollHeight - element.clientHeight;
      if (slack <= 8) continue;
      if (!best || slack > best.slack) best = { element, slack };
    }
    return best?.element || null;
  }

  function accountListRoot() {
    const dialogs = visibleDialogs();
    for (const dialog of dialogs) {
      if (scrollableWithin(dialog)) return dialog;
    }
    return dialogs[0] || document.querySelector('main');
  }

  function sleep(ms) {
    return new Promise((resolve) => { setTimeout(resolve, ms); });
  }

  // Scrolls the open followers/following dialog to enumerate the full list.
  // Read-only: it only scrolls an already-open list and reads rendered rows.
  async function collectAccountList({ maxScrolls = 1_200, settleMs = 500 } = {}) {
    const session = inspectSession();
    if (session.sessionExpired || session.challenge || session.actionBlocked || session.rateLimited) {
      return { ...session, accounts: [], complete: false, reason: 'session-stop' };
    }
    const root = accountListRoot();
    const scroller = scrollableWithin(root);
    if (!root) {
      return { ...session, accounts: [], complete: false, reason: 'open-a-followers-or-following-list' };
    }

    const accounts = new Map();
    const harvest = () => {
      for (const anchor of root.querySelectorAll('a[href^="/"]')) {
        const username = normalizeUsername(anchor.getAttribute('href'));
        if (!username || accounts.has(username)) continue;
        const label = visibleText(anchor);
        accounts.set(username, {
          username,
          profileUrl: `https://www.instagram.com/${username}/`,
          displayName: label === username ? '' : label,
          source: 'extension-scrolled-dom',
        });
      }
    };

    harvest();
    let complete = !scroller;
    let stagnantRounds = 0;
    for (let round = 0; scroller && round < maxScrolls; round += 1) {
      const beforeCount = accounts.size;
      const beforeHeight = scroller.scrollHeight;
      // Virtualised lists only fetch more rows in response to a real scroll
      // event. When we are already pinned at the end, assigning the same
      // scrollTop fires nothing, so nudge upward first to guarantee movement.
      if (scroller.scrollTop >= scroller.scrollHeight - scroller.clientHeight - 8) {
        scroller.scrollTop = Math.max(
          0,
          scroller.scrollTop - Math.max(80, Math.floor(scroller.clientHeight / 2)),
        );
        await sleep(60);
      }
      scroller.scrollTop = scroller.scrollHeight;
      await sleep(settleMs);
      // A long Followers list keeps a spinner up well past the settle delay.
      // Waiting for it to clear is what stops a big list being declared
      // complete while thousands of rows are still unfetched.
      for (let wait = 0; wait < 24; wait += 1) {
        if (!root.querySelector('[role="progressbar"], svg[aria-label*="Loading" i]')) break;
        await sleep(250);
      }
      harvest();

      const atBottom = scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 8;
      const grew = accounts.size > beforeCount || scroller.scrollHeight > beforeHeight;
      stagnantRounds = grew ? 0 : stagnantRounds + 1;
      // Instagram lazy-loads in bursts and can pause between pages, so a couple
      // of quiet rounds does not mean the end. Be patient before concluding.
      if (atBottom && stagnantRounds >= 10) {
        complete = true;
        break;
      }
      const check = inspectSession();
      if (check.sessionExpired || check.challenge || check.actionBlocked || check.rateLimited) {
        return {
          ...check,
          accounts: [...accounts.values()],
          complete: false,
          reason: 'session-stop',
        };
      }
    }

    return {
      ...session,
      accounts: [...accounts.values()]
        .sort((left, right) => left.username.localeCompare(right.username)),
      complete,
      capturedAt: new Date().toISOString(),
      reason: complete ? 'list-complete' : 'list-truncated',
    };
  }

  // Enumerates messages the signed-in account sent in the open conversation.
  // Read-only: no controls are activated here.
  async function enumerateSentDms({ maxScrolls = 300, settleMs = 300, limit = 500 } = {}) {
    const session = inspectSession();
    if (session.sessionExpired || session.challenge || session.actionBlocked || session.rateLimited) {
      return { ...session, messages: [], complete: false, reason: 'session-stop' };
    }
    const conversationId = currentDirectThreadId();
    if (!conversationId) {
      return {
        ...session,
        messages: [],
        complete: false,
        reason: 'open-an-instagram-conversation',
      };
    }

    const scope = document.querySelector('[data-pagelet="IGDMessagesList"]')
      || document.querySelector('main');
    const scroller = scrollableWithin(scope);
    const identitySelector = DM_MESSAGE_ID_ATTRIBUTES
      .map((attribute) => `[${attribute}]`)
      .join(', ');
    const found = new Map();

    const harvest = () => {
      const identityNodes = [...(scope?.querySelectorAll?.(identitySelector) || [])]
        .filter((element) => visibleText(element));
      for (const identityNode of identityNodes) {
        const row = identityNode.closest?.('[role="row"], [role="listitem"]') || identityNode;
        const identity = dmMessageId(identityNode) || dmMessageId(row);
        if (!identity?.value) continue;
        const ownership = dmOwnership(row, identityNode);
        if (ownership.sentByMe !== true) continue;
        const timestamp = dmMessageTimestamp(identityNode, row);
        if (timestamp?.timestamp == null) continue;
        const contents = dmContentCandidates(row);
        // Only exactly-identifiable single-content rows are eligible for unsend.
        if (contents.length !== 1) continue;
        const key = identity.value;
        if (found.has(key)) continue;
        found.set(key, {
          conversationId,
          messageId: identity.value,
          identityBasis: identity.attribute,
          timestamp: timestamp.timestamp,
          timestampBasis: timestamp.basis,
          contentDigest: dmContentDigest(contents[0]),
          preview: contents[0].slice(0, 120),
          ownershipBasis: ownership.basis,
          sentByMe: true,
        });
      }
    };

    harvest();
    let complete = !scroller;
    let stagnantRounds = 0;
    // Instagram renders the thread with `flex-direction: column-reverse`, so
    // scrollTop 0 is the NEWEST message and older ones live at NEGATIVE
    // scrollTop. Scrolling to 0 to "go up" would sit on the newest message
    // forever and never page in history.
    const reversed = getComputedStyle(scroller || scope).flexDirection === 'column-reverse'
      || scroller?.scrollTop < 0;
    const oldestOffset = () => (reversed
      ? -(scroller.scrollHeight - scroller.clientHeight)
      : 0);

    for (let round = 0; scroller && round < maxScrolls && found.size < limit; round += 1) {
      const beforeCount = found.size;
      const beforeHeight = scroller.scrollHeight;
      const target = oldestOffset();
      // Nudge off the edge first so the jump is a real scroll change even when
      // we are already pinned at the oldest end.
      if (Math.abs(scroller.scrollTop - target) <= 8) {
        scroller.scrollTop = target + (reversed ? 1 : -1)
          * Math.max(80, Math.floor(scroller.clientHeight / 2));
        await sleep(60);
      }
      scroller.scrollTop = target;
      await sleep(settleMs);
      // Instagram shows a spinner while a page loads; wait it out rather than
      // guessing with a fixed delay.
      for (let wait = 0; wait < 20; wait += 1) {
        if (!scope?.querySelector?.('[role="progressbar"], svg[aria-label*="Loading" i]')) break;
        await sleep(250);
      }
      harvest();

      const atTop = Math.abs(scroller.scrollTop - oldestOffset()) <= 8;
      const grew = found.size > beforeCount || scroller.scrollHeight > beforeHeight;
      stagnantRounds = grew ? 0 : stagnantRounds + 1;
      if (atTop && stagnantRounds >= 3) {
        complete = true;
        break;
      }
      const check = inspectSession();
      if (check.sessionExpired || check.challenge || check.actionBlocked || check.rateLimited) {
        return {
          ...check,
          messages: [...found.values()],
          complete: false,
          reason: 'session-stop',
        };
      }
    }

    const messages = [...found.values()]
      .sort((left, right) => right.timestamp - left.timestamp)
      .slice(0, limit);
    return {
      ...session,
      conversationId,
      messages,
      complete,
      exactIdentityAvailable: messages.length > 0,
      capturedAt: new Date().toISOString(),
      reason: messages.length
        ? (complete ? 'thread-complete' : 'thread-truncated')
        : 'exact-message-identity-unavailable',
    };
  }

  function pageKind() {
    const path = location.pathname.toLowerCase();
    if (path.startsWith('/accounts/login')) return 'login';
    if (path.startsWith('/direct/')) return 'messages';
    if (path.startsWith('/explore')) return 'explore';
    if (path.startsWith('/reel')) return 'reels';
    if (path.startsWith('/stories')) return 'stories';
    if (path.startsWith('/p/')) return 'post';
    return normalizeUsername(location.pathname) ? 'profile' : 'feed';
  }

  function inspectVisibleMessages() {
    const session = inspectSession();
    const kind = pageKind();
    const conversationId = currentDirectThreadId();
    if (!conversationId) {
      return {
        ...session,
        pageKind: kind,
        conversationId: '',
        conversationLabel: '',
        exactIdentityAvailable: false,
        ownershipAvailable: false,
        fragments: [],
        reason: 'open-an-instagram-conversation',
        capturedAt: new Date().toISOString(),
      };
    }

    const main = document.querySelector('main');
    const heading = [...(main?.querySelectorAll('h1, h2, header [dir="auto"]') || [])]
      .map(visibleText)
      .find(Boolean) || '';
    const rowText = [...(main?.querySelectorAll('[role="row"] [dir="auto"]') || [])];
    const candidates = (rowText.length
      ? rowText
      : [...(main?.querySelectorAll('div[dir="auto"]') || [])])
      .filter((element) => !element.querySelector('[dir="auto"]'))
      .filter((element) => !element.closest('header, nav, button, [role="button"], a'))
      .map(visibleText)
      .filter((text) => text && text.length <= 500);
    const fragments = [...new Set(candidates)].slice(-30).map((text, index) => ({
      index,
      text,
      source: 'extension-visible-dom-fragment',
    }));
    return {
      ...session,
      pageKind: kind,
      conversationId,
      conversationLabel: heading,
      exactIdentityAvailable: false,
      ownershipAvailable: false,
      fragments,
      reason: fragments.length ? 'visible-fragments-only' : 'no-visible-message-fragments',
      capturedAt: new Date().toISOString(),
    };
  }

  function inspectPageContext() {
    const kind = pageKind();
    const session = inspectSession();
    return {
      ...session,
      pageKind: kind,
      url: location.href,
      username: kind === 'profile' ? normalizeUsername(location.pathname) : '',
      profile: kind === 'profile' ? inspectProfile(location.pathname) : null,
    };
  }

  globalThis.InstaAioInstagramInspector = Object.freeze({
    captureVisibleAccounts,
    collectAccountList,
    enumerateSentDms,
    inspectPageContext,
    inspectProfile,
    inspectReviewedDmItem,
    inspectSession,
    inspectVisibleMessages,
    normalizeUsername,
    // The executors are exported so the userscript build runs this same audited
    // engine instead of carrying a second copy of the DOM logic. Both callers
    // still have to supply a resolution token minted by the matching inspect
    // call, so exporting them does not widen what an action can do.
    performReviewedDmUnsend,
    performReviewedProfileAction,
    reviewedTargetElement,
  });

  // Only the extension build has a runtime to talk to. Under Tampermonkey this
  // file provides the engine and the message router is simply not installed.
  if (!globalThis.chrome?.runtime?.onMessage?.addListener) return;

  chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
    if (request?.kind === 'insta-aio-inspect-profile') {
      sendResponse(inspectProfile(request.username));
      return;
    }
    if (request?.kind === 'insta-aio-inspect-session') {
      sendResponse(inspectSession());
      return;
    }
    if (request?.kind === 'insta-aio-capture-visible-accounts') {
      sendResponse({
        capturedAt: new Date().toISOString(),
        accounts: captureVisibleAccounts(),
      });
      return;
    }
    if (request?.kind === 'insta-aio-collect-account-list') {
      collectAccountList(request.options || {})
        .then(sendResponse)
        .catch(() => sendResponse({ unexpectedUi: true, reason: 'account-list-collection-failed' }));
      return true;
    }
    if (request?.kind === 'insta-aio-enumerate-sent-dms') {
      enumerateSentDms(request.options || {})
        .then(sendResponse)
        .catch(() => sendResponse({ unexpectedUi: true, reason: 'sent-dm-enumeration-failed' }));
      return true;
    }
    if (request?.kind === 'insta-aio-inspect-visible-messages') {
      sendResponse(inspectVisibleMessages());
      return;
    }
    if (request?.kind === 'insta-aio-inspect-reviewed-dm-item') {
      sendResponse(inspectReviewedDmItem(request.item));
      return;
    }
    if (request?.kind === 'insta-aio-perform-reviewed-profile-action') {
      performReviewedProfileAction(request.item)
        .then(sendResponse)
        .catch(() => sendResponse({ unexpectedUi: true, reason: 'live-action-driver-error' }));
      return true;
    }
    if (request?.kind === 'insta-aio-perform-reviewed-dm-unsend') {
      performReviewedDmUnsend(request.item)
        .then(sendResponse)
        .catch(() => sendResponse({ unexpectedUi: true, reason: 'live-dm-driver-error' }));
      return true;
    }
  });
})();

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
      sentDmsChecked: false,
      limits: {
        dailyActions: 100,
        dailyUnsends: 50,
        minDelayMs: 4_000,
        maxDelayMs: 11_000,
      },
      ledger: { day: null, actions: 0, unsends: 0 },
      run: null,
      introDone: false,
    };
  }

  function preferencesDefaults() {
    return {
      schemaVersion: 2,
      open: true,
      view: 'checker',
      position: null,
      width: 390,
      height: 620,
      opacity: 0.88,
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
    return {
      schemaVersion: 2,
      open: typeof source.open === 'boolean' ? source.open : true,
      view: VIEWS.includes(source.view) ? source.view : 'checker',
      position,
      width: Math.round(clamp(source.width || 390, WIDTH_MIN, WIDTH_MAX)),
      height: Math.round(clamp(source.height || 620, HEIGHT_MIN, HEIGHT_MAX)),
      opacity: Math.round(clamp(opacity ?? 0.88, 0.55, 1) * 100) / 100,
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
    if (!/^\/direct\/t\/[^/?#]+\/?$/i.test(pathname)) return null;
    return directThreadId(pathname);
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

  const sharedTokenCss = globalThis.InstaAioTokens?.css({ density: 'compact' }) || '';
  const host = document.createElement('div');
  host.id = ROOT_ID;
  const shadow = host.attachShadow({ mode: 'open' });
  shadow.innerHTML = `
    <style>
      ${sharedTokenCss}
      :host { all: initial; --aio-alpha: 88%; --aio-alpha-strong: 96%; --aio-width: 390px; --aio-height: 620px; --aio-settings-max-height: 460px; color-scheme: light dark; color: var(--aio-text, #1b211c); font-family: var(--aio-font, "Segoe UI Variable", "Segoe UI", system-ui, sans-serif); }
      *, *::before, *::after { box-sizing: border-box; }
      button, input, select { font: inherit; }
      button, label, summary { cursor: pointer; }
      [hidden] { display: none !important; }
      .launcher { position: fixed; z-index: 2147482900; right: 16px; bottom: 16px; width: 46px; height: 46px; border: 1px solid var(--aio-line, #cfd5cc); border-radius: 14px; background: color-mix(in srgb, var(--aio-bg, #fff) var(--aio-alpha), transparent); color: var(--aio-text, #172018); box-shadow: var(--aio-shadow-popover, 0 10px 32px rgba(0,0,0,.2)); font-weight: 850; }
      .panel { animation: aio-in var(--aio-motion-fast, 120ms) var(--aio-ease, ease) both; position: fixed; z-index: 2147482900; top: 62px; right: 16px; width: min(var(--aio-width), calc(100vw - 24px)); height: min(var(--aio-height), calc(100dvh - 74px)); display: flex; flex-direction: column; overflow: hidden; border: 1px solid var(--aio-line, #cfd5cc); border-radius: var(--aio-radius-lg, 14px); background: color-mix(in srgb, var(--aio-bg, #f7f8f5) var(--aio-alpha), transparent); color: var(--aio-text, #1b211c); box-shadow: var(--aio-shadow-panel, 0 20px 60px rgba(0,0,0,.24)); backdrop-filter: blur(10px) saturate(.95); -webkit-backdrop-filter: blur(10px) saturate(.95); font: var(--aio-text-md, 14px)/var(--aio-leading-md, 20px) var(--aio-font, "Segoe UI Variable", "Segoe UI", system-ui, sans-serif); }
      :host([data-floating="true"]) .panel { top: var(--aio-top); right: auto; left: var(--aio-left); }
      .header { display: grid; grid-template-columns: auto minmax(0,1fr) auto; gap: 8px; align-items: center; min-height: 66px; padding: 10px; border-bottom: 1px solid var(--aio-line, #d8ddd4); background: color-mix(in srgb, var(--aio-bg, #fff) var(--aio-alpha-strong), transparent); }
      .handle, .icon { width: 44px; height: 44px; display: grid; place-items: center; border: 0; border-radius: 9px; background: transparent; color: inherit; }
      .handle { cursor: grab; touch-action: none; font-size: 20px; min-width: 44px; min-height: 44px; display: inline-flex; align-items: center; justify-content: center; border-radius: 8px; }
      .handle:hover { background: color-mix(in srgb, var(--aio-text, #000) 8%, transparent); }
      .handle:active { cursor: grabbing; background: color-mix(in srgb, var(--aio-text, #000) 14%, transparent); }
      /* The whole header bar drags, so the grip is a hint rather than the only target. */
      .header { cursor: grab; }
      .header:active { cursor: grabbing; }
      .header button, .header select, .header summary, .header input { cursor: default; }
      .header h1 { margin: 0; overflow-wrap: break-word; word-break: normal; font-size: 17px; line-height: 1.15; }
      .header p { margin: 2px 0 0; color: var(--aio-text-muted, #667067); font-size: 11px; }
      .mode { display: inline-flex; margin-top: 4px; border: 1px solid var(--aio-warning, #8b6a20); border-radius: 999px; padding: 2px 7px; color: var(--aio-warning, #72520d); font-size: 10px; font-weight: 750; }
      .tabs { display: grid; grid-template-columns: repeat(3,minmax(44px,1fr)); border-bottom: 1px solid var(--aio-line, #d8ddd4); background: color-mix(in srgb, var(--aio-bg-sunken, #eef1ec) var(--aio-alpha-strong), transparent); }
      .tab { transition: background var(--aio-motion-fast, 120ms) var(--aio-ease, ease), color var(--aio-motion-fast, 120ms) var(--aio-ease, ease); min-height: 48px; border: 0; border-bottom: 3px solid transparent; padding: 6px 3px; background: transparent; color: var(--aio-text-muted, #616a61); font-size: 11px; font-weight: 700; }
      .tab[aria-selected="true"] { border-bottom-color: var(--aio-accent, #347844); color: var(--aio-text, #172018); background: color-mix(in srgb, var(--aio-bg-raised, #fff) 72%, transparent); }
      .scroll { flex: 1 1 auto; min-height: 0; min-height: 0; overflow: auto; overscroll-behavior: contain; }
      .view { padding: 14px; }
      .lead { margin: 0 0 12px; color: var(--aio-text-muted, #606960); font-size: 12px; }
      .tool-grid { display: grid; gap: 8px; }
      .tool { display: grid; grid-template-columns: minmax(0,1fr) auto; gap: 10px; align-items: center; width: 100%; border: 1px solid var(--aio-line, #d8ddd4); border-radius: 10px; padding: 12px; background: color-mix(in srgb, var(--aio-bg-raised, #fff) var(--aio-alpha-strong), transparent); color: inherit; text-align: left; }
      .tool strong, .tool span { display: block; }
      .tool span { margin-top: 3px; color: var(--aio-text-muted, #687068); font-size: 12px; }
      .tool em { color: var(--aio-accent, #347844); font-size: 10px; font-style: normal; font-weight: 800; text-transform: uppercase; }
      .card { margin-bottom: 10px; border: 1px solid var(--aio-line, #d8ddd4); border-radius: 10px; padding: 12px; background: color-mix(in srgb, var(--aio-bg-raised, #fff) var(--aio-alpha-strong), transparent); }
      .card h2, .card h3 { margin: 0 0 6px; font-size: 15px; }
      .card p { margin: 4px 0 0; color: var(--aio-text-muted, #687068); font-size: 12px; overflow-wrap: break-word; word-break: normal; }
      .metrics { display: grid; grid-template-columns: repeat(2,minmax(0,1fr)); gap: 8px; margin: 10px 0; }
      .metric { border: 1px solid var(--aio-line, #d8ddd4); border-radius: 9px; padding: 10px; background: color-mix(in srgb, var(--aio-bg-raised, #fff) var(--aio-alpha-strong), transparent); }
      .metric span, .metric strong { display: block; }
      .metric span { color: var(--aio-text-muted, #687068); font-size: 11px; }
      .metric strong { margin-top: 2px; font-size: 21px; }
      .field { display: grid; gap: 5px; margin: 10px 0; }
      .field label { color: var(--aio-text-muted, #687068); font-size: 12px; }
      .live-toggle { display: flex; align-items: flex-start; gap: 8px; color: var(--aio-text, #1b211c) !important; font-weight: 700; }
      .live-toggle input { width: 18px; height: 18px; flex: 0 0 auto; margin: 0; accent-color: var(--aio-accent, #347844); }
      .live-status { margin: 0; color: var(--aio-text-muted, #687068); font-size: 11px; }
      select, input[type="range"] { width: 100%; }
      select { min-height: 44px; border: 1px solid var(--aio-line, #cfd5cc); border-radius: 8px; padding: 8px; background: var(--aio-bg, #fff); color: var(--aio-text, #1b211c); }
      select option { background: var(--aio-bg, #fff); color: var(--aio-text, #1b211c); }
      input, textarea { background: var(--aio-bg, #fff); color: var(--aio-text, #1b211c); border: 1px solid var(--aio-line, #cfd5cc); border-radius: 8px; padding: 8px; }
      .toolbar { display: flex; flex-wrap: wrap; gap: 7px; margin: 10px 0; }
      .button, .file { min-height: 44px; display: inline-flex; align-items: center; justify-content: center; border: 1px solid var(--aio-line, #243027); border-radius: 8px; padding: 8px 11px; background: var(--aio-bg-sunken, #26362a); color: var(--aio-text, #1b211c); font-weight: 720; text-decoration: none; }
      .button.quiet, .file.quiet { border-color: var(--aio-line, #cfd5cc); background: color-mix(in srgb, var(--aio-bg-raised, #fff) 72%, transparent); color: var(--aio-text, #1b211c); }
      .file { position: relative; overflow: hidden; }
      .file input { position: absolute; inset: 0; opacity: 0; }
      .list { margin: 10px 0 0; padding: 0; border-top: 1px solid var(--aio-line, #d8ddd4); list-style: none; }
      .list li { padding: 8px 0; border-bottom: 1px solid var(--aio-line, #d8ddd4); overflow-wrap: break-word; word-break: normal; font-size: 12px; }
      .list small { display: block; margin-top: 2px; color: var(--aio-text-muted, #687068); }
      .notice { padding: 10px; border-left: 4px solid var(--aio-warning, #ad7823); background: var(--aio-bg-sunken, #fff4d6); color: var(--aio-text, #62490f); font-size: 12px; }
      details.settings { position: relative; }
      details.settings > summary { display: grid; width: 44px; height: 44px; place-items: center; border-radius: 9px; list-style: none; font-size: 18px; }
      details.settings > summary::-webkit-details-marker { display:none; }
      .settings-panel { position: absolute; z-index: 5; top: 48px; right: 0; width: min(250px, calc(100vw - 32px)); max-height: var(--aio-settings-max-height); overflow: auto; padding: 12px; border: 1px solid var(--aio-line, #cfd5cc); border-radius: 10px; background: color-mix(in srgb, var(--aio-bg-raised, #fff) 97%, transparent); color: var(--aio-text, #1b211c); box-shadow: var(--aio-shadow-panel, 0 16px 46px rgba(0,0,0,.2)); }
      .range-row { display:grid; grid-template-columns: minmax(0,1fr) auto; gap: 8px; align-items:center; }
      .footer { padding-right: 46px; min-height: 42px; display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 8px 12px; border-top: 1px solid var(--aio-line, #d8ddd4); background: color-mix(in srgb, var(--aio-bg, #fff) var(--aio-alpha-strong), transparent); color: var(--aio-text-muted, #687068); font-size: 11px; }
      .resize { position: absolute; right: 4px; bottom: 4px; display: flex; width: 76px; height: 44px; z-index: 5; align-items: center; justify-content: flex-start; border: 1px solid var(--aio-line, #d8ddd4); border-radius: 9px; padding: 0 24px 0 9px; background: var(--aio-bg-raised, #fff); color: var(--aio-text-muted, #687068); cursor: nwse-resize; touch-action: none; font-size: 11px; font-weight: 700; }
      .resize::before { content:""; position:absolute; right:7px; bottom:7px; width:9px; height:9px; border-right:2px solid currentColor; border-bottom:2px solid currentColor; }
      button:focus-visible, select:focus-visible, input:focus-visible, summary:focus-visible, .file:focus-within { outline: 3px solid var(--aio-focus, #168cff); outline-offset: 2px; }
      @media (max-width: 600px) { .panel { top:auto; right:0; bottom:0; left:0; width:100%; height:min(78dvh,720px); border-radius:14px 14px 0 0; } .handle,.resize { display:none; } .header { grid-template-columns:minmax(0,1fr) auto; } }
      @media (prefers-reduced-motion: reduce) { * { scroll-behavior:auto !important; } }
      .step, .context, .review, .card { transition: border-color var(--aio-motion-base, 180ms) var(--aio-ease, ease); }
      .intro { animation: aio-in var(--aio-motion-slow, 240ms) var(--aio-ease, ease) both; }
      .scan-progress .run-bar span { transition: width var(--aio-motion-base, 180ms) var(--aio-ease, ease); }
      /* A finished run should register without stealing attention. */
      .run-panel[data-finished="true"] .run-bar span { transition: width var(--aio-motion-slow, 240ms) var(--aio-ease, ease); }
      @media (prefers-reduced-motion: reduce) {
        .step, .context, .review, .card, .scan-progress .run-bar span, .run-panel[data-finished="true"] .run-bar span { transition: none; }
        .intro { animation: none; }
      }
      .review { margin-bottom: 12px; padding: 10px; border: 1px solid var(--aio-line, #d8ddd4); border-radius: 10px; }
      .review strong { display: block; margin-bottom: 6px; font-size: 13px; }
      .list--compact { max-height: 132px; overflow-y: auto; }
      .steps { display: grid; gap: 8px; margin: 0 0 12px; padding: 0; list-style: none; }
      .step { display: grid; grid-template-columns: auto minmax(0,1fr) auto; gap: 10px; align-items: center; padding: 10px; border: 1px solid var(--aio-line, #d8ddd4); border-radius: 10px; }
      .step[data-state="done"] { border-color: var(--aio-success, #0a7d3f); }
      .step[data-state="partial"] { border-color: var(--aio-warning, #b26a00); }
      .step-num { display: inline-flex; width: 24px; height: 24px; align-items: center; justify-content: center; border-radius: 50%; background: var(--aio-bg-sunken, #eef1ec); font-size: 12px; font-weight: 600; }
      .step[data-state="done"] .step-num { background: var(--aio-success, #0a7d3f); color: #fff; }
      .step-body strong { display: block; font-size: 13px; }
      .step-body span { display: block; color: var(--aio-text-muted, #687068); font-size: 12px; }
      .scan-progress { margin-bottom: 12px; }
      .settings-inline { margin-top: 10px; border-top: 1px solid var(--aio-line, #d8ddd4); }
      .settings-inline > summary { min-height: 44px; display: flex; align-items: center; font-size: 13px; cursor: pointer; }
      .header, .context, .tabs, .run-panel, .footer { flex: 0 0 auto; }
      .intro { flex: 0 1 auto; min-height: 0; overflow: auto; }
      .header, .footer { position: relative; z-index: 1; }
      input:not([type="range"]):not([type="checkbox"]), select, textarea { min-height: 44px; box-sizing: border-box; }
      .field input[type="range"] { min-height: 24px; }
      .field input[type="checkbox"] { min-width: 20px; min-height: 20px; }
      /* The checkbox itself stays small; its label carries the 44px target. */
      .field label { display: inline-flex; align-items: center; min-height: 44px; }
      .context { display: grid; grid-template-columns: auto minmax(0,1fr) auto; gap: 8px; align-items: center; padding: 8px 12px; border-bottom: 1px solid var(--aio-line, #d8ddd4); background: var(--aio-bg-sunken, #eef1ec); color: var(--aio-text, #1b211c); }
      .context-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--aio-text-muted, #687068); }
      .context[data-tone="ready"] .context-dot { background: var(--aio-success, #0a7d3f); }
      .context[data-tone="warning"] .context-dot { background: var(--aio-warning, #b26a00); }
      .context[data-tone="blocked"] .context-dot { background: var(--aio-danger, #8c1d1d); }
      .context-copy { min-width: 0; }
      .context-copy strong { display: block; color: currentColor !important; font-size: 13px; }
      .context-copy span { display: block; color: var(--aio-text-muted, #687068) !important; font-size: 12px; overflow-wrap: break-word; word-break: normal; }
      .context-cta { white-space: nowrap; }
      .intro { padding: 14px; border-bottom: 1px solid var(--aio-line, #d8ddd4); }
      .intro h2 { margin: 0 0 8px; font-size: 15px; }
      .intro-list { margin: 0 0 10px; padding-left: 18px; display: grid; gap: 6px; font-size: 13px; }
      .intro-note { margin: 0 0 8px; color: var(--aio-text-muted, #687068); font-size: 12px; }
      .run-panel { padding: 10px 12px; border-top: 1px solid var(--aio-line, #d8ddd4); background: color-mix(in srgb, var(--aio-bg, #fff) var(--aio-alpha-strong), transparent); }
      .run-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
      .run-head strong { font-size: 12px; overflow-wrap: break-word; word-break: normal; }
      .run-bar { overflow: hidden; height: 5px; margin: 8px 0 6px; border-radius: 999px; background: var(--aio-line, #d8ddd4); }
      .run-bar span { display: block; width: 0%; height: 100%; border-radius: 999px; background: var(--aio-accent, #1c6b3c); transition: width var(--aio-motion-base, 180ms) var(--aio-ease, ease); }
      .run-panel .list { max-height: 118px; overflow-y: auto; }
      .button.danger { background: var(--aio-accent, #0095f6); color: var(--aio-on-accent, #fff); }
      .button.primary { background: var(--aio-accent, #0095f6); color: var(--aio-on-accent, #fff); border: 0; font-weight: 600; }
      .button.primary:hover { filter: brightness(1.08); }
      .button.big { width: 100%; padding: 10px 12px; font-size: var(--system-14-font-size, 14px); line-height: var(--system-14-line-height, 18px); border-radius: 8px; }
      .button:disabled { cursor: not-allowed; filter: none; opacity: .48; }
      .mode[data-live="unlocked"] { border-color: var(--aio-success, #347844); color: var(--aio-success, #275d34); }
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
              <div class="field"><label for="aio-opacity">Surface transparency</label><div class="range-row"><input id="aio-opacity" type="range" min="55" max="100" value="88" data-preference="opacity"><output data-role="opacity-output">88%</output></div></div>
              <div class="field"><label>Size presets</label><div class="toolbar"><button class="button quiet" type="button" data-action="layout-compact">Compact</button><button class="button quiet" type="button" data-action="layout-tall">Tall</button><button class="button quiet" type="button" data-action="layout-wide">Wide</button></div></div>
              <button class="button quiet" type="button" data-action="reset-layout">Reset position and size</button>
              <details class="settings-inline"><summary>Advanced controls</summary><strong>Pacing and limits</strong><div class="field"><label for="aio-limit-actions">Follow/unfollow per day</label><input id="aio-limit-actions" type="number" min="1" max="400" data-role="limit-actions"></div><div class="field"><label for="aio-limit-unsends">Unsends per day</label><input id="aio-limit-unsends" type="number" min="1" max="300" data-role="limit-unsends"></div><div class="field"><label for="aio-limit-min">Min delay (seconds)</label><input id="aio-limit-min" type="number" min="2" max="600" data-role="limit-min"></div><div class="field"><label for="aio-limit-max">Max delay (seconds)</label><input id="aio-limit-max" type="number" min="2" max="900" data-role="limit-max"></div><button class="button quiet" type="button" data-action="save-limits">Save pacing</button></details>
              <p class="lead">Drag the header handle or lower corner. Arrow keys work on both.</p>
            </div>
          </details>
          <button class="icon" type="button" data-action="close" aria-label="Collapse Insta AIO toolbox">×</button>
        </div>
      </header>
      <div class="context" data-role="context" role="status" aria-live="polite">
        <span class="context-dot" data-role="context-dot"></span>
        <div class="context-copy"><strong data-role="context-title">Checking this page…</strong><span data-role="context-detail"></span></div>
        <button class="button quiet context-cta" type="button" data-action="context-cta" data-role="context-cta" hidden></button>
      </div>
      <section class="intro" data-role="intro" aria-labelledby="aio-intro-title" hidden>
        <h2 id="aio-intro-title">Three tools, all local</h2>
        <ol class="intro-list">
          <li><strong>Follower checker</strong> — scan your Following and Followers, then compare. Reading only.</li>
          <li><strong>Follow / Unfollow</strong> — work a list one account at a time, paced.</li>
          <li><strong>DM Unsend</strong> — remove messages you sent in one conversation.</li>
        </ol>
        <p class="intro-note">Everything stays in this browser. Nothing is uploaded, and there is no account to sign in to.</p>
        <p class="intro-note"><strong>Checks are read-only.</strong> Anything that changes your account stays locked until you unlock it for one run, and stops on the first rate limit or security check.</p>
        <div class="toolbar"><button class="button primary" type="button" data-action="intro-done">Start with the checker</button></div>
      </section>
      <nav class="tabs" role="tablist" aria-label="Insta AIO userscript tools">
        <button id="aio-tab-checker" class="tab" type="button" role="tab" data-view="checker" aria-controls="aio-panel-checker" aria-selected="true" tabindex="0">Follower checker</button>
        <button id="aio-tab-account" class="tab" type="button" role="tab" data-view="account" aria-controls="aio-panel-account" aria-selected="false" tabindex="-1">Follow / Unfollow</button>
        <button id="aio-tab-messages" class="tab" type="button" role="tab" data-view="messages" aria-controls="aio-panel-messages" aria-selected="false" tabindex="-1">DM Unsend</button>
      </nav>
      <div class="scroll">
        <section id="aio-panel-checker" class="view" role="tabpanel" aria-labelledby="aio-tab-checker" data-panel="checker" hidden><ol class="steps" data-role="checker-steps">
            <li class="step" data-step="following"><span class="step-num">1</span><div class="step-body"><strong>Scan Following</strong><span data-role="step-following">Not scanned yet</span></div><button class="button" type="button" data-action="scan-following">Scan Following</button></li>
            <li class="step" data-step="followers"><span class="step-num">2</span><div class="step-body"><strong>Scan Followers</strong><span data-role="step-followers">Not scanned yet</span></div><button class="button" type="button" data-action="scan-followers">Scan Followers</button></li>
            <li class="step" data-step="compare"><span class="step-num">3</span><div class="step-body"><strong>Compare</strong><span data-role="step-compare">Scan both lists first</span></div></li>
          </ol>
          <div class="scan-progress" data-role="scan-progress" hidden><div class="run-bar"><span data-role="scan-fill"></span></div><p class="lead" data-role="scan-detail"></p></div>
          <div class="field"><label for="aio-filter">Filter results</label><input id="aio-filter" type="search" placeholder="Search a username" data-role="result-filter"></div>
          <div class="card" data-role="comparison"></div><details class="settings-inline"><summary>Advanced: raw captures and export</summary><ul class="list" data-role="capture-list"></ul><div class="toolbar"><button class="button quiet" type="button" data-action="capture">Capture visible rows only</button><button class="button quiet" type="button" data-action="download-list">Download a raw list</button><button class="button quiet" type="button" data-action="clear-capture">Clear checker</button></div><div class="field"><label for="aio-list-type">Raw list to use</label><select id="aio-list-type" data-role="list-type"><option value="following">Following</option><option value="followers">Followers</option></select></div></details></section>
        <section id="aio-panel-account" class="view" role="tabpanel" aria-labelledby="aio-tab-account" data-panel="account" hidden><p class="lead"><strong>Follow / Unfollow review.</strong> Inspect the profile already open, or choose a bounded reviewed list. Nothing clicks during review.</p><div class="card" data-role="queue-current"></div>
          <div class="toolbar"><button class="button primary" type="button" data-action="account-dry-run">Inspect exact profile</button><button class="button quiet" type="button" data-action="open-profile">Open exact profile</button></div><details class="settings-inline"><summary>Advanced: queue state and files</summary><div class="toolbar"><button class="button quiet" type="button" data-action="queue-complete">Complete</button><button class="button quiet" type="button" data-action="queue-skip">Skip</button></div><div class="toolbar"><label class="file quiet">Import queue JSON<input type="file" accept=".json,application/json" data-file="queue"></label><button class="button quiet" type="button" data-action="export-queue">Export queue state</button></div></details><div class="card" data-role="account-result"></div>
          <div class="field"><label for="aio-bot-source">Targets</label><select id="aio-bot-source" data-role="bot-source"><option value="current-profile">Current exact profile</option><option value="not-following-me-back">Not following me back</option><option value="i-do-not-follow-back">I don't follow back</option><option value="scanned-followers">Last scanned Followers list</option><option value="scanned-following">Last scanned Following list</option><option value="queue">Imported queue</option></select></div>
          <div class="field"><label for="aio-bot-action">Action</label><select id="aio-bot-action" data-role="bot-action"><option value="unfollow">Unfollow</option><option value="follow">Follow</option></select></div>
          <div class="field"><label for="aio-bot-count">How many this run</label><input id="aio-bot-count" type="number" min="1" max="250" value="20" data-role="bot-count"></div>
          <p class="lead" data-role="account-run-summary">Choose a source, action, and bounded amount, then review the exact targets.</p><div class="toolbar"><button class="button primary big" type="button" data-action="review-accounts" data-role="account-run-primary">Review run</button></div><div class="review" data-role="run-review" hidden><strong data-role="review-title"></strong><ul class="list list--compact" data-role="review-list"></ul><p class="lead" data-role="review-skips"></p></div>
          <p class="notice">To grow from someone else's audience, open their profile, scan their Followers in the checker, then run with <strong>Last scanned Followers list</strong>. Accounts you already follow are skipped automatically. The run stops itself on any rate limit, security check, or block.</p></section>
        <section id="aio-panel-messages" class="view" role="tabpanel" aria-labelledby="aio-tab-messages" data-panel="messages" hidden><p class="lead"><strong>DM Unsend.</strong> Resolve this conversation and its eligible sent-message count before reviewing any permanent action.</p><div class="toolbar"><button class="button primary big" type="button" data-action="scan-sent">Check conversation</button></div>
          <div class="card" data-role="dm-summary" hidden><strong data-role="dm-summary-title"></strong><span data-role="dm-summary-detail"></span></div>
          <details class="settings-inline"><summary>Other message tools</summary><div class="toolbar"><button class="button quiet" type="button" data-action="read-messages">Read visible thread</button><label class="file quiet">Import reviewed DM job<input type="file" accept=".json,application/json" data-file="dm"></label><button class="button quiet" type="button" data-action="dm-dry-run">No-click exact check</button></div></details><div class="card" data-role="dm-result"></div><ul class="list" data-role="message-list"></ul>
          <div data-role="unsend-plan" hidden><div class="field"><label for="aio-unsend-scope">Scope</label><select id="aio-unsend-scope" data-role="unsend-scope"><option value="all">All eligible sent messages</option><option value="newest">Newest N</option><option value="oldest">Oldest N</option></select></div><div class="field"><label for="aio-unsend-count">Number of messages</label><input id="aio-unsend-count" type="number" min="1" max="250" value="1" data-role="unsend-count"></div><div class="toolbar"><button class="button danger" type="button" data-action="run-unsend" data-live-action>Review Unsend plan</button></div><p class="notice">Only messages you sent are eligible. The exact thread, scope, finite count, digest, and expiry are revalidated before the first message menu opens.</p></div></section>
      </div>
      <div class="run-panel" data-role="run-panel" hidden><div class="run-head"><strong data-role="run-title"></strong><button class="button danger" type="button" data-action="stop-run" data-role="stop-run">Stop</button></div><div class="run-bar"><span data-role="run-fill"></span></div><p class="lead" data-role="run-detail"></p><ul class="list" data-role="run-results"></ul></div>
      <footer class="footer" role="status" aria-live="polite"><span data-role="status">Ready. No Instagram control has been used.</span><strong>Local only</strong></footer>
      <button class="resize" type="button" data-role="resize" aria-label="Resize toolbox; use arrow keys for precise sizing" title="Drag to resize">Resize</button>
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
    const renderedPanelHeight = innerWidth <= 600
      ? Math.min(innerHeight * 0.78, 720)
      : Math.min(size.height, Math.max(0, innerHeight - 74));
    const settingsMaxHeight = Math.max(44, Math.min(500, Math.floor(renderedPanelHeight - 86)));
    host.style.setProperty('--aio-settings-max-height', `${settingsMaxHeight}px`);
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
      const button = document.createElement('button');
      button.className = 'button quiet';
      button.type = 'button';
      button.textContent = 'Download comparison';
      button.addEventListener('click', () => downloadJson(`insta-aio-follower-comparison-${Date.now()}.json`, {
        schemaVersion: 1,
        kind: 'insta-aio-comparison',
        generatedAt: nowIso(),
        complete: state.capture.complete || {},
        mutuals: comparison.mutuals,
        notFollowingMeBack: comparison.notFollowingMeBack,
        iDoNotFollowBack: comparison.iDoNotFollowBack,
      }));
      actions.append(button);
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
    resultDetail.textContent = state.accountCheck?.result
      || (item
        ? 'Open the exact queued profile, then run the check.'
        : 'Open an Instagram profile, then inspect it without clicking.');
    result.append(resultTitle, resultDetail);
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
    const list = query('[data-role="message-list"]');
    list.replaceChildren();
    for (const fragment of (evidence?.fragments || [])) {
      const row = document.createElement('li');
      row.textContent = fragment.text;
      const meta = document.createElement('small');
      meta.textContent = 'Visible fragment · ownership unknown';
      row.append(meta);
      list.append(row);
    }
    if (!(evidence?.fragments || []).length) {
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
    syncTabs(preferences.view);
    renderCheckerSteps();
    renderDmSummary();
    renderContext();
    renderIntro();
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
  let accountRunDraft = null;

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

  function reserveUnsendPlan(plan) {
    const count = Number(plan?.limit);
    const reviewedDigest = String(plan?.reviewedDigest || '');
    const bounds = limits();
    if (
      !newLiveRunAuthorized()
      || !Number.isInteger(count)
      || count < 1
      || !/^[0-9a-f]{8}$/.test(reviewedDigest)
      || Number(plan?.expiresAt) <= Date.now()
    ) return { ok: false, reason: 'The live window or reviewed plan expired.' };
    const current = state.ledger?.day === today()
      ? state.ledger
      : { day: today(), actions: 0, unsends: 0 };
    if (current.lastUnsendPlanDigest === reviewedDigest) {
      return { ok: false, reason: 'This reviewed Unsend plan was already reserved.' };
    }
    const remaining = Math.max(0, bounds.dailyUnsends - Number(current.unsends || 0));
    if (count > remaining) {
      return {
        ok: false,
        reason: `Only ${remaining} of ${bounds.dailyUnsends} daily Unsends remain.`,
      };
    }
    current.unsends = Number(current.unsends || 0) + count;
    current.lastUnsendPlanDigest = reviewedDigest;
    state.ledger = current;
    saveState();
    return {
      ok: true,
      minDelayMs: bounds.minDelayMs,
      maxDelayMs: Math.max(bounds.minDelayMs, bounds.maxDelayMs),
    };
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

  function confirmRun(message) {
    // eslint-disable-next-line no-alert
    return globalThis.confirm(message);
  }


  // --- Section 2: current Instagram context -------------------------------
  //
  // A first-time user cannot tell why a button is inert. Reading the route and
  // session on every render, and naming exactly one useful next action, removes
  // the guesswork. This only describes state; it never unlocks anything.

  function openFollowerListContext() {
    for (const dialog of document.querySelectorAll('[role="dialog"]')) {
      const heading = [...dialog.querySelectorAll('[role="heading"], h1, h2')]
        .map(visibleText)
        .find(Boolean);
      const firstLine = visibleText(dialog).split(/\r?\n/).map((line) => line.trim()).find(Boolean);
      const label = [dialog.getAttribute('aria-label'), heading, firstLine]
        .filter(Boolean)
        .join(' ')
        .normalize('NFKC')
        .toLocaleLowerCase();
      if (/(^|\s)followers(\s|$)/.test(label)) return { dialog, listType: 'followers', label: 'Followers' };
      if (/(^|\s)following(\s|$)/.test(label)) return { dialog, listType: 'following', label: 'Following' };
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
      const found = (state.sentDms || []).length;
      return {
        tone: 'ready',
        title: 'Conversation open',
        detail: found ? `${found} of your sent messages found here.` : 'Check it to see how many of your messages can be removed.',
        cta: found ? null : { label: 'Check conversation', action: 'scan-sent' },
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
        detail: `Scan ${followerList.label} to read every row, not just what is on screen.`,
        cta: { label: `Scan ${followerList.label}`, action: `scan-${followerList.listType}` },
        view: 'checker',
      };
    }
    const username = engine.normalizeUsername?.(location.pathname) || '';
    if (username) {
      return {
        tone: 'ready',
        title: `Profile: @${username}`,
        detail: 'Inspect this exact profile, or open its Followers or Following to scan a list.',
        view: 'account',
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
    strip.dataset.tone = context.tone;
    setText('context-title', context.title);
    setText('context-detail', context.detail);
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

  function renderIntro() {
    const intro = query('[data-role="intro"]');
    if (intro) intro.hidden = state.introDone === true;
  }


  // --- Section 3: guided scan sequence ------------------------------------

  function scanState(listType) {
    const count = state.capture[listType].length;
    if (!count) return 'todo';
    return state.capture.complete?.[listType] === true ? 'done' : 'partial';
  }

  function renderCheckerSteps() {
    const comparison = compareCapture();
    for (const listType of ['following', 'followers']) {
      const step = query(`.step[data-step="${listType}"]`);
      const status = scanState(listType);
      if (step) step.dataset.state = status;
      const count = state.capture[listType].length;
      setText(`step-${listType}`,
        status === 'todo' ? 'Not scanned yet'
          : status === 'done' ? `${count} found — complete`
            : `${count} found — did not reach the end`);
      const button = query(`[data-action="scan-${listType}"]`);
      const listLabel = listType === 'following' ? 'Following' : 'Followers';
      if (button) button.textContent = `${status === 'todo' ? 'Scan' : 'Rescan'} ${listLabel}`;
    }
    const compareStep = query('.step[data-step="compare"]');
    const both = state.capture.following.length && state.capture.followers.length;
    const complete = scanState('following') === 'done' && scanState('followers') === 'done';
    if (compareStep) compareStep.dataset.state = both ? (complete ? 'done' : 'partial') : 'todo';
    setText('step-compare', both
      ? `${comparison.mutuals.length} mutual · ${comparison.notFollowingMeBack.length} not following back${complete ? '' : ' (partial)'}`
      : 'Scan both lists first');
  }

  function showScanProgress(listType, found, complete) {
    const panel = query('[data-role="scan-progress"]');
    if (!panel) return;
    panel.hidden = false;
    const fill = query('[data-role="scan-fill"]');
    // Total is unknown mid-scan, so the bar reports motion, not completion.
    if (fill) fill.style.width = complete ? '100%' : `${Math.min(95, 5 + (found % 95))}%`;
    setText('scan-detail', complete
      ? `Scanned ${found} ${listType} — complete.`
      : `Scanning ${listType}… ${found} found so far.`);
  }

  async function scanInto(listType) {
    const select = query('[data-role="list-type"]');
    if (select) select.value = listType;
    showScanProgress(listType, 0, false);
    await actions['scan-list']();
    const found = state.capture[listType].length;
    showScanProgress(listType, found, state.capture.complete?.[listType] === true);
    renderAll();
  }


  // --- Sections 4 and 5: show the targets before anything runs ------------

  function renderRunReview(items, { omitted = 0, removed = 0 } = {}) {
    const panel = query('[data-role="run-review"]');
    if (!panel) return;
    panel.hidden = !items.length;
    if (!items.length) return;
    setText('review-title', `${items.length} account${items.length === 1 ? '' : 's'} queued`);
    const list = query('[data-role="review-list"]');
    if (list) {
      list.replaceChildren();
      for (const item of items.slice(0, 8)) {
        const row = document.createElement('li');
        row.textContent = `@${item.username}`;
        list.append(row);
      }
      if (items.length > 8) {
        const more = document.createElement('li');
        more.textContent = `+ ${items.length - 8} more`;
        list.append(more);
      }
    }
    // Naming why targets were dropped is the difference between a trustworthy
    // count and a surprising one.
    setText(
      'review-skips',
      `${removed} duplicate or already-followed target${removed === 1 ? '' : 's'} removed; ${omitted} left outside this bounded run. Every profile is rechecked before action.`,
    );
  }

  function accountRunPlan() {
    const action = query('[data-role="bot-action"]')?.value === 'follow' ? 'follow' : 'unfollow';
    const source = query('[data-role="bot-source"]')?.value || 'current-profile';
    const requestedCount = clampNumber(query('[data-role="bot-count"]')?.value, [1, 250], 20);
    const count = source === 'current-profile' ? 1 : requestedCount;
    const comparison = compareCapture();
    const names = (list) => (list || []).map((entry) => entry.username || entry).filter(Boolean);
    const pools = {
      'current-profile': () => {
        const username = engine.normalizeUsername?.(location.pathname) || '';
        return username ? [username] : [];
      },
      queue: () => (state.queue.queue || [])
        .filter((entry) => ACTIONABLE_STATUSES.has(entry.status))
        .map((entry) => entry.account?.username)
        .filter(Boolean),
      'i-do-not-follow-back': () => names(comparison.iDoNotFollowBack),
      'not-following-me-back': () => names(comparison.notFollowingMeBack),
      'scanned-followers': () => names(state.capture.followers),
      'scanned-following': () => names(state.capture.following),
    };
    const pool = (pools[source] || pools['current-profile'])();
    let eligible = pool;
    if (source !== 'current-profile' && action === 'follow' && state.capture.following.length) {
      const already = new Set(names(state.capture.following));
      eligible = eligible.filter((username) => !already.has(username));
    }
    const unique = [...new Set(eligible)];
    const items = unique.slice(0, count).map((username) => ({ username }));
    return Object.freeze({
      action,
      items: Object.freeze(items),
      omitted: Math.max(0, unique.length - items.length),
      removed: Math.max(0, pool.length - unique.length),
      signature: JSON.stringify({ action, count, source, usernames: items.map((item) => item.username) }),
      source,
    });
  }

  function renderAccountRunPrimary() {
    const button = query('[data-role="account-run-primary"]');
    if (!button) return;
    if (accountRunDraft) {
      button.dataset.action = 'run-accounts';
      button.dataset.liveAction = '';
      button.textContent = `Start ${accountRunDraft.action} run`;
      button.classList.add('danger');
      button.classList.remove('primary');
      const preview = accountRunDraft.items.slice(0, 3).map((item) => `@${item.username}`).join(', ');
      setText('account-run-summary', `Reviewed: ${preview}${accountRunDraft.items.length > 3 ? `, +${accountRunDraft.items.length - 3} more` : ''}. Every profile is rechecked before action.`);
    } else {
      button.dataset.action = 'review-accounts';
      delete button.dataset.liveAction;
      button.disabled = false;
      button.textContent = 'Review run';
      button.classList.add('primary');
      button.classList.remove('danger');
      setText('account-run-summary', 'Choose a source, action, and bounded amount, then review the exact targets.');
    }
  }

  function clearAccountRunDraft() {
    accountRunDraft = null;
    renderRunReview([]);
    renderAccountRunPrimary();
  }

  function reviewAccountRun() {
    const plan = accountRunPlan();
    if (!plan.items.length) {
      clearAccountRunDraft();
      status(
        plan.source === 'current-profile'
          ? 'Open one Instagram profile first. No target was reviewed.'
          : plan.source.startsWith('scanned')
          ? 'That list is empty. Open the list you want and scan it in the checker first.'
          : 'No targets. Scan both lists in the checker first, or import a queue.',
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
    const found = (state.sentDms || []).length;
    const checked = state.sentDmsChecked === true;
    if (summary) {
      summary.hidden = !checked;
      setText('dm-summary-title', found
        ? `${found} of your messages can be removed`
        : 'No removable messages found');
      setText('dm-summary-detail', !found
        ? 'Nothing here could be identified as yours, so nothing will be touched.'
        : state.sentDmsComplete
          ? 'The whole conversation was read.'
          : 'The conversation did not fully load, so there may be more further back.');
    }
    // Never hidden. Progressive disclosure applies to secondary controls, not
    // to the action the tool exists for.
    if (primary) primary.hidden = false;
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

  const actions = {
    'scan-following': () => scanInto('following'),
    'scan-followers': () => scanInto('followers'),
    'intro-done': () => {
      state.introDone = true;
      saveState();
      savePreferences({ view: 'checker' });
      renderAll();
      query('[data-view="checker"]')?.focus();
    },
    'context-cta': () => {
      const cta = query('[data-role="context-cta"]');
      const target = cta?.dataset.ctaAction;
      const view = cta?.dataset.ctaView;
      if (view) savePreferences({ view });
      if (target && actions[target]) actions[target]();
    },
    'review-accounts': () => reviewAccountRun(),
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
      const activeThreadId = currentDirectThreadId();
      const scanMatchesThread = Boolean(
        activeThreadId
        && directThreadId(outcome?.conversationId) === activeThreadId,
      );
      state.sentDms = scanMatchesThread
        ? sentMessagesForThread(outcome?.messages, activeThreadId)
        : [];
      state.sentDmsComplete = scanMatchesThread && outcome?.complete === true;
      state.sentDmsChecked = true;
      saveState();
      renderAll();
      status(
        !activeThreadId
          ? 'Open an Instagram conversation first.'
          : !scanMatchesThread
            ? 'The conversation changed during the scan. Scan this conversation again.'
            : state.sentDms.length
              ? `Found ${state.sentDms.length} of your sent messages.${outcome.complete ? '' : ' Older ones may still be unloaded.'}`
              : 'No exactly identifiable sent messages were found in this thread.',
      );
    },
    'run-accounts': async () => {
      const current = accountRunPlan();
      if (!accountRunDraft || accountRunDraft.signature !== current.signature) {
        clearAccountRunDraft();
        status('Targets changed. Review the run again before unlocking live actions.');
        return;
      }
      if (!requireNewRunAuthorization()) return;
      if (!confirmRun(
        `${accountRunDraft.action === 'follow' ? 'Follow' : 'Unfollow'} ${accountRunDraft.items.length} reviewed account${accountRunDraft.items.length === 1 ? '' : 's'}?\n\n`
        + 'This tab will move between profiles and the run continues across page loads. It changes your account.',
      )) return;
      const approved = accountRunDraft;
      clearAccountRunDraft();
      await startAccountRun({ action: approved.action, usernames: approved.items.map((item) => item.username) });
    },
    // The capture-phase shared runner owns this action. If that enhancement is
    // unavailable, fail closed rather than falling back to a second mutation
    // path with weaker review semantics.
    'run-unsend': () => {
      status('The reviewed DM runner is not ready. Reload Instagram; nothing was changed.');
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
    'layout-compact': () => savePreferences({ width: 360, height: 520, open: true }),
    'layout-tall': () => savePreferences({
      width: 430,
      height: Math.min(820, Math.max(HEIGHT_MIN, innerHeight - (INSET * 2))),
      open: true,
    }),
    'layout-wide': () => savePreferences({ width: 560, height: 680, open: true }),
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
      if (event.target.matches('[data-role="bot-source"], [data-role="bot-action"], [data-role="bot-count"]')) {
        clearAccountRunDraft();
        status('Run choices changed. Review the targets again.');
        return;
      }
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

  shadow.addEventListener('keydown', onTabKeydown);
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
    const maxWidth = Math.min(WIDTH_MAX, innerWidth - (INSET * 2));
    const maxHeight = Math.min(HEIGHT_MAX, innerHeight - (INSET * 2));
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

  let lastLocationHref = location.href;
  const duplicateObserver = new MutationObserver((records) => {
    const currentHref = location.href;
    if (currentHref !== lastLocationHref) {
      lastLocationHref = currentHref;
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
      reserveUnsendPlan,
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

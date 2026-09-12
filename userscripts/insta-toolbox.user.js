// ==UserScript==
// @name         Insta Toolbox
// @namespace    https://github.com/slaveofsolace/Insta-Toolbox
// @version      3.1.12
// @description  Mutual Checker, Follow / Unfollow, and DM Unsend on Instagram.
// @author       @slaveofsolace
// @homepageURL  https://github.com/slaveofsolace/Insta-Toolbox
// @supportURL   https://github.com/slaveofsolace/Insta-Toolbox/issues
// @downloadURL  https://github.com/slaveofsolace/Insta-Toolbox/releases/latest/download/insta-toolbox.user.js
// @updateURL    https://github.com/slaveofsolace/Insta-Toolbox/releases/latest/download/insta-toolbox.user.js
// @icon         data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 1024 1024'%3E%3Crect width='1024' height='1024' fill='%23101114'/%3E%3Crect x='160' y='224' width='192' height='128' fill='%23b83d67'/%3E%3Crect x='224' y='352' width='64' height='352' fill='%23b83d67'/%3E%3Crect x='160' y='704' width='192' height='96' fill='%23b83d67'/%3E%3Crect x='416' y='224' width='448' height='128' fill='%23f4f1e8'/%3E%3Crect x='576' y='352' width='128' height='448' fill='%23f4f1e8'/%3E%3C/svg%3E
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
//   extension/action-confirmation.js     <- shared destructive-action dialog
//   extension/action-labels.js           <- labels and thread-wide DM runner
//   extension/content-instagram.js       <- shared exact-target engine
//   userscripts/src/toolbox-shell.js     <- userscript UI and batch runner
//
// Edit those sources and run: pnpm run build:userscript
// ---------------------------------------------------------------------------
/*
 * MIT License
 *
 * Copyright (c) 2026 slaveofsolace (https://github.com/slaveofsolace)
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */
(() => {
  'use strict';
  const rootId = 'insta-toolbox-userscript-root';
  const extensionRootId = 'insta-toolbox-sidecar-root';
  const claimId = 'insta-toolbox-userscript-claim';
  if (!document.documentElement
    || document.getElementById(extensionRootId)
    || document.getElementById(rootId)
    || document.getElementById(claimId)) return;

  const bootstrapClaim = document.createElement('div');
  bootstrapClaim.id = claimId;
  bootstrapClaim.hidden = true;
  bootstrapClaim.setAttribute('aria-hidden', 'true');
  document.documentElement.append(bootstrapClaim);
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
      '--insta-toolbox-bg': 'rgb(var(--ig-primary-background, 255 255 255))',
      '--insta-toolbox-bg-raised': 'rgb(var(--ig-elevated-background, 255 255 255))',
      '--insta-toolbox-bg-sunken': 'rgb(var(--ig-secondary-background, 250 250 250))',
      '--insta-toolbox-text': 'rgb(var(--ig-primary-text, 0 0 0))',
      '--insta-toolbox-text-muted': 'rgb(var(--ig-secondary-text, 115 115 115))',
      '--insta-toolbox-line': 'rgb(var(--ig-separator, 219 219 219))',
      '--insta-toolbox-accent': '#b83d67',
      '--insta-toolbox-accent-violet': '#7657d6',
      '--insta-toolbox-accent-blue': '#1f6eb3',
      '--insta-toolbox-on-accent': '#fff',
      '--insta-toolbox-success': 'rgb(var(--ig-success, 0 148 84))',
      '--insta-toolbox-warning': '#b26a00',
      '--insta-toolbox-danger': 'rgb(var(--ig-error-or-destructive, 237 73 86))',
      // Deliberately not the danger colour: an uncertain outcome may well have
      // succeeded, and colouring it as a failure would assert what we do not know.
      '--insta-toolbox-uncertain': '#7a5cc4',
      '--insta-toolbox-focus': '#b83d67',
    };
  }

  function scale(density) {
    const tight = density === 'compact';
    return {
      '--insta-toolbox-space-1': SPACE[1],
      '--insta-toolbox-space-2': SPACE[2],
      '--insta-toolbox-space-3': SPACE[3],
      '--insta-toolbox-space-4': SPACE[4],
      '--insta-toolbox-space-5': SPACE[5],
      '--insta-toolbox-space-6': SPACE[6],
      // Compact trims vertical rhythm only. Hit targets and font sizes are
      // never reduced, so a denser panel stays as usable as a roomy one.
      '--insta-toolbox-pad-y': tight ? SPACE[2] : SPACE[3],
      '--insta-toolbox-pad-x': tight ? SPACE[3] : SPACE[4],
      '--insta-toolbox-gap': tight ? SPACE[2] : SPACE[3],
      '--insta-toolbox-radius-sm': '6px',
      '--insta-toolbox-radius-md': '8px',
      '--insta-toolbox-radius-lg': '16px',
      '--insta-toolbox-border': '1px',
      '--insta-toolbox-target': '44px',
      '--insta-toolbox-text-lg': '15px',
      '--insta-toolbox-text-md': '14px',
      '--insta-toolbox-text-sm': '13px',
      '--insta-toolbox-text-xs': '12px',
      '--insta-toolbox-leading-lg': '20px',
      '--insta-toolbox-leading-md': '20px',
      '--insta-toolbox-leading-sm': '18px',
      '--insta-toolbox-leading-xs': '16px',
      '--insta-toolbox-weight-normal': '400',
      '--insta-toolbox-weight-strong': '600',
      '--insta-toolbox-font': 'var(--ig-font-family, "Segoe UI Variable", "Segoe UI", system-ui, -apple-system, sans-serif)',
      '--insta-toolbox-shadow-panel': '0 12px 40px rgba(0, 0, 0, .18)',
      '--insta-toolbox-shadow-popover': '0 8px 24px rgba(0, 0, 0, .16)',
      '--insta-toolbox-shadow-none': 'none',
      '--insta-toolbox-motion-fast': '120ms',
      '--insta-toolbox-motion-base': '180ms',
      '--insta-toolbox-motion-slow': '240ms',
      '--insta-toolbox-ease': 'cubic-bezier(.2, .7, .3, 1)',
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
    .insta-toolbox-focusable:focus { outline: none; }
    .insta-toolbox-focusable:focus-visible {
      outline: 2px solid var(--insta-toolbox-focus);
      outline-offset: 2px;
    }
    /* A control may look small but must never be small to hit. */
    .insta-toolbox-target { min-width: var(--insta-toolbox-target); min-height: var(--insta-toolbox-target); }
    .insta-toolbox-state-locked { color: var(--insta-toolbox-text-muted); }
    .insta-toolbox-state-armed { border-color: var(--insta-toolbox-danger); color: var(--insta-toolbox-danger); }
    .insta-toolbox-state-running { border-color: var(--insta-toolbox-warning); color: var(--insta-toolbox-warning); }
    .insta-toolbox-state-paused { border-color: var(--insta-toolbox-line); color: var(--insta-toolbox-text-muted); }
    .insta-toolbox-state-stopped { border-color: var(--insta-toolbox-danger); color: var(--insta-toolbox-danger); }
    .insta-toolbox-state-uncertain { border-color: var(--insta-toolbox-uncertain); color: var(--insta-toolbox-uncertain); }
    .insta-toolbox-state-success { color: var(--insta-toolbox-success); }
    .insta-toolbox-state-selected { color: var(--insta-toolbox-accent); }
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
      .insta-toolbox-surface, .insta-toolbox-raised, .insta-toolbox-sunken { background: Canvas; color: CanvasText; }
      .insta-toolbox-surface, .insta-toolbox-raised, .insta-toolbox-sunken, .insta-toolbox-card { border: 1px solid CanvasText; }
      .insta-toolbox-focusable:focus-visible { outline-color: Highlight; }
      .insta-toolbox-state-selected { color: Highlight; }
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

  Object.defineProperty(globalThis, 'InstaToolboxTokens', {
    configurable: false,
    enumerable: false,
    value: api,
    writable: false,
  });
})();

(() => {
  'use strict';

  const namespace = 'InstaToolboxActionConfirmation';
  if (globalThis[namespace]) return;

  function immutableCopy(value) {
    if (Array.isArray(value)) return Object.freeze(value.map(immutableCopy));
    if (value && typeof value === 'object') {
      return Object.freeze(Object.fromEntries(
        Object.entries(value).map(([key, entry]) => [key, immutableCopy(entry)]),
      ));
    }
    return value;
  }

  function cleanText(value, fallback = '') {
    const text = String(value ?? '').trim();
    return (text || fallback).slice(0, 1_000);
  }

  function createController({ root, attribute, status, unavailableTone = 'error' }) {
    if (!root?.querySelector || !attribute) throw new TypeError('A confirmation root and role attribute are required.');

    const query = (role) => root.querySelector(`[${attribute}="${role}"]`);
    const dialog = query('action-confirmation');
    const cancelButton = query('confirm-cancel');
    const confirmButton = query('confirm-accept');
    let pending = null;

    function renderList(role, values) {
      const list = query(role);
      if (!list) return;
      const items = (Array.isArray(values) ? values : [])
        .map((value) => cleanText(value))
        .filter(Boolean)
        .slice(0, 250);
      list.replaceChildren(...items.map((value) => {
        const item = root.ownerDocument.createElement('li');
        item.textContent = value;
        return item;
      }));
      list.hidden = items.length === 0;
    }

    function renderFacts(values) {
      const list = query('confirm-facts');
      if (!list) return;
      const facts = (Array.isArray(values) ? values : [])
        .map((entry) => ({
          label: cleanText(entry?.label),
          value: cleanText(entry?.value),
        }))
        .filter((entry) => entry.label && entry.value)
        .slice(0, 12);
      const nodes = [];
      for (const fact of facts) {
        const term = root.ownerDocument.createElement('dt');
        const description = root.ownerDocument.createElement('dd');
        term.textContent = fact.label;
        description.textContent = fact.value;
        nodes.push(term, description);
      }
      list.replaceChildren(...nodes);
      list.hidden = facts.length === 0;
    }

    function settle(confirmed) {
      const current = pending;
      if (!current) return false;
      pending = null;
      if (dialog?.open) dialog.close();
      if (current.restoreFocus?.isConnected) current.restoreFocus.focus();
      const expired = Number(current.binding?.expiresAt) > 0
        && Number(current.binding.expiresAt) <= Date.now();
      if (confirmed === true && expired) {
        status?.('This review expired. Review the action again. Nothing was changed.', unavailableTone);
      }
      current.resolve(confirmed === true && !expired ? current.binding : null);
      return true;
    }

    function confirm(request = {}) {
      if (pending) return Promise.resolve(null);
      if (!dialog?.showModal || !cancelButton || !confirmButton) {
        status?.('The confirmation panel is unavailable. Nothing was changed.', unavailableTone);
        return Promise.resolve(null);
      }

      const title = query('confirm-title');
      const message = query('confirm-message');
      const detail = query('confirm-detail');
      if (title) title.textContent = cleanText(request.title, 'Confirm action');
      if (message) message.textContent = cleanText(request.message, 'Review this action.');
      if (detail) detail.textContent = cleanText(request.detail, 'This cannot be undone.');
      confirmButton.textContent = cleanText(request.confirmLabel, 'Confirm');
      renderFacts(request.facts);
      renderList('confirm-items', request.items);

      const binding = immutableCopy(request.binding || {});
      return new Promise((resolve) => {
        pending = {
          binding,
          resolve,
          restoreFocus: root.activeElement || root.ownerDocument.activeElement,
        };
        try {
          dialog.showModal();
          cancelButton.focus();
        } catch {
          pending = null;
          resolve(null);
          status?.('The confirmation panel could not open. Nothing was changed.', unavailableTone);
        }
      });
    }

    function onCancel(event) {
      event.preventDefault();
      settle(false);
    }

    function onAccept(event) {
      if (event?.isTrusted !== true) {
        event?.preventDefault?.();
        event?.stopPropagation?.();
        return;
      }
      settle(true);
    }

    function onClose() {
      if (pending) settle(false);
    }

    dialog?.addEventListener('cancel', onCancel);
    dialog?.addEventListener('close', onClose);
    confirmButton?.addEventListener('click', onAccept);

    return Object.freeze({
      cancel: () => settle(false),
      confirm,
      destroy() {
        settle(false);
        dialog?.removeEventListener('cancel', onCancel);
        dialog?.removeEventListener('close', onClose);
        confirmButton?.removeEventListener('click', onAccept);
      },
      isPending: () => Boolean(pending),
    });
  }

  Object.defineProperty(globalThis, namespace, {
    configurable: false,
    enumerable: false,
    value: Object.freeze({ createController }),
    writable: false,
  });
})();

(() => {
  'use strict';

  const namespace = '__instaToolboxActionLabels';
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
    "[role='button']",
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

  function isDmMessageOptionsLabel(value) {
    const label = normalizeActionLabel(value);
    return label.startsWith('see more options for message')
      || label.startsWith('more options')
      || label.startsWith('altre opzioni')
      || label.startsWith('opzioni')
      || label.startsWith('opciones')
      || label.startsWith('options')
      || label === 'more';
  }

  const api = Object.freeze({
    dmActionSelectors,
    dmUnsendLabels,
    relationshipLabels: Object.freeze(relationshipEntries.map(([label]) => label)),
    isDmUnsendLabel(value) {
      return dmUnsendLabelSet.has(normalizeActionLabel(value));
    },
    isDmMessageOptionsLabel,
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

  if (globalThis.InstaToolboxDmThreadUnsender) return;
  const actionLabels = globalThis.__instaToolboxActionLabels;
  if (!actionLabels) return;

  const ACTIVE_ATTRIBUTE = 'data-insta-toolbox-unsend-active';
  const DONE_ATTRIBUTE = 'data-insta-toolbox-unsent';
  const DEFAULT_MIN_DELAY_MS = 1_000;
  const DEFAULT_MAX_DELAY_MS = 2_000;
  const DEFAULT_MAX_FAILURES = 5;
  const MIN_USABLE_VISIBLE_PX = 24;
  const MAX_HOVER_DEPTH = 8;
  const MAX_HISTORY_CHECK_MS = 90_000;
  const MAX_SCAN_PASSES = 3;
  const MAX_PLAN_MESSAGES = 5_000;
  const MAX_EMPTY_GROWTH_ROUNDS = 600;
  const MAX_SCROLL_STEPS_PER_SEARCH = 2_000;
  const OLDEST_BOUNDARY_POLL_MS = 120;
  const OLDEST_BOUNDARY_STABLE_MS = 2_000;
  const STABLE_EMPTY_PASSES = 3;
  const PLAN_VERSION = 2;
  const PLAN_SCOPES = new Set(['all', 'newest', 'oldest']);
  const listeners = new Set();
  const consumedPlanDigests = new Map();

  let activeController = null;
  let currentState = Object.freeze({
    status: 'idle',
    operation: null,
    processed: 0,
    failed: 0,
    retryAttempts: 0,
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
    const min = Math.max(1_000, Number(minimum) || DEFAULT_MIN_DELAY_MS);
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

  function planDigest({ version, threadId, scope, limit, detectedCount, expiresAt }) {
    return digestText(JSON.stringify({
      version: Number(version),
      threadId: String(threadId || ''),
      scope: String(scope || ''),
      limit: limit === null ? null : Number(limit),
      detectedCount: detectedCount === null ? null : Number(detectedCount),
      expiresAt: Number(expiresAt),
    }));
  }

  function createPlan(value = {}) {
    const threadId = String(value.threadId || '').trim();
    const requestedScope = value.scope === null || value.scope === undefined || value.scope === ''
      ? 'all'
      : String(value.scope);
    if (!PLAN_SCOPES.has(requestedScope)) return null;
    const scope = requestedScope;
    const requestedLimit = Math.floor(Number(value.limit));
    const limit = scope === 'all'
      ? null
      : Number.isFinite(requestedLimit) && requestedLimit > 0
        ? Math.min(MAX_PLAN_MESSAGES, requestedLimit)
        : null;
    const hasDetectedCount = value.detectedCount !== null
      && value.detectedCount !== undefined
      && value.detectedCount !== '';
    const requestedDetectedCount = hasDetectedCount ? Number(value.detectedCount) : Number.NaN;
    const detectedCount = Number.isFinite(requestedDetectedCount) && requestedDetectedCount >= 0
      ? Math.min(MAX_PLAN_MESSAGES, Math.floor(requestedDetectedCount))
      : null;
    const expiresAt = Math.floor(Number(value.expiresAt) || 0);
    if (!threadId || (scope !== 'all' && !(limit > 0)) || expiresAt <= Date.now()) return null;
    const plan = {
      version: PLAN_VERSION,
      threadId,
      scope,
      limit,
      detectedCount,
      expiresAt,
    };
    return Object.freeze({ ...plan, reviewedDigest: planDigest(plan) });
  }

  function validatePlan(value) {
    if (Number(value?.version) !== PLAN_VERSION) return null;
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
    const match = String(location.pathname || '').match(/^\/direct\/t\/([^/?#]+)\/?$/i);
    if (match) {
      try {
        return decodeURIComponent(match[1]);
      } catch {
        return '';
      }
    }
    const roots = [...document.querySelectorAll("[data-pagelet='IGDMessagesList']")].filter(isVisible);
    if (roots.length !== 1) return '';
    const links = [...document.querySelectorAll("a[href*='/direct/t/']")].filter(isVisible);
    if (links.length !== 1) return '';
    const linkMatch = String(links[0].getAttribute?.('href') || '').match(/\/direct\/t\/([^/?#]+)/i);
    if (!linkMatch) return '';
    try {
      return decodeURIComponent(linkMatch[1]);
    } catch {
      return '';
    }
  }

  function sessionStop(expectedThreadId = '') {
    const observation = globalThis.InstaToolboxInstagramInspector?.inspectSession?.() || {};
    if (observation.sessionExpired) return 'Instagram signed you out';
    if (observation.challenge) return 'Instagram opened a security check';
    if (observation.actionBlocked) return 'Instagram blocked the action';
    if (observation.rateLimited) return 'Instagram asked you to slow down';
    const threadId = currentThreadId();
    if (!threadId) return 'The conversation is no longer open';
    if (expectedThreadId && threadId !== expectedThreadId) return 'The reviewed conversation changed';
    return null;
  }

  function watchThread(controller, expectedThreadId) {
    let timer;
    let observer;
    const check = () => {
      if (!controller.signal.aborted && currentThreadId() !== expectedThreadId) {
        controller.abort('Conversation changed. Unsend stopped.');
      }
    };
    const poll = () => {
      check();
      if (!controller.signal.aborted) timer = setTimeout(poll, 200);
    };
    const cleanup = () => {
      clearTimeout(timer);
      observer?.disconnect();
      globalThis.removeEventListener?.('popstate', check);
      globalThis.navigation?.removeEventListener?.('currententrychange', check);
      controller.signal.removeEventListener('abort', cleanup);
    };
    if (globalThis.MutationObserver && document.documentElement) {
      observer = new MutationObserver(check);
      observer.observe(document.documentElement, { childList: true, subtree: true });
    }
    globalThis.addEventListener?.('popstate', check);
    globalThis.navigation?.addEventListener?.('currententrychange', check);
    controller.signal.addEventListener('abort', cleanup, { once: true });
    poll();
    return cleanup;
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
    const roots = [...document.querySelectorAll("[data-pagelet='IGDMessagesList']")].filter(isVisible);
    const root = roots.length === 1 ? roots[0] : null;
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

  function stableMessageKey(row) {
    // Only identifiers whose attribute names explicitly describe a message are
    // safe across Instagram's recycled virtual-list nodes. Generic `id` and
    // `data-id` values often identify the physical slot, not the logical DM.
    for (const attribute of ['data-message-id', 'data-item-id']) {
      const value = String(row?.getAttribute?.(attribute) || '').trim();
      if (value) return `${attribute}:${value}`;
    }
    for (const element of row?.querySelectorAll?.('[data-message-id], [data-item-id]') || []) {
      for (const attribute of ['data-message-id', 'data-item-id']) {
        const value = String(element?.getAttribute?.(attribute) || '').trim();
        if (value) return `${attribute}:${value}`;
      }
    }
    return null;
  }

  function messagePositionFingerprint(row, traversal = null) {
    const scroller = traversal?.scroller || row?.parentElement;
    const rowRect = row?.getBoundingClientRect?.();
    const scrollerRect = scroller?.getBoundingClientRect?.();
    const siblings = [...(row?.parentElement?.children || [])];
    const ordinal = siblings.indexOf(row);
    const scrollTop = Number(scroller?.scrollTop);
    const relativeTop = Number(rowRect?.top) - Number(scrollerRect?.top);
    return [
      Number.isFinite(scrollTop) ? Math.round(scrollTop) : '',
      Number.isFinite(relativeTop) ? Math.round(relativeTop) : '',
      ordinal >= 0 ? ordinal : '',
    ].join(':');
  }

  function genericMessageHint(row) {
    for (const attribute of ['data-id', 'id']) {
      const value = String(row?.getAttribute?.(attribute) || '').trim();
      if (value) return `${attribute}:${value}`;
    }
    return '';
  }

  function messageFingerprint(row, traversal = null) {
    const timestamp = String(
      row?.querySelector?.('time[datetime]')?.getAttribute?.('datetime')
      || row?.querySelector?.('[data-timestamp]')?.getAttribute?.('data-timestamp')
      || '',
    );
    return digestText(JSON.stringify({
      key: stableMessageKey(row),
      genericHint: genericMessageHint(row),
      position: messagePositionFingerprint(row, traversal),
      timestamp,
      text: preview(row),
    }));
  }

  function processedMarkerMatches(row, traversal = null) {
    const key = stableMessageKey(row);
    if (key && traversal?.processedKeys?.has(key)) return true;
    if (!row?.hasAttribute?.(DONE_ATTRIBUTE)) return false;
    const marker = String(row.getAttribute?.(DONE_ATTRIBUTE) || '');
    if (marker && marker === messageFingerprint(row, traversal)) return true;
    // Instagram can recycle a virtualized row node for another message. A
    // marker tied to the old content must not hide the newly mounted message.
    row.removeAttribute?.(DONE_ATTRIBUTE);
    return false;
  }

  function candidateRows(scroller, traversal = null) {
    const container = deepestMessageContainer(scroller);
    let rows = [...(container?.children || [])];
    if (!rows.length) {
      rows = [...(scroller?.querySelectorAll?.('[role="row"], [role="listitem"]') || [])];
    }
    return rows
      .filter((row) => !processedMarkerMatches(row, traversal))
      .filter((row) => !row.hasAttribute?.(ACTIVE_ATTRIBUTE))
      .filter(hasMessageContent)
      .filter((row) => sentByCurrentUser(row, row.ownerDocument.defaultView));
  }

  function orderedCandidates(scroller, order = 'oldest', traversal = null) {
    const rows = candidateRows(scroller, traversal);
    const positioned = rows.map((row, index) => {
      const rect = row?.getBoundingClientRect?.();
      const top = Number(rect?.top);
      const bottom = Number(rect?.bottom);
      return {
        index,
        position: Number.isFinite(top) && Number.isFinite(bottom)
          ? (top + bottom) / 2
          : Number.NaN,
        row,
      };
    });
    const distinctPositions = new Set(
      positioned.filter(({ position }) => Number.isFinite(position)).map(({ position }) => position),
    );
    if (distinctPositions.size > 1) {
      const direction = order === 'newest' ? -1 : 1;
      return positioned
        .sort((left, right) => {
          if (!Number.isFinite(left.position)) return 1;
          if (!Number.isFinite(right.position)) return -1;
          return ((left.position - right.position) * direction) || (left.index - right.index);
        })
        .map(({ row }) => row);
    }
    // Geometry can be unavailable in detached/unit-test DOM. Fall back to the
    // visual ordering implied by the container's flex direction.
    const newestFirst = reversedLayout(scroller) ? rows : [...rows].reverse();
    return order === 'newest' ? newestFirst : newestFirst.reverse();
  }

  function firstVisibleCandidate(scroller, order = 'oldest', traversal = null) {
    const rows = orderedCandidates(scroller, order, traversal);
    return rows.find(isVisible) || null;
  }

  async function waitForElement(target, getter, signal, timeoutMs = 3_000) {
    if (signal?.aborted) throw new DOMException('The operation was stopped.', 'AbortError');
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

  function isDmMessageOptionsControl(control) {
    if (actionLabels.isDmMessageOptionsLabel(visibleText(control))) return true;
    return [...control?.querySelectorAll?.('[aria-label]') || []]
      .some((element) => actionLabels.isDmMessageOptionsLabel(visibleText(element)));
  }

  function actionButton(row) {
    const matches = [];
    for (const selector of actionLabels.dmActionSelectors) {
      for (const element of row.querySelectorAll?.(selector) || []) {
        const control = clickable(element, row) || (element.matches?.('button, [role="button"]') ? element : null);
        if (control) matches.push(control);
      }
    }
    return [...new Set(matches)]
      .filter(isDmMessageOptionsControl)
      .find(isVisible) || null;
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
    if (activeController?.signal.aborted) {
      throw new DOMException('The operation was stopped.', 'AbortError');
    }
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
    pending.catch(() => {});
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
    pending.catch(() => {});
    requireAuthorization(expectedThreadId, authorizationExpiresAt);
    activateControl(menuControl);
    const result = await pending;
    requireAuthorization(expectedThreadId, authorizationExpiresAt);
    if (result?.ambiguous) throw new Error('Instagram showed more than one new Unsend confirmation.');
    const dialogButton = result?.control;
    if (!dialogButton) return false;

    const before = removalEvidence(row);
    const closed = waitForElement(
      document.body,
      () => (!dialogButton.isConnected || !isVisible(dialogButton) ? true : null),
      signal,
      5_000,
    );
    const removed = waitForElement(
      document.body,
      () => (removalProven(row, before) ? true : null),
      signal,
      5_000,
    );
    closed.catch(() => {});
    removed.catch(() => {});
    requireAuthorization(expectedThreadId, authorizationExpiresAt);
    activateControl(dialogButton);
    // Parenthesised deliberately: `await closed !== true` binds as
    // `await (closed !== true)`, which is always true for a promise and made
    // every successful removal report as a failure.
    if ((await closed) !== true) return false;

    // Instagram may remove the row or replace it with an "unsent" placeholder.
    // A hidden hover control is not proof: require the reviewed row or its
    // message content to disappear or change.
    return (await removed) === true;
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
      return true;
    } finally {
      row.removeAttribute(ACTIVE_ATTRIBUTE);
      if (!success && !signal.aborted) await dismissStaleSurfaces(signal).catch(() => {});
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

  function advanceHistoryProgress(progress, height, rowCount) {
    const nextHeight = Math.max(0, Number(height) || 0);
    const nextRows = Math.max(0, Math.floor(Number(rowCount) || 0));
    return {
      grew: nextHeight > progress.maxHeight || nextRows > progress.maxRows,
      maxHeight: Math.max(progress.maxHeight, nextHeight),
      maxRows: Math.max(progress.maxRows, nextRows),
    };
  }

  async function loadAllHistory(context, signal) {
    const { root, scroller } = context;
    if (!scroller || scroller.scrollHeight <= scroller.clientHeight + 50) {
      return { complete: true, detectedCount: candidateRows(scroller || root).length, pagesChecked: 0 };
    }
    const reversed = reversedLayout(scroller);
    const startedAt = Date.now();
    let quietRounds = 0;
    let topNudgeUsed = false;
    let pagesChecked = 0;
    let progress = advanceHistoryProgress(
      { maxHeight: 0, maxRows: 0 },
      scroller.scrollHeight,
      candidateRows(scroller).length,
    );
    // Instagram pauses between pages on a long thread, so a few quiet rounds
    // does not mean the history ended. Giving up after three left most of a
    // long conversation unloaded, which is the same impatience the follower
    // scan had.
    for (let page = 0;
      page < 600 && quietRounds < 10 && Date.now() - startedAt < MAX_HISTORY_CHECK_MS;
      page += 1) {
      pagesChecked = page + 1;
      const stop = sessionStop(context.threadId);
      if (stop) throw new Error(stop);
      const target = oldestOffset(scroller, reversed);
      if (Math.abs(scroller.scrollTop - target) > 5) {
        scroller.scrollTop = target;
        dispatch(scroller, new Event('scroll', { bubbles: true }));
      } else if (!topNudgeUsed && quietRounds >= 2) {
        // Some Instagram builds only restart lazy history loading after real
        // movement at the oldest edge. Wake that loader once per loaded page,
        // not on every quiet poll: repeated nudges made the conversation look
        // as though the run was permanently fighting manual scrolling.
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
      progress = advanceHistoryProgress(
        progress,
        scroller.scrollHeight,
        candidateRows(scroller).length,
      );
      const { grew } = progress;
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
    progress = advanceHistoryProgress(
      progress,
      scroller.scrollHeight,
      candidateRows(scroller).length,
    );
    return {
      complete: quietRounds >= 10,
      // Instagram virtualizes long conversations. This is only the largest
      // simultaneously mounted sent-message window, never a proven total.
      detectedCount: progress.maxRows,
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

  function createTraversal(order = 'newest') {
    return {
      order: order === 'oldest' ? 'oldest' : 'newest',
      scroller: null,
      lastScrollTop: null,
      lastScrollHeight: 0,
      lastSearchGrew: false,
      lastSearchIncomplete: false,
      lastSearchSteps: 0,
      oldestBoundaryProven: order !== 'oldest',
      processedKeys: new Set(),
    };
  }

  function traversalContext(context, traversal) {
    let current = context;
    if (context?.threadId) {
      current = threadContext();
      if (!current.ok || current.threadId !== context.threadId) {
        throw new Error(current.reason || 'The reviewed conversation changed.');
      }
    }
    if (traversal.scroller !== current?.scroller) {
      if (traversal.order === 'oldest' && traversal.scroller) {
        traversal.oldestBoundaryProven = false;
      }
      traversal.scroller = current.scroller;
      traversal.lastScrollTop = null;
      traversal.lastScrollHeight = Number(current.scroller?.scrollHeight) || 0;
    }
    return current;
  }

  function traversalBounds(scroller, order) {
    const reversed = reversedLayout(scroller);
    const oldest = oldestOffset(scroller, reversed);
    const newest = newestOffset(scroller, reversed);
    const start = order === 'oldest' ? oldest : newest;
    const end = order === 'oldest' ? newest : oldest;
    return { start, end, direction: end >= start ? 1 : -1 };
  }

  function oldestBoundarySnapshot(context) {
    const scroller = context?.scroller;
    const rows = [...(deepestMessageContainer(scroller)?.children || [])];
    const rowEvidence = rows.map((row, index) => ({
      genericHint: genericMessageHint(row),
      index,
      key: stableMessageKey(row),
      text: visibleText(row).slice(0, 120),
      timestamp: String(
        row?.querySelector?.('time[datetime]')?.getAttribute?.('datetime')
        || row?.querySelector?.('[data-timestamp]')?.getAttribute?.('data-timestamp')
        || '',
      ),
    }));
    return {
      height: Number(scroller?.scrollHeight) || 0,
      loaderVisible: Boolean(visibleLoader(context?.root)),
      oldest: traversalBounds(scroller, 'oldest').start,
      rowCount: rows.length,
      rowSignature: digestText(JSON.stringify(rowEvidence)),
      scroller,
    };
  }

  async function proveStableOldestBoundary(
    context,
    traversal,
    signal,
    authorizationExpiresAt,
  ) {
    const startedAt = Date.now();
    let stableKey = '';
    let stableSince = 0;

    while (Date.now() - startedAt < MAX_HISTORY_CHECK_MS) {
      requireAuthorization(context.threadId, authorizationExpiresAt);
      const current = traversalContext(context, traversal);
      const before = oldestBoundarySnapshot(current);
      current.scroller.scrollTop = before.oldest;
      dispatch(current.scroller, new Event('scroll', { bubbles: true }));
      await delay(OLDEST_BOUNDARY_POLL_MS, signal);

      requireAuthorization(context.threadId, authorizationExpiresAt);
      const refreshed = traversalContext(context, traversal);
      const after = oldestBoundarySnapshot(refreshed);
      const atOldest = Math.abs(Number(after.scroller?.scrollTop) - after.oldest) <= 1;
      const replaced = before.scroller !== after.scroller;
      const changed = replaced
        || before.height !== after.height
        || before.rowCount !== after.rowCount
        || before.rowSignature !== after.rowSignature;
      const nextKey = [
        after.height,
        after.oldest,
        after.rowCount,
        after.rowSignature,
      ].join(':');

      if (!atOldest || after.loaderVisible || changed) {
        stableKey = '';
        stableSince = 0;
        continue;
      }
      if (stableKey !== nextKey) {
        stableKey = nextKey;
        stableSince = Date.now();
        continue;
      }
      if (Date.now() - stableSince >= OLDEST_BOUNDARY_STABLE_MS) {
        traversal.scroller = after.scroller;
        traversal.lastScrollTop = after.oldest;
        traversal.lastScrollHeight = after.height;
        traversal.lastSearchGrew = false;
        traversal.lastSearchIncomplete = false;
        traversal.lastSearchSteps = 0;
        traversal.oldestBoundaryProven = true;
        return refreshed;
      }
    }

    throw new Error('The oldest conversation boundary could not be proven before the safety timeout.');
  }

  function markProcessedRow(row, traversal, keyBeforeRemoval) {
    if (keyBeforeRemoval) traversal.processedKeys.add(keyBeforeRemoval);
    // Tie the marker to the postcondition DOM, not merely the physical node.
    // If Instagram recycles the node for a different message, the fingerprint
    // changes and candidateRows removes the stale marker.
    row.setAttribute?.(DONE_ATTRIBUTE, messageFingerprint(row, traversal));
  }

  function resetTraversalAfterRemoval(traversal, scroller, before = {}) {
    const scrollerChanged = Boolean(before.scroller && before.scroller !== scroller);
    const height = Number(scroller?.scrollHeight) || 0;
    const previousHeight = Number(before.scrollHeight);
    const shrank = Number.isFinite(previousHeight) && height + 1 < previousHeight;
    traversal.scroller = scroller;
    if (traversal.order === 'oldest' && (scrollerChanged || shrank)) {
      traversal.oldestBoundaryProven = false;
    }
    traversal.lastScrollTop = scrollerChanged || shrank
      ? null
      : Number.isFinite(Number(scroller?.scrollTop))
        ? Number(scroller.scrollTop)
        : traversal.lastScrollTop;
    traversal.lastScrollHeight = height;
    traversal.lastSearchGrew = false;
    traversal.lastSearchIncomplete = false;
    traversal.lastSearchSteps = 0;
  }

  async function reestablishTraversalEdge(context, traversal, signal) {
    for (let attempt = 0; attempt < MAX_SCAN_PASSES; attempt += 1) {
      if (signal.aborted) return null;
      const current = traversalContext(context, traversal);
      const scroller = current.scroller;
      const previousHeight = Number(traversal.lastScrollHeight) || 0;
      const { start } = traversalBounds(scroller, traversal.order);
      scroller.scrollTop = start;
      dispatch(scroller, new Event('scroll', { bubbles: true }));
      await delay(5, signal);

      const refreshed = traversalContext(context, traversal);
      if (refreshed.scroller !== scroller) continue;
      const refreshedStart = traversalBounds(scroller, traversal.order).start;
      const actualPosition = Number(scroller.scrollTop);
      const currentHeight = Number(scroller.scrollHeight) || 0;
      if (!Number.isFinite(actualPosition) || Math.abs(actualPosition - refreshedStart) > 1) {
        traversal.lastScrollTop = null;
        traversal.lastScrollHeight = currentHeight;
        continue;
      }
      if (currentHeight > previousHeight + 1) traversal.lastSearchGrew = true;
      traversal.lastScrollTop = actualPosition;
      traversal.lastScrollHeight = currentHeight;
      return refreshed;
    }
    traversal.lastSearchIncomplete = true;
    return null;
  }

  async function nextSentRow(
    context,
    signal,
    order = 'newest',
    traversal = createTraversal(order),
    authorizationExpiresAt = null,
  ) {
    traversal.order = order === 'oldest' ? 'oldest' : 'newest';
    traversal.lastSearchGrew = false;
    traversal.lastSearchIncomplete = false;
    traversal.lastSearchSteps = 0;

    let current = traversalContext(context, traversal);
    let scroller = current.scroller;
    const startingHeight = Number(scroller?.scrollHeight) || 0;
    if (traversal.lastScrollHeight && startingHeight + 1 < traversal.lastScrollHeight) {
      // A successful Unsend can shrink the scroll range. Resume from the
      // requested edge instead of retaining an offset outside the new range.
      traversal.lastScrollTop = null;
      if (traversal.order === 'oldest') traversal.oldestBoundaryProven = false;
    }
    traversal.lastScrollHeight = startingHeight;

    if (traversal.order === 'oldest' && !traversal.oldestBoundaryProven) {
      // Instagram can replace or shrink its virtual scroller after a removal.
      // Do not expose another oldest candidate until that new edge has remained
      // stable under the same bounded proof used before the first action.
      let provenContext = null;
      for (let attempt = 0; attempt < MAX_SCAN_PASSES; attempt += 1) {
        provenContext = await proveStableOldestBoundary(
          context,
          traversal,
          signal,
          authorizationExpiresAt,
        );
        const verifiedContext = traversalContext(provenContext, traversal);
        if (traversal.oldestBoundaryProven) {
          current = verifiedContext;
          scroller = verifiedContext.scroller;
          break;
        }
      }
      if (!traversal.oldestBoundaryProven || !provenContext) {
        throw new Error('The oldest conversation boundary changed before the next message could be selected.');
      }
    } else if (!Number.isFinite(traversal.lastScrollTop)) {
      current = await reestablishTraversalEdge(context, traversal, signal);
      if (!current) return null;
      scroller = current.scroller;
    }

    // Leave a comfortably visible row in place. This handles short threads and
    // the next mounted message after Instagram replaces a virtualized window.
    const visible = firstVisibleCandidate(scroller, traversal.order, traversal);
    if (visible && await exposeRow(visible, scroller, signal)) return visible;
    const [mounted] = orderedCandidates(scroller, traversal.order, traversal);
    if (mounted && await exposeRow(mounted, scroller, signal)) return mounted;

    for (let pass = 0; pass < MAX_SCAN_PASSES; pass += 1) {
      if (signal.aborted) return null;
      const stop = context.threadId ? sessionStop(context.threadId) : null;
      if (stop) throw new Error(stop);
      current = traversalContext(context, traversal);
      scroller = current.scroller;
      const heightBeforePass = Number(scroller?.scrollHeight) || 0;
      const { start, end, direction } = traversalBounds(scroller, traversal.order);
      const range = Math.abs(end - start);
      // Never jump farther than one third of the mounted viewport. Instagram's
      // virtual list can recycle every row between scroll events; overlapping
      // windows prevent sparse sent messages from falling between coarse steps.
      const viewportStep = Math.floor((Number(scroller?.clientHeight) || 90) / 3);
      const step = range < 500 ? 30 : Math.max(30, Math.min(150, viewportStep));
      let position = pass === 0 && Number.isFinite(traversal.lastScrollTop)
        ? Math.max(Math.min(traversal.lastScrollTop, Math.max(start, end)), Math.min(start, end))
        : start;

      while (traversal.lastSearchSteps < MAX_SCROLL_STEPS_PER_SEARCH) {
        if (signal.aborted) return null;
        const stepStop = context.threadId ? sessionStop(context.threadId) : null;
        if (stepStop) throw new Error(stepStop);
        traversal.lastScrollTop = position;
        scroller.scrollTop = position;
        dispatch(scroller, new Event('scroll', { bubbles: true }));
        traversal.lastSearchSteps += 1;
        await delay(5, signal);

        const row = firstVisibleCandidate(scroller, traversal.order, traversal);
        if (row && await exposeRow(row, scroller, signal)) {
          traversal.lastScrollHeight = Number(scroller?.scrollHeight) || heightBeforePass;
          return row;
        }
        if (position === end) break;
        position = direction > 0
          ? Math.min(end, position + step)
          : Math.max(end, position - step);
      }

      const heightAfterPass = Number(scroller?.scrollHeight) || 0;
      if (heightAfterPass > heightBeforePass + 1) traversal.lastSearchGrew = true;
      if (heightAfterPass + 1 < heightBeforePass) {
        traversal.lastScrollTop = null;
        if (traversal.order === 'oldest') traversal.oldestBoundaryProven = false;
      }
      traversal.lastScrollHeight = heightAfterPass;
      if (traversal.lastSearchSteps >= MAX_SCROLL_STEPS_PER_SEARCH && position !== end) {
        // Resume here on the next bounded search instead of repeatedly scanning
        // only the first 300k pixels of an unusually tall conversation.
        traversal.lastSearchIncomplete = true;
        return null;
      }
      // A new pass begins at the requested edge. This is intentional: the DOM
      // can shrink, grow, or swap nodes after any edge-triggered page load.
      traversal.lastScrollTop = null;
      await delay(30, signal);
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

  function removalEvidence(row) {
    if (!row?.isConnected) return 'row-removed';
    if (!hasMessageContent(row)) return 'content-removed';
    return preview(row);
  }

  function removalProven(row, before) {
    const after = removalEvidence(row);
    return after === 'row-removed'
      || after === 'content-removed'
      || (before && after && after !== before);
  }

  async function inspectAll() {
    if (activeController) {
      return { ready: false, reason: 'Another message check or run is already active.' };
    }
    const context = threadContext();
    if (!context.ok) return { ready: false, reason: context.reason };
    const controller = new AbortController();
    activeController = controller;
    const unwatch = watchThread(controller, context.threadId);
    publish({
      status: 'preparing',
      operation: 'check',
      processed: 0,
      failed: 0,
      message: 'Checking the full conversation without opening a message menu…',
      startedAt: new Date().toISOString(),
      finishedAt: null,
      canStop: true,
    });
    try {
      const history = await loadAllHistory(context, controller.signal);
      const detectedCount = Math.min(MAX_PLAN_MESSAGES, history.detectedCount);
      const result = Object.freeze({
        ready: true,
        threadId: context.threadId,
        detectedCount,
        countExact: false,
        complete: history.complete,
        pagesChecked: history.pagesChecked,
        reason: history.complete
          ? `At least ${detectedCount} sent message${detectedCount === 1 ? '' : 's'} detected. Instagram may keep other messages outside the mounted window.`
          : 'The bounded read-only check ended before the oldest history boundary was proven.',
        checkedAt: new Date().toISOString(),
      });
      publish({
        status: 'reviewed',
        message: result.reason,
        current: null,
        canStop: false,
        finishedAt: result.checkedAt,
      });
      return result;
    } catch (error) {
      const reason = error?.name === 'AbortError' || controller.signal.aborted
        ? 'Conversation check stopped.'
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
      unwatch();
      if (activeController === controller) activeController = null;
    }
  }

  async function start(options = {}) {
    if (activeController) return snapshot();
    const plan = validatePlan(options.plan);
    if (!plan) {
      publish({
        status: 'error',
        message: 'A fresh, thread-specific reviewed plan is required before Unsend can start.',
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

    const now = Date.now();
    for (const [digest, expiresAt] of consumedPlanDigests) {
      if (expiresAt <= now) consumedPlanDigests.delete(digest);
    }
    if (consumedPlanDigests.has(plan.reviewedDigest)) {
      publish({
        status: 'error',
        message: 'This reviewed Unsend plan was already used.',
        canStop: false,
        finishedAt: new Date().toISOString(),
      });
      return snapshot();
    }
    consumedPlanDigests.set(plan.reviewedDigest, plan.expiresAt);
    while (consumedPlanDigests.size > 128) {
      consumedPlanDigests.delete(consumedPlanDigests.keys().next().value);
    }

    const controller = new AbortController();
    activeController = controller;
    const signal = controller.signal;
    const unwatch = watchThread(controller, expectedThreadId);
    const maxFailures = Math.max(1, Math.min(10, Number(options.maxConsecutiveFailures) || DEFAULT_MAX_FAILURES));
    const authorizationExpiresAt = plan.expiresAt;
    // "all" is intentionally not bound to a virtual-DOM count. This ceiling
    // is only a catastrophic-loop guard, not a daily or user-facing quota.
    const maxMessages = plan.limit === null ? MAX_PLAN_MESSAGES : plan.limit;
    const order = plan.scope === 'oldest' ? 'oldest' : 'newest';
    const traversal = createTraversal(order);
    let processed = 0;
    let failed = 0;
    let retryAttempts = 0;
    let consecutiveFailures = 0;
    let lastUnsendAt = 0;
    let stableEmptyPasses = 0;
    let emptyGrowthRounds = 0;
    let exhausted = false;

    publish({
      status: 'preparing',
      operation: 'unsend',
      processed: 0,
      failed: 0,
      retryAttempts: 0,
      consecutiveFailures: 0,
      current: null,
      message: 'Finding sent messages…',
      startedAt: new Date().toISOString(),
      finishedAt: null,
      canStop: true,
    });

    try {
      let initialContext = traversalContext(context, traversal);
      if (plan.scope === 'oldest') {
        publish({
          status: 'preparing',
          current: null,
          message: 'Finding the oldest message boundary…',
        });
        initialContext = await proveStableOldestBoundary(
          context,
          traversal,
          signal,
          authorizationExpiresAt,
        );
      } else {
        const initialBounds = traversalBounds(initialContext.scroller, order);
        initialContext.scroller.scrollTop = initialBounds.start;
        dispatch(initialContext.scroller, new Event('scroll', { bubbles: true }));
        await delay(80, signal);
      }

      while (!signal.aborted && processed < maxMessages && consecutiveFailures < maxFailures) {
        if (authorizationExpiresAt <= Date.now()) {
          throw new Error('Live authorization expired before the next message.');
        }
        const stop = sessionStop(expectedThreadId);
        if (stop) throw new Error(stop);
        // Instagram can replace the virtualized message scroller while history
        // is loading or after an Unsend. Reacquire it before every message so a
        // detached container cannot turn a real plan into a false zero-item run.
        const currentContext = threadContext();
        if (!currentContext.ok || currentContext.threadId !== expectedThreadId) {
          throw new Error(currentContext.reason || 'The reviewed conversation changed.');
        }
        const row = await nextSentRow(
          currentContext,
          signal,
          order,
          traversal,
          authorizationExpiresAt,
        );
        if (!row) {
          if (traversal.lastSearchGrew || traversal.lastSearchIncomplete) {
            emptyGrowthRounds += 1;
            if (emptyGrowthRounds > MAX_EMPTY_GROWTH_ROUNDS) {
              throw new Error('The conversation kept changing before a stable end could be reached.');
            }
            stableEmptyPasses = 0;
            publish({
              status: 'preparing',
              current: null,
              message: 'Checking newly loaded messages…',
            });
            await delay(120, signal);
            continue;
          }
          stableEmptyPasses += 1;
          if (stableEmptyPasses < STABLE_EMPTY_PASSES) {
            publish({
              status: 'preparing',
              current: null,
              message: 'Checking for more sent messages…',
            });
            await delay(160, signal);
            continue;
          }
          exhausted = true;
          break;
        }
        stableEmptyPasses = 0;
        emptyGrowthRounds = 0;
        const label = preview(row);
        const keyBeforeRemoval = stableMessageKey(row);
        const traversalBeforeRemoval = {
          scroller: currentContext.scroller,
          scrollHeight: Number(currentContext.scroller?.scrollHeight) || 0,
        };
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
        let removalVerified = false;
        try {
          // unsendRow already proves the removal: the confirmation dialog
          // closed and the row either went away or lost its content and menu.
          // Re-checking isConnected here rejected every success, because
          // Instagram leaves an "unsent" placeholder row in the thread.
          await unsendRow(row, signal, expectedThreadId, authorizationExpiresAt);
          removalVerified = true;
        } catch (error) {
          if (signal.aborted) throw error;
          retryAttempts += 1;
          consecutiveFailures += 1;
          if (consecutiveFailures >= maxFailures) failed += 1;
          const backoff = Math.min(15_000, 1_000 * (2 ** (consecutiveFailures - 1)));
          publish({
            status: 'waiting',
            failed,
            retryAttempts,
            consecutiveFailures,
            current: label,
            message: consecutiveFailures >= maxFailures
              ? `Could not remove this message after ${consecutiveFailures} attempts.`
              : `Could not remove this message. Retrying in ${Math.round(backoff / 1_000)}s (${consecutiveFailures}/${maxFailures})…`,
          });
          if (consecutiveFailures >= maxFailures) break;
          await delay(backoff, signal);
          continue;
        }
        if (removalVerified) {
          processed += 1;
          consecutiveFailures = 0;
          lastUnsendAt = Date.now();
          markProcessedRow(row, traversal, keyBeforeRemoval);
          const afterRemovalContext = threadContext();
          if (!afterRemovalContext.ok || afterRemovalContext.threadId !== expectedThreadId) {
            throw new Error(afterRemovalContext.reason || 'The reviewed conversation changed.');
          }
          resetTraversalAfterRemoval(traversal, afterRemovalContext.scroller, traversalBeforeRemoval);
          if (typeof options.onVerifiedRemoval === 'function') {
            await options.onVerifiedRemoval(Object.freeze({
              processed,
              failed,
              retryAttempts,
              threadId: expectedThreadId,
              reviewedDigest: plan.reviewedDigest,
            }));
          }
          publish({
            status: 'running',
            processed,
            failed,
            retryAttempts,
            consecutiveFailures,
            current: null,
            message: `${processed} message${processed === 1 ? '' : 's'} unsent`,
          });
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
      } else if (plan.limit === null && processed >= MAX_PLAN_MESSAGES && !exhausted) {
        publish({
          status: 'error',
          message: `Safety stop after ${processed} verified removals. Start a fresh run to continue.`,
          processed,
          failed,
          current: null,
          canStop: false,
          finishedAt: new Date().toISOString(),
        });
      } else {
        const shortfall = plan.limit !== null && processed < plan.limit && exhausted;
        publish({
          status: 'completed',
          message: shortfall
            ? `Done. ${processed} message${processed === 1 ? '' : 's'} unsent; no more sent messages were found.`
            : `Done. ${processed} message${processed === 1 ? '' : 's'} unsent.`,
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
      unwatch();
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
  if (globalThis.__instaToolboxTestHooks === true) {
    publicApi.__test = Object.freeze({
      candidateRows,
      createTraversal,
      deepestMessageContainer,
      advanceHistoryProgress,
      actionButton,
      currentThreadId,
      hasMessageContent,
      isVisible,
      markProcessedRow,
      messageFingerprint,
      nextSentRow,
      oldestBoundarySnapshot,
      orderedCandidates,
      proveStableOldestBoundary,
      removalEvidence,
      removalProven,
      reversedLayout,
      rowNeedsReposition,
      resetTraversalAfterRemoval,
      reestablishTraversalEdge,
      sentByCurrentUser,
      stableMessageKey,
      traversalBounds,
      validatePlan,
      watchThread,
      requireAuthorization,
    });
  }
  Object.defineProperty(globalThis, 'InstaToolboxDmThreadUnsender', {
    configurable: false,
    enumerable: false,
    value: Object.freeze(publicApi),
    writable: false,
  });
})();

(() => {
  if (globalThis.__instaToolboxInspectorInstalled) return;
  const actionLabels = globalThis.__instaToolboxActionLabels;
  if (
    !actionLabels
    || typeof actionLabels.isDmUnsendLabel !== 'function'
    || typeof actionLabels.isDmMessageOptionsLabel !== 'function'
    || typeof actionLabels.normalizeActionLabel !== 'function'
    || typeof actionLabels.relationshipForLabel !== 'function'
  ) return;
  globalThis.__instaToolboxInspectorInstalled = true;

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
    "[role='button']",
  ]);
  const INSTAGRAM_WEB_ORIGIN = 'https://www.instagram.com';
  const INSTAGRAM_WEB_APP_ID = '936619743392459';
  const INSTAGRAM_WEB_ASBD_ID = '129477';
  const RELATIONSHIP_PAGE_SIZE = 50;
  const RELATIONSHIP_MAX_PAGES = 1_000;
  const RELATIONSHIP_MAX_ACCOUNTS = 25_000;
  const RELATIONSHIP_MAX_DURATION_MS = 20 * 60 * 1_000;
  const RELATIONSHIP_REQUEST_TIMEOUT_MS = 20_000;
  const RELATIONSHIP_REQUEST_ATTEMPTS = 3;
  const RELATIONSHIP_RETRY_BASE_MS = 1_000;
  let pendingRelationshipCooldown = null;

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

  function relationshipCount(...values) {
    for (const value of values) {
      if (value === null || value === undefined || typeof value === 'boolean' || String(value).trim() === '') continue;
      const number = Number(value);
      if (Number.isSafeInteger(number) && number >= 0) return number;
    }
    return null;
  }

  function detectAuthenticatedUsername() {
    const candidates = new Set();
    const anchors = [
      ...document.querySelectorAll('a[href]'),
    ];
    for (const anchor of anchors) {
      const labels = [
        anchor.getAttribute?.('aria-label'),
        ...[...anchor.querySelectorAll?.('[aria-label], img[alt]') || []]
          .flatMap((element) => [element.getAttribute?.('aria-label'), element.getAttribute?.('alt')]),
      ]
        .map((value) => String(value || '').normalize('NFKC').toLowerCase())
        .filter(Boolean);
      if (!labels.some((label) => label === 'profile' || label.includes('profile picture'))) continue;
      const username = normalizeUsername(anchor.getAttribute?.('href'));
      if (username) candidates.add(username);
    }
    return candidates.size === 1 ? [...candidates][0] : '';
  }

  function relationshipError(code, message) {
    const error = new Error(message);
    error.code = code;
    return error;
  }

  function relationshipRateLimit(response, now) {
    const raw = String(response?.headers?.get?.('Retry-After') || '').trim();
    let delayMs = null;
    if (/^\d+$/.test(raw)) {
      const seconds = Number(raw);
      if (Number.isSafeInteger(seconds) && seconds <= Number.MAX_SAFE_INTEGER / 1000) delayMs = seconds * 1000;
      else delayMs = Infinity;
    } else if (/^(Mon|Tue|Wed|Thu|Fri|Sat|Sun), /i.test(raw)) {
      const date = Date.parse(raw);
      if (Number.isFinite(date)) delayMs = Math.max(0, date - now());
    }
    return Object.assign(relationshipError('rate-limited', 'Instagram asked this session to wait before loading more accounts.'), {
      retryDelayMs: delayMs,
      cooldownSource: delayMs === null ? 'fallback' : 'server',
    });
  }

  async function waitForRelationshipCooldown(cooldown, { now, signal, sleepImpl, onProgress, username, listType, pages, found, expectedCount }) {
    if (!cooldown || !pendingRelationshipCooldown || pendingRelationshipCooldown.retryAt <= now()) return;
    const { retryAt, cooldownSource, attempt } = pendingRelationshipCooldown;
    if (!Number.isFinite(retryAt) || retryAt >= cooldown.deadline) {
      const message = Number.isFinite(retryAt) && retryAt <= 8.64e15
        ? `Instagram is rate limiting this check. Next retry no earlier than ${new Date(retryAt).toISOString()}. This run has stopped; saved comparison unchanged.`
        : 'Instagram requested a longer cooldown than this run supports. This run has stopped; saved comparison unchanged.';
      throw Object.assign(relationshipError('rate-limited', message), { cooldownPending: true });
    }
    while (now() < retryAt) {
      cooldown.assertActive();
      const remainingMs = retryAt - now();
      onProgress?.(Object.freeze({
        phase: 'cooldown', username, listType, pages, found, expectedCount,
        attempt, retryAt, remainingMs, cooldownSource,
      }));
      await sleepImpl(Math.min(1000, remainingMs), signal);
    }
    cooldown.assertActive();
  }

  function assertRelationshipRunActive(signal, startedAt, now, maxDurationMs) {
    if (signal?.aborted) throw relationshipError('stopped', 'Follower check stopped.');
    if (now() - startedAt > maxDurationMs) {
      throw relationshipError('time-limit', 'The follower check reached its 20-minute read limit.');
    }
    const session = inspectSession();
    if (session.sessionExpired) throw relationshipError('session-expired', 'Instagram requires a fresh login.');
    if (session.challenge) throw relationshipError('challenge', 'Instagram opened a security challenge.');
    if (session.actionBlocked) throw relationshipError('action-blocked', 'Instagram restricted activity.');
    if (session.rateLimited) throw relationshipError('rate-limited', 'Instagram asked this session to wait.');
  }

  function relationshipDelay(ms, signal, setTimer = setTimeout, clearTimer = clearTimeout) {
    if (!ms) return Promise.resolve();
    return new Promise((resolve, reject) => {
      if (signal?.aborted) {
        reject(relationshipError('stopped', 'Follower check stopped.'));
        return;
      }
      let timer = null;
      const stop = () => {
        if (timer !== null) clearTimer(timer);
        signal?.removeEventListener?.('abort', stop);
        reject(relationshipError('stopped', 'Follower check stopped.'));
      };
      timer = setTimer(() => {
        signal?.removeEventListener?.('abort', stop);
        resolve();
      }, ms);
      signal?.addEventListener?.('abort', stop, { once: true });
    });
  }

  function relationshipRunDeadline(sourceSignal, maxDurationMs, setTimer, clearTimer) {
    const controller = new AbortController();
    let timedOut = false;
    const stop = () => controller.abort();
    if (sourceSignal?.aborted) stop();
    else sourceSignal?.addEventListener?.('abort', stop, { once: true });
    const timer = setTimer(() => {
      timedOut = true;
      controller.abort();
    }, maxDurationMs);
    return Object.freeze({
      cleanup() {
        clearTimer(timer);
        sourceSignal?.removeEventListener?.('abort', stop);
      },
      signal: controller.signal,
      timedOut: () => timedOut,
    });
  }

  function relationshipResponseStop(data) {
    const message = String(data?.message || data?.error_type || '').toLowerCase();
    if (message.includes('challenge') || message.includes('checkpoint')) return 'challenge';
    if (message.includes('login') || message.includes('not logged')) return 'session-expired';
    if (message.includes('wait a few minutes') || message.includes('rate limit')) return 'rate-limited';
    if (message.includes('feedback_required') || message.includes('restrict certain activity')) return 'action-blocked';
    return '';
  }

  function relationshipStepWithTimeout(task, {
    clearTimer,
    setTimer,
    signal,
    timeoutMs,
  }) {
    return new Promise((resolve, reject) => {
      if (signal?.aborted) {
        reject(relationshipError('stopped', 'Follower check stopped.'));
        return;
      }
      const controller = new AbortController();
      let settled = false;
      const finish = (callback, value) => {
        if (settled) return;
        settled = true;
        clearTimer(timer);
        signal?.removeEventListener?.('abort', stop);
        callback(value);
      };
      const stop = () => {
        controller.abort();
        finish(reject, relationshipError('stopped', 'Follower check stopped.'));
      };
      const timer = setTimer(() => {
        controller.abort();
        finish(reject, relationshipError(
          'request-timeout',
          'Instagram did not finish this follower page within 20 seconds.',
        ));
      }, timeoutMs);
      signal?.addEventListener?.('abort', stop, { once: true });
      Promise.resolve()
        .then(() => task(controller.signal))
        .then((value) => finish(resolve, value))
        .catch((error) => {
          if (signal?.aborted) {
            finish(reject, relationshipError('stopped', 'Follower check stopped.'));
            return;
          }
          finish(reject, error);
        });
    });
  }

  async function fetchInstagramRelationshipJson(url, {
    clearTimer,
    cooldown = null,
    expectedCount = null,
    fetchImpl,
    found = 0,
    listType = null,
    now = Date.now,
    onProgress,
    pages = 0,
    random,
    requestAttempts,
    requestTimeoutMs,
    retryBaseMs,
    setTimer,
    signal,
    sleepImpl,
    username,
  }) {
    for (let attempt = 1; attempt <= requestAttempts; attempt += 1) {
      try {
        cooldown?.assertActive();
        await waitForRelationshipCooldown(cooldown, { now, signal, sleepImpl, onProgress, username, listType, pages, found, expectedCount });
        return await relationshipStepWithTimeout(async (attemptSignal) => {
          const response = await fetchImpl(url.href, {
            cache: 'no-store',
            credentials: 'include',
            headers: {
              'X-ASBD-ID': INSTAGRAM_WEB_ASBD_ID,
              'X-IG-App-ID': INSTAGRAM_WEB_APP_ID,
              'X-Requested-With': 'XMLHttpRequest',
            },
            method: 'GET',
            referrer: `${INSTAGRAM_WEB_ORIGIN}/${username}/`,
            referrerPolicy: 'strict-origin-when-cross-origin',
            signal: attemptSignal,
          });
          cooldown?.assertActive();
          // Error pages can be HTML. Classify status and redirects before decoding.
          if (response.status === 429) {
            throw relationshipRateLimit(response, now);
          }
          const responsePath = response.url ? new URL(response.url, url).pathname : '';
          if (/^\/(challenge|checkpoint)(\/|$)/.test(responsePath)) {
            throw relationshipError('challenge', 'Instagram opened a security challenge.');
          }
          if (response.status === 401 || /^\/accounts\/login(\/|$)/.test(responsePath)) {
            throw relationshipError('session-expired', 'Instagram requires a fresh login.');
          }
          let data = null;
          try {
            data = await response.json();
          } catch (error) {
            if (attemptSignal.aborted) throw error;
            if (error?.code === 'request-timeout' || error?.code === 'stopped') throw error;
            if (!response.ok) {
              throw relationshipError('request-failed', `Instagram could not load this account request (HTTP ${response.status || 'error'}).`);
            }
            throw relationshipError('invalid-response', 'Instagram returned an invalid account response. Reload your profile before trying again.');
          }
          const responseStop = relationshipResponseStop(data);
          if (response.status === 429 || responseStop === 'rate-limited') {
            throw relationshipRateLimit(response, now);
          }
          if (response.status === 401 || responseStop === 'session-expired') {
            throw relationshipError('session-expired', 'Instagram requires a fresh login.');
          }
          if (responseStop === 'challenge') {
            throw relationshipError('challenge', 'Instagram opened a security challenge.');
          }
          if (responseStop === 'action-blocked') {
            throw relationshipError('action-blocked', 'Instagram restricted activity.');
          }
          if (!response.ok || data?.status === 'fail') {
            throw relationshipError('request-failed', `Instagram could not load this follower page (HTTP ${response.status || 'error'}).`);
          }
          return data;
        }, { clearTimer, setTimer, signal, timeoutMs: requestTimeoutMs });
      } catch (error) {
        if (error?.code === 'rate-limited' && cooldown && !error.cooldownPending) {
          cooldown.assertActive();
          cooldown.attempts += 1;
          const delayMs = Math.max(1000, error.retryDelayMs
            ?? Math.min(60 * 60_000, 5 * 60_000 * (2 ** Math.min(cooldown.attempts - 1, 4))));
          const retryAt = now() + delayMs;
          pendingRelationshipCooldown = { retryAt, cooldownSource: error.cooldownSource || 'fallback', attempt: cooldown.attempts };
          if (cooldown.attempts > 8) {
            error.message = 'Instagram is still rate limiting this check. Automatic retries stopped; saved comparison unchanged.';
            throw error;
          }
          await waitForRelationshipCooldown(cooldown, { now, signal, sleepImpl, onProgress, username, listType, pages, found, expectedCount });
          attempt -= 1;
          continue;
        }
        let retryable = error?.code === 'request-timeout' || error?.code === 'network-error';
        if (signal?.aborted || error?.code === 'stopped') {
          throw relationshipError('stopped', 'Follower check stopped.');
        }
        if (!error?.code && error?.name === 'AbortError') {
          retryable = true;
        } else if (!error?.code) {
          retryable = true;
          error = relationshipError('network-error', 'Instagram follower data could not be reached from this tab.');
        }
        if (!retryable || attempt >= requestAttempts) {
          if (retryable) {
            throw relationshipError(
              'request-timeout',
              `Instagram did not finish this ${listType || 'account'} request after ${requestAttempts} attempts. The previous comparison is unchanged.`,
            );
          }
          throw error;
        }
        const retryDelayMs = Math.min(
          5_000,
          (retryBaseMs * attempt) + Math.floor(Math.max(0, Math.min(0.999999, random())) * 250),
        );
        onProgress?.(Object.freeze({
          attempt: attempt + 1,
          failedAttempt: attempt,
          found,
          expectedCount,
          listType,
          maxAttempts: requestAttempts,
          pages,
          phase: 'retrying',
          retryDelayMs,
          username,
        }));
        await sleepImpl(retryDelayMs, signal);
      }
    }
    throw relationshipError('request-timeout', 'Instagram follower data did not finish.');
  }

  async function resolveRelationshipUserId(username, options) {
    const url = new URL('/api/v1/web/search/topsearch/', INSTAGRAM_WEB_ORIGIN);
    url.searchParams.set('context', 'blended');
    url.searchParams.set('query', username);
    url.searchParams.set('include_reel', 'false');
    const data = await fetchInstagramRelationshipJson(url, options);
    const exact = (Array.isArray(data?.users) ? data.users : [])
      .map((entry) => entry?.user)
      .find((user) => normalizeUsername(user?.username) === username);
    const userId = String(exact?.pk || '').trim();
    if (!/^\d+$/.test(userId)) {
      throw relationshipError('username-not-found', `Instagram could not resolve @${username}.`);
    }
    return {
      userId,
    };
  }

  async function resolveRelationshipProfileCounts(username, userId, options) {
    const url = new URL('/api/v1/users/web_profile_info/', INSTAGRAM_WEB_ORIGIN);
    url.searchParams.set('username', username);
    const data = await fetchInstagramRelationshipJson(url, options);
    const profile = data?.data?.user;
    const resolvedUsername = normalizeUsername(profile?.username);
    const resolvedUserId = String(profile?.id || profile?.pk || '').trim();
    if (resolvedUsername !== username || resolvedUserId !== userId) {
      throw relationshipError(
        'profile-mismatch',
        `Instagram did not return the exact profile counters for @${username}. The previous comparison is unchanged.`,
      );
    }
    const followers = relationshipCount(
      profile?.edge_followed_by?.count,
      profile?.follower_count,
      profile?.followers_count,
    );
    const following = relationshipCount(
      profile?.edge_follow?.count,
      profile?.following_count,
      profile?.follows_count,
    );
    if (!Number.isSafeInteger(followers) || !Number.isSafeInteger(following)) {
      throw relationshipError(
        'profile-count-unavailable',
        `Instagram did not provide verified follower and following totals for @${username}. The previous comparison is unchanged.`,
      );
    }
    return Object.freeze({ followers, following });
  }

  function openProfileRelationshipCounts(username) {
    if (normalizeUsername(location.pathname) !== username) return null;
    const followers = exactProfileListCount('followers', { requireScoped: true });
    const following = exactProfileListCount('following', { requireScoped: true });
    if (!Number.isSafeInteger(followers) || !Number.isSafeInteger(following)) return null;
    return Object.freeze({ followers, following });
  }

  function exactProfileCountDisagreement(username, profileCounts) {
    if (normalizeUsername(location.pathname) !== username) {
      return Object.freeze({ followers: false, following: false });
    }
    const followers = exactProfileListCount('followers');
    const following = exactProfileListCount('following');
    return Object.freeze({
      followers: Number.isSafeInteger(followers) && followers !== profileCounts.followers,
      following: Number.isSafeInteger(following) && following !== profileCounts.following,
    });
  }

  function finalizeRelationshipList(list, {
    countChanged,
    countDisagreed,
    expectedCount,
  }) {
    if (countChanged) {
      return Object.freeze({
        ...list,
        complete: false,
        expectedCount,
        reason: 'count-changed',
      });
    }
    if (countDisagreed) {
      return Object.freeze({
        ...list,
        complete: false,
        expectedCount,
        reason: 'profile-count-disagreement',
      });
    }
    return list;
  }

  async function fetchRelationshipList(listType, userId, username, {
    clearTimer,
    cooldown,
    fetchImpl,
    maxAccounts,
    maxDurationMs,
    maxPages,
    now,
    onProgress,
    random,
    requestAttempts,
    requestTimeoutMs,
    retryBaseMs,
    setTimer,
    signal,
    sleepImpl,
    startedAt,
    expectedCount = null,
  }) {
    const accounts = new Map();
    const accountKeyByUsername = new Map();
    const seenTokens = new Set();
    let nextMaxId = '';
    let pages = 0;
    let stagnantPages = 0;
    let instagramLimited = false;
    while (pages < maxPages && accounts.size < maxAccounts) {
      assertRelationshipRunActive(signal, startedAt, now, maxDurationMs);
      const url = new URL(`/api/v1/friendships/${userId}/${listType}/`, INSTAGRAM_WEB_ORIGIN);
      url.searchParams.set('count', String(RELATIONSHIP_PAGE_SIZE));
      url.searchParams.set('search_surface', 'follow_list_page');
      url.searchParams.set('query', '');
      url.searchParams.set('enable_groups', 'true');
      if (listType === 'following') url.searchParams.set('includes_hashtags', 'false');
      if (nextMaxId) url.searchParams.set('max_id', nextMaxId);
      const data = await fetchInstagramRelationshipJson(url, {
        clearTimer,
        cooldown,
        expectedCount,
        fetchImpl,
        found: accounts.size,
        listType,
        now,
        onProgress,
        pages,
        random,
        requestAttempts,
        requestTimeoutMs,
        retryBaseMs,
        setTimer,
        signal,
        sleepImpl,
        username,
      });
      if (!Array.isArray(data?.users)) {
        throw relationshipError('invalid-response', `Instagram returned an invalid ${listType} page.`);
      }
      for (const flag of ['has_more', 'should_limit_list_of_followers']) {
        if (Object.prototype.hasOwnProperty.call(data, flag) && typeof data[flag] !== 'boolean') {
          throw relationshipError('invalid-response', `Instagram returned an invalid ${listType} pagination flag.`);
        }
      }
      instagramLimited ||= data.should_limit_list_of_followers === true;
      pages += 1;
      const beforePageCount = accounts.size;
      for (const user of data.users) {
        const accountUsername = normalizeUsername(user?.username);
        if (!accountUsername) continue;
        const rawAccountId = user?.pk ?? user?.id ?? '';
        const accountId = String(rawAccountId || '').trim();
        if (accountId && !/^\d+$/.test(accountId)) {
          throw relationshipError('invalid-response', `Instagram returned an invalid ${listType} account ID.`);
        }
        const accountKey = accountId ? `id:${accountId}` : `username:${accountUsername}`;
        const usernameOwner = accountKeyByUsername.get(accountUsername);
        if (usernameOwner && usernameOwner !== accountKey) {
          if (usernameOwner === `username:${accountUsername}` && accountId) {
            accounts.delete(usernameOwner);
          } else {
            throw relationshipError(
              'invalid-response',
              `Instagram returned conflicting ${listType} account identities.`,
            );
          }
        }
        const previous = accounts.get(accountKey);
        if (previous?.username && previous.username !== accountUsername) {
          accountKeyByUsername.delete(previous.username);
        }
        accounts.set(accountKey, {
          username: accountUsername,
          profileUrl: `${INSTAGRAM_WEB_ORIGIN}/${accountUsername}/`,
          displayName: String(user?.full_name || '').trim().slice(0, 160),
          source: 'authenticated-instagram-web',
        });
        accountKeyByUsername.set(accountUsername, accountKey);
        if (accounts.size >= maxAccounts) break;
      }
      stagnantPages = accounts.size > beforePageCount ? 0 : stagnantPages + 1;
      onProgress?.(Object.freeze({
        expectedCount,
        found: accounts.size,
        listType,
        pages,
        phase: 'loading',
        username,
      }));
      const sortedAccounts = () => [...accounts.values()]
        .sort((left, right) => left.username.localeCompare(right.username));
      const candidateToken = stagnantPages >= 3 ? null : data.next_max_id;
      if (candidateToken === undefined || candidateToken === null || candidateToken === '') {
        const countReconciled = Number.isSafeInteger(expectedCount)
          && accounts.size === expectedCount && !instagramLimited
          && data.has_more !== true && stagnantPages < 3;
        return {
          accounts: sortedAccounts(),
          complete: countReconciled,
          expectedCount,
          pages,
          reason: countReconciled
            ? 'pagination-complete'
            : instagramLimited
              ? 'instagram-limited-list'
              : data.has_more === true
                ? 'cursor-missing'
                : Number.isSafeInteger(expectedCount) ? 'count-mismatch' : 'count-unverified',
        };
      }
      nextMaxId = String(candidateToken);
      if (!nextMaxId || nextMaxId.length > 500) {
        throw relationshipError('invalid-pagination', `Instagram returned an unsafe ${listType} pagination token.`);
      }
      if (seenTokens.has(nextMaxId)) {
        return {
          accounts: sortedAccounts(),
          complete: false,
          expectedCount,
          pages,
          reason: 'count-mismatch',
        };
      }
      seenTokens.add(nextMaxId);
      const delayMs = Math.floor(800 + (Math.max(0, Math.min(0.999999, random())) * 700));
      await sleepImpl(delayMs, signal);
    }
    return {
      accounts: [...accounts.values()]
        .sort((left, right) => left.username.localeCompare(right.username)),
      complete: false,
      expectedCount,
      pages,
      reason: accounts.size >= maxAccounts ? 'account-limit' : 'page-limit',
    };
  }

  async function fetchFollowerComparison({
    clearTimer = clearTimeout,
    fetchImpl = globalThis.fetch?.bind(globalThis),
    maxAccounts = RELATIONSHIP_MAX_ACCOUNTS,
    maxDurationMs = RELATIONSHIP_MAX_DURATION_MS,
    maxPages = RELATIONSHIP_MAX_PAGES,
    now = Date.now,
    onProgress = null,
    random = Math.random,
    requestAttempts = RELATIONSHIP_REQUEST_ATTEMPTS,
    requestTimeoutMs = RELATIONSHIP_REQUEST_TIMEOUT_MS,
    retryBaseMs = RELATIONSHIP_RETRY_BASE_MS,
    retryRateLimits = false,
    signal = null,
    sleepImpl = relationshipDelay,
    setTimer = setTimeout,
    username: requestedUsername,
  } = {}) {
    const username = normalizeUsername(requestedUsername);
    if (!username) throw relationshipError('invalid-username', 'Enter a valid Instagram username.');
    const pageOrigin = String(location?.origin || '');
    if (pageOrigin !== INSTAGRAM_WEB_ORIGIN) {
      throw relationshipError('wrong-origin', 'Open instagram.com before running the follower check.');
    }
    if (typeof fetchImpl !== 'function') {
      throw relationshipError('fetch-unavailable', 'This browser context cannot load Instagram follower data.');
    }
    const boundedPages = Math.max(1, Math.min(RELATIONSHIP_MAX_PAGES, Math.trunc(Number(maxPages) || 0)));
    const boundedAccounts = Math.max(1, Math.min(RELATIONSHIP_MAX_ACCOUNTS, Math.trunc(Number(maxAccounts) || 0)));
    const boundedDuration = Math.max(1_000, Math.min(RELATIONSHIP_MAX_DURATION_MS, Math.trunc(Number(maxDurationMs) || 0)));
    const boundedAttempts = Math.max(1, Math.min(RELATIONSHIP_REQUEST_ATTEMPTS, Math.trunc(Number(requestAttempts) || 0)));
    const boundedRequestTimeout = Math.max(1, Math.min(RELATIONSHIP_REQUEST_TIMEOUT_MS, Math.trunc(Number(requestTimeoutMs) || 0)));
    const boundedRetryBase = Math.max(0, Math.min(5_000, Math.trunc(Number(retryBaseMs) || 0)));
    const deadline = relationshipRunDeadline(signal, boundedDuration, setTimer, clearTimer);
    const runSignal = deadline.signal;
    try {
      const startedAt = now();
      assertRelationshipRunActive(runSignal, startedAt, now, boundedDuration);
      const initialPath = location.pathname;
      const cooldown = retryRateLimits === true ? {
        attempts: 0,
        deadline: startedAt + boundedDuration,
        assertActive() {
          assertRelationshipRunActive(runSignal, startedAt, now, boundedDuration);
          if (location.origin !== pageOrigin || location.pathname !== initialPath) {
            throw relationshipError('profile-mismatch', 'The open profile changed. Follower check stopped.');
          }
        },
      } : null;
      onProgress?.(Object.freeze({ found: 0, listType: null, pages: 0, phase: 'resolving', username }));
      const common = {
        cooldown,
        fetchImpl,
        maxAccounts: boundedAccounts,
        maxDurationMs: boundedDuration,
        maxPages: boundedPages,
        now,
        onProgress,
        random,
        requestAttempts: boundedAttempts,
        requestTimeoutMs: boundedRequestTimeout,
        retryBaseMs: boundedRetryBase,
        clearTimer,
        setTimer,
        signal: runSignal,
        sleepImpl,
        startedAt,
      };
      const openProfileCounts = openProfileRelationshipCounts(username);
      const resolution = await resolveRelationshipUserId(username, {
        ...common,
        found: 0,
        listType: null,
        pages: 0,
        username,
      });
      const { userId } = resolution;
      onProgress?.(Object.freeze({ found: 0, listType: null, pages: 0, phase: 'verifying-profile', username }));
      const profileCountsAtStart = openProfileCounts || await resolveRelationshipProfileCounts(username, userId, {
        ...common,
        found: 0,
        listType: null,
        pages: 0,
        username,
      });
      onProgress?.(Object.freeze({
        expectedCounts: profileCountsAtStart,
        found: 0,
        listType: null,
        pages: 0,
        phase: 'counts-ready',
        username,
      }));
      const countDisagreementAtStart = exactProfileCountDisagreement(username, profileCountsAtStart);
      const followersTraversal = await fetchRelationshipList('followers', userId, username, {
        ...common,
        expectedCount: profileCountsAtStart.followers,
      });
      const followingTraversal = await fetchRelationshipList('following', userId, username, {
        ...common,
        expectedCount: profileCountsAtStart.following,
      });
      assertRelationshipRunActive(runSignal, startedAt, now, boundedDuration);
      onProgress?.(Object.freeze({
        found: followersTraversal.accounts.length + followingTraversal.accounts.length,
        listType: null,
        pages: followersTraversal.pages + followingTraversal.pages,
        phase: 'revalidating-profile',
        username,
      }));
      const profileCountsAtEnd = openProfileCounts
        ? openProfileRelationshipCounts(username)
        : await resolveRelationshipProfileCounts(username, userId, {
          ...common,
          found: followersTraversal.accounts.length + followingTraversal.accounts.length,
          listType: null,
          pages: followersTraversal.pages + followingTraversal.pages,
          username,
        });
      if (!profileCountsAtEnd) {
        throw relationshipError('profile-count-unavailable', 'Keep the checked profile open until the comparison finishes. The previous comparison is unchanged.');
      }
      const countDisagreementAtEnd = exactProfileCountDisagreement(username, profileCountsAtEnd);
      const followers = finalizeRelationshipList(followersTraversal, {
        countChanged: profileCountsAtStart.followers !== profileCountsAtEnd.followers,
        countDisagreed: countDisagreementAtStart.followers || countDisagreementAtEnd.followers,
        expectedCount: profileCountsAtEnd.followers,
      });
      const following = finalizeRelationshipList(followingTraversal, {
        countChanged: profileCountsAtStart.following !== profileCountsAtEnd.following,
        countDisagreed: countDisagreementAtStart.following || countDisagreementAtEnd.following,
        expectedCount: profileCountsAtEnd.following,
      });
      const expectedCounts = Object.freeze({
        followers: profileCountsAtEnd.followers,
        following: profileCountsAtEnd.following,
      });
      const capturedAt = new Date(now()).toISOString();
      const result = Object.freeze({
        capturedAt,
        complete: Object.freeze({ followers: followers.complete, following: following.complete }),
        expectedCounts: Object.freeze({ followers: followers.expectedCount, following: following.expectedCount }),
        followers: Object.freeze(followers.accounts),
        following: Object.freeze(following.accounts),
        pages: Object.freeze({ followers: followers.pages, following: following.pages }),
        reasons: Object.freeze({ followers: followers.reason, following: following.reason }),
        source: 'authenticated-instagram-web',
        userId,
        username,
      });
      onProgress?.(Object.freeze({
        found: result.followers.length + result.following.length,
        listType: null,
        pages: result.pages.followers + result.pages.following,
        phase: 'complete',
        username,
      }));
      return result;
    } catch (error) {
      if (deadline.timedOut() && error?.code === 'stopped') {
        throw relationshipError('time-limit', 'The follower check reached its 20-minute read limit.');
      }
      throw error;
    } finally {
      deadline.cleanup();
    }
  }

  function followerComparisonSummary(workspace) {
    const completeList = (type) => workspace?.verified?.[type] === true && workspace?.complete?.[type] === true;
    const complete = completeList('followers') && completeList('following');
    const available = complete || ['followers', 'following'].some((type) => (
      workspace?.verified?.[type] === true || (Array.isArray(workspace?.[type]) && workspace[type].length > 0)
    ));
    const verifiedPartial = !complete && ['followers', 'following'].some((type) => (
      workspace?.verified?.[type] === true && workspace?.complete?.[type] !== true
    ));
    return {
      available,
      complete,
      labels: {
        mutuals: 'Mutuals',
        notFollowingMeBack: complete ? "Don't follow you back" : 'Not found in followers',
        iDoNotFollowBack: complete ? "You don't follow back" : 'Not found in following',
      },
      warning: complete ? '' : 'Partial comparison — captured accounts only. Someone missing from a list may still be a mutual. The missing accounts and the reason are unknown; check profiles before acting.',
      ageFilterGuidance: verifiedPartial
        ? 'Possible viewer-age filtering: Instagram may hide age-restricted accounts if the signed-in account has no birthday. Check Accounts Center, reload, and retry. Other causes are possible.'
        : '',
      accountsCenterUrl: verifiedPartial
        ? 'https://accountscenter.instagram.com/personal_info'
        : '',
    };
  }

  function followerComparisonRecord(workspace, comparison, generatedAt = new Date().toISOString()) {
    const summary = followerComparisonSummary(workspace);
    return {
      schemaVersion: 1,
      kind: 'insta-toolbox-comparison',
      generatedAt,
      subjectUsername: normalizeUsername(workspace?.subjectUsername),
      source: workspace?.source && typeof workspace.source === 'object' ? workspace.source : {},
      complete: workspace?.complete && typeof workspace.complete === 'object' ? workspace.complete : {},
      verified: workspace?.verified && typeof workspace.verified === 'object' ? workspace.verified : {},
      partial: !summary.complete,
      labels: summary.labels,
      warning: summary.warning,
      ageFilterGuidance: summary.ageFilterGuidance,
      accountsCenterUrl: summary.accountsCenterUrl,
      mutuals: Array.isArray(comparison?.mutuals) ? comparison.mutuals : [],
      notFollowingMeBack: Array.isArray(comparison?.notFollowingMeBack)
        ? comparison.notFollowingMeBack
        : [],
      iDoNotFollowBack: Array.isArray(comparison?.iDoNotFollowBack)
        ? comparison.iDoNotFollowBack
        : [],
    };
  }

  function followerComparisonReport(workspace, comparison, generatedAt = new Date().toISOString()) {
    const record = followerComparisonRecord(workspace, comparison, generatedAt);
    const followersCount = Array.isArray(workspace?.followers) ? workspace.followers.length : 0;
    const followingCount = Array.isArray(workspace?.following) ? workspace.following.length : 0;
    const fullyVerified = record.verified.followers === true && record.verified.following === true;
    const fullyComplete = fullyVerified
      && record.complete.followers === true
      && record.complete.following === true;
    const source = record.source.followers === 'authenticated-web'
      && record.source.following === 'authenticated-web'
      ? 'Authenticated Instagram web pagination'
      : record.source.followers === 'list-dialog' && record.source.following === 'list-dialog'
        ? 'Instagram list-dialog capture'
        : 'Mixed local captures';
    const lines = [
      'INSTA TOOLBOX MUTUAL CHECK',
      '================================',
      `Account: ${record.subjectUsername ? `@${record.subjectUsername}` : 'Not recorded'}`,
      `Generated: ${record.generatedAt}`,
      `Source: ${source}`,
      `Completeness: ${fullyComplete ? 'Complete — both lists reached their verified end.' : 'Partial — one or both saved lists may omit accounts.'}`,
      ...(record.warning ? [record.warning] : []),
      ...(record.ageFilterGuidance ? [record.ageFilterGuidance] : []),
      ...(record.accountsCenterUrl ? [`Accounts Center: ${record.accountsCenterUrl}`] : []),
      '',
      'SUMMARY',
      '-------',
      `Followers: ${followersCount.toLocaleString('en-US')}`,
      `Following: ${followingCount.toLocaleString('en-US')}`,
      `Mutual followers: ${record.mutuals.length.toLocaleString('en-US')}`,
      `${fullyComplete ? 'Not following you back' : record.labels.notFollowingMeBack}: ${record.notFollowingMeBack.length.toLocaleString('en-US')}`,
      `${fullyComplete ? 'You do not follow back' : record.labels.iDoNotFollowBack}: ${record.iDoNotFollowBack.length.toLocaleString('en-US')}`,
    ];
    const addSection = (title, accounts) => {
      lines.push('', title, '-'.repeat(title.length));
      if (!accounts.length) {
        lines.push('None');
        return;
      }
      accounts.forEach((account, index) => {
        const username = normalizeUsername(account?.username);
        const displayName = String(account?.displayName || '').trim();
        lines.push(`${index + 1}. @${username}${displayName ? ` — ${displayName}` : ''}`);
      });
    };
    addSection(fullyComplete ? 'NOT FOLLOWING YOU BACK' : record.labels.notFollowingMeBack.toUpperCase(), record.notFollowingMeBack);
    addSection(fullyComplete ? 'YOU DO NOT FOLLOW BACK' : record.labels.iDoNotFollowBack.toUpperCase(), record.iDoNotFollowBack);
    addSection('MUTUAL FOLLOWERS', record.mutuals);
    lines.push('', 'Generated locally by Insta Toolbox. No account action was performed.', '');
    return lines.join('\r\n');
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
    const explicitlyMarked = [...(row?.querySelectorAll?.('[data-insta-toolbox-message-content]') || [])];
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
    return [...new Set(matches)].filter((control) => (
      actionLabels.isDmMessageOptionsLabel(visibleText(control))
      || [...control?.querySelectorAll?.('[aria-label]') || []]
        .some((element) => actionLabels.isDmMessageOptionsLabel(visibleText(element)))
    ));
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

  function captureVisibleAccounts(expectedListType = '') {
    const listContext = accountListDialog(expectedListType);
    const roots = listContext ? [listContext.dialog] : [];
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

  function accountListTypeFromText(value) {
    const label = String(value || '')
      .normalize('NFKC')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
    if (/^followers(?:\s|$)/.test(label)) return 'followers';
    if (/^following(?:\s|$)/.test(label)) return 'following';
    return '';
  }

  function accountListDialog(expectedListType = '') {
    const expected = expectedListType === 'followers' || expectedListType === 'following'
      ? expectedListType
      : '';
    for (const dialog of visibleDialogs()) {
      const heading = [...dialog.querySelectorAll('[role="heading"], h1, h2')]
        .map((element) => visibleText(element))
        .find(Boolean);
      const firstLine = visibleText(dialog)
        .split(/\r?\n/)
        .map((line) => line.trim())
        .find(Boolean);
      const observedTypes = new Set(
        [dialog.getAttribute('aria-label'), heading, firstLine]
          .map(accountListTypeFromText)
          .filter(Boolean),
      );
      if (observedTypes.size !== 1) continue;
      const [observed] = observedTypes;
      if (observed && (!expected || observed === expected)) {
        return { dialog, listType: observed };
      }
    }
    return null;
  }

  function exactProfileListCount(listType, { requireScoped = false } = {}) {
    if (listType !== 'followers' && listType !== 'following') return null;
    const profileUsername = normalizeUsername(location.pathname);
    const profileHeader = requireScoped ? verifiedProfileHeader(profileUsername).root : null;
    const scopedCounts = new Set();
    const fallbackCounts = new Set();
    for (const link of document.querySelectorAll('a[role="link"], a[href="#"]')) {
      if (!visibleText(link) || link.closest?.('[hidden], [aria-hidden="true"], [role="dialog"]')) continue;
      const values = [
        link.getAttribute('title'),
        visibleText(link),
      ];
      const exactTitle = link.querySelector?.('[title]')?.getAttribute('title');
      if (exactTitle && new RegExp(`\\b${listType}$`, 'i').test(visibleText(link).trim())) {
        values.push(`${exactTitle} ${listType}`);
      }
      for (const value of values) {
        const label = String(value || '')
          .normalize('NFKC')
          .replace(/[\u00a0\u202f]/g, ' ')
          .replace(/\s+/g, ' ')
          .trim()
          .toLowerCase();
        const match = label.match(/^([0-9][0-9., ]*)\s+(followers|following)$/);
        if (!match || match[2] !== listType) continue;
        if (!/^(?:\d+|\d{1,3}([,. ])\d{3}(?:\1\d{3})*)$/.test(match[1])) continue;
        const digits = match[1].replace(/\D/g, '');
        if (!digits) continue;
        const count = Number(digits);
        if (!Number.isSafeInteger(count)) continue;
        fallbackCounts.add(count);
        const href = link.getAttribute?.('href');
        if (!href || !profileUsername) continue;
        // Instagram also renders profile counters as non-navigation links.
        // Trust those only inside the uniquely identified current profile header.
        if (href === '#' && profileHeader?.contains(link)) {
          scopedCounts.add(count);
          continue;
        }
        try {
          const target = new URL(href, INSTAGRAM_WEB_ORIGIN);
          if (target.origin !== INSTAGRAM_WEB_ORIGIN) continue;
          const pathname = target.pathname
            .replace(/\/+$/, '')
            .toLowerCase();
          if (pathname === `/${profileUsername}/${listType}`) scopedCounts.add(count);
        } catch {
          // Ignore malformed, non-navigation values such as JavaScript URLs.
        }
      }
    }
    if (scopedCounts.size === 1) return [...scopedCounts][0];
    if (!requireScoped && !scopedCounts.size && fallbackCounts.size === 1) return [...fallbackCounts][0];
    return null;
  }

  function sleep(ms) {
    return new Promise((resolve) => { setTimeout(resolve, ms); });
  }

  // Scrolls the open followers/following dialog to enumerate the full list.
  // Read-only: it only scrolls an already-open list and reads rendered rows.
  async function collectAccountList({ maxScrolls = 1_200, settleMs = 500, listType = '' } = {}) {
    const session = inspectSession();
    if (session.sessionExpired || session.challenge || session.actionBlocked || session.rateLimited) {
      return { ...session, accounts: [], complete: false, reason: 'session-stop' };
    }
    let expectedListType = listType === 'followers' || listType === 'following' ? listType : '';
    let listContext = accountListDialog(expectedListType);
    let root = listContext?.dialog || null;
    let scroller = scrollableWithin(root);
    if (!root) {
      return { ...session, accounts: [], complete: false, reason: 'open-a-followers-or-following-list' };
    }
    const observedListType = listContext?.listType || expectedListType;
    expectedListType = observedListType;
    const profilePath = location.pathname;
    const expectedCountAtStart = exactProfileListCount(observedListType);

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
    // Recycled rows cannot all exist in the DOM at once. Start at the top and
    // retain each window before advancing by less than one viewport.
    if (scroller) {
      scroller.scrollTop = 0;
      await sleep(settleMs);
    }
    let complete = !scroller
      && Number.isSafeInteger(expectedCountAtStart)
      && accounts.size === expectedCountAtStart;
    let stagnantRounds = 0;
    for (let round = 0; round < maxScrolls; round += 1) {
      const currentContext = accountListDialog(expectedListType);
      if (!currentContext || location.pathname !== profilePath) {
        complete = false;
        break;
      }
      const currentRoot = currentContext.dialog;
      const currentScroller = scrollableWithin(currentRoot);
      if (currentRoot !== root || currentScroller !== scroller) {
        listContext = currentContext;
        root = currentRoot;
        scroller = currentScroller;
        stagnantRounds = 0;
        if (scroller) {
          scroller.scrollTop = 0;
          await sleep(settleMs);
        }
        harvest();
      }
      harvest();
      if (!scroller) {
        complete = Number.isSafeInteger(expectedCountAtStart)
          && accounts.size === expectedCountAtStart;
        break;
      }
      const beforeCount = accounts.size;
      const beforeHeight = scroller.scrollHeight;
      const beforeTop = scroller.scrollTop;
      // Nudge only at the end to trigger a stalled lazy-loading sentinel.
      if (scroller.scrollTop >= scroller.scrollHeight - scroller.clientHeight - 8) {
        scroller.scrollTop = Math.max(
          0,
          scroller.scrollTop - Math.max(80, Math.floor(scroller.clientHeight / 2)),
        );
        await sleep(settleMs);
        harvest();
      }
      scroller.scrollTop = Math.min(
        Math.max(0, scroller.scrollHeight - scroller.clientHeight),
        beforeTop + Math.max(1, Math.floor(scroller.clientHeight * 0.75)),
      );
      await sleep(settleMs);
      // A long Followers list keeps a spinner up well past the settle delay.
      // Waiting for it to clear is what stops a big list being declared
      // complete while thousands of rows are still unfetched.
      let loading = false;
      for (let wait = 0; wait < 24; wait += 1) {
        loading = Boolean(root.querySelector('[role="progressbar"], svg[aria-label*="Loading" i]'));
        if (!loading) break;
        await sleep(250);
      }
      const settledContext = accountListDialog(expectedListType);
      if (location.pathname !== profilePath || !settledContext) {
        complete = false;
        break;
      }
      if (settledContext.dialog !== root || scrollableWithin(root) !== scroller) continue;
      harvest();

      const atBottom = scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 8;
      const grew = accounts.size > beforeCount || scroller.scrollHeight > beforeHeight;
      stagnantRounds = grew || loading ? 0 : stagnantRounds + 1;
      const check = inspectSession();
      if (check.sessionExpired || check.challenge || check.actionBlocked || check.rateLimited) {
        return {
          ...check,
          accounts: [...accounts.values()],
          complete: false,
          reason: 'session-stop',
        };
      }
      if (atBottom && !loading
        && Number.isSafeInteger(expectedCountAtStart)
        && accounts.size === expectedCountAtStart) {
        complete = true;
        break;
      }
      // Instagram lazy-loads in bursts and can pause between pages, so a couple
      // of quiet rounds does not mean the end. Be patient before concluding.
      if (atBottom && !loading && stagnantRounds >= 10) {
        break;
      }
    }

    const expectedCountAtEnd = exactProfileListCount(observedListType);
    const expectedCount = expectedCountAtEnd ?? expectedCountAtStart;
    const countChanged = Number.isSafeInteger(expectedCountAtStart)
      && Number.isSafeInteger(expectedCountAtEnd)
      && expectedCountAtStart !== expectedCountAtEnd;
    const countMismatch = Number.isSafeInteger(expectedCount)
      && accounts.size !== expectedCount;
    if (countChanged || countMismatch || !Number.isSafeInteger(expectedCount)) complete = false;

    return {
      ...session,
      accounts: [...accounts.values()]
        .sort((left, right) => left.username.localeCompare(right.username)),
      complete,
      listType: listContext?.listType || null,
      expectedCount,
      observedCount: accounts.size,
      capturedAt: new Date().toISOString(),
      reason: countChanged
        ? 'list-count-changed'
        : countMismatch
          ? 'list-count-mismatch'
          : !Number.isSafeInteger(expectedCount)
            ? 'list-count-unverified'
            : complete
              ? 'list-complete'
              : 'list-truncated',
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

  globalThis.InstaToolboxInstagramInspector = Object.freeze({
    captureVisibleAccounts,
    collectAccountList,
    detectAuthenticatedUsername,
    enumerateSentDms,
    fetchFollowerComparison,
    followerComparisonRecord,
    followerComparisonReport,
    followerComparisonSummary,
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
    if (request?.kind === 'insta-toolbox-inspect-profile') {
      sendResponse(inspectProfile(request.username));
      return;
    }
    if (request?.kind === 'insta-toolbox-inspect-session') {
      sendResponse(inspectSession());
      return;
    }
    if (request?.kind === 'insta-toolbox-capture-visible-accounts') {
      sendResponse({
        capturedAt: new Date().toISOString(),
        accounts: captureVisibleAccounts(),
      });
      return;
    }
    if (request?.kind === 'insta-toolbox-collect-account-list') {
      collectAccountList(request.options || {})
        .then(sendResponse)
        .catch(() => sendResponse({ unexpectedUi: true, reason: 'account-list-collection-failed' }));
      return true;
    }
    if (request?.kind === 'insta-toolbox-enumerate-sent-dms') {
      enumerateSentDms(request.options || {})
        .then(sendResponse)
        .catch(() => sendResponse({ unexpectedUi: true, reason: 'sent-dm-enumeration-failed' }));
      return true;
    }
    if (request?.kind === 'insta-toolbox-inspect-visible-messages') {
      sendResponse(inspectVisibleMessages());
      return;
    }
    if (request?.kind === 'insta-toolbox-inspect-reviewed-dm-item') {
      sendResponse(inspectReviewedDmItem(request.item));
      return;
    }
    if (request?.kind === 'insta-toolbox-perform-reviewed-profile-action') {
      performReviewedProfileAction(request.item)
        .then(sendResponse)
        .catch(() => sendResponse({ unexpectedUi: true, reason: 'live-action-driver-error' }));
      return true;
    }
    if (request?.kind === 'insta-toolbox-perform-reviewed-dm-unsend') {
      performReviewedDmUnsend(request.item)
        .then(sendResponse)
        .catch(() => sendResponse({ unexpectedUi: true, reason: 'live-dm-driver-error' }));
      return true;
    }
  });
})();

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

  function compareCapture({ allowPartial = false } = {}) {
    if (!allowPartial && !comparisonIsReady()) return { mutuals: [], iDoNotFollowBack: [], notFollowingMeBack: [] };
    const followers = allowPartial ? state.capture.followers : verifiedCapture('followers');
    const following = allowPartial ? state.capture.following : verifiedCapture('following');
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
    const summary = engine.followerComparisonSummary(state.capture);
    const comparisonReady = summary.available;
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
    const comparison = compareCapture({ allowPartial: true });
    const result = query('[data-role="comparison"]');
    result.replaceChildren();
    const title = document.createElement('h2');
    title.textContent = comparisonReady
      ? !summary.complete ? 'Partial comparison' : authenticatedCheck ? `Account comparison${state.capture.subjectUsername ? ` · @${state.capture.subjectUsername}` : ''}` : 'Scanned-list comparison'
      : 'No comparison loaded';
    const detail = document.createElement('p');
    detail.textContent = comparisonReady
      ? `${formatCount(state.capture.followers.length)} followers · ${formatCount(state.capture.following.length)} following · ${formatCount(comparison.mutuals.length)} mutual · ${formatCount(comparison.notFollowingMeBack.length)} ${summary.labels.notFollowingMeBack.toLowerCase()} · ${formatCount(comparison.iDoNotFollowBack.length)} ${summary.labels.iDoNotFollowBack.toLowerCase()}.`
      : 'Run Check mutuals to load a comparison.';
    result.append(title, detail);

    if (comparisonReady && !summary.complete) {
      const warning = document.createElement('p');
      warning.className = 'notice';
      warning.textContent = summary.warning;
      result.append(warning);
      if (summary.ageFilterGuidance) {
        const guidance = document.createElement('p');
        guidance.className = 'notice';
        guidance.append(document.createTextNode(`${summary.ageFilterGuidance} `));
        const link = document.createElement('a');
        link.href = summary.accountsCenterUrl;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        link.textContent = 'Open Accounts Center';
        guidance.append(link);
        result.append(guidance);
      }
    }

    const unverified = ['followers', 'following']
      .filter((type) => state.capture[type].length && state.capture.verified?.[type] !== true);
    if (unverified.length) {
      const warning = document.createElement('p');
      warning.className = 'notice';
      warning.textContent = `Saved ${unverified.join(' and ')} rows need a fresh scan before they can be used for runs.`;
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
    const category = query('[data-role="comparison-category"]');
    if (category) for (const option of category.options) {
      option.textContent = summary.labels[CHECKER_CATEGORY_KEYS[option.value]] || option.textContent;
    }
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
    const comparison = compareCapture({ allowPartial: true });
    const summary = engine.followerComparisonSummary(state.capture);
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
    setText('step-compare', summary.available
      ? `${formatCount(comparison.mutuals.length)} mutual · ${formatCount(comparison.notFollowingMeBack.length)} ${summary.labels.notFollowingMeBack.toLowerCase()}`
      : 'Scan both lists to compare');
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
      const comparisonReady = engine.followerComparisonSummary(state.capture).available;
      if (!comparisonReady) {
        status('Run Check mutuals to load a comparison.');
        return;
      }
      const generatedAt = nowIso();
      downloadJson(
        `insta-toolbox-mutual-comparison-${generatedAt.replace(/[:.]/g, '-')}.json`,
        engine.followerComparisonRecord(state.capture, compareCapture({ allowPartial: true }), generatedAt),
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

})();

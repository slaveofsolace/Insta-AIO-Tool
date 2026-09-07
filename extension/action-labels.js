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

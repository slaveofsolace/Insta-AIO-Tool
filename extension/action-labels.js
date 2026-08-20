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

(() => {
  'use strict';

  const modules = globalThis.__instaAioOverlayModules;
  const shared = modules?.shared;
  if (!shared || modules.collision) return;

  function intersects(first, second) {
    return first.left < second.right
      && first.right > second.left
      && first.top < second.bottom
      && first.bottom > second.top;
  }

  function placement({ viewport, strip, obstacles = [], dock = 'right' }) {
    const inset = 14;
    const instagramRail = viewport.width >= 760 ? 260 : inset;
    const left = instagramRail;
    const right = viewport.width - strip.width - inset;
    const top = inset;
    const bottom = viewport.height - strip.height - inset;
    const candidates = dock === 'right'
      ? [{ left, top: bottom }, { left, top }, { left: right, top: bottom }, { left: right, top }]
      : [{ left: right, top: bottom }, { left: right, top }, { left, top: bottom }, { left, top }];
    for (const candidate of candidates) {
      const rectangle = {
        left: candidate.left,
        right: candidate.left + strip.width,
        top: candidate.top,
        bottom: candidate.top + strip.height,
      };
      if (
        rectangle.left >= inset
        && rectangle.right <= viewport.width - inset
        && rectangle.top >= inset
        && rectangle.bottom <= viewport.height - inset
        && !obstacles.some((obstacle) => intersects(rectangle, obstacle))
      ) return candidate;
    }
    return null;
  }

  function visible(element, targetWindow) {
    if (!element?.isConnected || element.hidden) return false;
    const style = targetWindow.getComputedStyle(element);
    if (style.display === 'none' || style.visibility === 'hidden') return false;
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function surfaceMatches(element, state, actionLabels) {
    const role = element.getAttribute('role');
    const text = String(element.textContent || '').normalize('NFKC').toLowerCase();
    if (state.dmIntent) {
      if (role === 'menu') return true;
      for (const candidate of element.querySelectorAll('button, [role="button"], [role="menuitem"], span')) {
        if (actionLabels?.isDmUnsendLabel?.(candidate.textContent)) return true;
      }
    }
    if (state.accountIntent?.action === 'unfollow') {
      return role === 'dialog'
        && text.includes('unfollow')
        && text.includes(String(state.accountIntent.username || '').toLowerCase());
    }
    return false;
  }

  function publicState(rawState, now = Date.now()) {
    const accountArm = shared.armRemainingMs(rawState?.accountArm, now) > 0
      ? rawState.accountArm
      : null;
    const dmArm = shared.armRemainingMs(rawState?.dmArm, now) > 0
      ? rawState.dmArm
      : null;
    return {
      accountArm,
      accountIntent: rawState?.accountIntent || null,
      dmArm,
      dmIntent: rawState?.dmIntent || null,
    };
  }

  function create({
    document: targetDocument,
    window: targetWindow,
    actionLabels,
    getExecutionState,
    getReviewedTarget,
    onChange,
    debounceMs = 40,
  }) {
    let active = true;
    let timer = null;
    let priorSignature = '';

    function evaluate() {
      timer = null;
      if (!active) return;
      const state = publicState(getExecutionState());
      const surfaces = [...targetDocument.querySelectorAll('[role="dialog"], [role="menu"]')]
        .filter((element) => visible(element, targetWindow))
        .filter((element) => surfaceMatches(element, state, actionLabels));
      const rectangles = surfaces.map((element) => {
        const rect = element.getBoundingClientRect();
        return {
          bottom: rect.bottom,
          height: rect.height,
          left: rect.left,
          right: rect.right,
          top: rect.top,
          width: rect.width,
        };
      });
      const reviewedTarget = getReviewedTarget?.(state) || null;
      const reviewedRectangles = visible(reviewedTarget, targetWindow)
        ? [reviewedTarget.getBoundingClientRect()].map((rect) => ({
          bottom: rect.bottom,
          height: rect.height,
          left: rect.left,
          right: rect.right,
          top: rect.top,
          width: rect.width,
        }))
        : [];
      const armed = Boolean(state.accountArm || state.dmArm);
      const next = {
        active: armed || rectangles.length > 0,
        kind: rectangles.length ? 'native-surface' : armed ? 'armed' : null,
        rectangles,
        reviewedRectangles,
        target: state.accountIntent?.username
          ? `@${state.accountIntent.username}`
          : state.dmIntent?.messageId
            ? `message ${state.dmIntent.messageId}`
            : null,
      };
      const signature = JSON.stringify(next);
      if (signature === priorSignature) return;
      priorSignature = signature;
      onChange(next);
    }

    function schedule() {
      if (!active || timer !== null) return;
      timer = targetWindow.setTimeout(evaluate, debounceMs);
    }

    const observer = new targetWindow.MutationObserver(schedule);
    observer.observe(targetDocument.body || targetDocument.documentElement, {
      attributes: true,
      attributeFilter: ['aria-hidden', 'aria-modal', 'hidden', 'role', 'style'],
      childList: true,
      subtree: true,
    });
    evaluate();

    return Object.freeze({
      checkNow: evaluate,
      teardown() {
        if (!active) return;
        active = false;
        if (timer !== null) targetWindow.clearTimeout(timer);
        timer = null;
        observer.disconnect();
      },
    });
  }

  shared.install('collision', {
    create,
    intersects,
    placement,
    publicState,
    surfaceMatches,
  });
})();

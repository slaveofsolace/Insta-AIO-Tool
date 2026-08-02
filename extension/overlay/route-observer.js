(() => {
  'use strict';

  const modules = globalThis.__instaAioOverlayModules;
  const shared = modules?.shared;
  if (!shared || modules.routeObserver) return;

  function create({
    document: targetDocument,
    window: targetWindow,
    MutationObserver: Observer = targetWindow.MutationObserver,
    onRouteChange,
    debounceMs = 80,
    setTimer = targetWindow.setTimeout.bind(targetWindow),
    clearTimer = targetWindow.clearTimeout.bind(targetWindow),
  }) {
    let active = true;
    let timer = null;
    let previousUrl = targetWindow.location.href;

    function evaluate(reason) {
      timer = null;
      if (!active) return;
      const nextUrl = targetWindow.location.href;
      if (nextUrl === previousUrl) return;
      const priorUrl = previousUrl;
      previousUrl = nextUrl;
      onRouteChange({ nextUrl, priorUrl, reason });
    }

    function schedule(reason) {
      if (!active || timer !== null) return;
      timer = setTimer(() => evaluate(reason), debounceMs);
    }

    const navigation = targetWindow.navigation;
    const navigationListener = () => schedule('navigation');
    const popstateListener = () => schedule('popstate');
    navigation?.addEventListener?.('navigate', navigationListener);
    targetWindow.addEventListener('popstate', popstateListener);

    const observer = new Observer(() => schedule('dom'));
    observer.observe(targetDocument.documentElement, {
      childList: true,
      subtree: true,
    });

    function teardown() {
      if (!active) return;
      active = false;
      if (timer !== null) clearTimer(timer);
      timer = null;
      observer.disconnect();
      navigation?.removeEventListener?.('navigate', navigationListener);
      targetWindow.removeEventListener('popstate', popstateListener);
    }

    return Object.freeze({
      currentUrl: () => previousUrl,
      schedule,
      teardown,
    });
  }

  shared.install('routeObserver', { create });
})();

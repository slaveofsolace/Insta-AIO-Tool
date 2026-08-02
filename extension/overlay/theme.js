(() => {
  'use strict';

  const modules = globalThis.__instaAioOverlayModules;
  const shared = modules?.shared;
  if (!shared || modules.theme) return;

  function parsedColor(value) {
    const match = String(value || '').match(/rgba?\((\d+)[, ]+(\d+)[, ]+(\d+)(?:[, /]+([\d.]+))?\)/i);
    if (!match) return null;
    return {
      red: Number(match[1]),
      green: Number(match[2]),
      blue: Number(match[3]),
      alpha: match[4] == null ? 1 : Number(match[4]),
    };
  }

  function isDarkColor(value) {
    const color = parsedColor(value);
    if (!color || color.alpha < 0.5) return null;
    const luminance = (
      (0.2126 * color.red)
      + (0.7152 * color.green)
      + (0.0722 * color.blue)
    ) / 255;
    return luminance < 0.42;
  }

  function resolve(preference, {
    document: targetDocument,
    getComputedStyle: getStyle,
    matchMedia,
  }) {
    if (preference === 'light' || preference === 'dark') return preference;
    const declared = [targetDocument.documentElement, targetDocument.body]
      .map((element) => `${element?.dataset?.theme || ''} ${element?.className || ''}`.toLowerCase())
      .join(' ');
    if (/(^|\s)(dark|night)(\s|$)/.test(declared)) return 'dark';
    if (/(^|\s)(light|day)(\s|$)/.test(declared)) return 'light';
    for (const element of [targetDocument.body, targetDocument.documentElement]) {
      if (!element) continue;
      const dark = isDarkColor(getStyle(element).backgroundColor);
      if (dark !== null) return dark ? 'dark' : 'light';
    }
    return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }

  function create({
    document: targetDocument,
    window: targetWindow,
    root,
    preference = 'auto',
    onChange = () => {},
  }) {
    let active = true;
    let currentPreference = preference;
    let currentResolved = null;
    const media = targetWindow.matchMedia('(prefers-color-scheme: dark)');

    function apply() {
      if (!active) return;
      const next = resolve(currentPreference, {
        document: targetDocument,
        getComputedStyle: targetWindow.getComputedStyle.bind(targetWindow),
        matchMedia: targetWindow.matchMedia.bind(targetWindow),
      });
      root.dataset.themePreference = currentPreference;
      root.dataset.theme = next;
      root.style.colorScheme = next;
      if (next !== currentResolved) {
        currentResolved = next;
        onChange(next);
      }
    }

    const observer = new targetWindow.MutationObserver(apply);
    for (const element of [targetDocument.documentElement, targetDocument.body]) {
      if (!element) continue;
      observer.observe(element, {
        attributes: true,
        attributeFilter: ['class', 'style', 'data-theme'],
      });
    }
    const mediaListener = () => {
      if (currentPreference === 'auto') apply();
    };
    media.addEventListener?.('change', mediaListener);
    apply();

    return Object.freeze({
      resolved: () => currentResolved,
      setPreference(next) {
        currentPreference = ['auto', 'light', 'dark'].includes(next) ? next : 'auto';
        apply();
      },
      teardown() {
        if (!active) return;
        active = false;
        observer.disconnect();
        media.removeEventListener?.('change', mediaListener);
      },
    });
  }

  shared.install('theme', {
    create,
    isDarkColor,
    parsedColor,
    resolve,
  });
})();

(() => {
  'use strict';

  const modules = globalThis.__instaAioOverlayModules;
  const shared = modules?.shared;
  if (!shared || modules.icons) return;

  const paths = Object.freeze({
    capture: '<path d="M5 7h14v11H5zM8 4h8M9 11h6M12 8v6"/>',
    check: '<path d="m5 12 4 4L19 6"/>',
    close: '<path d="m7 7 10 10M17 7 7 17"/>',
    inspect: '<circle cx="11" cy="11" r="6"/><path d="m16 16 4 4M11 8v6M8 11h6"/>',
    messages: '<path d="M5 5h14v11H9l-4 3z"/>',
    now: '<path d="M4 11.5 12 5l8 6.5v7a1 1 0 0 1-1 1h-5v-5h-4v5H5a1 1 0 0 1-1-1z"/>',
    preferences: '<circle cx="12" cy="12" r="3"/><path d="M19 12a7 7 0 0 0-.1-1l2-1.5-2-3.4-2.4 1a8 8 0 0 0-1.7-1L14.5 3h-5L9 6.1a8 8 0 0 0-1.7 1l-2.4-1-2 3.4L5 11a7 7 0 0 0 0 2l-2 1.5 2 3.4 2.4-1a8 8 0 0 0 1.7 1l.4 3.1h5l.4-3.1a8 8 0 0 0 1.7-1l2.4 1 2-3.4-2.1-1.5a7 7 0 0 0 .1-1z"/>',
    queue: '<path d="M7 6h13M7 12h13M7 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01"/>',
    workspace: '<path d="M4 5h7v6H4zM13 5h7v10h-7zM4 13h7v6H4zM13 17h7v2h-7z"/>',
  });

  function svg(name, className = '') {
    const body = paths[name];
    if (!body) return '';
    const classAttribute = className ? ` class="${className}"` : '';
    return `<svg${classAttribute} viewBox="0 0 24 24" aria-hidden="true">${body}</svg>`;
  }

  shared.install('icons', { svg });
})();

(() => {
  'use strict';

  const modules = globalThis.__instaAioOverlayModules;
  const shared = modules?.shared;
  if (!shared || modules.accessibility) return;

  function nextTabIndex(key, currentIndex, count) {
    if (!count) return -1;
    if (key === 'Home') return 0;
    if (key === 'End') return count - 1;
    if (key === 'ArrowRight' || key === 'ArrowDown') return (currentIndex + 1) % count;
    if (key === 'ArrowLeft' || key === 'ArrowUp') return (currentIndex - 1 + count) % count;
    return -1;
  }

  function handleTabKey(event, buttons, onSelect) {
    const currentIndex = buttons.indexOf(event.target);
    if (currentIndex < 0) return false;
    const nextIndex = nextTabIndex(event.key, currentIndex, buttons.length);
    if (nextIndex < 0) return false;
    event.preventDefault();
    const next = buttons[nextIndex];
    onSelect(next.dataset.iaSection);
    next.focus();
    return true;
  }

  shared.install('accessibility', { handleTabKey, nextTabIndex });
})();

(() => {
  const shadow = document.querySelector('#insta-aio-userscript-root').shadowRoot;
  const vis = (el) => {
    const r = el.getBoundingClientRect();
    const s = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none';
  };
  const visibleHitPoint = (el) => {
    const rect = el.getBoundingClientRect();
    const visible = {
      left: Math.max(0, rect.left),
      top: Math.max(0, rect.top),
      right: Math.min(innerWidth, rect.right),
      bottom: Math.min(innerHeight, rect.bottom),
    };

    // getBoundingClientRect() still reports the full box when a control has
    // scrolled underneath a clipping ancestor. Probe the centre of the part a
    // person can actually see instead of sampling the clipped-away centre,
    // which can legitimately resolve to the tab strip above the scrollport.
    for (let ancestor = el.parentElement; ancestor; ancestor = ancestor.parentElement) {
      const style = getComputedStyle(ancestor);
      const clipsX = /(auto|scroll|hidden|clip)/.test(style.overflowX);
      const clipsY = /(auto|scroll|hidden|clip)/.test(style.overflowY);
      if (!clipsX && !clipsY) continue;
      const ancestorRect = ancestor.getBoundingClientRect();
      if (clipsX) {
        visible.left = Math.max(visible.left, ancestorRect.left);
        visible.right = Math.min(visible.right, ancestorRect.right);
      }
      if (clipsY) {
        visible.top = Math.max(visible.top, ancestorRect.top);
        visible.bottom = Math.min(visible.bottom, ancestorRect.bottom);
      }
    }

    if (visible.right <= visible.left || visible.bottom <= visible.top) return null;
    return {
      x: visible.left + ((visible.right - visible.left) / 2),
      y: visible.top + ((visible.bottom - visible.top) / 2),
    };
  };
  // For each interactive control, ask the document what is actually on top at
  // its centre. Anything that resolves to a different control is unclickable.
  const blocked = [];
  for (const el of shadow.querySelectorAll('button, select, input, summary, a[href], [role="tab"]')) {
    if (!vis(el)) continue;
    const point = visibleHitPoint(el);
    if (!point) continue;
    const top = shadow.elementFromPoint
      ? shadow.elementFromPoint(point.x, point.y)
      : document.elementFromPoint(point.x, point.y);
    if (!top) continue;
    const resolved = top.closest('button, select, input, summary, a[href], [role="tab"]');
    if (resolved && resolved !== el) {
      blocked.push((el.className || el.tagName) + ' blocked by ' + (resolved.className || resolved.tagName));
    }
  }
  // Contrast: a control whose text matches its own background is invisible.
  const invisibleText = [];
  for (const el of shadow.querySelectorAll('select, input, button')) {
    if (!vis(el)) continue;
    const s = getComputedStyle(el);
    if (s.color === s.backgroundColor) invisibleText.push((el.className || el.tagName) + ' ' + s.color);
  }
  return { blocked: [...new Set(blocked)], invisibleText: [...new Set(invisibleText)] };
})()

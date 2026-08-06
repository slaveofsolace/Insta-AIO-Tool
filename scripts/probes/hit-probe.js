(() => {
  const shadow = document.querySelector('#insta-aio-userscript-root').shadowRoot;
  const vis = (el) => {
    const r = el.getBoundingClientRect();
    const s = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none';
  };
  // For each interactive control, ask the document what is actually on top at
  // its centre. Anything that resolves to a different control is unclickable.
  const blocked = [];
  for (const el of shadow.querySelectorAll('button, select, input, summary, a[href], [role="tab"]')) {
    if (!vis(el)) continue;
    const r = el.getBoundingClientRect();
    const x = r.left + r.width / 2;
    const y = r.top + r.height / 2;
    const top = shadow.elementFromPoint ? shadow.elementFromPoint(x, y) : document.elementFromPoint(x, y);
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

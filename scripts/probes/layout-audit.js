(async () => {
  await Promise.all(document.querySelector("#insta-aio-userscript-root").shadowRoot.getAnimations().map((a) => a.finished.catch(() => {})));
  const shadow = document.querySelector('#insta-aio-userscript-root').shadowRoot;
  const panel = shadow.querySelector('.panel');
  const cs = getComputedStyle(panel);
  const kids = [...panel.children];
  const vis = (el) => {
    const r = el.getBoundingClientRect();
    const s = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none';
  };
  const inFlow = (el) => { const p = getComputedStyle(el).position; return p !== 'absolute' && p !== 'fixed'; };
  const shown = kids.filter(vis).filter(inFlow);
  const overlaps = [];
  for (let i = 0; i < shown.length; i += 1) {
    for (let j = i + 1; j < shown.length; j += 1) {
      const a = shown[i].getBoundingClientRect();
      const b = shown[j].getBoundingClientRect();
      const ox = Math.min(a.right, b.right) - Math.max(a.left, b.left);
      const oy = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
      if (ox > 2 && oy > 2) {
        overlaps.push(shown[i].className + ' OVER ' + shown[j].className + ' by ' + Math.round(ox) + 'x' + Math.round(oy));
      }
    }
  }
  const pr = panel.getBoundingClientRect();
  const escapes = [...shadow.querySelectorAll('*')].filter((el) => {
    if (!vis(el)) return false;
    if (el.closest('.settings-panel, dialog, .resize, .launcher')) return false;
    if (el.closest('.scroll')) return false;
    if (!inFlow(el)) return false;
    const r = el.getBoundingClientRect();
    return r.bottom > pr.bottom + 2 || r.top < pr.top - 2 || r.right > pr.right + 2 || r.left < pr.left - 2;
  }).map((el) => {
    const rect = el.getBoundingClientRect();
    return `${el.className || el.tagName} @${Math.round(rect.left)},${Math.round(rect.top)},${Math.round(rect.right)},${Math.round(rect.bottom)} panel@${Math.round(pr.left)},${Math.round(pr.top)},${Math.round(pr.right)},${Math.round(pr.bottom)}`;
  });
  const ids = [...shadow.querySelectorAll('[id]')].map((el) => el.id);
  const dupes = ids.filter((id, i) => ids.indexOf(id) !== i);
  const small = [...shadow.querySelectorAll('button, select, input, summary, [role="tab"]')]
    .filter(vis)
    .filter((el) => el.getBoundingClientRect().height < 44)
    .map((el) => el.tagName + '.' + (el.className || '?') + ' h=' + Math.round(el.getBoundingClientRect().height));
  const scroll = shadow.querySelector('.scroll');
  return {
    gridTemplateRows: cs.gridTemplateRows,
    panelChildren: kids.length,
    visibleChildren: shown.length,
    childClasses: kids.map((k) => k.className || k.tagName),
    overlaps,
    escapes: [...new Set(escapes)].slice(0, 12),
    duplicateIds: [...new Set(dupes)],
    undersizedTargets: [...new Set(small)].slice(0, 14),
    panelHeight: Math.round(pr.height),
    scrollOverflow: scroll ? Math.round(scroll.scrollHeight - scroll.clientHeight) : null,
  };
})()

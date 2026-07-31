export function virtualWindow(items, {
  scrollTop = 0,
  rowHeight = 72,
  viewportHeight = 520,
  overscan = 8,
} = {}) {
  const source = Array.isArray(items) ? items : [];
  const height = Math.max(1, Number(rowHeight) || 1);
  const viewport = Math.max(height, Number(viewportHeight) || height);
  const buffer = Math.max(0, Math.floor(Number(overscan) || 0));
  const firstVisible = Math.max(0, Math.floor(Math.max(0, Number(scrollTop) || 0) / height));
  const start = Math.max(0, firstVisible - buffer);
  const visibleCount = Math.ceil(viewport / height) + buffer * 2;
  const end = Math.min(source.length, start + visibleCount);
  return {
    items: source.slice(start, end),
    start,
    end,
    total: source.length,
    rowHeight: height,
    topPadding: start * height,
    bottomPadding: Math.max(0, (source.length - end) * height),
  };
}

export function normalizeImportPath(name) {
  return String(name || '').replaceAll('\\', '/').replace(/^\.\/+/, '');
}

export function classifyImportPath(name) {
  const lower = normalizeImportPath(name).toLowerCase();
  if (/followers(_\d+)?\.json$/.test(lower)) return 'followers';
  if (/following(_\d+)?\.json$/.test(lower)) return 'following';
  if (/message_\d+\.json$/.test(lower)) return 'messages';
  if (/liked-photos\.json$/.test(lower)) return 'simple-liked-photos';
  if (/followed\.json$/.test(lower) && !/unfollowed\.json$/.test(lower)) {
    return 'simple-followed';
  }
  if (/unfollowed\.json$/.test(lower)) return 'simple-unfollowed';
  if (lower.endsWith('.json')) return 'unknown-json';
  return 'other';
}

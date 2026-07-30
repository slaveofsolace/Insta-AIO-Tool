const RESERVED_PATHS = new Set([
  'accounts', 'about', 'api', 'developer', 'direct', 'emails', 'explore',
  'legal', 'privacy', 'reels', 'settings', 'stories', 'terms', 'web',
]);

export function normalizeUsername(value) {
  if (value == null) return '';
  let username = String(value).trim();
  if (!username) return '';

  username = username.replace(/^@/, '');
  try {
    if (/^https?:\/\//i.test(username)) {
      const url = new URL(username);
      username = url.pathname.split('/').filter(Boolean)[0] || '';
    }
  } catch {
    // Leave non-URL values untouched.
  }

  username = username.split(/[/?#]/)[0].trim().toLowerCase();
  if (!/^[a-z0-9._]{1,30}$/i.test(username)) return '';
  if (RESERVED_PATHS.has(username)) return '';
  return username;
}

export function stableAccountKey(account) {
  const id = account?.id == null ? '' : String(account.id).trim();
  return id ? `id:${id}` : `username:${normalizeUsername(account?.username)}`;
}

export function normalizeAccount(input, source = 'unknown') {
  if (input == null) return null;

  if (typeof input === 'string') {
    const username = normalizeUsername(input);
    return username ? {
      id: null,
      username,
      displayName: '',
      profileUrl: `https://www.instagram.com/${username}/`,
      timestamp: null,
      isVerified: false,
      isPrivate: null,
      source,
    } : null;
  }

  const stringData = Array.isArray(input.string_list_data)
    ? input.string_list_data.find((entry) => entry?.value || entry?.href)
    : null;
  const nestedUser = input.user || input.node || input.account || {};

  const username = normalizeUsername(
    input.username
      ?? input.value
      ?? stringData?.value
      ?? stringData?.href
      ?? nestedUser.username
      ?? nestedUser.value,
  );

  if (!username) return null;

  const id = input.id
    ?? input.pk
    ?? input.user_id
    ?? nestedUser.id
    ?? nestedUser.pk
    ?? null;

  const rawTimestamp = input.timestamp ?? input.time ?? stringData?.timestamp ?? null;
  const timestamp = rawTimestamp == null
    ? null
    : Number(rawTimestamp) < 10_000_000_000
      ? Number(rawTimestamp) * 1000
      : Number(rawTimestamp);

  return {
    id: id == null ? null : String(id),
    username,
    displayName: String(
      input.displayName
        ?? input.full_name
        ?? input.name
        ?? nestedUser.full_name
        ?? nestedUser.name
        ?? '',
    ),
    profileUrl: input.profileUrl
      ?? input.href
      ?? stringData?.href
      ?? `https://www.instagram.com/${username}/`,
    timestamp: Number.isFinite(timestamp) ? timestamp : null,
    isVerified: Boolean(input.isVerified ?? input.is_verified ?? nestedUser.is_verified ?? false),
    isPrivate: input.isPrivate ?? input.is_private ?? nestedUser.is_private ?? null,
    source,
  };
}

export function dedupeAccounts(accounts) {
  const index = new Map();
  for (const raw of accounts || []) {
    const account = normalizeAccount(raw, raw?.source || 'unknown');
    if (!account) continue;
    const key = stableAccountKey(account);
    const existing = index.get(key);
    index.set(key, existing ? {
      ...existing,
      ...account,
      displayName: account.displayName || existing.displayName,
      id: account.id || existing.id,
      timestamp: account.timestamp ?? existing.timestamp,
    } : account);
  }
  return [...index.values()].sort((a, b) => a.username.localeCompare(b.username));
}

export function indexAccounts(accounts) {
  return new Map(dedupeAccounts(accounts).map((account) => [stableAccountKey(account), account]));
}

export function accountMatchesSet(account, values) {
  const normalized = new Set((values || []).map(normalizeUsername).filter(Boolean));
  return normalized.has(normalizeUsername(account?.username));
}

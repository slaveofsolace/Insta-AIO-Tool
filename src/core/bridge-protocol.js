export const BRIDGE_SCHEMA_VERSION = 1;
export const BRIDGE_CHANNEL = 'insta-aio-extension-bridge';
export const BRIDGE_PERMISSIONS = Object.freeze(['read', 'action']);

const SENSITIVE_KEYS = new Set([
  'password',
  'passwd',
  'cookie',
  'cookies',
  'cookieheader',
  'authorization',
  'csrftoken',
  'accesstoken',
  'refreshtoken',
  'privatekey',
  'secret',
  'sessionkey',
  'sessioncookie',
  'sessioncookies',
]);

function cryptoApi() {
  if (!globalThis.crypto?.subtle || !globalThis.crypto?.getRandomValues) {
    throw new Error('Web Crypto is required for the extension bridge.');
  }
  return globalThis.crypto;
}

function base64UrlEncode(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  const base64 = typeof btoa === 'function'
    ? btoa(binary)
    : Buffer.from(bytes).toString('base64');
  return base64.replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

function base64UrlDecode(value) {
  const normalized = String(value).replaceAll('-', '+').replaceAll('_', '/');
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
  const binary = typeof atob === 'function'
    ? atob(padded)
    : Buffer.from(padded, 'base64').toString('binary');
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function randomCode(byteLength) {
  const bytes = new Uint8Array(byteLength);
  cryptoApi().getRandomValues(bytes);
  return base64UrlEncode(bytes);
}

function normalizePermissions(permissions) {
  const unique = [...new Set(permissions || [])];
  if (!unique.length || unique.some((permission) => !BRIDGE_PERMISSIONS.includes(permission))) {
    throw new Error('Bridge permissions must include read and may include action.');
  }
  if (!unique.includes('read')) unique.unshift('read');
  return unique.sort();
}

export function normalizeBridgeOrigin(value) {
  const url = new URL(String(value));
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error('Bridge origins must use HTTP or HTTPS.');
  }
  if (url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('Bridge origins must not include credentials, paths, queries, or fragments.');
  }
  return url.origin;
}

export function createBridgePairing({
  origin,
  permissions = ['read'],
  createdAt = Date.now(),
} = {}) {
  const pairing = {
    schemaVersion: BRIDGE_SCHEMA_VERSION,
    kind: 'insta-aio-bridge-pairing',
    pairingId: randomCode(12),
    secret: randomCode(32),
    origin: normalizeBridgeOrigin(origin),
    permissions: normalizePermissions(permissions),
    createdAt: new Date(createdAt).toISOString(),
    pairedAt: null,
    revokedAt: null,
  };
  return {
    pairing,
    pairingCode: formatBridgePairingCode(pairing),
  };
}

export function formatBridgePairingCode(pairing) {
  if (!pairing?.pairingId || !pairing?.secret) {
    throw new Error('Pairing record is incomplete.');
  }
  return `IA1.${pairing.pairingId}.${pairing.secret}`;
}

export function parseBridgePairingCode(pairingCode, {
  origin,
  permissions = ['read'],
  createdAt = Date.now(),
} = {}) {
  const parts = String(pairingCode || '').trim().split('.');
  if (parts.length !== 3 || parts[0] !== 'IA1') {
    throw new Error('Pairing code is invalid.');
  }
  const pairingIdBytes = base64UrlDecode(parts[1]);
  const secretBytes = base64UrlDecode(parts[2]);
  if (pairingIdBytes.byteLength !== 12 || secretBytes.byteLength !== 32) {
    throw new Error('Pairing code has an invalid length.');
  }
  return {
    schemaVersion: BRIDGE_SCHEMA_VERSION,
    kind: 'insta-aio-bridge-pairing',
    pairingId: parts[1],
    secret: parts[2],
    origin: normalizeBridgeOrigin(origin),
    permissions: normalizePermissions(permissions),
    createdAt: new Date(createdAt).toISOString(),
    pairedAt: null,
    revokedAt: null,
  };
}

export function createBridgeHandshakeNonce() {
  return randomCode(16);
}

function stable(value) {
  if (value == null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(stable);
  return Object.fromEntries(
    Object.keys(value).sort().map((key) => [key, stable(value[key])]),
  );
}

function unsignedMessage(message) {
  const { signature, ...unsigned } = message;
  return unsigned;
}

function canonicalMessage(message) {
  return JSON.stringify(stable(unsignedMessage(message)));
}

function requiredPermission(type) {
  if (['bridge.pair', 'bridge.ping'].includes(type) || type.startsWith('read.')) return 'read';
  if (type.startsWith('action.') || type.startsWith('checkpoint.')) return 'action';
  throw new Error(`Unsupported bridge message type: ${type}`);
}

function assertNoSensitivePayload(value, path = 'payload') {
  if (value == null) return;
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoSensitivePayload(item, `${path}[${index}]`));
    return;
  }
  if (typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    if (SENSITIVE_KEYS.has(key.toLocaleLowerCase())) {
      throw new Error(`Bridge payload may not contain session material at ${path}.${key}.`);
    }
    assertNoSensitivePayload(child, `${path}.${key}`);
  }
}

async function hmac(secret, value) {
  const encoder = new TextEncoder();
  const key = await cryptoApi().subtle.importKey(
    'raw',
    base64UrlDecode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  return base64UrlEncode(new Uint8Array(
    await cryptoApi().subtle.sign('HMAC', key, encoder.encode(value)),
  ));
}

function constantTimeEqual(left, right) {
  const a = new TextEncoder().encode(String(left));
  const b = new TextEncoder().encode(String(right));
  if (a.byteLength !== b.byteLength) return false;
  let difference = 0;
  for (let index = 0; index < a.byteLength; index += 1) {
    difference |= a[index] ^ b[index];
  }
  return difference === 0;
}

function assertHandshakeNonce(value, label) {
  let decoded;
  try {
    decoded = base64UrlDecode(value);
  } catch {
    throw new Error(`${label} is invalid.`);
  }
  if (decoded.byteLength !== 16) {
    throw new Error(`${label} must contain 16 random bytes.`);
  }
}

export async function deriveBridgeSessionPairing(pairing, {
  clientNonce,
  extensionNonce,
  pairedAt = Date.now(),
} = {}) {
  if (!pairing?.pairingId || !pairing?.secret || pairing.revokedAt) {
    throw new Error('Bridge pairing cannot complete.');
  }
  if (pairing.pairedAt) {
    throw new Error('Bridge pairing code has already been consumed.');
  }
  assertHandshakeNonce(clientNonce, 'Client pairing nonce');
  assertHandshakeNonce(extensionNonce, 'Extension pairing nonce');
  const secret = await hmac(
    pairing.secret,
    `insta-aio-bridge-session-v1:${pairing.pairingId}:${clientNonce}:${extensionNonce}`,
  );
  return {
    ...pairing,
    secret,
    pairedAt: new Date(pairedAt).toISOString(),
  };
}

export async function createSignedBridgeMessage(pairing, type, payload = {}, {
  requestId = randomCode(12),
  nonce = randomCode(16),
  timestamp = Date.now(),
} = {}) {
  if (pairing?.revokedAt) throw new Error('Bridge pairing is revoked.');
  const permission = requiredPermission(type);
  if (!pairing?.permissions?.includes(permission)) {
    throw new Error(`Bridge pairing does not grant ${permission} permission.`);
  }
  assertNoSensitivePayload(payload);
  const message = {
    schemaVersion: BRIDGE_SCHEMA_VERSION,
    channel: BRIDGE_CHANNEL,
    pairingId: pairing.pairingId,
    requestId,
    nonce,
    timestamp: new Date(timestamp).toISOString(),
    type,
    payload,
  };
  const encoded = canonicalMessage(message);
  if (new TextEncoder().encode(encoded).byteLength > 1_000_000) {
    throw new Error('Bridge message exceeds the one-megabyte limit.');
  }
  return {
    ...message,
    signature: await hmac(pairing.secret, encoded),
  };
}

export async function verifySignedBridgeMessage(message, pairing, {
  origin,
  now = Date.now(),
  maximumAgeMs = 60_000,
  usedNonces = new Set(),
} = {}) {
  if (
    message?.schemaVersion !== BRIDGE_SCHEMA_VERSION
    || message?.channel !== BRIDGE_CHANNEL
    || message?.pairingId !== pairing?.pairingId
  ) {
    return { ok: false, reason: 'schema-or-pairing-mismatch' };
  }
  if (pairing.revokedAt) return { ok: false, reason: 'pairing-revoked' };
  let normalizedOrigin;
  try {
    normalizedOrigin = normalizeBridgeOrigin(origin);
  } catch {
    return { ok: false, reason: 'origin-mismatch' };
  }
  if (normalizedOrigin !== pairing.origin) {
    return { ok: false, reason: 'origin-mismatch' };
  }
  let permission;
  try {
    permission = requiredPermission(message.type);
    assertNoSensitivePayload(message.payload);
  } catch (error) {
    return { ok: false, reason: 'invalid-payload', error: error.message };
  }
  if (!pairing.permissions.includes(permission)) {
    return { ok: false, reason: 'permission-denied' };
  }
  const timestamp = new Date(message.timestamp).getTime();
  if (!Number.isFinite(timestamp) || Math.abs(now - timestamp) > maximumAgeMs) {
    return { ok: false, reason: 'message-expired' };
  }
  if (!message.nonce || usedNonces.has(message.nonce)) {
    return { ok: false, reason: 'replayed-message' };
  }
  const expected = await hmac(pairing.secret, canonicalMessage(message));
  if (!constantTimeEqual(message.signature, expected)) {
    return { ok: false, reason: 'invalid-signature' };
  }
  usedNonces.add(message.nonce);
  return {
    ok: true,
    permission,
    message: unsignedMessage(message),
  };
}

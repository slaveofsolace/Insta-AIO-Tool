import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';

if (!globalThis.crypto) globalThis.crypto = webcrypto;

import {
  createBridgeHandshakeNonce,
  createBridgePairing,
  createSignedBridgeMessage,
  deriveBridgeSessionPairing,
  formatBridgePairingCode,
  parseBridgePairingCode,
  verifySignedBridgeMessage,
} from '../src/core/bridge-protocol.js';

test('one-time bridge code reconstructs the same origin-scoped pairing', () => {
  const { pairing, pairingCode } = createBridgePairing({
    origin: 'http://127.0.0.1:4173',
    permissions: ['read', 'action'],
    createdAt: 1_700_000_000_000,
  });
  assert.equal(formatBridgePairingCode(pairing), pairingCode);
  const accepted = parseBridgePairingCode(pairingCode, {
    origin: 'http://127.0.0.1:4173',
    permissions: ['read', 'action'],
    createdAt: 1_700_000_001_000,
  });
  assert.equal(accepted.pairingId, pairing.pairingId);
  assert.equal(accepted.secret, pairing.secret);
  assert.equal(accepted.origin, pairing.origin);
  assert.equal(accepted.pairedAt, null);
});

test('pairing code is rotated into a derived session secret after one handshake', async () => {
  const { pairing, pairingCode } = createBridgePairing({
    origin: 'https://example.test',
    permissions: ['read', 'action'],
  });
  const accepted = parseBridgePairingCode(pairingCode, {
    origin: pairing.origin,
    permissions: pairing.permissions,
  });
  const clientNonce = createBridgeHandshakeNonce();
  const extensionNonce = createBridgeHandshakeNonce();
  const left = await deriveBridgeSessionPairing(pairing, {
    clientNonce,
    extensionNonce,
    pairedAt: 1_700_000_000_000,
  });
  const right = await deriveBridgeSessionPairing(accepted, {
    clientNonce,
    extensionNonce,
    pairedAt: 1_700_000_000_000,
  });
  assert.equal(left.secret, right.secret);
  assert.notEqual(left.secret, pairing.secret);
  assert.equal(left.pairedAt, '2023-11-14T22:13:20.000Z');
  await assert.rejects(
    deriveBridgeSessionPairing(left, { clientNonce, extensionNonce }),
    /already been consumed/,
  );
});

test('signed bridge messages enforce origin, permissions, age, and replay checks', async () => {
  const { pairing } = createBridgePairing({
    origin: 'http://127.0.0.1:4173',
    permissions: ['read', 'action'],
  });
  const now = 1_700_000_000_000;
  const message = await createSignedBridgeMessage(pairing, 'action.reviewed-job', {
    jobId: 'job-1',
    mode: 'dry-run',
  }, {
    timestamp: now,
    nonce: 'nonce-1',
    requestId: 'request-1',
  });
  const usedNonces = new Set();
  const valid = await verifySignedBridgeMessage(message, pairing, {
    origin: pairing.origin,
    now,
    usedNonces,
  });
  assert.equal(valid.ok, true);
  assert.equal(valid.permission, 'action');

  const replay = await verifySignedBridgeMessage(message, pairing, {
    origin: pairing.origin,
    now,
    usedNonces,
  });
  assert.equal(replay.reason, 'replayed-message');

  const wrongOrigin = await verifySignedBridgeMessage({
    ...message,
    nonce: 'nonce-2',
  }, pairing, {
    origin: 'http://localhost:4173',
    now,
  });
  assert.equal(wrongOrigin.reason, 'origin-mismatch');

  const expired = await verifySignedBridgeMessage({
    ...message,
    nonce: 'nonce-3',
  }, pairing, {
    origin: pairing.origin,
    now: now + 60_001,
  });
  assert.equal(expired.reason, 'message-expired');
});

test('read-only pairings reject action messages before signing', async () => {
  const { pairing } = createBridgePairing({
    origin: 'https://example.test',
    permissions: ['read'],
  });
  await assert.rejects(
    createSignedBridgeMessage(pairing, 'action.reviewed-job', {}),
    /does not grant action permission/,
  );
  const ping = await createSignedBridgeMessage(pairing, 'bridge.ping', {});
  const verified = await verifySignedBridgeMessage(ping, pairing, {
    origin: pairing.origin,
  });
  assert.equal(verified.ok, true);
});

test('bridge payloads reject credentials, cookies, and authorization material', async () => {
  const { pairing } = createBridgePairing({
    origin: 'https://example.test',
    permissions: ['read', 'action'],
  });
  for (const payload of [
    { password: 'not-allowed' },
    { nested: { cookies: ['not-allowed'] } },
    { authorization: 'not-allowed' },
    { accessToken: 'not-allowed' },
    { nested: { Secret: 'not-allowed' } },
  ]) {
    await assert.rejects(
      createSignedBridgeMessage(pairing, 'action.reviewed-job', payload),
      /may not contain session material/,
    );
  }
});

test('tampering invalidates bridge signatures', async () => {
  const { pairing } = createBridgePairing({
    origin: 'https://example.test',
    permissions: ['read'],
  });
  const message = await createSignedBridgeMessage(pairing, 'read.session', {
    requested: true,
  });
  const tampered = {
    ...message,
    payload: { requested: false },
  };
  const verified = await verifySignedBridgeMessage(tampered, pairing, {
    origin: pairing.origin,
  });
  assert.equal(verified.reason, 'invalid-signature');
});

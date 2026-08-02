import test from 'node:test';
import assert from 'node:assert/strict';
import {
  copyFile,
  mkdir,
  mkdtemp,
  rm,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  createBridgePairing,
  createSignedBridgeMessage,
  verifySignedBridgeMessage,
} from '../src/core/bridge-protocol.js';
import {
  confirmDmJobDestructive,
  confirmDmJobReview,
  createReviewedDmJob,
} from '../src/core/dm-jobs.js';
import { messageSelectionKey } from '../src/core/messages.js';

test('background completes an exact DM dry run without exposing an Unsend path', async () => {
  const temporaryRoot = await mkdtemp(path.join(tmpdir(), 'insta-aio-background-dm-'));
  const libraryRoot = path.join(temporaryRoot, 'lib');
  await mkdir(libraryRoot, { recursive: true });
  await Promise.all([
    copyFile(new URL('../extension/background.js', import.meta.url), path.join(temporaryRoot, 'background.js')),
    copyFile(new URL('../src/core/bridge-protocol.js', import.meta.url), path.join(libraryRoot, 'bridge-protocol.js')),
    copyFile(new URL('../src/core/controlled-account-action.js', import.meta.url), path.join(libraryRoot, 'controlled-account-action.js')),
    copyFile(new URL('../src/core/controlled-dm-unsend.js', import.meta.url), path.join(libraryRoot, 'controlled-dm-unsend.js')),
  ]);

  const origin = 'http://127.0.0.1:4173';
  const { pairing: unpaired } = createBridgePairing({
    origin,
    permissions: ['read', 'action'],
  });
  const pairing = { ...unpaired, pairedAt: new Date().toISOString() };
  const sourceMessage = {
    id: 'sent-1',
    conversationId: 'inbox/friend_123',
    conversationName: 'Friend Example',
    senderName: 'Owner Example',
    senderId: null,
    isMine: true,
    timestamp: 1_700_000_000_100,
    type: 'text',
    content: 'Yes — reviewing it now.',
    source: 'meta-export',
  };
  const draft = createReviewedDmJob(
    [sourceMessage],
    [messageSelectionKey(sourceMessage)],
    { createdAt: 1_700_000_000_000 },
  );
  const job = confirmDmJobReview(draft, {
    confirmedAt: 1_700_000_000_200,
    mode: 'dry-run',
    phrase: draft.reviewConfirmationPhrase,
  });
  const item = job.items[0];

  const stored = {
    bridgePairings: [pairing],
    bridgeReplayNonces: [],
    pendingJobs: [],
    accountActionLedger: [],
    pendingLiveIntent: null,
    liveArm: null,
  };
  let runtimeListener = null;
  let inspectionCalls = 0;
  globalThis.chrome = {
    runtime: {
      getManifest: () => ({ version: '0.4.0' }),
      onMessage: {
        addListener(listener) {
          runtimeListener = listener;
        },
      },
    },
    storage: {
      local: {
        async get(keys) {
          return Object.fromEntries(keys.map((key) => [key, stored[key]]));
        },
        async set(values) {
          Object.assign(stored, structuredClone(values));
        },
      },
    },
    tabs: {
      async get(tabId) {
        return { id: tabId, active: true, url: 'https://www.instagram.com/direct/t/123/' };
      },
      async query() {
        return [{ id: 7, active: true, url: 'https://www.instagram.com/direct/t/123/' }];
      },
      async sendMessage(_tabId, message) {
        assert.equal(message.kind, 'insta-aio-inspect-reviewed-dm-item');
        inspectionCalls += 1;
        assert.deepEqual(message.item, {
          conversationId: item.conversationId,
          contentDigest: item.contentDigest,
          messageId: item.messageId,
          sentByMe: true,
          timestamp: item.timestamp,
        });
        return {
          conversationId: item.conversationId,
          contentDigest: item.contentDigest,
          exactIdentityAvailable: true,
          messageId: item.messageId,
          ownershipAvailable: true,
          resolutionToken: 'read-only-resolution-token',
          sentByMe: true,
          timestamp: item.timestamp,
          evidence: {
            source: 'extension-stable-visible-message-identity',
          },
        };
      },
    },
  };

  try {
    const backgroundUrl = `${pathToFileURL(path.join(temporaryRoot, 'background.js')).href}?test=${Date.now()}`;
    await import(backgroundUrl);
    assert.equal(typeof runtimeListener, 'function');

    function deliver(request, sender) {
      return new Promise((resolve) => {
        const result = runtimeListener(request, sender, resolve);
        if (result !== true) queueMicrotask(() => resolve(undefined));
      });
    }

    const request = await createSignedBridgeMessage(pairing, 'action.dm-job', { job });
    const response = await deliver({
      kind: 'insta-aio-bridge-request',
      origin,
      message: request,
    }, {
      url: `${origin}/index.html`,
      tab: { url: `${origin}/index.html` },
    });
    assert.equal(response.error, undefined);
    const verified = await verifySignedBridgeMessage(response.message, pairing, {
      origin,
      usedNonces: new Set(),
    });
    assert.equal(verified.ok, true);
    assert.equal(verified.message.type, 'action.dry-run-result');
    assert.equal(verified.message.payload.status, 'dry-run-complete');
    assert.equal(verified.message.payload.stopReason, null);
    assert.equal(verified.message.payload.results[0].status, 'resolved-no-click');
    assert.equal(inspectionCalls, 1);
    assert.equal(stored.pendingJobs.length, 1);
    assert.equal(stored.pendingJobs[0].mode, 'dry-run');
    assert.equal(stored.pendingJobs[0].result.status, 'dry-run-complete');
  } finally {
    delete globalThis.chrome;
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

test('background reserves and consumes one exact armed DM capability before dispatch', async () => {
  const temporaryRoot = await mkdtemp(path.join(tmpdir(), 'insta-aio-background-dm-live-'));
  const libraryRoot = path.join(temporaryRoot, 'lib');
  await mkdir(libraryRoot, { recursive: true });
  await Promise.all([
    copyFile(new URL('../extension/background.js', import.meta.url), path.join(temporaryRoot, 'background.js')),
    copyFile(new URL('../src/core/bridge-protocol.js', import.meta.url), path.join(libraryRoot, 'bridge-protocol.js')),
    copyFile(new URL('../src/core/controlled-account-action.js', import.meta.url), path.join(libraryRoot, 'controlled-account-action.js')),
    copyFile(new URL('../src/core/controlled-dm-unsend.js', import.meta.url), path.join(libraryRoot, 'controlled-dm-unsend.js')),
  ]);

  const origin = 'http://127.0.0.1:4173';
  const { pairing: unpaired } = createBridgePairing({
    origin,
    permissions: ['read', 'action'],
  });
  const pairing = { ...unpaired, pairedAt: new Date().toISOString() };
  const createdAt = Date.now() - 2_000;
  const sourceMessage = {
    id: 'sent-live-1',
    conversationId: 'inbox/friend_123',
    conversationName: 'Friend Example',
    senderName: 'Owner Example',
    senderId: null,
    isMine: true,
    timestamp: createdAt - 10_000,
    type: 'text',
    content: 'This exact message is reviewed once.',
    source: 'meta-export',
  };
  const draft = createReviewedDmJob(
    [sourceMessage],
    [messageSelectionKey(sourceMessage)],
    { createdAt },
  );
  const reviewed = confirmDmJobReview(draft, {
    confirmedAt: createdAt + 100,
    mode: 'live',
    phrase: draft.reviewConfirmationPhrase,
    settings: { liveDmUnsendEnabled: true, liveDmBatchLimit: 1 },
  });
  const job = confirmDmJobDestructive(reviewed, {
    confirmedAt: createdAt + 200,
    phrase: reviewed.destructiveConfirmationPhrase,
  });
  const item = job.items[0];

  const stored = {
    bridgePairings: [pairing],
    bridgeReplayNonces: [],
    pendingJobs: [],
    accountActionLedger: [],
    dmActionLedger: [],
    pendingLiveIntent: null,
    liveArm: null,
    pendingDmIntent: null,
    dmArm: null,
  };
  let runtimeListener = null;
  let inspectionCount = 0;
  let performCount = 0;
  let messageRemoved = false;
  globalThis.chrome = {
    runtime: {
      getManifest: () => ({ version: '0.4.0' }),
      onMessage: {
        addListener(listener) {
          runtimeListener = listener;
        },
      },
    },
    storage: {
      local: {
        async get(keys) {
          return Object.fromEntries(keys.map((key) => [key, stored[key]]));
        },
        async set(values) {
          Object.assign(stored, structuredClone(values));
        },
      },
    },
    tabs: {
      async get(tabId) {
        return { id: tabId, active: true, url: 'https://www.instagram.com/direct/t/123/' };
      },
      async query() {
        return [{ id: 7, active: true, url: 'https://www.instagram.com/direct/t/123/' }];
      },
      async sendMessage(tabId, message) {
        assert.equal(tabId, 7);
        if (message.kind === 'insta-aio-inspect-session') {
          return {
            sessionExpired: false,
            challenge: false,
            actionBlocked: false,
            rateLimited: false,
          };
        }
        if (message.kind === 'insta-aio-inspect-reviewed-dm-item') {
          inspectionCount += 1;
          if (messageRemoved) {
            return {
              conversationId: item.conversationId,
              messageId: item.messageId,
              missing: true,
              exactIdentityAvailable: true,
              reason: 'exact-message-not-found',
              evidence: { observedThreadId: '123' },
            };
          }
          return {
            conversationId: item.conversationId,
            contentDigest: item.contentDigest,
            exactIdentityAvailable: true,
            messageId: item.messageId,
            ownershipAvailable: true,
            resolutionToken: `dm-token-${inspectionCount}`,
            sentByMe: true,
            timestamp: item.timestamp,
          };
        }
        if (message.kind === 'insta-aio-perform-reviewed-dm-unsend') {
          performCount += 1;
          assert.equal(stored.pendingDmIntent, null);
          assert.equal(stored.dmArm, null);
          assert.equal(stored.dmActionLedger[0].status, 'reserved');
          assert.equal(message.item.resolutionToken, 'dm-token-2');
          messageRemoved = true;
          return {
            result: 'unsent',
            conversationId: item.conversationId,
            messageId: item.messageId,
            postcondition: {
              exactCandidateAbsent: true,
              exactThread: true,
              expectedThreadId: '123',
              observedThreadId: '123',
              observationReason: 'exact-message-not-found',
              retainedIdentityNodeDisconnected: true,
              retainedRowDisconnected: true,
            },
          };
        }
        throw new Error(`Unexpected content request: ${message.kind}`);
      },
    },
  };

  try {
    const backgroundUrl = `${pathToFileURL(path.join(temporaryRoot, 'background.js')).href}?test=${Date.now()}`;
    await import(backgroundUrl);
    const pwaSender = {
      url: `${origin}/index.html`,
      tab: { url: `${origin}/index.html` },
    };
    const instagramSender = {
      url: 'https://www.instagram.com/direct/t/123/',
      tab: { id: 7, url: 'https://www.instagram.com/direct/t/123/' },
    };

    function deliver(request, sender) {
      return new Promise((resolve) => {
        const result = runtimeListener(request, sender, resolve);
        if (result !== true) queueMicrotask(() => resolve(undefined));
      });
    }

    async function bridge(type, payload) {
      const request = await createSignedBridgeMessage(pairing, type, payload);
      const response = await deliver({
        kind: 'insta-aio-bridge-request',
        origin,
        message: request,
      }, pwaSender);
      assert.equal(response.error, undefined);
      const verified = await verifySignedBridgeMessage(response.message, pairing, {
        origin,
        usedNonces: new Set(),
      });
      assert.equal(verified.ok, true);
      return { request, message: verified.message };
    }

    const prepared = await bridge('action.dm-live-intent', { job });
    assert.equal(prepared.message.type, 'action.dm-live-intent-result');
    assert.equal(prepared.message.payload.armed, false);
    const intent = prepared.message.payload.intent;

    const rejectedArm = await deliver({
      kind: 'insta-aio-arm-dm-unsend',
      phrase: 'ARM UNSEND WRONG',
      jobId: intent.jobId,
      itemId: intent.itemId,
      conversationId: intent.conversationId,
      messageId: intent.messageId,
    }, instagramSender);
    assert.equal(rejectedArm.error, 'dm-live-arm-phrase-mismatch');

    const armed = await deliver({
      kind: 'insta-aio-arm-dm-unsend',
      phrase: `ARM UNSEND ${intent.armCode}`,
      jobId: intent.jobId,
      itemId: intent.itemId,
      conversationId: intent.conversationId,
      messageId: intent.messageId,
    }, instagramSender);
    assert.equal(armed.error, undefined);
    assert.equal(armed.state.dmArm.jobId, job.id);
    assert.equal(inspectionCount, 1);

    const session = await bridge('action.dm-session', { jobId: job.id });
    assert.equal(session.message.payload.sessionExpired, false);
    const conversation = await bridge('action.dm-conversation', {
      jobId: job.id,
      conversationId: item.conversationId,
    });
    assert.equal(conversation.message.payload.conversationId, item.conversationId);
    const resolved = await bridge('action.dm-message', { jobId: job.id, item });
    assert.equal(resolved.message.payload.resolutionToken, 'dm-token-2');

    const liveItem = { ...item, resolutionToken: resolved.message.payload.resolutionToken };
    const readiness = await bridge('action.dm-live-readiness', {
      jobId: job.id,
      item: liveItem,
    });
    assert.equal(readiness.message.payload.authorized, true);

    const performed = await bridge('action.dm-perform', {
      jobId: job.id,
      item: liveItem,
    });
    assert.equal(performed.message.payload.result, 'unsent');
    assert.equal(performCount, 1);
    assert.equal(stored.dmActionLedger[0].status, 'succeeded');
    assert.equal(stored.pendingJobs[0].mode, 'live');

    const postcheck = await bridge('action.dm-message', { jobId: job.id, item });
    assert.equal(postcheck.message.payload.missing, true);

    const replay = await bridge('action.dm-perform', {
      jobId: job.id,
      item: liveItem,
    });
    assert.equal(replay.message.payload.authorized, false);
    assert.equal(replay.message.payload.reason, 'dm-live-intent-required');
    assert.equal(performCount, 1);
  } finally {
    delete globalThis.chrome;
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

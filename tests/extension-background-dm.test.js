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
      getManifest: () => ({ version: '0.3.0' }),
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

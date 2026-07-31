import {
  createBridgeHandshakeNonce,
  createSignedBridgeMessage,
  deriveBridgeSessionPairing,
  verifySignedBridgeMessage,
} from './lib/bridge-protocol.js';

const MAX_REPLAY_NONCES = 512;
const MAX_PENDING_JOBS = 50;
let requestTail = Promise.resolve();

async function loadBridgeState() {
  const stored = await chrome.storage.local.get([
    'bridgePairings',
    'bridgeReplayNonces',
    'pendingJobs',
  ]);
  return {
    pairings: Array.isArray(stored.bridgePairings) ? stored.bridgePairings : [],
    replayNonces: Array.isArray(stored.bridgeReplayNonces) ? stored.bridgeReplayNonces : [],
    pendingJobs: Array.isArray(stored.pendingJobs) ? stored.pendingJobs : [],
  };
}

async function saveBridgeState(state) {
  await chrome.storage.local.set({
    bridgePairings: state.pairings,
    bridgeReplayNonces: state.replayNonces.slice(-MAX_REPLAY_NONCES),
    pendingJobs: state.pendingJobs.slice(0, MAX_PENDING_JOBS),
  });
}

function errorPermission(type) {
  return String(type || '').startsWith('action.') ? 'action' : 'read';
}

async function activeInstagramTab() {
  const tabs = await chrome.tabs.query({ url: 'https://www.instagram.com/*' });
  return tabs.find((tab) => tab.active) || tabs[0] || null;
}

function validateReviewedJob(job, expectedKind) {
  if (job?.kind !== expectedKind || !job.id || !Array.isArray(job.items)) {
    return 'invalid-reviewed-job';
  }
  if (job.mode !== 'dry-run') return 'live-execution-disabled';
  if (job.status !== 'ready' || !job.items.length) return 'job-not-ready';
  if (expectedKind === 'insta-aio-reviewed-action-job' && !job.confirmedAt) {
    return 'job-not-confirmed';
  }
  if (expectedKind === 'insta-aio-reviewed-dm-job' && !job.reviewConfirmedAt) {
    return 'job-not-confirmed';
  }
  return null;
}

async function inspectAccountJob(job) {
  const tab = await activeInstagramTab();
  if (!tab?.id) {
    return {
      jobId: job.id,
      status: 'stopped',
      stopReason: 'instagram-tab-unavailable',
      results: [],
    };
  }
  const results = [];
  for (const item of job.items) {
    let observation;
    try {
      observation = await chrome.tabs.sendMessage(tab.id, {
        kind: 'insta-aio-inspect-profile',
        username: item.username,
      });
    } catch {
      observation = { unexpectedUi: true, reason: 'inspector-unavailable' };
    }
    const matches = (
      observation?.username === item.username
      && !observation.ambiguous
      && !observation.unexpectedUi
      && !observation.sessionExpired
      && !observation.challenge
      && !observation.actionBlocked
      && !observation.rateLimited
    );
    results.push({
      itemId: item.id,
      username: item.username,
      action: item.action,
      status: matches ? 'resolved-no-click' : 'safe-stopped',
      observation,
    });
    if (!matches) break;
  }
  const failed = results.find((result) => result.status === 'safe-stopped');
  return {
    jobId: job.id,
    status: failed ? 'stopped' : 'dry-run-complete',
    stopReason: failed
      ? failed.observation?.reason
        || (failed.observation?.username !== failed.username ? 'wrong-profile' : 'ambiguous-ui')
      : null,
    results,
  };
}

async function routeVerifiedRequest(request, pairing, state) {
  if (request.type === 'bridge.ping') {
    return {
      responseType: 'read.bridge-status',
      payload: {
        extensionVersion: chrome.runtime.getManifest().version,
        permissions: pairing.permissions,
        liveExecutionEnabled: false,
      },
    };
  }

  if (request.type === 'read.visible-accounts') {
    const tab = await activeInstagramTab();
    if (!tab?.id) {
      return {
        responseType: 'read.visible-accounts-result',
        payload: { error: 'instagram-tab-unavailable', accounts: [] },
      };
    }
    let result;
    try {
      result = await chrome.tabs.sendMessage(tab.id, {
        kind: 'insta-aio-capture-visible-accounts',
      });
    } catch {
      result = { error: 'inspector-unavailable', accounts: [] };
    }
    return {
      responseType: 'read.visible-accounts-result',
      payload: result,
    };
  }

  if (request.type === 'action.account-job') {
    const job = request.payload?.job;
    const invalid = validateReviewedJob(job, 'insta-aio-reviewed-action-job');
    if (invalid) {
      return {
        responseType: 'action.bridge-error',
        payload: { reason: invalid },
      };
    }
    const result = await inspectAccountJob(job);
    state.pendingJobs.unshift({
      kind: job.kind,
      jobId: job.id,
      receivedAt: new Date().toISOString(),
      mode: 'dry-run',
      result,
    });
    return {
      responseType: 'action.dry-run-result',
      payload: result,
    };
  }

  if (request.type === 'action.dm-job') {
    const job = request.payload?.job;
    const invalid = validateReviewedJob(job, 'insta-aio-reviewed-dm-job');
    if (invalid) {
      return {
        responseType: 'action.bridge-error',
        payload: { reason: invalid },
      };
    }
    const result = {
      jobId: job.id,
      status: 'stopped',
      stopReason: 'exact-message-identity-unavailable',
      results: job.items.map((item) => ({
        itemId: item.id,
        conversationId: item.conversationId,
        messageId: item.messageId,
        status: 'safe-stopped',
      })),
    };
    state.pendingJobs.unshift({
      kind: job.kind,
      jobId: job.id,
      receivedAt: new Date().toISOString(),
      mode: 'dry-run',
      result,
    });
    return {
      responseType: 'action.dry-run-result',
      payload: result,
    };
  }

  return {
    responseType: `${errorPermission(request.type)}.bridge-error`,
    payload: { reason: 'unsupported-message-type' },
  };
}

async function handleBridgeRequest(input) {
  const state = await loadBridgeState();
  const request = input.message;
  const pairingIndex = state.pairings.findIndex((candidate) => (
    candidate.pairingId === request?.pairingId
  ));
  if (pairingIndex < 0) return { error: 'pairing-not-found' };
  const pairing = state.pairings[pairingIndex];
  const usedNonces = new Set(state.replayNonces
    .filter((entry) => entry.pairingId === pairing.pairingId)
    .map((entry) => entry.nonce));
  const verified = await verifySignedBridgeMessage(request, pairing, {
    origin: input.origin,
    usedNonces,
  });
  if (!verified.ok) return { error: verified.reason };

  state.replayNonces.push({
    pairingId: pairing.pairingId,
    nonce: request.nonce,
    usedAt: new Date().toISOString(),
  });

  if (request.type === 'bridge.pair') {
    if (pairing.pairedAt) return { error: 'pairing-code-consumed' };
    const extensionNonce = createBridgeHandshakeNonce();
    const response = await createSignedBridgeMessage(
      pairing,
      'read.pairing-complete',
      { extensionNonce },
      { requestId: request.requestId },
    );
    state.pairings[pairingIndex] = await deriveBridgeSessionPairing(pairing, {
      clientNonce: request.payload?.clientNonce,
      extensionNonce,
    });
    await saveBridgeState(state);
    return { message: response };
  }

  if (!pairing.pairedAt) return { error: 'pairing-incomplete' };
  const routed = await routeVerifiedRequest(request, pairing, state);
  const response = await createSignedBridgeMessage(
    pairing,
    routed.responseType,
    routed.payload,
    { requestId: request.requestId },
  );
  await saveBridgeState(state);
  return { message: response };
}

function bridgeSenderOrigin(sender) {
  try {
    return new URL(sender?.url || sender?.tab?.url || '').origin;
  } catch {
    return null;
  }
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request?.kind !== 'insta-aio-bridge-request') return false;
  const origin = bridgeSenderOrigin(sender);
  if (!origin || origin !== request.origin) {
    sendResponse({ error: 'origin-mismatch' });
    return false;
  }
  const operation = requestTail.then(() => handleBridgeRequest({
    message: request.message,
    origin,
  }));
  requestTail = operation.catch(() => {});
  operation.then(sendResponse).catch(() => sendResponse({ error: 'bridge-internal-error' }));
  return true;
});

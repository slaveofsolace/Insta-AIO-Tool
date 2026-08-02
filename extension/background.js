import {
  createBridgeHandshakeNonce,
  createSignedBridgeMessage,
  deriveBridgeSessionPairing,
  verifySignedBridgeMessage,
} from './lib/bridge-protocol.js';
import {
  ACCOUNT_ARM_TTL_MS,
  accountArmMatchesIntent as armMatchesIntent,
  accountIntentMatchesItem as intentMatchesItem,
  normalizeActionUsername as normalizeUsername,
  prepareControlledAccountIntent as prepareLiveAccountIntent,
  pruneControlledAccountState as pruneLiveState,
  publicAccountArm as publicLiveArm,
  publicAccountIntent as publicLiveIntent,
} from './lib/controlled-account-action.js';

const MAX_REPLAY_NONCES = 512;
const MAX_PENDING_JOBS = 50;
const MAX_ACCOUNT_ACTION_LEDGER = 500;
const EXTENSION_DAILY_ACTION_LIMIT = 25;
let requestTail = Promise.resolve();

async function loadBridgeState() {
  const stored = await chrome.storage.local.get([
    'bridgePairings',
    'bridgeReplayNonces',
    'pendingJobs',
    'accountActionLedger',
    'pendingLiveIntent',
    'liveArm',
  ]);
  return {
    pairings: Array.isArray(stored.bridgePairings) ? stored.bridgePairings : [],
    replayNonces: Array.isArray(stored.bridgeReplayNonces) ? stored.bridgeReplayNonces : [],
    pendingJobs: Array.isArray(stored.pendingJobs) ? stored.pendingJobs : [],
    accountActionLedger: Array.isArray(stored.accountActionLedger)
      ? stored.accountActionLedger
      : [],
    pendingLiveIntent: stored.pendingLiveIntent || null,
    liveArm: stored.liveArm || null,
  };
}

async function saveBridgeState(state) {
  await chrome.storage.local.set({
    bridgePairings: state.pairings,
    bridgeReplayNonces: state.replayNonces.slice(-MAX_REPLAY_NONCES),
    pendingJobs: state.pendingJobs.slice(0, MAX_PENDING_JOBS),
    accountActionLedger: state.accountActionLedger.slice(0, MAX_ACCOUNT_ACTION_LEDGER),
    pendingLiveIntent: state.pendingLiveIntent || null,
    liveArm: state.liveArm || null,
  });
}

function errorPermission(type) {
  return String(type || '').startsWith('action.') ? 'action' : 'read';
}

async function activeInstagramTab() {
  const tabs = await chrome.tabs.query({ url: 'https://www.instagram.com/*' });
  return tabs.find((tab) => tab.active) || tabs[0] || null;
}

async function intentInstagramTab(state) {
  const tabId = state.liveArm?.tabId;
  if (Number.isInteger(tabId)) {
    try {
      const tab = await chrome.tabs.get(tabId);
      if (new URL(tab.url || '').origin === 'https://www.instagram.com') return tab;
    } catch {
      return null;
    }
  }
  return activeInstagramTab();
}

async function inspectProfileInTab(tabId, username) {
  try {
    return await chrome.tabs.sendMessage(tabId, {
      kind: 'insta-aio-inspect-profile',
      username,
    });
  } catch {
    return { unexpectedUi: true, reason: 'inspector-unavailable' };
  }
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

function accountActionDay(now = Date.now()) {
  return new Date(now).toISOString().slice(0, 10);
}

function accountActionAttemptId(jobId, intent) {
  return `${jobId}:${intent.itemId}:${intent.action}:${intent.username}`;
}

function extensionReservationConflict(state, jobId, intent, now = Date.now()) {
  const ledger = Array.isArray(state.accountActionLedger) ? state.accountActionLedger : [];
  const counted = new Set(['reserved', 'succeeded', 'uncertain']);
  const id = accountActionAttemptId(jobId, intent);
  const existing = ledger.find((entry) => entry.id === id && counted.has(entry.status));
  if (existing) return { reason: 'extension-duplicate-attempt', existing };

  const day = accountActionDay(now);
  const duplicateTarget = ledger.find((entry) => (
    entry.day === day
    && entry.action === intent.action
    && entry.username === intent.username
    && counted.has(entry.status)
  ));
  if (duplicateTarget) return { reason: 'extension-duplicate-account-action', existing: duplicateTarget };

  const used = ledger.filter((entry) => (
    entry.day === day
    && entry.action === intent.action
    && counted.has(entry.status)
  )).length;
  if (used >= EXTENSION_DAILY_ACTION_LIMIT) {
    return {
      reason: 'extension-daily-limit',
      limit: EXTENSION_DAILY_ACTION_LIMIT,
      used,
    };
  }
  return null;
}

function reserveExtensionAction(state, jobId, intent, tabId, now = Date.now()) {
  const conflict = extensionReservationConflict(state, jobId, intent, now);
  if (conflict) return { ok: false, ...conflict };
  const record = {
    id: accountActionAttemptId(jobId, intent),
    jobId,
    itemId: intent.itemId,
    action: intent.action,
    username: intent.username,
    tabId,
    day: accountActionDay(now),
    status: 'reserved',
    reservedAt: new Date(now).toISOString(),
    finalizedAt: null,
    result: null,
  };
  state.accountActionLedger.unshift(record);
  return { ok: true, record };
}

function finalizeExtensionAction(state, attemptId, result, succeeded, now = Date.now()) {
  const record = state.accountActionLedger.find((entry) => entry.id === attemptId);
  if (!record) throw new Error('Extension action reservation is missing.');
  record.status = succeeded ? 'succeeded' : 'uncertain';
  record.finalizedAt = new Date(now).toISOString();
  record.result = succeeded
    ? String(result?.result || 'completed')
    : String(result?.reason || 'live-action-not-confirmed');
}

async function accountLiveReadiness(state, pairing, jobId, item, now = Date.now()) {
  pruneLiveState(state, now);
  const intent = state.pendingLiveIntent;
  if (!intentMatchesItem(intent, jobId, item) || intent?.pairingId !== pairing.pairingId) {
    return { authorized: false, reason: 'live-intent-required' };
  }
  if (!armMatchesIntent(state.liveArm, intent)) {
    return {
      authorized: false,
      reason: 'live-arm-required',
      intent: publicLiveIntent(intent),
    };
  }
  if (
    !item?.resolutionToken
    || !['following', 'not-following'].includes(item.expectedRelationship)
  ) {
    return { authorized: false, reason: 'exact-profile-resolution-required' };
  }
  const reservationConflict = extensionReservationConflict(state, jobId, intent, now);
  if (reservationConflict) {
    return {
      authorized: false,
      reason: reservationConflict.reason,
    };
  }
  const tab = await intentInstagramTab(state);
  if (!tab?.id || tab.id !== state.liveArm.tabId) {
    return { authorized: false, reason: 'armed-instagram-tab-unavailable' };
  }
  return {
    authorized: true,
    expiresAt: state.liveArm.expiresAt,
    intent: publicLiveIntent(intent),
  };
}

async function performLiveAccountAction(state, pairing, jobId, item) {
  const readiness = await accountLiveReadiness(state, pairing, jobId, item);
  if (!readiness.authorized) return readiness;
  const intent = state.pendingLiveIntent;
  const tab = await intentInstagramTab(state);
  const reservation = reserveExtensionAction(state, jobId, intent, tab.id);
  if (!reservation.ok) {
    return { authorized: false, reason: reservation.reason };
  }

  // Reserve and consume the one-shot capability durably before the first page control is used.
  state.liveArm = null;
  state.pendingLiveIntent = null;
  await saveBridgeState(state);

  let result;
  try {
    result = await chrome.tabs.sendMessage(tab.id, {
      kind: 'insta-aio-perform-reviewed-profile-action',
      item: {
        action: intent.action,
        expectedRelationship: item.expectedRelationship,
        resolutionToken: item.resolutionToken,
        username: intent.username,
      },
    });
  } catch {
    result = { unexpectedUi: true, reason: 'live-action-inspector-unavailable' };
  }

  const succeeded = Boolean(result?.result)
    && !result?.ambiguous
    && !result?.unexpectedUi
    && !result?.sessionExpired
    && !result?.challenge
    && !result?.actionBlocked
    && !result?.rateLimited;
  finalizeExtensionAction(state, reservation.record.id, result, succeeded);
  state.pendingJobs.unshift({
    kind: 'insta-aio-reviewed-action-job',
    jobId,
    receivedAt: new Date().toISOString(),
    mode: 'live',
    result: {
      jobId,
      status: succeeded ? 'completed' : 'stopped',
      stopReason: succeeded ? null : result?.reason || 'live-action-not-confirmed',
      results: [{
        itemId: intent.itemId,
        username: intent.username,
        action: intent.action,
        status: succeeded ? 'completed' : 'safe-stopped',
      }],
    },
  });
  await saveBridgeState(state);
  return result || { unexpectedUi: true, reason: 'empty-live-action-result' };
}

async function armPendingAccountIntent(request, sender) {
  const state = pruneLiveState(await loadBridgeState());
  const intent = state.pendingLiveIntent;
  if (!intent) return { error: 'live-intent-required' };
  if (!Number.isInteger(sender?.tab?.id)) return { error: 'instagram-tab-required' };

  const expectedPhrase = `ARM ${intent.action.toUpperCase()} @${intent.username}`;
  if (String(request?.phrase || '').trim() !== expectedPhrase) {
    return { error: 'live-arm-phrase-mismatch' };
  }
  if (
    request?.jobId !== intent.jobId
    || request?.itemId !== intent.itemId
    || normalizeUsername(request?.username) !== intent.username
    || request?.action !== intent.action
  ) {
    return { error: 'live-intent-mismatch' };
  }

  const observation = await inspectProfileInTab(sender.tab.id, intent.username);
  const expectedRelationship = intent.action === 'follow' ? 'not-following' : 'following';
  if (
    observation?.username !== intent.username
    || observation?.relationship !== expectedRelationship
    || observation?.ambiguous
    || observation?.unexpectedUi
    || observation?.sessionExpired
    || observation?.challenge
    || observation?.actionBlocked
    || observation?.rateLimited
    || !observation?.resolutionToken
  ) {
    return {
      error: observation?.reason
        || (observation?.username !== intent.username ? 'wrong-profile' : 'ambiguous-profile-control'),
    };
  }

  const now = Date.now();
  state.liveArm = {
    action: intent.action,
    armedAt: new Date(now).toISOString(),
    expiresAt: new Date(now + ACCOUNT_ARM_TTL_MS).toISOString(),
    itemId: intent.itemId,
    jobId: intent.jobId,
    tabId: sender.tab.id,
    username: intent.username,
  };
  await saveBridgeState(state);
  return {
    arm: publicLiveArm(state.liveArm),
    state: overlayState(state),
  };
}

async function cancelPendingAccountIntent() {
  const state = await loadBridgeState();
  state.pendingLiveIntent = null;
  state.liveArm = null;
  await saveBridgeState(state);
  return { state: overlayState(state) };
}

async function routeVerifiedRequest(request, pairing, state) {
  pruneLiveState(state);
  if (request.type === 'bridge.ping') {
    return {
      responseType: 'read.bridge-status',
      payload: {
        extensionVersion: chrome.runtime.getManifest().version,
        permissions: pairing.permissions,
        controlledAccountActionsAvailable: true,
        liveExecutionEnabled: armMatchesIntent(state.liveArm, state.pendingLiveIntent),
        pendingLiveIntent: publicLiveIntent(state.pendingLiveIntent),
        liveArm: publicLiveArm(state.liveArm),
      },
    };
  }

  if (request.type === 'action.account-live-intent') {
    const prepared = prepareLiveAccountIntent(request.payload?.job, pairing, state);
    if (prepared.error) {
      return {
        responseType: 'action.bridge-error',
        payload: { reason: prepared.error },
      };
    }
    return {
      responseType: 'action.account-live-intent-result',
      payload: prepared,
    };
  }

  if (request.type === 'action.account-session') {
    const intent = state.pendingLiveIntent;
    if (!intent || intent.jobId !== request.payload?.jobId || intent.pairingId !== pairing.pairingId) {
      return {
        responseType: 'action.account-session-result',
        payload: { unexpectedUi: true, reason: 'live-intent-required' },
      };
    }
    const tab = await intentInstagramTab(state);
    let result;
    try {
      result = tab?.id
        ? await chrome.tabs.sendMessage(tab.id, { kind: 'insta-aio-inspect-session' })
        : { unexpectedUi: true, reason: 'instagram-tab-unavailable' };
    } catch {
      result = { unexpectedUi: true, reason: 'inspector-unavailable' };
    }
    return {
      responseType: 'action.account-session-result',
      payload: result,
    };
  }

  if (request.type === 'action.account-profile') {
    const intent = state.pendingLiveIntent;
    const username = normalizeUsername(request.payload?.username);
    if (
      !intent
      || intent.jobId !== request.payload?.jobId
      || intent.pairingId !== pairing.pairingId
      || username !== intent.username
    ) {
      return {
        responseType: 'action.account-profile-result',
        payload: { unexpectedUi: true, reason: 'live-intent-mismatch' },
      };
    }
    const tab = await intentInstagramTab(state);
    const result = tab?.id
      ? await inspectProfileInTab(tab.id, username)
      : { unexpectedUi: true, reason: 'instagram-tab-unavailable' };
    return {
      responseType: 'action.account-profile-result',
      payload: result,
    };
  }

  if (request.type === 'action.account-live-readiness') {
    return {
      responseType: 'action.account-live-readiness-result',
      payload: await accountLiveReadiness(
        state,
        pairing,
        request.payload?.jobId,
        request.payload?.item,
      ),
    };
  }

  if (request.type === 'action.account-perform') {
    return {
      responseType: 'action.account-perform-result',
      payload: await performLiveAccountAction(
        state,
        pairing,
        request.payload?.jobId,
        request.payload?.item,
      ),
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

function overlayState(state) {
  pruneLiveState(state);
  return {
    extensionVersion: chrome.runtime.getManifest().version,
    controlledAccountActionsAvailable: true,
    liveExecutionEnabled: armMatchesIntent(state.liveArm, state.pendingLiveIntent),
    pendingLiveIntent: publicLiveIntent(state.pendingLiveIntent),
    liveArm: publicLiveArm(state.liveArm),
    pairings: state.pairings.map((pairing) => ({
      origin: pairing.origin,
      permissions: Array.isArray(pairing.permissions) ? [...pairing.permissions] : [],
      pairedAt: pairing.pairedAt || null,
    })),
    recentRuns: state.pendingJobs.slice(0, 12).map((job) => ({
      kind: job.kind,
      jobId: job.jobId,
      receivedAt: job.receivedAt,
      mode: job.mode === 'live' ? 'live' : 'dry-run',
      status: job.result?.status || 'stopped',
      stopReason: job.result?.stopReason || null,
      results: (job.result?.results || []).slice(0, 25).map((result) => ({
        username: result.username || null,
        action: result.action || null,
        conversationId: result.conversationId || null,
        messageId: result.messageId || null,
        status: result.status || 'safe-stopped',
      })),
    })),
  };
}

function isInstagramSender(sender) {
  return bridgeSenderOrigin(sender) === 'https://www.instagram.com';
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request?.kind === 'insta-aio-overlay-state') {
    if (!isInstagramSender(sender)) {
      sendResponse({ error: 'instagram-origin-required' });
      return false;
    }
    loadBridgeState()
      .then(async (state) => {
        pruneLiveState(state);
        await saveBridgeState(state);
        sendResponse({ state: overlayState(state) });
      })
      .catch(() => sendResponse({ error: 'overlay-state-unavailable' }));
    return true;
  }
  if (request?.kind === 'insta-aio-arm-account-action') {
    if (!isInstagramSender(sender)) {
      sendResponse({ error: 'instagram-origin-required' });
      return false;
    }
    const operation = requestTail.then(() => armPendingAccountIntent(request, sender));
    requestTail = operation.catch(() => {});
    operation.then(sendResponse).catch(() => sendResponse({ error: 'live-arm-unavailable' }));
    return true;
  }
  if (request?.kind === 'insta-aio-cancel-account-action') {
    if (!isInstagramSender(sender)) {
      sendResponse({ error: 'instagram-origin-required' });
      return false;
    }
    const operation = requestTail.then(() => cancelPendingAccountIntent());
    requestTail = operation.catch(() => {});
    operation.then(sendResponse).catch(() => sendResponse({ error: 'live-intent-cancel-failed' }));
    return true;
  }
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

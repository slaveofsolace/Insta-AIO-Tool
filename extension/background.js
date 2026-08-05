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
import {
  DM_ARM_TTL_MS,
  controlledDmArmPhrase,
  dmArmMatchesIntent,
  dmIntentMatchesItem,
  prepareControlledDmIntent,
  pruneControlledDmState,
  publicDmArm,
  publicDmIntent,
  verifiedControlledDmResult,
} from './lib/controlled-dm-unsend.js';

const MAX_REPLAY_NONCES = 512;
const MAX_PENDING_JOBS = 50;
const MAX_ACCOUNT_ACTION_LEDGER = 500;
const MAX_DM_ACTION_LEDGER = 500;
const DEFAULT_DAILY_ACTION_LIMIT = 100;
const DEFAULT_DAILY_DM_LIMIT = 50;
// Ceilings the user cannot raise. Instagram penalises fast bulk activity, so the
// batch runner stays well inside commonly reported action thresholds.
const MAX_DAILY_ACTION_LIMIT = 400;
const MAX_DAILY_DM_LIMIT = 300;
const MAX_BATCH_ITEMS = 250;
const BATCH_ARM_TTL_MS = 30 * 60 * 1000;
const DEFAULT_BATCH_MIN_DELAY_MS = 4_000;
const DEFAULT_BATCH_MAX_DELAY_MS = 11_000;
const MIN_ALLOWED_BATCH_DELAY_MS = 1_500;
// After this many consecutive items the runner takes a longer cooldown.
const BATCH_REST_EVERY = 20;
const BATCH_REST_MS = 90_000;
let requestTail = Promise.resolve();
let activeBatchAbort = false;

function clampInteger(value, fallback, min, max) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(numeric)));
}

function normalizeBatchLimits(limits) {
  return {
    dailyActionLimit: clampInteger(
      limits?.dailyActionLimit,
      DEFAULT_DAILY_ACTION_LIMIT,
      1,
      MAX_DAILY_ACTION_LIMIT,
    ),
    dailyDmLimit: clampInteger(
      limits?.dailyDmLimit,
      DEFAULT_DAILY_DM_LIMIT,
      1,
      MAX_DAILY_DM_LIMIT,
    ),
    minDelayMs: clampInteger(
      limits?.minDelayMs,
      DEFAULT_BATCH_MIN_DELAY_MS,
      MIN_ALLOWED_BATCH_DELAY_MS,
      600_000,
    ),
    maxDelayMs: clampInteger(
      limits?.maxDelayMs,
      DEFAULT_BATCH_MAX_DELAY_MS,
      MIN_ALLOWED_BATCH_DELAY_MS,
      900_000,
    ),
  };
}

async function loadBridgeState() {
  const stored = await chrome.storage.local.get([
    'bridgePairings',
    'bridgeReplayNonces',
    'pendingJobs',
    'accountActionLedger',
    'dmActionLedger',
    'pendingLiveIntent',
    'liveArm',
    'pendingDmIntent',
    'dmArm',
    'batchArm',
    'batchRun',
    'batchLimits',
  ]);
  return {
    pairings: Array.isArray(stored.bridgePairings) ? stored.bridgePairings : [],
    replayNonces: Array.isArray(stored.bridgeReplayNonces) ? stored.bridgeReplayNonces : [],
    pendingJobs: Array.isArray(stored.pendingJobs) ? stored.pendingJobs : [],
    accountActionLedger: Array.isArray(stored.accountActionLedger)
      ? stored.accountActionLedger
      : [],
    dmActionLedger: Array.isArray(stored.dmActionLedger)
      ? stored.dmActionLedger
      : [],
    pendingLiveIntent: stored.pendingLiveIntent || null,
    liveArm: stored.liveArm || null,
    pendingDmIntent: stored.pendingDmIntent || null,
    dmArm: stored.dmArm || null,
    batchArm: stored.batchArm || null,
    batchRun: stored.batchRun || null,
    batchLimits: normalizeBatchLimits(stored.batchLimits),
  };
}

async function saveBridgeState(state) {
  await chrome.storage.local.set({
    bridgePairings: state.pairings,
    bridgeReplayNonces: state.replayNonces.slice(-MAX_REPLAY_NONCES),
    pendingJobs: state.pendingJobs.slice(0, MAX_PENDING_JOBS),
    accountActionLedger: state.accountActionLedger.slice(0, MAX_ACCOUNT_ACTION_LEDGER),
    dmActionLedger: state.dmActionLedger.slice(0, MAX_DM_ACTION_LEDGER),
    pendingLiveIntent: state.pendingLiveIntent || null,
    liveArm: state.liveArm || null,
    pendingDmIntent: state.pendingDmIntent || null,
    dmArm: state.dmArm || null,
    batchArm: state.batchArm || null,
    batchRun: state.batchRun || null,
    batchLimits: normalizeBatchLimits(state.batchLimits),
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

async function dmIntentInstagramTab(state) {
  const tabId = state.dmArm?.tabId;
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

async function inspectDmItemInTab(tabId, item) {
  try {
    return await chrome.tabs.sendMessage(tabId, {
      kind: 'insta-aio-inspect-reviewed-dm-item',
      item: {
        conversationId: item.conversationId,
        contentDigest: item.contentDigest,
        messageId: item.messageId,
        sentByMe: item.sentByMe === true,
        timestamp: item.timestamp,
      },
    });
  } catch {
    return { unexpectedUi: true, reason: 'inspector-unavailable' };
  }
}

function directThreadId(value) {
  const text = String(value || '').replaceAll('\\', '/');
  const directMatch = text.match(/\/direct\/t\/([^/?#]+)/i);
  if (directMatch) return directMatch[1];
  const finalSegment = text.split('/').filter(Boolean).at(-1) || '';
  const exportMatch = finalSegment.match(/_([0-9]+)$/);
  return exportMatch?.[1] || (/^[0-9]+$/.test(finalSegment) ? finalSegment : null);
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

async function inspectDmJob(job) {
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
        kind: 'insta-aio-inspect-reviewed-dm-item',
        item: {
          conversationId: item.conversationId,
          contentDigest: item.contentDigest,
          messageId: item.messageId,
          sentByMe: item.sentByMe,
          timestamp: item.timestamp,
        },
      });
    } catch {
      observation = { unexpectedUi: true, reason: 'inspector-unavailable' };
    }
    const matches = (
      item.sentByMe === true
      && observation?.conversationId === item.conversationId
      && observation?.messageId === item.messageId
      && Number(observation?.timestamp) === Number(item.timestamp)
      && observation?.contentDigest === item.contentDigest
      && observation?.sentByMe === true
      && observation?.exactIdentityAvailable === true
      && observation?.ownershipAvailable === true
      && Boolean(observation?.resolutionToken)
      && !observation?.ambiguous
      && !observation?.unexpectedUi
      && !observation?.sessionExpired
      && !observation?.challenge
      && !observation?.actionBlocked
      && !observation?.rateLimited
    );
    results.push({
      itemId: item.id,
      conversationId: item.conversationId,
      messageId: item.messageId,
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
      ? failed.observation?.reason || 'exact-message-identity-unavailable'
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
  const dailyActionLimit = normalizeBatchLimits(state.batchLimits).dailyActionLimit;
  if (used >= dailyActionLimit) {
    return {
      reason: 'extension-daily-limit',
      limit: dailyActionLimit,
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

function dmActionAttemptId(jobId, intent) {
  return `${jobId}:${intent.itemId}:${intent.conversationId}:${intent.messageId}`;
}

function extensionDmReservationConflict(state, jobId, intent, now = Date.now()) {
  const ledger = Array.isArray(state.dmActionLedger) ? state.dmActionLedger : [];
  const counted = new Set(['reserved', 'succeeded', 'uncertain']);
  const id = dmActionAttemptId(jobId, intent);
  const existing = ledger.find((entry) => entry.id === id && counted.has(entry.status));
  if (existing) return { reason: 'extension-duplicate-dm-attempt', existing };

  const duplicateMessage = ledger.find((entry) => (
    entry.conversationId === intent.conversationId
    && entry.messageId === intent.messageId
    && counted.has(entry.status)
  ));
  if (duplicateMessage) return { reason: 'extension-duplicate-dm-message', existing: duplicateMessage };

  const day = accountActionDay(now);
  const used = ledger.filter((entry) => entry.day === day && counted.has(entry.status)).length;
  const dailyDmLimit = normalizeBatchLimits(state.batchLimits).dailyDmLimit;
  if (used >= dailyDmLimit) {
    return { reason: 'extension-daily-dm-limit', limit: dailyDmLimit, used };
  }
  return null;
}

function reserveExtensionDmAction(state, jobId, intent, pairingId, tabId, now = Date.now()) {
  const conflict = extensionDmReservationConflict(state, jobId, intent, now);
  if (conflict) return { ok: false, ...conflict };
  const record = {
    id: dmActionAttemptId(jobId, intent),
    jobId,
    itemId: intent.itemId,
    conversationId: intent.conversationId,
    messageId: intent.messageId,
    pairingId,
    tabId,
    day: accountActionDay(now),
    status: 'reserved',
    reservedAt: new Date(now).toISOString(),
    finalizedAt: null,
    result: null,
  };
  state.dmActionLedger.unshift(record);
  return { ok: true, record };
}

function finalizeExtensionDmAction(state, attemptId, result, succeeded, now = Date.now()) {
  const record = state.dmActionLedger.find((entry) => entry.id === attemptId);
  if (!record) throw new Error('Extension DM reservation is missing.');
  record.status = succeeded ? 'succeeded' : 'uncertain';
  record.finalizedAt = new Date(now).toISOString();
  record.result = succeeded
    ? String(result?.result || 'unsent')
    : String(result?.reason || 'live-dm-not-confirmed');
}

function matchingDmAttempt(state, pairing, jobId, item) {
  return state.dmActionLedger.find((entry) => (
    entry.jobId === jobId
    && entry.itemId === item?.id
    && entry.conversationId === String(item?.conversationId || '')
    && entry.messageId === String(item?.messageId || '')
    && entry.pairingId === pairing.pairingId
    && ['succeeded', 'uncertain'].includes(entry.status)
  )) || null;
}

async function dmLiveReadiness(state, pairing, jobId, item, now = Date.now()) {
  pruneControlledDmState(state, now);
  const intent = state.pendingDmIntent;
  if (!dmIntentMatchesItem(intent, jobId, item) || intent?.pairingId !== pairing.pairingId) {
    return { authorized: false, reason: 'dm-live-intent-required' };
  }
  if (!dmArmMatchesIntent(state.dmArm, intent)) {
    return {
      authorized: false,
      reason: 'dm-live-arm-required',
      intent: publicDmIntent(intent),
    };
  }
  if (!item?.resolutionToken) {
    return { authorized: false, reason: 'exact-dm-resolution-required' };
  }
  const reservationConflict = extensionDmReservationConflict(state, jobId, intent, now);
  if (reservationConflict) {
    return { authorized: false, reason: reservationConflict.reason };
  }
  const tab = await dmIntentInstagramTab(state);
  if (!tab?.id || tab.id !== state.dmArm.tabId) {
    return { authorized: false, reason: 'armed-instagram-tab-unavailable' };
  }
  return {
    authorized: true,
    expiresAt: state.dmArm.expiresAt,
    intent: publicDmIntent(intent),
  };
}

async function performLiveDmUnsend(state, pairing, jobId, item) {
  const readiness = await dmLiveReadiness(state, pairing, jobId, item);
  if (!readiness.authorized) return readiness;
  const intent = state.pendingDmIntent;
  const tab = await dmIntentInstagramTab(state);
  const reservation = reserveExtensionDmAction(
    state,
    jobId,
    intent,
    pairing.pairingId,
    tab.id,
  );
  if (!reservation.ok) return { authorized: false, reason: reservation.reason };

  // Reserve and consume the one-shot DM capability durably before the first page control is used.
  state.dmArm = null;
  state.pendingDmIntent = null;
  await saveBridgeState(state);

  let result;
  try {
    result = await chrome.tabs.sendMessage(tab.id, {
      kind: 'insta-aio-perform-reviewed-dm-unsend',
      item: {
        conversationId: intent.conversationId,
        contentDigest: intent.contentDigest,
        messageId: intent.messageId,
        resolutionToken: item.resolutionToken,
        sentByMe: true,
        timestamp: intent.timestamp,
      },
    });
  } catch {
    result = { unexpectedUi: true, reason: 'live-dm-inspector-unavailable' };
  }

  const succeeded = verifiedControlledDmResult(intent, result);
  finalizeExtensionDmAction(state, reservation.record.id, result, succeeded);
  state.pendingJobs.unshift({
    kind: 'insta-aio-reviewed-dm-job',
    jobId,
    receivedAt: new Date().toISOString(),
    mode: 'live',
    result: {
      jobId,
      status: succeeded ? 'completed' : 'stopped',
      stopReason: succeeded ? null : result?.reason || 'live-dm-not-confirmed',
      results: [{
        itemId: intent.itemId,
        conversationId: intent.conversationId,
        messageId: intent.messageId,
        status: succeeded ? 'completed' : 'safe-stopped',
      }],
    },
  });
  await saveBridgeState(state);
  return result || { unexpectedUi: true, reason: 'empty-live-dm-result' };
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

// ---------------------------------------------------------------------------
// Batch runner
//
// The audited controlled path stays one-shot: every item below still runs a
// complete inspect -> exact-resolution -> reserve -> perform -> finalize cycle
// against the live DOM. The batch layer only removes the need to retype a
// confirmation phrase for each item, and it stops the whole run the moment
// Instagram signals a challenge, rate limit, block, or an unexpected surface.
// ---------------------------------------------------------------------------

function batchArmPhrase(kind, action, count) {
  if (kind === 'dm') return `ARM MASS UNSEND ${count}`;
  return `ARM BATCH ${String(action || '').toUpperCase()} ${count}`;
}

function sessionStopReason(observation) {
  if (observation?.sessionExpired) return 'session-expired';
  if (observation?.challenge) return 'challenge-required';
  if (observation?.actionBlocked) return 'action-blocked';
  if (observation?.rateLimited) return 'rate-limited';
  return null;
}

function jitteredDelay(limits) {
  const min = Math.min(limits.minDelayMs, limits.maxDelayMs);
  const max = Math.max(limits.minDelayMs, limits.maxDelayMs);
  return min + Math.floor(Math.random() * (max - min + 1));
}

function sleep(ms) {
  return new Promise((resolve) => { setTimeout(resolve, ms); });
}

function batchArmValid(state, now = Date.now()) {
  const arm = state.batchArm;
  if (!arm) return false;
  return Date.parse(arm.expiresAt) > now;
}

async function armBatch(request, sender) {
  const state = await loadBridgeState();
  if (!Number.isInteger(sender?.tab?.id)) return { error: 'instagram-tab-required' };
  const kind = request?.batchKind === 'dm' ? 'dm' : 'account';
  const action = kind === 'account' ? String(request?.action || '') : null;
  if (kind === 'account' && !['follow', 'unfollow'].includes(action)) {
    return { error: 'batch-action-invalid' };
  }
  const count = clampInteger(request?.count, 0, 1, MAX_BATCH_ITEMS);
  if (!count) return { error: 'batch-count-invalid' };

  const expected = batchArmPhrase(kind, action, count);
  if (String(request?.phrase || '').trim() !== expected) {
    return { error: 'batch-arm-phrase-mismatch', expectedPhrase: expected };
  }

  const now = Date.now();
  state.batchArm = {
    kind,
    action,
    count,
    jobId: String(request?.jobId || `batch-${now}`),
    tabId: sender.tab.id,
    armedAt: new Date(now).toISOString(),
    expiresAt: new Date(now + BATCH_ARM_TTL_MS).toISOString(),
  };
  await saveBridgeState(state);
  return { arm: { ...state.batchArm }, state: overlayState(state) };
}

async function tabSettled(tabId, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    let tab;
    try {
      tab = await chrome.tabs.get(tabId);
    } catch {
      return false;
    }
    if (tab.status === 'complete') return true;
    await sleep(250);
  }
  return false;
}

// Follow/unfollow targets live on their own profile pages, so the armed tab is
// navigated to each target before the exact-resolution check runs.
async function navigateToProfile(tabId, username) {
  const target = `https://www.instagram.com/${username}/`;
  try {
    const tab = await chrome.tabs.get(tabId);
    const current = normalizeUsername(new URL(tab.url || '').pathname);
    if (current === username) return true;
    await chrome.tabs.update(tabId, { url: target });
  } catch {
    return false;
  }
  if (!await tabSettled(tabId)) return false;
  // Instagram hydrates its profile header after load; give it a moment.
  await sleep(1_200);
  return true;
}

async function runBatchAccountItem(state, tabId, jobId, item, limits) {
  if (!item.username) {
    return { status: 'skipped', reason: 'invalid-username', fatal: false };
  }
  if (!await navigateToProfile(tabId, item.username)) {
    return { status: 'skipped', reason: 'profile-navigation-failed', fatal: false };
  }
  // Instagram hydrates the profile header after load, and the content script may
  // not have re-injected yet. A single attempt would report the target as
  // unresolvable and silently skip it, which on a slow connection could drop
  // most of a batch. Retry briefly before believing the target is not there.
  let observation = await inspectProfileInTab(tabId, item.username);
  for (let attempt = 0; attempt < 6; attempt += 1) {
    if (sessionStopReason(observation)) break;
    if (observation?.username === item.username && observation?.resolutionToken) break;
    await sleep(1_000);
    observation = await inspectProfileInTab(tabId, item.username);
  }
  const stop = sessionStopReason(observation);
  if (stop) return { status: 'stopped', stopReason: stop, fatal: true };

  const expectedRelationship = item.action === 'follow' ? 'not-following' : 'following';
  if (
    observation?.username !== item.username
    || observation?.relationship !== expectedRelationship
    || observation?.ambiguous
    || observation?.unexpectedUi
    || !observation?.resolutionToken
  ) {
    return {
      status: 'skipped',
      reason: observation?.username !== item.username
        ? 'wrong-profile'
        : observation?.reason || 'relationship-mismatch',
      fatal: false,
    };
  }

  const intent = {
    action: item.action,
    itemId: item.id,
    jobId,
    username: item.username,
  };
  const reservation = reserveExtensionAction(state, jobId, intent, tabId);
  if (!reservation.ok) {
    return {
      status: 'skipped',
      reason: reservation.reason,
      fatal: reservation.reason === 'extension-daily-limit',
    };
  }
  await saveBridgeState(state);

  let result;
  try {
    result = await chrome.tabs.sendMessage(tabId, {
      kind: 'insta-aio-perform-reviewed-profile-action',
      item: {
        action: item.action,
        expectedRelationship,
        resolutionToken: observation.resolutionToken,
        username: item.username,
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
  await saveBridgeState(state);

  const resultStop = sessionStopReason(result);
  if (resultStop) return { status: 'stopped', stopReason: resultStop, fatal: true };
  return succeeded
    ? { status: 'completed', result: String(result.result), fatal: false }
    : { status: 'failed', reason: result?.reason || 'live-action-not-confirmed', fatal: false };
}

async function runBatchDmItem(state, pairingId, tabId, jobId, item, limits) {
  const observation = await inspectDmItemInTab(tabId, {
    conversationId: item.conversationId,
    contentDigest: item.contentDigest,
    messageId: item.messageId,
    sentByMe: true,
    timestamp: item.timestamp,
  });
  const stop = sessionStopReason(observation);
  if (stop) return { status: 'stopped', stopReason: stop, fatal: true };

  if (
    observation?.conversationId !== String(item.conversationId)
    || observation?.messageId !== String(item.messageId)
    || Number(observation?.timestamp) !== Number(item.timestamp)
    || observation?.contentDigest !== item.contentDigest
    || observation?.sentByMe !== true
    || observation?.exactIdentityAvailable !== true
    || observation?.ownershipAvailable !== true
    || observation?.ambiguous
    || observation?.unexpectedUi
    || !observation?.resolutionToken
  ) {
    return {
      status: 'skipped',
      reason: observation?.reason || 'exact-dm-resolution-required',
      fatal: false,
    };
  }

  const intent = {
    conversationId: String(item.conversationId),
    contentDigest: item.contentDigest,
    itemId: item.id,
    jobId,
    messageId: String(item.messageId),
    timestamp: Number(item.timestamp),
  };
  const reservation = reserveExtensionDmAction(state, jobId, intent, pairingId, tabId);
  if (!reservation.ok) {
    return {
      status: 'skipped',
      reason: reservation.reason,
      fatal: reservation.reason === 'extension-daily-dm-limit',
    };
  }
  await saveBridgeState(state);

  let result;
  try {
    result = await chrome.tabs.sendMessage(tabId, {
      kind: 'insta-aio-perform-reviewed-dm-unsend',
      item: {
        conversationId: intent.conversationId,
        contentDigest: intent.contentDigest,
        messageId: intent.messageId,
        resolutionToken: observation.resolutionToken,
        sentByMe: true,
        timestamp: intent.timestamp,
      },
    });
  } catch {
    result = { unexpectedUi: true, reason: 'live-dm-inspector-unavailable' };
  }

  const succeeded = verifiedControlledDmResult(intent, result);
  finalizeExtensionDmAction(state, reservation.record.id, result, succeeded);
  await saveBridgeState(state);

  const resultStop = sessionStopReason(result);
  if (resultStop) return { status: 'stopped', stopReason: resultStop, fatal: true };
  return succeeded
    ? { status: 'completed', result: 'unsent', fatal: false }
    : { status: 'failed', reason: result?.reason || 'live-dm-not-confirmed', fatal: false };
}

async function startBatch(request, sender, pairingId = null) {
  const state = await loadBridgeState();
  const now = Date.now();
  if (!batchArmValid(state, now)) return { error: 'batch-arm-required' };
  const arm = state.batchArm;
  if (!Number.isInteger(sender?.tab?.id) || sender.tab.id !== arm.tabId) {
    return { error: 'armed-instagram-tab-unavailable' };
  }
  if (state.batchRun?.status === 'running') return { error: 'batch-already-running' };

  const items = Array.isArray(request?.items) ? request.items.slice(0, arm.count) : [];
  if (!items.length) return { error: 'batch-items-required' };
  if (request?.batchKind !== arm.kind) return { error: 'batch-kind-mismatch' };

  const limits = normalizeBatchLimits(state.batchLimits);
  const runId = `run-${now}`;
  state.batchRun = {
    id: runId,
    kind: arm.kind,
    action: arm.action,
    jobId: arm.jobId,
    status: 'running',
    total: items.length,
    completed: 0,
    failed: 0,
    skipped: 0,
    startedAt: new Date(now).toISOString(),
    finishedAt: null,
    stopReason: null,
    currentIndex: 0,
    currentLabel: '',
    nextActionAt: null,
    results: [],
  };
  // The arm authorises exactly this run; it cannot be replayed for another.
  state.batchArm = null;
  activeBatchAbort = false;
  await saveBridgeState(state);

  // Run detached so the caller gets an immediate acknowledgement and can poll.
  void executeBatch(runId, arm, items, limits, pairingId);
  return { run: { ...state.batchRun }, state: overlayState(state) };
}

async function executeBatch(runId, arm, items, limits, pairingId) {
  let index = 0;
  for (const rawItem of items) {
    if (activeBatchAbort) break;
    const state = await loadBridgeState();
    if (state.batchRun?.id !== runId || state.batchRun.status !== 'running') return;

    const item = {
      ...rawItem,
      id: String(rawItem?.id || `${runId}-${index}`),
      username: arm.kind === 'account' ? normalizeUsername(rawItem?.username) : null,
      action: arm.kind === 'account' ? arm.action : null,
    };
    state.batchRun.currentIndex = index;
    state.batchRun.currentLabel = arm.kind === 'account'
      ? `@${item.username}`
      : String(item.preview || item.messageId || '');
    await saveBridgeState(state);

    let outcome;
    try {
      outcome = arm.kind === 'account'
        ? await runBatchAccountItem(state, arm.tabId, arm.jobId, item, limits)
        : await runBatchDmItem(state, pairingId, arm.tabId, arm.jobId, item, limits);
    } catch {
      outcome = { status: 'failed', reason: 'batch-item-threw', fatal: false };
    }

    const after = await loadBridgeState();
    if (after.batchRun?.id !== runId) return;
    after.batchRun.results.unshift({
      index,
      label: arm.kind === 'account' ? item.username : item.messageId,
      status: outcome.status,
      reason: outcome.reason || outcome.stopReason || null,
      at: new Date().toISOString(),
    });
    after.batchRun.results = after.batchRun.results.slice(0, MAX_BATCH_ITEMS);
    if (outcome.status === 'completed') after.batchRun.completed += 1;
    else if (outcome.status === 'skipped') after.batchRun.skipped += 1;
    else after.batchRun.failed += 1;

    if (outcome.fatal) {
      after.batchRun.status = 'stopped';
      after.batchRun.stopReason = outcome.stopReason || outcome.reason || 'safe-stop';
      after.batchRun.finishedAt = new Date().toISOString();
      await saveBridgeState(after);
      return;
    }

    index += 1;
    const isLast = index >= items.length;
    let waitMs = 0;
    if (!isLast) {
      waitMs = jitteredDelay(limits);
      if (index % BATCH_REST_EVERY === 0) waitMs += BATCH_REST_MS;
      after.batchRun.nextActionAt = new Date(Date.now() + waitMs).toISOString();
    }
    await saveBridgeState(after);
    if (!isLast) await sleep(waitMs);
  }

  const final = await loadBridgeState();
  if (final.batchRun?.id !== runId) return;
  final.batchRun.status = activeBatchAbort ? 'aborted' : 'completed';
  final.batchRun.stopReason = activeBatchAbort ? 'stopped-by-user' : null;
  final.batchRun.nextActionAt = null;
  final.batchRun.finishedAt = new Date().toISOString();
  await saveBridgeState(final);
}

async function abortBatch() {
  activeBatchAbort = true;
  const state = await loadBridgeState();
  if (state.batchRun?.status === 'running') {
    state.batchRun.status = 'aborted';
    state.batchRun.stopReason = 'stopped-by-user';
    state.batchRun.nextActionAt = null;
    state.batchRun.finishedAt = new Date().toISOString();
    await saveBridgeState(state);
  }
  return { run: state.batchRun ? { ...state.batchRun } : null };
}

async function batchStatus() {
  const state = await loadBridgeState();
  return {
    run: state.batchRun ? { ...state.batchRun } : null,
    arm: batchArmValid(state) ? { ...state.batchArm } : null,
    limits: normalizeBatchLimits(state.batchLimits),
  };
}

async function updateBatchLimits(request) {
  const state = await loadBridgeState();
  state.batchLimits = normalizeBatchLimits({
    ...normalizeBatchLimits(state.batchLimits),
    ...(request?.limits || {}),
  });
  await saveBridgeState(state);
  return { limits: state.batchLimits };
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

async function armPendingDmIntent(request, sender) {
  const state = pruneControlledDmState(await loadBridgeState());
  const intent = state.pendingDmIntent;
  if (!intent) return { error: 'dm-live-intent-required' };
  if (!Number.isInteger(sender?.tab?.id)) return { error: 'instagram-tab-required' };
  if (String(request?.phrase || '').trim() !== controlledDmArmPhrase(intent)) {
    return { error: 'dm-live-arm-phrase-mismatch' };
  }
  if (
    request?.jobId !== intent.jobId
    || request?.itemId !== intent.itemId
    || String(request?.conversationId || '') !== intent.conversationId
    || String(request?.messageId || '') !== intent.messageId
  ) {
    return { error: 'dm-live-intent-mismatch' };
  }

  const observation = await inspectDmItemInTab(sender.tab.id, {
    conversationId: intent.conversationId,
    contentDigest: intent.contentDigest,
    messageId: intent.messageId,
    sentByMe: true,
    timestamp: intent.timestamp,
  });
  if (
    observation?.conversationId !== intent.conversationId
    || observation?.messageId !== intent.messageId
    || Number(observation?.timestamp) !== intent.timestamp
    || observation?.contentDigest !== intent.contentDigest
    || observation?.sentByMe !== true
    || observation?.exactIdentityAvailable !== true
    || observation?.ownershipAvailable !== true
    || observation?.ambiguous
    || observation?.unexpectedUi
    || observation?.sessionExpired
    || observation?.challenge
    || observation?.actionBlocked
    || observation?.rateLimited
    || !observation?.resolutionToken
  ) {
    return { error: observation?.reason || 'exact-dm-resolution-required' };
  }

  const now = Date.now();
  state.dmArm = {
    armedAt: new Date(now).toISOString(),
    expiresAt: new Date(now + DM_ARM_TTL_MS).toISOString(),
    itemId: intent.itemId,
    jobId: intent.jobId,
    tabId: sender.tab.id,
    conversationId: intent.conversationId,
    messageId: intent.messageId,
  };
  await saveBridgeState(state);
  return {
    arm: publicDmArm(state.dmArm),
    state: overlayState(state),
  };
}

async function cancelPendingDmIntent() {
  const state = await loadBridgeState();
  state.pendingDmIntent = null;
  state.dmArm = null;
  await saveBridgeState(state);
  return { state: overlayState(state) };
}

async function routeVerifiedRequest(request, pairing, state) {
  pruneLiveState(state);
  pruneControlledDmState(state);
  if (request.type === 'bridge.ping') {
    return {
      responseType: 'read.bridge-status',
      payload: {
        extensionVersion: chrome.runtime.getManifest().version,
        permissions: pairing.permissions,
        controlledAccountActionsAvailable: true,
        controlledDmUnsendAvailable: true,
        liveExecutionEnabled: armMatchesIntent(state.liveArm, state.pendingLiveIntent)
          || dmArmMatchesIntent(state.dmArm, state.pendingDmIntent),
        pendingLiveIntent: publicLiveIntent(state.pendingLiveIntent),
        liveArm: publicLiveArm(state.liveArm),
        pendingDmIntent: publicDmIntent(state.pendingDmIntent),
        dmArm: publicDmArm(state.dmArm),
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
    state.pendingDmIntent = null;
    state.dmArm = null;
    return {
      responseType: 'action.account-live-intent-result',
      payload: prepared,
    };
  }

  if (request.type === 'action.dm-live-intent') {
    const prepared = prepareControlledDmIntent(request.payload?.job, pairing, state);
    if (prepared.error) {
      return {
        responseType: 'action.bridge-error',
        payload: { reason: prepared.error },
      };
    }
    state.pendingLiveIntent = null;
    state.liveArm = null;
    return {
      responseType: 'action.dm-live-intent-result',
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

  if (request.type === 'action.dm-session') {
    const intent = state.pendingDmIntent;
    if (!intent || intent.jobId !== request.payload?.jobId || intent.pairingId !== pairing.pairingId) {
      return {
        responseType: 'action.dm-session-result',
        payload: { unexpectedUi: true, reason: 'dm-live-intent-required' },
      };
    }
    const tab = await dmIntentInstagramTab(state);
    let result;
    try {
      result = tab?.id
        ? await chrome.tabs.sendMessage(tab.id, { kind: 'insta-aio-inspect-session' })
        : { unexpectedUi: true, reason: 'instagram-tab-unavailable' };
    } catch {
      result = { unexpectedUi: true, reason: 'inspector-unavailable' };
    }
    return { responseType: 'action.dm-session-result', payload: result };
  }

  if (request.type === 'action.dm-conversation') {
    const intent = state.pendingDmIntent;
    const conversationId = String(request.payload?.conversationId || '');
    if (
      !intent
      || intent.jobId !== request.payload?.jobId
      || intent.pairingId !== pairing.pairingId
      || conversationId !== intent.conversationId
    ) {
      return {
        responseType: 'action.dm-conversation-result',
        payload: { unexpectedUi: true, reason: 'dm-live-intent-mismatch' },
      };
    }
    const tab = await dmIntentInstagramTab(state);
    const expectedThreadId = directThreadId(intent.conversationId);
    const observedThreadId = directThreadId(tab?.url);
    const exact = Boolean(tab?.id && expectedThreadId && expectedThreadId === observedThreadId);
    return {
      responseType: 'action.dm-conversation-result',
      payload: exact
        ? { conversationId: intent.conversationId, unexpectedUi: false }
        : { ambiguous: true, reason: 'wrong-conversation' },
    };
  }

  if (request.type === 'action.dm-message') {
    const item = request.payload?.item;
    const jobId = request.payload?.jobId;
    const intent = state.pendingDmIntent;
    let tab = null;
    if (dmIntentMatchesItem(intent, jobId, item) && intent?.pairingId === pairing.pairingId) {
      tab = await dmIntentInstagramTab(state);
    } else {
      const attempt = matchingDmAttempt(state, pairing, jobId, item);
      if (attempt) {
        try {
          tab = await chrome.tabs.get(attempt.tabId);
          if (new URL(tab?.url || '').origin !== 'https://www.instagram.com') tab = null;
        } catch {
          tab = null;
        }
      }
    }
    const result = tab?.id
      ? await inspectDmItemInTab(tab.id, item)
      : { unexpectedUi: true, reason: 'dm-live-intent-mismatch' };
    return { responseType: 'action.dm-message-result', payload: result };
  }

  if (request.type === 'action.dm-live-readiness') {
    return {
      responseType: 'action.dm-live-readiness-result',
      payload: await dmLiveReadiness(
        state,
        pairing,
        request.payload?.jobId,
        request.payload?.item,
      ),
    };
  }

  if (request.type === 'action.dm-perform') {
    return {
      responseType: 'action.dm-perform-result',
      payload: await performLiveDmUnsend(
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
    const result = await inspectDmJob(job);
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
  pruneControlledDmState(state);
  return {
    extensionVersion: chrome.runtime.getManifest().version,
    controlledAccountActionsAvailable: true,
    controlledDmUnsendAvailable: true,
    liveExecutionEnabled: armMatchesIntent(state.liveArm, state.pendingLiveIntent)
      || dmArmMatchesIntent(state.dmArm, state.pendingDmIntent),
    pendingLiveIntent: publicLiveIntent(state.pendingLiveIntent),
    liveArm: publicLiveArm(state.liveArm),
    pendingDmIntent: publicDmIntent(state.pendingDmIntent),
    dmArm: publicDmArm(state.dmArm),
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
  if (request?.kind === 'insta-aio-arm-dm-unsend') {
    if (!isInstagramSender(sender)) {
      sendResponse({ error: 'instagram-origin-required' });
      return false;
    }
    const operation = requestTail.then(() => armPendingDmIntent(request, sender));
    requestTail = operation.catch(() => {});
    operation.then(sendResponse).catch(() => sendResponse({ error: 'dm-live-arm-unavailable' }));
    return true;
  }
  if (request?.kind === 'insta-aio-cancel-dm-unsend') {
    if (!isInstagramSender(sender)) {
      sendResponse({ error: 'instagram-origin-required' });
      return false;
    }
    const operation = requestTail.then(() => cancelPendingDmIntent());
    requestTail = operation.catch(() => {});
    operation.then(sendResponse).catch(() => sendResponse({ error: 'dm-live-intent-cancel-failed' }));
    return true;
  }
  if (request?.kind === 'insta-aio-arm-batch') {
    if (!isInstagramSender(sender)) {
      sendResponse({ error: 'instagram-origin-required' });
      return false;
    }
    const operation = requestTail.then(() => armBatch(request, sender));
    requestTail = operation.catch(() => {});
    operation.then(sendResponse).catch(() => sendResponse({ error: 'batch-arm-unavailable' }));
    return true;
  }
  if (request?.kind === 'insta-aio-start-batch') {
    if (!isInstagramSender(sender)) {
      sendResponse({ error: 'instagram-origin-required' });
      return false;
    }
    const operation = requestTail.then(() => startBatch(request, sender));
    requestTail = operation.catch(() => {});
    operation.then(sendResponse).catch(() => sendResponse({ error: 'batch-start-unavailable' }));
    return true;
  }
  if (request?.kind === 'insta-aio-batch-status') {
    if (!isInstagramSender(sender)) {
      sendResponse({ error: 'instagram-origin-required' });
      return false;
    }
    batchStatus()
      .then(sendResponse)
      .catch(() => sendResponse({ error: 'batch-status-unavailable' }));
    return true;
  }
  if (request?.kind === 'insta-aio-abort-batch') {
    if (!isInstagramSender(sender)) {
      sendResponse({ error: 'instagram-origin-required' });
      return false;
    }
    abortBatch()
      .then(sendResponse)
      .catch(() => sendResponse({ error: 'batch-abort-unavailable' }));
    return true;
  }
  if (request?.kind === 'insta-aio-batch-limits') {
    if (!isInstagramSender(sender)) {
      sendResponse({ error: 'instagram-origin-required' });
      return false;
    }
    const operation = requestTail.then(() => updateBatchLimits(request));
    requestTail = operation.catch(() => {});
    operation.then(sendResponse).catch(() => sendResponse({ error: 'batch-limits-unavailable' }));
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

import { normalizeUsername } from './accounts.js';
import { getUnfollowProtectionReason } from './queue.js';

const ACTIONABLE_STATUSES = new Set(['pending', 'ready', 'paused', 'failed']);

export const ACTION_CONFIRMATION_MAX_AGE_MS = 10 * 60 * 1000;

function fnv1a(value) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function jobId(createdAt, digest) {
  return `action-job-${new Date(createdAt).toISOString().replace(/[:.]/g, '-')}-${digest}`;
}

function canonicalPreview(items) {
  return items.map((item) => (
    `${item.queueItemId}\t${item.action}\t${item.username}`
  )).join('\n');
}

function clone(value) {
  return typeof structuredClone === 'function'
    ? structuredClone(value)
    : JSON.parse(JSON.stringify(value));
}

export class ActionJobError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'ActionJobError';
    this.code = code;
  }
}

export function actionPreviewDigest(items) {
  return fnv1a(canonicalPreview(items || []));
}

export function actionLiveBatchLimit(settings = {}) {
  const requested = Number(settings.liveActionBatchLimit);
  return Number.isFinite(requested)
    ? Math.max(1, Math.min(25, Math.floor(requested)))
    : 1;
}

export function actionConfirmationIsFresh(job, now = Date.now()) {
  const confirmedAt = new Date(job?.confirmedAt || '').getTime();
  return Number.isFinite(confirmedAt)
    && confirmedAt <= now + 30_000
    && now - confirmedAt <= ACTION_CONFIRMATION_MAX_AGE_MS;
}

export function createReviewedActionJob(queue, {
  snapshot = null,
  settings = {},
  selectedIds = null,
  createdAt = Date.now(),
} = {}) {
  const selected = selectedIds ? new Set(selectedIds) : null;
  const items = [];
  const blockedItems = [];

  for (const queueItem of queue || []) {
    if (selected && !selected.has(queueItem.id)) continue;
    const username = normalizeUsername(queueItem.account?.username);
    let blockReason = null;

    if (!username) blockReason = 'invalid-account';
    else if (queueItem.migrationOnly === true) blockReason = 'migration-history';
    else if (!['follow', 'unfollow'].includes(queueItem.action)) {
      blockReason = 'unsupported-action';
    } else if (!ACTIONABLE_STATUSES.has(queueItem.status)) {
      blockReason = `queue-status-${queueItem.status}`;
    } else if (queueItem.action === 'unfollow') {
      blockReason = getUnfollowProtectionReason(
        queueItem.account,
        snapshot,
        settings,
        { preexisting: queueItem.preexisting },
      );
    }

    const preview = {
      id: `action-item-${queueItem.id}`,
      queueItemId: queueItem.id,
      action: queueItem.action,
      username,
      profileUrl: username ? `https://www.instagram.com/${username}/` : null,
      sourceStatus: queueItem.status,
      status: blockReason ? 'blocked' : 'pending',
      blockReason,
      attemptCount: 0,
      beforeEvidence: null,
      afterEvidence: null,
      result: null,
      error: null,
      checkpointedAt: null,
    };
    if (blockReason) blockedItems.push(preview);
    else items.push(preview);
  }

  const digest = actionPreviewDigest(items);
  const createdIso = new Date(createdAt).toISOString();
  return {
    schemaVersion: 1,
    kind: 'insta-aio-reviewed-action-job',
    id: jobId(createdAt, digest),
    createdAt: createdIso,
    updatedAt: createdIso,
    status: 'awaiting-confirmation',
    control: 'paused',
    mode: 'dry-run',
    previewDigest: digest,
    confirmationPhrase: `REVIEW ${items.length} ${digest}`,
    confirmedAt: null,
    items,
    blockedItems,
    checkpointIndex: 0,
    stopReason: null,
    activity: [],
  };
}

export function confirmReviewedActionJob(job, {
  phrase,
  mode = 'dry-run',
  settings = {},
  confirmedAt = Date.now(),
} = {}) {
  if (job?.kind !== 'insta-aio-reviewed-action-job') {
    throw new ActionJobError('INVALID_JOB', 'Select a reviewed action job.');
  }
  if (!['dry-run', 'live'].includes(mode)) {
    throw new ActionJobError('INVALID_MODE', `Unsupported action mode: ${mode}`);
  }
  if (actionPreviewDigest(job.items) !== job.previewDigest) {
    throw new ActionJobError('PREVIEW_CHANGED', 'The reviewed action preview changed.');
  }
  if (String(phrase || '').trim() !== job.confirmationPhrase) {
    throw new ActionJobError(
      'CONFIRMATION_MISMATCH',
      'The confirmation phrase does not match the reviewed batch.',
    );
  }
  if (!job.items.length) {
    throw new ActionJobError('EMPTY_JOB', 'The reviewed batch contains no actionable items.');
  }
  if (mode === 'live') {
    if (settings.liveActionEnabled !== true) {
      throw new ActionJobError(
        'LIVE_DISABLED',
        'Live account actions are disabled in settings.',
      );
    }
    const maximum = actionLiveBatchLimit(settings);
    if (job.items.length > maximum) {
      throw new ActionJobError(
        'BATCH_LIMIT',
        `The live batch contains ${job.items.length} items; the configured limit is ${maximum}.`,
      );
    }
  }

  const next = clone(job);
  next.mode = mode;
  next.status = 'ready';
  next.control = 'ready';
  next.confirmedAt = new Date(confirmedAt).toISOString();
  next.updatedAt = next.confirmedAt;
  next.stopReason = null;
  return next;
}

export function setActionJobControl(job, control, now = Date.now()) {
  if (!['ready', 'running', 'paused', 'stopped'].includes(control)) {
    throw new ActionJobError('INVALID_CONTROL', `Unsupported job control: ${control}`);
  }
  const next = clone(job);
  next.control = control;
  next.updatedAt = new Date(now).toISOString();
  if (control === 'paused') next.status = 'paused';
  if (control === 'stopped') next.status = 'stopped';
  if (control === 'running') next.status = 'running';
  return next;
}

export function actionStopReason(observation = {}) {
  if (observation.sessionExpired) return 'session-expired';
  if (observation.challenge) return 'login-challenge';
  if (observation.actionBlocked) return 'action-blocked';
  if (observation.rateLimited) return 'rate-limited';
  if (observation.ambiguous) return 'ambiguous-ui';
  if (observation.unexpectedUi) return 'unexpected-ui';
  return null;
}

export function validateActionObservation(item, observation = {}) {
  const stopReason = actionStopReason(observation);
  if (stopReason) return { ok: false, stopReason };

  const observedUsername = normalizeUsername(observation.username);
  if (!observedUsername || observedUsername !== item.username) {
    return { ok: false, stopReason: 'wrong-profile' };
  }
  if (!['following', 'not-following', 'requested'].includes(observation.relationship)) {
    return { ok: false, stopReason: 'ambiguous-relationship' };
  }
  if (item.action === 'follow' && ['following', 'requested'].includes(observation.relationship)) {
    return { ok: true, skipReason: 'already-complete' };
  }
  if (item.action === 'unfollow' && observation.relationship === 'not-following') {
    return { ok: true, skipReason: 'already-complete' };
  }
  if (item.action === 'follow' && observation.relationship !== 'not-following') {
    return { ok: false, stopReason: 'unexpected-relationship' };
  }
  if (item.action === 'unfollow' && observation.relationship !== 'following') {
    return { ok: false, stopReason: 'unexpected-relationship' };
  }
  return { ok: true, skipReason: null };
}

export function validateActionCompletion(item, observation = {}) {
  const initial = validateActionObservation({
    ...item,
    action: item.action === 'follow' ? 'unfollow' : 'follow',
  }, observation);
  const stopReason = actionStopReason(observation);
  if (stopReason) return { ok: false, stopReason };
  if (normalizeUsername(observation.username) !== item.username) {
    return { ok: false, stopReason: 'wrong-profile' };
  }
  if (item.action === 'follow') {
    return ['following', 'requested'].includes(observation.relationship)
      ? { ok: true }
      : { ok: false, stopReason: 'follow-not-confirmed' };
  }
  if (item.action === 'unfollow') {
    return observation.relationship === 'not-following'
      ? { ok: true }
      : { ok: false, stopReason: 'unfollow-not-confirmed' };
  }
  return initial;
}

export function appendActionCheckpoint(job, itemId, patch, {
  activity = null,
  now = Date.now(),
} = {}) {
  const next = clone(job);
  const item = next.items.find((candidate) => candidate.id === itemId);
  if (!item) throw new ActionJobError('ITEM_NOT_FOUND', `Action item not found: ${itemId}`);
  Object.assign(item, patch, {
    checkpointedAt: new Date(now).toISOString(),
  });
  next.checkpointIndex += 1;
  next.updatedAt = new Date(now).toISOString();
  if (activity) next.activity.push(activity);
  return next;
}

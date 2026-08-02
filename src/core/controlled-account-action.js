export const ACCOUNT_INTENT_TTL_MS = 10 * 60 * 1000;
export const ACCOUNT_ARM_TTL_MS = 90 * 1000;
export const ACCOUNT_CONFIRMATION_MAX_AGE_MS = 10 * 60 * 1000;

export function normalizeActionUsername(value) {
  const username = String(value || '').replace(/^@/, '').trim().toLowerCase();
  return /^[a-z0-9._]{1,30}$/i.test(username) ? username : '';
}

function fnv1a(value) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

export function controlledAccountPreviewDigest(items) {
  return fnv1a((items || []).map((item) => (
    `${item.queueItemId}\t${item.action}\t${item.username}`
  )).join('\n'));
}

export function pruneControlledAccountState(state, now = Date.now()) {
  if (state.pendingLiveIntent && new Date(state.pendingLiveIntent.expiresAt).getTime() <= now) {
    state.pendingLiveIntent = null;
    state.liveArm = null;
  }
  if (state.liveArm && new Date(state.liveArm.expiresAt).getTime() <= now) {
    state.liveArm = null;
  }
  if (
    state.liveArm
    && (!state.pendingLiveIntent || state.liveArm.jobId !== state.pendingLiveIntent.jobId)
  ) {
    state.liveArm = null;
  }
  return state;
}

export function publicAccountIntent(intent) {
  return intent ? {
    action: intent.action,
    confirmedAt: intent.confirmedAt,
    expiresAt: intent.expiresAt,
    itemId: intent.itemId,
    jobId: intent.jobId,
    username: intent.username,
  } : null;
}

export function publicAccountArm(arm) {
  return arm ? {
    action: arm.action,
    armedAt: arm.armedAt,
    expiresAt: arm.expiresAt,
    itemId: arm.itemId,
    jobId: arm.jobId,
    username: arm.username,
  } : null;
}

export function accountIntentMatchesItem(intent, jobId, item) {
  return Boolean(
    intent
    && intent.jobId === jobId
    && intent.itemId === item?.id
    && intent.username === normalizeActionUsername(item?.username)
    && intent.action === item?.action,
  );
}

export function accountArmMatchesIntent(arm, intent) {
  return Boolean(
    arm
    && intent
    && arm.jobId === intent.jobId
    && arm.itemId === intent.itemId
    && arm.username === intent.username
    && arm.action === intent.action,
  );
}

export function validateControlledAccountJob(job, now = Date.now()) {
  if (
    job?.kind !== 'insta-aio-reviewed-action-job'
    || !job.id
    || job.mode !== 'live'
    || job.status !== 'ready'
    || !job.confirmedAt
    || !Array.isArray(job.items)
  ) {
    return 'invalid-live-account-job';
  }
  if (job.items.length !== 1) return 'controlled-live-batch-must-be-one';
  if (controlledAccountPreviewDigest(job.items) !== job.previewDigest) {
    return 'reviewed-preview-changed';
  }
  const confirmedAt = new Date(job.confirmedAt).getTime();
  if (
    !Number.isFinite(confirmedAt)
    || confirmedAt > now + 30_000
    || now - confirmedAt > ACCOUNT_CONFIRMATION_MAX_AGE_MS
  ) {
    return 'live-confirmation-expired';
  }
  const item = job.items[0];
  const username = normalizeActionUsername(item?.username);
  if (
    !item?.id
    || !item.queueItemId
    || !username
    || username !== item.username
    || !['follow', 'unfollow'].includes(item.action)
  ) {
    return 'invalid-live-account-item';
  }
  return null;
}

export function prepareControlledAccountIntent(job, pairing, state, now = Date.now()) {
  pruneControlledAccountState(state, now);
  const invalid = validateControlledAccountJob(job, now);
  if (invalid) return { error: invalid };
  const item = job.items[0];
  const nextIntent = {
    kind: 'account-action',
    jobId: job.id,
    itemId: item.id,
    queueItemId: item.queueItemId,
    username: item.username,
    action: item.action,
    previewDigest: job.previewDigest,
    confirmedAt: job.confirmedAt,
    pairingId: pairing.pairingId,
    origin: pairing.origin,
    receivedAt: new Date(now).toISOString(),
    expiresAt: new Date(now + ACCOUNT_INTENT_TTL_MS).toISOString(),
  };
  const sameIntent = accountIntentMatchesItem(state.pendingLiveIntent, job.id, item)
    && state.pendingLiveIntent.previewDigest === job.previewDigest
    && state.pendingLiveIntent.pairingId === pairing.pairingId;
  if (!sameIntent) state.liveArm = null;
  state.pendingLiveIntent = sameIntent
    ? { ...state.pendingLiveIntent, expiresAt: nextIntent.expiresAt }
    : nextIntent;
  return {
    intent: publicAccountIntent(state.pendingLiveIntent),
    armed: accountArmMatchesIntent(state.liveArm, state.pendingLiveIntent),
    arm: publicAccountArm(state.liveArm),
  };
}

export const DM_INTENT_TTL_MS = 10 * 60 * 1000;
export const DM_ARM_TTL_MS = 90 * 1000;
export const DM_CONFIRMATION_MAX_AGE_MS = 10 * 60 * 1000;

function fnv1a(value) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

export function controlledDmPreviewDigest(items) {
  return fnv1a((items || []).map((item) => (
    `${item.conversationId}\t${item.messageId}\t${item.timestamp}\t${item.contentDigest}`
  )).join('\n'));
}

export function controlledDmArmPhrase(intent) {
  return intent?.armCode ? `ARM UNSEND ${intent.armCode}` : '';
}

export function pruneControlledDmState(state, now = Date.now()) {
  if (state.pendingDmIntent && new Date(state.pendingDmIntent.expiresAt).getTime() <= now) {
    state.pendingDmIntent = null;
    state.dmArm = null;
  }
  if (state.dmArm && new Date(state.dmArm.expiresAt).getTime() <= now) {
    state.dmArm = null;
  }
  if (
    state.dmArm
    && (!state.pendingDmIntent || state.dmArm.jobId !== state.pendingDmIntent.jobId)
  ) {
    state.dmArm = null;
  }
  return state;
}

export function publicDmIntent(intent) {
  return intent ? {
    armCode: intent.armCode,
    contentDigest: intent.contentDigest,
    conversationId: intent.conversationId,
    destructiveConfirmedAt: intent.destructiveConfirmedAt,
    expiresAt: intent.expiresAt,
    itemId: intent.itemId,
    jobId: intent.jobId,
    messageId: intent.messageId,
    reviewConfirmedAt: intent.reviewConfirmedAt,
    timestamp: intent.timestamp,
  } : null;
}

export function publicDmArm(arm) {
  return arm ? {
    armedAt: arm.armedAt,
    conversationId: arm.conversationId,
    expiresAt: arm.expiresAt,
    itemId: arm.itemId,
    jobId: arm.jobId,
    messageId: arm.messageId,
  } : null;
}

export function dmIntentMatchesItem(intent, jobId, item) {
  return Boolean(
    intent
    && intent.jobId === jobId
    && intent.itemId === item?.id
    && intent.conversationId === String(item?.conversationId || '')
    && intent.messageId === String(item?.messageId || '')
    && intent.timestamp === Number(item?.timestamp)
    && intent.contentDigest === String(item?.contentDigest || '')
    && item?.sentByMe === true,
  );
}

export function dmArmMatchesIntent(arm, intent) {
  return Boolean(
    arm
    && intent
    && arm.jobId === intent.jobId
    && arm.itemId === intent.itemId
    && arm.conversationId === intent.conversationId
    && arm.messageId === intent.messageId,
  );
}

function directThreadId(value) {
  const text = String(value || '').replaceAll('\\', '/');
  const directMatch = text.match(/\/direct\/t\/([^/?#]+)/i);
  if (directMatch) return directMatch[1];
  const finalSegment = text.split('/').filter(Boolean).at(-1) || '';
  const exportMatch = finalSegment.match(/_([0-9]+)$/);
  return exportMatch?.[1] || (/^[0-9]+$/.test(finalSegment) ? finalSegment : null);
}

export function verifiedControlledDmResult(intent, result) {
  const postcondition = result?.postcondition;
  const expectedThreadId = directThreadId(intent?.conversationId);
  return Boolean(
    result?.result === 'unsent'
    && result?.conversationId === intent?.conversationId
    && result?.messageId === intent?.messageId
    && expectedThreadId
    && postcondition?.exactThread === true
    && postcondition?.expectedThreadId === expectedThreadId
    && postcondition?.observedThreadId === expectedThreadId
    && postcondition?.retainedRowDisconnected === true
    && postcondition?.retainedIdentityNodeDisconnected === true
    && postcondition?.exactCandidateAbsent === true
    && postcondition?.observationReason === 'exact-message-not-found'
    && !result?.ambiguous
    && !result?.unexpectedUi
    && !result?.sessionExpired
    && !result?.challenge
    && !result?.actionBlocked
    && !result?.rateLimited
  );
}

function freshConfirmation(value, now) {
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp)
    && timestamp <= now + 30_000
    && now - timestamp <= DM_CONFIRMATION_MAX_AGE_MS;
}

export function validateControlledDmJob(job, now = Date.now()) {
  if (
    job?.kind !== 'insta-aio-reviewed-dm-job'
    || !job.id
    || job.mode !== 'live'
    || job.status !== 'ready'
    || !job.reviewConfirmedAt
    || !job.destructiveConfirmedAt
    || !Array.isArray(job.items)
  ) {
    return 'invalid-live-dm-job';
  }
  if (job.items.length !== 1) return 'controlled-live-dm-batch-must-be-one';
  if (controlledDmPreviewDigest(job.items) !== job.previewDigest) {
    return 'reviewed-dm-preview-changed';
  }
  if (!freshConfirmation(job.reviewConfirmedAt, now)) {
    return 'dm-review-confirmation-expired';
  }
  if (!freshConfirmation(job.destructiveConfirmedAt, now)) {
    return 'dm-destructive-confirmation-expired';
  }
  if (
    new Date(job.destructiveConfirmedAt).getTime()
    < new Date(job.reviewConfirmedAt).getTime()
  ) {
    return 'dm-confirmations-out-of-order';
  }

  const item = job.items[0];
  if (
    !item?.id
    || !String(item.conversationId || '').trim()
    || !String(item.messageId || '').trim()
    || !Number.isFinite(Number(item.timestamp))
    || !/^[a-f0-9]{8}$/i.test(String(item.contentDigest || ''))
    || item.sentByMe !== true
  ) {
    return 'invalid-live-dm-item';
  }
  return null;
}

export function prepareControlledDmIntent(job, pairing, state, now = Date.now()) {
  pruneControlledDmState(state, now);
  const invalid = validateControlledDmJob(job, now);
  if (invalid) return { error: invalid };

  const item = job.items[0];
  const armCode = fnv1a([
    job.id,
    item.id,
    item.conversationId,
    item.messageId,
    item.timestamp,
    item.contentDigest,
    pairing.pairingId,
  ].join('\t')).toUpperCase();
  const nextIntent = {
    kind: 'dm-unsend',
    jobId: job.id,
    itemId: item.id,
    conversationId: String(item.conversationId),
    messageId: String(item.messageId),
    timestamp: Number(item.timestamp),
    contentDigest: String(item.contentDigest),
    previewDigest: job.previewDigest,
    reviewConfirmedAt: job.reviewConfirmedAt,
    destructiveConfirmedAt: job.destructiveConfirmedAt,
    armCode,
    pairingId: pairing.pairingId,
    origin: pairing.origin,
    receivedAt: new Date(now).toISOString(),
    expiresAt: new Date(now + DM_INTENT_TTL_MS).toISOString(),
  };
  const sameIntent = dmIntentMatchesItem(state.pendingDmIntent, job.id, item)
    && state.pendingDmIntent.previewDigest === job.previewDigest
    && state.pendingDmIntent.pairingId === pairing.pairingId
    && state.pendingDmIntent.armCode === armCode;
  if (!sameIntent) state.dmArm = null;
  state.pendingDmIntent = sameIntent
    ? { ...state.pendingDmIntent, expiresAt: nextIntent.expiresAt }
    : nextIntent;
  return {
    intent: publicDmIntent(state.pendingDmIntent),
    armed: dmArmMatchesIntent(state.dmArm, state.pendingDmIntent),
    arm: publicDmArm(state.dmArm),
  };
}

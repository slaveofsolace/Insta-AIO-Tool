import { messageSelectionKey } from './messages.js';

function fnv1a(value) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function clone(value) {
  return typeof structuredClone === 'function'
    ? structuredClone(value)
    : JSON.parse(JSON.stringify(value));
}

function canonicalItems(items) {
  return (items || []).map((item) => (
    `${item.conversationId}\t${item.messageId}\t${item.timestamp}\t${item.contentDigest}`
  )).join('\n');
}

function selectedMessages(messages, selectedIds) {
  const selected = new Set(selectedIds || []);
  const idCounts = new Map();
  for (const message of messages || []) {
    idCounts.set(message.id, (idCounts.get(message.id) || 0) + 1);
  }
  return (messages || []).filter((message) => (
    selected.has(messageSelectionKey(message))
    || (idCounts.get(message.id) === 1 && selected.has(message.id))
  ));
}

export class DmJobError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'DmJobError';
    this.code = code;
  }
}

export function dmContentDigest(content) {
  return fnv1a(String(content ?? ''));
}

export function dmPreviewDigest(items) {
  return fnv1a(canonicalItems(items));
}

export function dmLiveBatchLimit(settings = {}) {
  const requested = Number(settings.liveDmBatchLimit);
  return Number.isFinite(requested)
    ? Math.max(1, Math.min(25, Math.floor(requested)))
    : 1;
}

export function createReviewedDmJob(messages, selectedIds, {
  createdAt = Date.now(),
} = {}) {
  const items = [];
  const blockedItems = [];
  const seenKeys = new Set();

  for (const message of selectedMessages(messages, selectedIds)) {
    const conversationId = String(message.conversationId || '').trim();
    const messageId = String(message.id || '').trim();
    const key = `${conversationId}:${messageId}`;
    let blockReason = null;
    if (!message.isMine) blockReason = 'received-message';
    else if (!conversationId) blockReason = 'missing-conversation-id';
    else if (!messageId) blockReason = 'missing-message-id';
    else if (seenKeys.has(key)) blockReason = 'duplicate-message';
    else if (!Number.isFinite(Number(message.timestamp))) blockReason = 'invalid-timestamp';

    const item = {
      id: `dm-item-${fnv1a(`${key}:${message.timestamp}`)}`,
      selectionKey: messageSelectionKey(message),
      conversationId,
      conversationName: String(message.conversationName || conversationId),
      messageId,
      timestamp: Number(message.timestamp),
      type: String(message.type || 'unknown'),
      senderName: String(message.senderName || ''),
      senderId: message.senderId == null ? null : String(message.senderId),
      sentByMe: message.isMine === true,
      contentDigest: dmContentDigest(message.content),
      contentLength: String(message.content ?? '').length,
      preview: String(message.content ?? '').slice(0, 240),
      source: String(message.source || 'unknown'),
      status: blockReason ? 'blocked' : 'pending',
      blockReason,
      attemptCount: 0,
      resolutionEvidence: null,
      result: null,
      error: null,
      checkpointedAt: null,
    };
    if (blockReason) blockedItems.push(item);
    else {
      items.push(item);
      seenKeys.add(key);
    }
  }

  const digest = dmPreviewDigest(items);
  const createdIso = new Date(createdAt).toISOString();
  return {
    schemaVersion: 1,
    kind: 'insta-aio-reviewed-dm-job',
    id: `dm-job-${createdIso.replace(/[:.]/g, '-')}-${digest}`,
    createdAt: createdIso,
    updatedAt: createdIso,
    status: 'awaiting-review-confirmation',
    control: 'paused',
    mode: 'dry-run',
    previewDigest: digest,
    reviewConfirmationPhrase: `REVIEW UNSEND ${items.length} ${digest}`,
    destructiveConfirmationPhrase: `UNSEND ${items.length} ${digest}`,
    reviewConfirmedAt: null,
    destructiveConfirmedAt: null,
    items,
    blockedItems,
    checkpointIndex: 0,
    stopReason: null,
    activity: [],
  };
}

export function confirmDmJobReview(job, {
  phrase,
  mode = 'dry-run',
  settings = {},
  confirmedAt = Date.now(),
} = {}) {
  if (job?.kind !== 'insta-aio-reviewed-dm-job') {
    throw new DmJobError('INVALID_JOB', 'Select a reviewed DM job.');
  }
  if (dmPreviewDigest(job.items) !== job.previewDigest) {
    throw new DmJobError('PREVIEW_CHANGED', 'The reviewed DM preview changed.');
  }
  if (String(phrase || '').trim() !== job.reviewConfirmationPhrase) {
    throw new DmJobError(
      'CONFIRMATION_MISMATCH',
      'The review confirmation phrase does not match the selected messages.',
    );
  }
  if (!job.items.length) {
    throw new DmJobError('EMPTY_JOB', 'The reviewed DM batch contains no eligible sent messages.');
  }
  if (!['dry-run', 'live'].includes(mode)) {
    throw new DmJobError('INVALID_MODE', `Unsupported DM job mode: ${mode}`);
  }
  if (mode === 'live') {
    if (settings.liveDmUnsendEnabled !== true) {
      throw new DmJobError('LIVE_DISABLED', 'Live DM unsend is disabled in settings.');
    }
    const maximum = dmLiveBatchLimit(settings);
    if (job.items.length > maximum) {
      throw new DmJobError(
        'BATCH_LIMIT',
        `The live DM batch contains ${job.items.length} messages; the configured limit is ${maximum}.`,
      );
    }
  }

  const next = clone(job);
  next.mode = mode;
  next.status = mode === 'live'
    ? 'awaiting-destructive-confirmation'
    : 'ready';
  next.control = 'ready';
  next.reviewConfirmedAt = new Date(confirmedAt).toISOString();
  next.updatedAt = next.reviewConfirmedAt;
  return next;
}

export function confirmDmJobDestructive(job, {
  phrase,
  confirmedAt = Date.now(),
} = {}) {
  if (job?.mode !== 'live' || job.status !== 'awaiting-destructive-confirmation') {
    throw new DmJobError(
      'REVIEW_REQUIRED',
      'Complete the live DM batch review before destructive confirmation.',
    );
  }
  if (dmPreviewDigest(job.items) !== job.previewDigest) {
    throw new DmJobError('PREVIEW_CHANGED', 'The reviewed DM preview changed.');
  }
  if (String(phrase || '').trim() !== job.destructiveConfirmationPhrase) {
    throw new DmJobError(
      'DESTRUCTIVE_CONFIRMATION_MISMATCH',
      'The destructive confirmation phrase does not match the selected messages.',
    );
  }
  const next = clone(job);
  next.status = 'ready';
  next.control = 'ready';
  next.destructiveConfirmedAt = new Date(confirmedAt).toISOString();
  next.updatedAt = next.destructiveConfirmedAt;
  return next;
}

export function dmStopReason(observation = {}) {
  if (observation.sessionExpired) return 'session-expired';
  if (observation.challenge) return 'login-challenge';
  if (observation.actionBlocked) return 'action-blocked';
  if (observation.rateLimited) return 'rate-limited';
  if (observation.ambiguous) return 'ambiguous-ui';
  if (observation.unexpectedUi) return 'unexpected-ui';
  return null;
}

export function validateDmResolution(item, conversation, message) {
  const conversationStop = dmStopReason(conversation);
  if (conversationStop) return { ok: false, stopReason: conversationStop };
  if (conversation?.conversationId !== item.conversationId) {
    return { ok: false, stopReason: 'wrong-conversation' };
  }
  const messageStop = dmStopReason(message);
  if (messageStop) return { ok: false, stopReason: messageStop };
  if (message?.missing) return { ok: false, stopReason: 'message-missing' };
  if (message?.conversationId !== item.conversationId) {
    return { ok: false, stopReason: 'wrong-conversation' };
  }
  if (String(message?.messageId || '') !== item.messageId) {
    return { ok: false, stopReason: 'wrong-message' };
  }
  if (message?.sentByMe !== true) {
    return { ok: false, stopReason: 'received-message' };
  }
  if (Number(message.timestamp) !== item.timestamp) {
    return { ok: false, stopReason: 'timestamp-mismatch' };
  }
  if (String(message.contentDigest || '') !== item.contentDigest) {
    return { ok: false, stopReason: 'content-mismatch' };
  }
  if (!message.resolutionToken) {
    return { ok: false, stopReason: 'missing-resolution-token' };
  }
  return { ok: true };
}

export function appendDmCheckpoint(job, itemId, patch, {
  activity = null,
  now = Date.now(),
} = {}) {
  const next = clone(job);
  const item = next.items.find((candidate) => candidate.id === itemId);
  if (!item) throw new DmJobError('ITEM_NOT_FOUND', `DM item not found: ${itemId}`);
  Object.assign(item, patch, {
    checkpointedAt: new Date(now).toISOString(),
  });
  next.checkpointIndex += 1;
  next.updatedAt = new Date(now).toISOString();
  if (activity) next.activity.push(activity);
  return next;
}

import { normalizeUsername } from './accounts.js';

function clone(value) {
  return typeof structuredClone === 'function'
    ? structuredClone(value)
    : JSON.parse(JSON.stringify(value));
}

function dayKey(value) {
  return new Date(value).toISOString().slice(0, 10);
}

function attemptId(claim) {
  return `${claim.jobId}:${claim.itemId}:${claim.action}:${normalizeUsername(claim.username)}`;
}

export function reserveActionAttempt(candidateState, claim, settings = {}, now = Date.now()) {
  const state = clone(candidateState || {});
  state.actionLedger = Array.isArray(state.actionLedger) ? state.actionLedger : [];
  const id = attemptId(claim);
  const existing = state.actionLedger.find((entry) => entry.id === id);
  if (existing && ['reserved', 'succeeded', 'uncertain'].includes(existing.status)) {
    return {
      state,
      result: { ok: false, reason: 'duplicate-attempt', existing },
    };
  }

  const action = claim.action;
  const limit = Math.max(
    1,
    Number(action === 'follow'
      ? settings.dailyFollowLimit || 25
      : settings.dailyUnfollowLimit || 25),
  );
  const today = dayKey(now);
  const used = state.actionLedger.filter((entry) => (
    entry.mode === 'live'
    && entry.action === action
    && entry.day === today
    && ['reserved', 'succeeded', 'uncertain'].includes(entry.status)
  )).length;
  if (used >= limit) {
    return {
      state,
      result: { ok: false, reason: 'daily-limit', limit, used },
    };
  }

  const record = {
    id,
    jobId: claim.jobId,
    itemId: claim.itemId,
    queueItemId: claim.queueItemId,
    action,
    username: normalizeUsername(claim.username),
    mode: 'live',
    day: today,
    status: 'reserved',
    reservedAt: new Date(now).toISOString(),
    finalizedAt: null,
    result: null,
  };
  state.actionLedger.push(record);
  return {
    state,
    result: { ok: true, record },
  };
}

export function finalizeActionAttempt(candidateState, attemptIdValue, {
  status,
  result = null,
  now = Date.now(),
} = {}) {
  if (!['succeeded', 'failed', 'uncertain', 'canceled'].includes(status)) {
    throw new Error(`Unsupported action attempt status: ${status}`);
  }
  const state = clone(candidateState || {});
  state.actionLedger = Array.isArray(state.actionLedger) ? state.actionLedger : [];
  const index = state.actionLedger.findIndex((entry) => entry.id === attemptIdValue);
  if (index < 0) throw new Error(`Action attempt not found: ${attemptIdValue}`);
  state.actionLedger[index] = {
    ...state.actionLedger[index],
    status,
    result,
    finalizedAt: new Date(now).toISOString(),
  };
  return state;
}

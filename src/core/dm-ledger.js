function clone(value) {
  return typeof structuredClone === 'function'
    ? structuredClone(value)
    : JSON.parse(JSON.stringify(value));
}

function attemptId(claim) {
  return `${claim.jobId}:${claim.itemId}:${claim.conversationId}:${claim.messageId}`;
}

export function reserveDmAttempt(candidateState, claim, now = Date.now()) {
  const state = clone(candidateState || {});
  state.dmLedger = Array.isArray(state.dmLedger) ? state.dmLedger : [];
  const id = attemptId(claim);
  const existing = state.dmLedger.find((entry) => entry.id === id);
  if (existing && ['reserved', 'succeeded', 'uncertain'].includes(existing.status)) {
    return {
      state,
      result: { ok: false, reason: 'duplicate-attempt', existing },
    };
  }
  const sameMessage = state.dmLedger.find((entry) => (
    entry.conversationId === claim.conversationId
    && entry.messageId === claim.messageId
    && ['reserved', 'succeeded', 'uncertain'].includes(entry.status)
  ));
  if (sameMessage) {
    return {
      state,
      result: { ok: false, reason: 'duplicate-message', existing: sameMessage },
    };
  }
  const record = {
    id,
    jobId: claim.jobId,
    itemId: claim.itemId,
    conversationId: claim.conversationId,
    messageId: claim.messageId,
    status: 'reserved',
    reservedAt: new Date(now).toISOString(),
    finalizedAt: null,
    result: null,
  };
  state.dmLedger.push(record);
  return {
    state,
    result: { ok: true, record },
  };
}

export function finalizeDmAttempt(candidateState, attemptIdValue, {
  status,
  result = null,
  now = Date.now(),
} = {}) {
  if (!['succeeded', 'failed', 'uncertain', 'canceled'].includes(status)) {
    throw new Error(`Unsupported DM attempt status: ${status}`);
  }
  const state = clone(candidateState || {});
  state.dmLedger = Array.isArray(state.dmLedger) ? state.dmLedger : [];
  const index = state.dmLedger.findIndex((entry) => entry.id === attemptIdValue);
  if (index < 0) throw new Error(`DM attempt not found: ${attemptIdValue}`);
  state.dmLedger[index] = {
    ...state.dmLedger[index],
    status,
    result,
    finalizedAt: new Date(now).toISOString(),
  };
  return state;
}

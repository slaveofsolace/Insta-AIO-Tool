import { dmStopReason } from '../core/dm-jobs.js';

export const INSTAGRAM_DM_UNSENDER_SOURCE = Object.freeze({
  name: 'instagram-dm-unsender',
  version: '0.7.2',
  license: 'MIT',
  sha256: '2DC5D357B6C3BBFE1F9E10E8D2F9252E7446C490FB3C16DF1B59719CB1D1FE2C',
  author: 'Romain Lebesle',
  sourceUrl: 'https://github.com/thoughtsunificator/instagram-dm-unsender',
});

export const UNSEND_LABELS = Object.freeze([
  'unsend',
  'annulla invio',
  'retirar',
  'deshacer',
  'retirer',
  'zurücknehmen',
]);

function normalizedLabel(value) {
  return String(value || '').trim().toLocaleLowerCase();
}

export function directThreadId(value) {
  const text = String(value || '').replaceAll('\\', '/');
  const directMatch = text.match(/\/direct\/t\/([^/?#]+)/i);
  if (directMatch) return directMatch[1];
  const finalSegment = text.split('/').filter(Boolean).at(-1) || '';
  const exportMatch = finalSegment.match(/_([0-9]+)$/);
  return exportMatch?.[1] || (/^[0-9]+$/.test(finalSegment) ? finalSegment : null);
}

export function resolveExactDmCandidate(item, candidates) {
  const exact = (candidates || []).filter((candidate) => (
    String(candidate.conversationId || '') === item.conversationId
    && String(candidate.messageId || '') === item.messageId
    && Number(candidate.timestamp) === item.timestamp
    && String(candidate.contentDigest || '') === item.contentDigest
  ));
  if (!exact.length) {
    return {
      conversationId: item.conversationId,
      messageId: item.messageId,
      missing: true,
    };
  }
  if (exact.length !== 1) {
    return {
      conversationId: item.conversationId,
      messageId: item.messageId,
      ambiguous: true,
    };
  }
  const candidate = exact[0];
  if (candidate.sentByMe !== true) {
    return {
      ...candidate,
      sentByMe: false,
    };
  }
  if (!candidate.resolutionToken) {
    return {
      ...candidate,
      unexpectedUi: true,
    };
  }
  return {
    ...candidate,
    sentByMe: true,
  };
}

function requireBoundary(boundary, name) {
  if (typeof boundary?.[name] !== 'function') {
    throw new Error(`DM browser boundary is missing ${name}().`);
  }
}

export function createInstagramDmUnsenderAdapter(boundary) {
  for (const method of [
    'inspectSession',
    'inspectConversation',
    'inspectMessages',
    'openMessageActions',
    'openUnsendConfirmation',
    'confirmUnsend',
  ]) {
    requireBoundary(boundary, method);
  }

  return {
    source: INSTAGRAM_DM_UNSENDER_SOURCE,

    async inspectSession() {
      return boundary.inspectSession();
    },

    async resolveConversation(conversationId) {
      const inspected = await boundary.inspectConversation();
      const stopReason = dmStopReason(inspected);
      if (stopReason) return inspected;
      const expectedThreadId = directThreadId(conversationId);
      const observedThreadId = directThreadId(inspected.url || inspected.threadId);
      if (!expectedThreadId || !observedThreadId || expectedThreadId !== observedThreadId) {
        return {
          ...inspected,
          conversationId: inspected.conversationId || null,
          ambiguous: true,
          reason: 'conversation-id-unresolved',
        };
      }
      return {
        ...inspected,
        conversationId,
        threadId: observedThreadId,
      };
    },

    async resolveMessage(item) {
      const candidates = await boundary.inspectMessages(item);
      return resolveExactDmCandidate(item, candidates);
    },

    async performReviewedUnsend(item) {
      const candidates = await boundary.inspectMessages(item);
      const current = resolveExactDmCandidate(item, candidates);
      if (
        current.missing
        || current.ambiguous
        || current.unexpectedUi
        || current.sentByMe !== true
        || current.resolutionToken !== item.resolutionToken
      ) {
        return {
          ambiguous: true,
          reason: 'message-changed-before-unsend',
        };
      }

      const menu = await boundary.openMessageActions(current.resolutionToken);
      const menuStop = dmStopReason(menu);
      if (menuStop) return menu;
      const unsendOptions = (menu.options || []).filter((option) => (
        UNSEND_LABELS.includes(normalizedLabel(option.label))
      ));
      if (unsendOptions.length !== 1 || !unsendOptions[0].token) {
        return {
          unexpectedUi: true,
          reason: 'unsend-menu-item-not-exact',
        };
      }

      const confirmation = await boundary.openUnsendConfirmation(unsendOptions[0].token);
      const confirmationStop = dmStopReason(confirmation);
      if (confirmationStop) return confirmation;
      if (
        confirmation.conversationId !== item.conversationId
        || confirmation.messageId !== item.messageId
        || confirmation.sentByMe !== true
        || !UNSEND_LABELS.includes(normalizedLabel(confirmation.label))
        || !confirmation.confirmToken
      ) {
        return {
          unexpectedUi: true,
          reason: 'unsend-confirmation-not-exact',
        };
      }

      const result = await boundary.confirmUnsend(confirmation.confirmToken);
      const resultStop = dmStopReason(result);
      if (resultStop) return result;
      return {
        ...result,
        result: result.result || 'unsend-requested',
      };
    },
  };
}

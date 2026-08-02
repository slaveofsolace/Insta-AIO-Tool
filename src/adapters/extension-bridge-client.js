import {
  BRIDGE_CHANNEL,
  createBridgeHandshakeNonce,
  createSignedBridgeMessage,
  deriveBridgeSessionPairing,
  verifySignedBridgeMessage,
} from '../core/bridge-protocol.js';

const responseNonces = new Set();

function requireBrowserTransport() {
  if (!globalThis.window?.postMessage || !globalThis.location?.origin) {
    throw new Error('The extension bridge requires a browser window.');
  }
}

function exchange(message, {
  timeoutMs = 10_000,
} = {}) {
  requireBrowserTransport();
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      window.removeEventListener('message', onMessage);
      reject(new Error('No response from the companion extension.'));
    }, timeoutMs);

    function onMessage(event) {
      if (
        event.source !== window
        || event.origin !== location.origin
        || event.data?.channel !== BRIDGE_CHANNEL
        || event.data?.direction !== 'extension-to-pwa'
        || event.data?.requestId !== message.requestId
      ) {
        return;
      }
      clearTimeout(timeout);
      window.removeEventListener('message', onMessage);
      if (event.data.error) {
        reject(new Error(`Extension bridge rejected the request: ${event.data.error}.`));
        return;
      }
      resolve(event.data.message);
    }

    window.addEventListener('message', onMessage);
    window.postMessage({
      channel: BRIDGE_CHANNEL,
      direction: 'pwa-to-extension',
      message,
    }, location.origin);
  });
}

async function verifyResponse(response, pairing, requestId) {
  if (response?.requestId !== requestId) {
    throw new Error('Extension response does not match the request.');
  }
  const verified = await verifySignedBridgeMessage(response, pairing, {
    origin: location.origin,
    usedNonces: responseNonces,
  });
  if (!verified.ok) {
    throw new Error(`Extension response verification failed: ${verified.reason}.`);
  }
  return verified.message;
}

export async function completeExtensionPairing(pairing, options = {}) {
  if (!pairing || pairing.pairedAt || pairing.revokedAt) {
    throw new Error('Create an unused bridge pairing code first.');
  }
  const clientNonce = createBridgeHandshakeNonce();
  const request = await createSignedBridgeMessage(pairing, 'bridge.pair', {
    clientNonce,
  });
  const response = await exchange(request, options);
  const verified = await verifyResponse(response, pairing, request.requestId);
  if (
    verified.type !== 'read.pairing-complete'
    || !verified.payload?.extensionNonce
  ) {
    throw new Error('Extension returned an invalid pairing response.');
  }
  return deriveBridgeSessionPairing(pairing, {
    clientNonce,
    extensionNonce: verified.payload.extensionNonce,
  });
}

export async function requestExtensionBridge(pairing, type, payload = {}, options = {}) {
  if (!pairing?.pairedAt || pairing.revokedAt) {
    throw new Error('Complete extension pairing before sending requests.');
  }
  const request = await createSignedBridgeMessage(pairing, type, payload);
  const response = await exchange(request, options);
  return verifyResponse(response, pairing, request.requestId);
}

function responsePayload(response, expectedType) {
  if (response?.type === 'action.bridge-error') {
    throw new Error(response.payload?.reason || 'extension-rejected-action');
  }
  if (response?.type !== expectedType || !response.payload) {
    throw new Error(`Extension returned an unexpected response for ${expectedType}.`);
  }
  return response.payload;
}

export function createExtensionAccountActionDriver(pairing, {
  jobId,
  request = requestExtensionBridge,
  timeoutMs = 15_000,
} = {}) {
  if (!jobId) throw new Error('An account action job ID is required.');

  async function exchange(type, payload, expectedType) {
    const response = await request(pairing, type, {
      jobId,
      ...payload,
    }, { timeoutMs });
    return responsePayload(response, expectedType);
  }

  return Object.freeze({
    async inspectSession() {
      return exchange(
        'action.account-session',
        {},
        'action.account-session-result',
      );
    },

    async resolveProfile(username) {
      return exchange(
        'action.account-profile',
        { username },
        'action.account-profile-result',
      );
    },

    async inspectLiveAuthorization(item) {
      return exchange(
        'action.account-live-readiness',
        { item },
        'action.account-live-readiness-result',
      );
    },

    async performReviewedAction(item) {
      return exchange(
        'action.account-perform',
        { item },
        'action.account-perform-result',
      );
    },
  });
}

export function createExtensionDmUnsendDriver(pairing, {
  jobId,
  request = requestExtensionBridge,
  timeoutMs = 15_000,
} = {}) {
  if (!jobId) throw new Error('A reviewed DM job ID is required.');

  async function exchange(type, payload, expectedType) {
    const response = await request(pairing, type, {
      jobId,
      ...payload,
    }, { timeoutMs });
    return responsePayload(response, expectedType);
  }

  return Object.freeze({
    async inspectSession() {
      return exchange('action.dm-session', {}, 'action.dm-session-result');
    },

    async resolveConversation(conversationId) {
      return exchange(
        'action.dm-conversation',
        { conversationId },
        'action.dm-conversation-result',
      );
    },

    async resolveMessage(item) {
      return exchange('action.dm-message', { item }, 'action.dm-message-result');
    },

    async inspectLiveAuthorization(item) {
      return exchange(
        'action.dm-live-readiness',
        { item },
        'action.dm-live-readiness-result',
      );
    },

    async performReviewedUnsend(item) {
      return exchange('action.dm-perform', { item }, 'action.dm-perform-result');
    },
  });
}

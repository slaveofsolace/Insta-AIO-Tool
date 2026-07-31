import { parseBridgePairingCode } from './lib/bridge-protocol.js';

const form = document.querySelector('#pairing-form');
const originLabel = document.querySelector('#active-origin');
const status = document.querySelector('#status');
const list = document.querySelector('#pairings');
let activeTab = null;
let activeOrigin = null;

function scriptId(pairingId) {
  return `insta-aio-${String(pairingId).replace(/[^a-z0-9_-]/gi, '-')}`;
}

function originPattern(origin) {
  return `${origin}/*`;
}

async function pairings() {
  const stored = await chrome.storage.local.get('bridgePairings');
  return Array.isArray(stored.bridgePairings) ? stored.bridgePairings : [];
}

async function renderPairings() {
  const records = await pairings();
  list.replaceChildren();
  if (!records.length) {
    const empty = document.createElement('p');
    empty.textContent = 'No origins paired.';
    list.append(empty);
    return;
  }
  for (const pairing of records) {
    const card = document.createElement('div');
    card.className = 'pairing';
    const title = document.createElement('strong');
    title.textContent = pairing.origin;
    const detail = document.createElement('small');
    detail.textContent = `${pairing.permissions.join(' + ')} · ${pairing.pairedAt ? 'connected' : 'awaiting PWA handshake'}`;
    const revoke = document.createElement('button');
    revoke.type = 'button';
    revoke.className = 'secondary';
    revoke.textContent = 'Revoke';
    revoke.addEventListener('click', async () => {
      const remaining = (await pairings()).filter((candidate) => (
        candidate.pairingId !== pairing.pairingId
      ));
      await chrome.storage.local.set({ bridgePairings: remaining });
      try {
        await chrome.scripting.unregisterContentScripts({ ids: [scriptId(pairing.pairingId)] });
      } catch {
        // The script may not have completed registration.
      }
      if (!remaining.some((candidate) => candidate.origin === pairing.origin)) {
        await chrome.permissions.remove({ origins: [originPattern(pairing.origin)] });
      }
      status.textContent = `Revoked ${pairing.origin}.`;
      await renderPairings();
    });
    card.append(title, detail, revoke);
    list.append(card);
  }
}

async function installOriginBridge(pairing) {
  const id = scriptId(pairing.pairingId);
  try {
    await chrome.scripting.unregisterContentScripts({ ids: [id] });
  } catch {
    // Registration does not exist yet.
  }
  await chrome.scripting.registerContentScripts([{
    id,
    matches: [originPattern(pairing.origin)],
    js: ['content-pwa.js'],
    runAt: 'document_start',
    persistAcrossSessions: true,
  }]);
  if (activeTab?.id) {
    await chrome.scripting.executeScript({
      target: { tabId: activeTab.id },
      files: ['content-pwa.js'],
    });
  }
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  status.textContent = '';
  if (!activeOrigin || !activeTab?.id) {
    status.textContent = 'Open the PWA in a normal HTTP or HTTPS tab first.';
    return;
  }
  try {
    const permissions = document.querySelector('#action-permission').checked
      ? ['read', 'action']
      : ['read'];
    const pairing = parseBridgePairingCode(
      document.querySelector('#pairing-code').value,
      { origin: activeOrigin, permissions },
    );
    const existing = await pairings();
    if (existing.some((candidate) => candidate.pairingId === pairing.pairingId)) {
      throw new Error('This pairing code is already saved.');
    }
    const granted = await chrome.permissions.request({
      origins: [originPattern(activeOrigin)],
    });
    if (!granted) throw new Error('Origin access was not granted.');
    await chrome.storage.local.set({
      bridgePairings: [pairing, ...existing].slice(0, 20),
    });
    await installOriginBridge(pairing);
    document.querySelector('#pairing-code').value = '';
    status.textContent = 'Origin paired. Return to the PWA and complete the handshake.';
    await renderPairings();
  } catch (error) {
    status.textContent = error.message;
  }
});

const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
activeTab = tab || null;
try {
  const url = new URL(tab?.url || '');
  if (['http:', 'https:'].includes(url.protocol) && url.hostname !== 'www.instagram.com') {
    activeOrigin = url.origin;
    originLabel.textContent = activeOrigin;
  }
} catch {
  activeOrigin = null;
}
await renderPairings();

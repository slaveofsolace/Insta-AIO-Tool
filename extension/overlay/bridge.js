(() => {
  'use strict';

  const modules = globalThis.__instaAioOverlayModules;
  const shared = modules?.shared;
  if (!shared || modules.bridge) return;

  function send(chromeLike, message) {
    return new Promise((resolve) => {
      try {
        chromeLike.runtime.sendMessage(message, (response) => {
          const error = chromeLike.runtime.lastError?.message;
          resolve(error ? { error } : response || {});
        });
      } catch (error) {
        resolve({ error: error.message });
      }
    });
  }

  function activePairing(state) {
    return (state?.pairings || []).find((pairing) => pairing?.pairedAt) || null;
  }

  shared.install('bridge', { activePairing, send });
})();

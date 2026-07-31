(() => {
  if (globalThis.__instaAioBridgeContentInstalled) return;
  globalThis.__instaAioBridgeContentInstalled = true;

  const CHANNEL = 'insta-aio-extension-bridge';

  window.addEventListener('message', (event) => {
    if (
      event.source !== window
      || event.origin !== location.origin
      || event.data?.channel !== CHANNEL
      || event.data?.direction !== 'pwa-to-extension'
      || !event.data?.message
    ) {
      return;
    }

    const requestId = event.data.message.requestId;
    chrome.runtime.sendMessage({
      kind: 'insta-aio-bridge-request',
      origin: location.origin,
      message: event.data.message,
    }).then((response) => {
      window.postMessage({
        channel: CHANNEL,
        direction: 'extension-to-pwa',
        requestId,
        ...(response || { error: 'empty-extension-response' }),
      }, location.origin);
    }).catch(() => {
      window.postMessage({
        channel: CHANNEL,
        direction: 'extension-to-pwa',
        requestId,
        error: 'extension-transport-failed',
      }, location.origin);
    });
  });
})();

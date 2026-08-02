(() => {
  'use strict';

  const modules = globalThis.__instaAioOverlayModules;
  const shared = modules?.shared;
  if (!shared || modules.downloads) return;

  function create({ URL: UrlApi, Blob: BlobType }) {
    const urls = new Map();

    function clear(name, anchor) {
      const previous = urls.get(name);
      if (previous) UrlApi.revokeObjectURL(previous);
      urls.delete(name);
      anchor?.removeAttribute('href');
      anchor?.removeAttribute('download');
      anchor?.setAttribute('aria-disabled', 'true');
    }

    function update(name, anchor, { filename, payload } = {}) {
      clear(name, anchor);
      if (payload === undefined) return null;
      const url = UrlApi.createObjectURL(new BlobType([
        JSON.stringify(payload, null, 2),
      ], { type: 'application/json' }));
      urls.set(name, url);
      anchor.href = url;
      anchor.download = filename;
      anchor.removeAttribute('aria-disabled');
      return url;
    }

    function teardown() {
      for (const url of urls.values()) UrlApi.revokeObjectURL(url);
      urls.clear();
    }

    return Object.freeze({
      activeCount: () => urls.size,
      clear,
      teardown,
      update,
    });
  }

  shared.install('downloads', { create });
})();

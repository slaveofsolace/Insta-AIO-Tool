// Single source of truth for the Instagram content-script load order.
//
// The order matters: each overlay module registers itself on a shared registry
// and the entry point refuses to start until every module it needs is present.
// Keeping one list here stops the build, the packager, and the acceptance
// harnesses from drifting apart when a module is added.
export const instagramScriptOrder = Object.freeze([
  'action-labels.js',
  'content-instagram.js',
  'overlay/tokens.js',
  'overlay/shared.js',
  'overlay/preferences.js',
  'overlay/route-observer.js',
  'overlay/theme.js',
  'overlay/bridge.js',
  'overlay/downloads.js',
  'overlay/accessibility.js',
  'overlay/layout.js',
  'overlay/collision.js',
  'overlay/icons.js',
  'overlay/batch.js',
  'overlay/shell.js',
  'overlay/views/now.js',
  'overlay/views/capture.js',
  'overlay/views/queue.js',
  'overlay/views/messages.js',
  'overlay/views/workspace.js',
  'instagram-overlay.js',
]);

// Files shipped in the packaged extension that are not Instagram content scripts.
export const supportingExtensionFiles = Object.freeze([
  'background.js',
  'content-pwa.js',
  'manifest.json',
  'popup.css',
  'popup.html',
  'popup.js',
]);

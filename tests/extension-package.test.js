import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const manifest = JSON.parse(await readFile(
  new URL('../extension/manifest.json', import.meta.url),
  'utf8',
));
const background = await readFile(
  new URL('../extension/background.js', import.meta.url),
  'utf8',
);
const instagramContent = await readFile(
  new URL('../extension/content-instagram.js', import.meta.url),
  'utf8',
);
const instagramOverlay = await readFile(
  new URL('../extension/instagram-overlay.js', import.meta.url),
  'utf8',
);
const pwaContent = await readFile(
  new URL('../extension/content-pwa.js', import.meta.url),
  'utf8',
);
const controlledPolicy = await readFile(
  new URL('../src/core/controlled-account-action.js', import.meta.url),
  'utf8',
);

test('extension uses Manifest V3 without cookie or request interception permissions', () => {
  assert.equal(manifest.manifest_version, 3);
  const permissions = [
    ...(manifest.permissions || []),
    ...(manifest.host_permissions || []),
  ];
  assert.equal(permissions.includes('cookies'), false);
  assert.equal(permissions.includes('webRequest'), false);
  assert.equal(permissions.includes('webRequestBlocking'), false);
  assert.deepEqual(manifest.host_permissions, ['https://www.instagram.com/*']);
});

test('Instagram content script isolates its only page-control call behind the reviewed live driver', () => {
  assert.match(instagramContent, /insta-aio-inspect-profile/);
  assert.match(instagramContent, /insta-aio-capture-visible-accounts/);
  assert.match(instagramContent, /replace\(\/\^\\\/\+\/, ''\)/);
  assert.equal((instagramContent.match(/\.click\s*\(/g) || []).length, 1);
  assert.match(instagramContent, /function activateLiveControl\(control\)[\s\S]*?control\.click\(\)/);
  assert.match(instagramContent, /profileResolutions\.delete\(token\)/);
  assert.match(instagramContent, /unfollow-confirmation-not-exact/);
  assert.doesNotMatch(instagramContent, /cookies?|authorization/i);
  assert.doesNotMatch(instagramOverlay, /\.click\s*\(/);
  assert.match(instagramOverlay, /data-ia-section="queue"/);
});

test('bridge transport pins the page origin and requires one fresh, armed live account intent', () => {
  assert.match(pwaContent, /event\.origin !== location\.origin/);
  assert.match(pwaContent, /window\.postMessage/);
  assert.match(background, /bridgeSenderOrigin\(sender\)/);
  assert.match(background, /origin !== request\.origin/);
  assert.match(controlledPolicy, /controlled-live-batch-must-be-one/);
  assert.match(controlledPolicy, /live-confirmation-expired/);
  assert.match(background, /live-arm-required/);
  assert.match(background, /Reserve and consume the one-shot capability durably before the first page control is used/);
  assert.match(background, /accountActionLedger/);
  assert.match(background, /reserveExtensionAction/);
  assert.match(instagramContent, /function verifiedProfileHeader\(username\)/);
  assert.match(instagramContent, /profileRoot !== resolution\.profileRoot/);
  assert.match(instagramContent, /preexisting-dialog-before-live-action/);
  assert.match(instagramContent, /dialogNamesUsername\(dialog, username\)/);
  assert.match(background, /state\.liveArm = null;[\s\S]*state\.pendingLiveIntent = null;[\s\S]*await saveBridgeState\(state\)/);
});

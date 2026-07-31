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
const pwaContent = await readFile(
  new URL('../extension/content-pwa.js', import.meta.url),
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

test('Instagram content script exposes inspection only and contains no click path', () => {
  assert.match(instagramContent, /insta-aio-inspect-profile/);
  assert.match(instagramContent, /insta-aio-capture-visible-accounts/);
  assert.match(instagramContent, /replace\(\/\^\\\/\+\/, ''\)/);
  assert.doesNotMatch(instagramContent, /\.click\s*\(/);
  assert.doesNotMatch(instagramContent, /cookies?|authorization/i);
});

test('bridge transport pins the page origin and background rejects live jobs', () => {
  assert.match(pwaContent, /event\.origin !== location\.origin/);
  assert.match(pwaContent, /window\.postMessage/);
  assert.match(background, /bridgeSenderOrigin\(sender\)/);
  assert.match(background, /origin !== request\.origin/);
  assert.match(background, /live-execution-disabled/);
  assert.match(background, /liveExecutionEnabled: false/);
});

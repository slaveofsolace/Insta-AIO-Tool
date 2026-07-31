import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const manifest = JSON.parse(await readFile(
  new URL('../extension/manifest.json', import.meta.url),
  'utf8',
));
const inspector = await readFile(
  new URL('../extension/content-instagram.js', import.meta.url),
  'utf8',
);
const overlay = await readFile(
  new URL('../extension/instagram-overlay.js', import.meta.url),
  'utf8',
);
const background = await readFile(
  new URL('../extension/background.js', import.meta.url),
  'utf8',
);
const fixture = await readFile(
  new URL('./fixtures/overlay-preview.html', import.meta.url),
  'utf8',
);
const popupHtml = await readFile(
  new URL('../extension/popup.html', import.meta.url),
  'utf8',
);
const popupCss = await readFile(
  new URL('../extension/popup.css', import.meta.url),
  'utf8',
);

test('Instagram loads the inspector before the visible sidecar', () => {
  const instagramEntry = manifest.content_scripts.find((entry) => (
    entry.matches.includes('https://www.instagram.com/*')
  ));
  assert.deepEqual(instagramEntry.js, [
    'content-instagram.js',
    'instagram-overlay.js',
  ]);
  assert.equal(manifest.version, '0.2.0');
});

test('sidecar migrates the visible capture and manual queue workflow', () => {
  assert.match(inspector, /querySelectorAll\('\[role="dialog"\]'\)/);
  assert.match(overlay, /kind: 'insta-aio-visible-list'/);
  assert.match(overlay, /insta-aio-manual-queue/);
  assert.match(overlay, /data-ia-action="capture-visible"/);
  assert.match(overlay, /data-ia-action="queue-complete"/);
  assert.match(overlay, /data-ia-action="queue-skip"/);
  assert.match(overlay, /Download import JSON/);
  assert.match(overlay, /extension-local queue only/);
});

test('sidecar exposes every tool family and accessibility controls', () => {
  for (const section of ['now', 'capture', 'queue', 'messages', 'workspace']) {
    assert.match(overlay, new RegExp(`data-ia-section="${section}"`));
    assert.match(overlay, new RegExp(`data-ia-view="${section}"`));
  }
  assert.match(overlay, /aria-live="polite"/);
  assert.match(overlay, /aria-selected=/);
  assert.match(overlay, /aria-expanded=/);
  assert.match(overlay, /prefers-reduced-motion: reduce/);
  assert.match(overlay, /Alt \+ Shift \+ I/);
  assert.match(overlay, /__instaAioOverlayTestOpenShadow === true \? 'open' : 'closed'/);
});

test('Instagram scripts contain no synthetic or page-control click path', () => {
  const combined = `${inspector}\n${overlay}`;
  assert.doesNotMatch(combined, /\.click\s*\(/);
  assert.doesNotMatch(combined, /dispatchEvent\s*\(/);
  assert.doesNotMatch(combined, /Follow.*\.click|Unfollow.*\.click|Unsend.*\.click/is);
  assert.match(overlay, /No Instagram controls will be clicked/);
});

test('visible DM evidence remains read-only and identity-incomplete', () => {
  assert.match(inspector, /inspectVisibleMessages/);
  assert.match(inspector, /exactIdentityAvailable: false/);
  assert.match(inspector, /ownershipAvailable: false/);
  assert.match(inspector, /!element\.closest\('header, nav, button, \[role="button"\], a'\)/);
  assert.match(overlay, /Exact identity is required/);
  assert.match(overlay, /cannot authorize removal/);
});

test('background reveals only sanitized pairing and dry-run summaries to Instagram', () => {
  const overlayStateBody = background.slice(
    background.indexOf('function overlayState'),
    background.indexOf('function isInstagramSender'),
  );
  assert.match(background, /insta-aio-overlay-state/);
  assert.match(background, /instagram-origin-required/);
  assert.match(background, /liveExecutionEnabled: false/);
  assert.doesNotMatch(overlayStateBody, /secret|signature|nonce/i);
});

test('runtime fixture exercises the actual production scripts', () => {
  assert.match(fixture, /\/extension\/content-instagram\.js/);
  assert.match(fixture, /\/extension\/instagram-overlay\.js/);
  assert.match(fixture, /instaAioOverlayManualQueueV1/);
  assert.match(fixture, /resolved-no-click/);
  assert.match(fixture, /fixtureSearch\.get\('shadow'\) !== 'closed'/);
});

test('popup identifies itself as setup while directing work to the Instagram sidecar', () => {
  assert.match(popupHtml, /The working UI lives on Instagram/);
  assert.match(popupHtml, /Pair exact workspace origin/);
  assert.match(popupCss, /#d8ff45/);
  assert.doesNotMatch(popupCss, /Inter,/);
});

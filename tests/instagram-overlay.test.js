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
const controlledPolicy = await readFile(
  new URL('../src/core/controlled-account-action.js', import.meta.url),
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
  assert.equal(manifest.version, '0.3.0');
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

test('sidecar captures focus before hiding its launcher and restores a usable target', () => {
  const setOpenBody = overlay.slice(
    overlay.indexOf('function setOpen'),
    overlay.indexOf('const sectionCopy'),
  );
  assert.ok(setOpenBody.indexOf('const focusBeforeOpen') < setOpenBody.indexOf('launcher.hidden'));
  assert.match(setOpenBody, /lastFocusedElement = focusBeforeOpen/);
  assert.match(setOpenBody, /lastFocusedElement !== document\.body/);
  assert.match(setOpenBody, /lastFocusedElement !== document\.documentElement/);
  assert.match(setOpenBody, /launcher\.focus\(\)/);
});

test('dry runs remain no-click while the one live activator is token-bound and one-use', () => {
  assert.equal((inspector.match(/\.click\s*\(/g) || []).length, 1);
  assert.match(inspector, /function activateLiveControl\(control\)/);
  assert.match(inspector, /profileResolutions\.delete\(token\)/);
  assert.match(inspector, /current\.control !== resolution\.control/);
  assert.doesNotMatch(overlay, /\.click\s*\(|dispatchEvent\s*\(/);
  const dryRunBody = background.slice(
    background.indexOf('async function inspectAccountJob'),
    background.indexOf('async function accountLiveReadiness'),
  );
  assert.doesNotMatch(dryRunBody, /insta-aio-perform-reviewed-profile-action/);
  assert.match(overlay, /Inspection is no-click/);
});

test('sidecar exposes an exact, expiring live arm without executing from the overlay', () => {
  assert.match(overlay, /Controlled live gate/);
  assert.match(overlay, /ARM \$\{String\(intent\.action/);
  assert.match(overlay, /Arm for 90 seconds/);
  assert.match(overlay, /Arming alone does not click/);
  assert.match(controlledPolicy, /ACCOUNT_ARM_TTL_MS = 90 \* 1000/);
  assert.match(background, /insta-aio-arm-account-action/);
  assert.match(background, /expectedPhrase = `ARM \$\{intent\.action\.toUpperCase\(\)\} @\$\{intent\.username\}`/);
});

test('visible DM evidence remains read-only and identity-incomplete', () => {
  assert.match(inspector, /inspectVisibleMessages/);
  assert.match(inspector, /exactIdentityAvailable: false/);
  assert.match(inspector, /ownershipAvailable: false/);
  assert.match(inspector, /!element\.closest\('header, nav, button, \[role="button"\], a'\)/);
  assert.match(overlay, /Exact identity is required/);
  assert.match(overlay, /cannot authorize removal/);
});

test('background reveals only sanitized pairing, intent, arm, and run summaries to Instagram', () => {
  const overlayStateBody = background.slice(
    background.indexOf('function overlayState'),
    background.indexOf('function isInstagramSender'),
  );
  assert.match(background, /insta-aio-overlay-state/);
  assert.match(background, /instagram-origin-required/);
  assert.match(background, /pendingLiveIntent: publicLiveIntent/);
  assert.match(background, /liveArm: publicLiveArm/);
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

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
const instagramEntry = manifest.content_scripts.find((entry) => (
  entry.matches.includes('https://www.instagram.com/*')
));
const overlayFiles = instagramEntry.js.slice(2);
const overlay = (await Promise.all(overlayFiles.map((file) => readFile(
  new URL(`../extension/${file}`, import.meta.url),
  'utf8',
)))).join('\n');
const background = await readFile(
  new URL('../extension/background.js', import.meta.url),
  'utf8',
);
const controlledPolicy = await readFile(
  new URL('../src/core/controlled-account-action.js', import.meta.url),
  'utf8',
);
const controlledDmPolicy = await readFile(
  new URL('../src/core/controlled-dm-unsend.js', import.meta.url),
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
  assert.deepEqual(instagramEntry.js, [
    'action-labels.js',
    'content-instagram.js',
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
  assert.equal(manifest.version, '0.5.0');
});

test('sidecar migrates the visible capture and manual queue workflow', () => {
  assert.match(inspector, /querySelectorAll\('\[role="dialog"\]'\)/);
  assert.match(overlay, /kind: 'insta-aio-visible-list'/);
  assert.match(overlay, /insta-aio-manual-queue/);
  assert.match(overlay, /data-ia-action="capture-visible"/);
  assert.match(overlay, /data-ia-action="queue-complete"/);
  assert.match(overlay, /data-ia-action="queue-skip"/);
  assert.match(overlay, /Download selected list/);
  assert.match(overlay, /compareCaptureWorkspace/);
  assert.match(overlay, /extension-local queue only/);
});

test('sidecar exposes every tool family and accessibility controls', () => {
  for (const section of ['now', 'capture', 'queue', 'messages', 'workspace']) {
    assert.match(overlay, new RegExp(`tab\\('${section}'`));
    assert.match(overlay, new RegExp(`data-ia-view="${section}"`));
  }
  assert.match(overlay, /aria-live="polite"/);
  assert.match(overlay, /aria-selected=/);
  assert.match(overlay, /aria-expanded=/);
  assert.match(overlay, /prefers-reduced-motion: reduce/);
  assert.match(overlay, /Alt \+ Shift \+ I/);
  assert.match(overlay, /data-ia-role="move-handle"/);
  assert.match(overlay, /data-ia-role="resize-handle"/);
  assert.match(overlay, /data-ia-preference="opacity"/);
  assert.match(overlay, /Follower checker/);
  assert.match(overlay, /Follow \/ Unfollow/);
  assert.match(overlay, /DM Unsend/);
  assert.match(overlay, /openShadow: globalThis\.__instaAioOverlayTestOpenShadow === true/);
  assert.match(overlay, /attachShadow\(\{ mode: openShadow \? 'open' : 'closed' \}\)/);
});

test('sidecar captures focus before hiding its launcher and restores a usable target', () => {
  const setOpenBody = overlay.slice(
    overlay.indexOf('function setOpen'),
    overlay.indexOf('function renderSection'),
  );
  assert.ok(setOpenBody.indexOf('const focusBeforeOpen') < setOpenBody.indexOf('launcher.hidden'));
  assert.match(setOpenBody, /lastFocusedElement = focusBeforeOpen/);
  assert.match(setOpenBody, /lastFocusedElement !== document\.body/);
  assert.match(setOpenBody, /lastFocusedElement !== document\.documentElement/);
  assert.match(setOpenBody, /\)\s*\?\s*lastFocusedElement\s*:\s*launcher;/);
  assert.match(setOpenBody, /restoreTarget\.focus\(\{ preventScroll: true \}\)/);
});

test('dry runs remain no-click while the one live activator is token-bound and one-use', () => {
  assert.equal((inspector.match(/\.click\s*\(/g) || []).length, 1);
  assert.match(inspector, /function activateLiveControl\(control\)/);
  assert.match(inspector, /profileResolutions\.delete\(token\)/);
  assert.match(inspector, /current\.control !== resolution\.control/);
  assert.doesNotMatch(overlay, /\.click\s*\(|dispatchEvent\s*\(/);
  assert.doesNotMatch(overlay, /setInterval\s*\(/);
  assert.equal((overlay.match(/\.innerHTML\s*=/g) || []).length, 1);
  assert.match(overlay, /shadow\.innerHTML = `/);
  assert.doesNotMatch(overlay, /@import\s+url|url\(\s*['"]?https?:|<script[^>]+src=['"]https?:/i);
  const dryRunBody = background.slice(
    background.indexOf('async function inspectAccountJob'),
    background.indexOf('async function accountLiveReadiness'),
  );
  assert.doesNotMatch(dryRunBody, /insta-aio-perform-reviewed-profile-action/);
  assert.match(overlay, /Inspection is no-click/);
});

test('sidecar exposes an exact, expiring live arm without executing from the overlay', () => {
  assert.match(overlay, /data-ia-role="account-live-disclosure"/);
  assert.match(overlay, /ARM \$\{String\(intent\.action/);
  assert.match(overlay, /Arm for 90 seconds/);
  assert.match(overlay, /Arming alone does not click/);
  assert.match(controlledPolicy, /ACCOUNT_ARM_TTL_MS = 90 \* 1000/);
  assert.match(background, /insta-aio-arm-account-action/);
  assert.match(background, /expectedPhrase = `ARM \$\{intent\.action\.toUpperCase\(\)\} @\$\{intent\.username\}`/);
  assert.match(overlay, /data-ia-role="dm-live-disclosure"/);
  assert.match(overlay, /ARM UNSEND \$\{intent\.armCode\}/);
  assert.match(overlay, /data-ia-action="arm-dm-live"/);
  assert.match(overlay, /Arming does not open a menu or remove anything/);
  assert.match(overlay, /The prior arm expired/);
  assert.match(overlay, /the old expiry is never extended/);
  assert.match(overlay, /state: 'canceled'/);
  assert.match(controlledDmPolicy, /DM_ARM_TTL_MS = 90 \* 1000/);
  assert.match(background, /insta-aio-arm-dm-unsend/);
});

test('visible DM evidence stays read-only while reviewed jobs require stable exact identity', () => {
  assert.match(inspector, /inspectVisibleMessages/);
  assert.match(inspector, /exactIdentityAvailable: false/);
  assert.match(inspector, /ownershipAvailable: false/);
  assert.match(inspector, /!element\.closest\('header, nav, button, \[role="button"\], a'\)/);
  assert.match(inspector, /function inspectReviewedDmItem\(item\)/);
  assert.match(inspector, /data-message-id/);
  assert.match(inspector, /data-timestamp-ms/);
  assert.match(inspector, /message-ownership-unavailable/);
  assert.match(overlay, /Exact message ID, timestamp, digest, conversation, and sent-by-me ownership must all match/);
  assert.match(overlay, /Visible text alone cannot authorize removal/);
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
  assert.match(background, /pendingDmIntent: publicDmIntent/);
  assert.match(background, /dmArm: publicDmArm/);
  assert.doesNotMatch(overlayStateBody, /secret|signature|nonce/i);
});

test('runtime fixture exercises the actual production scripts', () => {
  assert.match(fixture, /\/extension\/content-instagram\.js/);
  assert.match(fixture, /\/extension\/overlay\/shared\.js/);
  assert.match(fixture, /\/extension\/overlay\/views\/messages\.js/);
  assert.match(fixture, /\/extension\/instagram-overlay\.js/);
  assert.match(fixture, /instaAioOverlayManualQueueV1/);
  assert.match(fixture, /resolved-no-click/);
  assert.match(fixture, /fixtureSearch\.get\('shadow'\) !== 'closed'/);
  assert.match(fixture, /messages-exact/);
  assert.match(fixture, /data-pagelet="IGDMessagesList"/);
  assert.match(fixture, /data-message-id="sent-1"/);
});

test('popup identifies itself as setup while directing work to the Instagram sidecar', () => {
  assert.match(popupHtml, /The working UI lives on Instagram/);
  assert.match(popupHtml, /Pair exact workspace origin/);
  assert.match(popupCss, /#d8ff45/);
  assert.doesNotMatch(popupCss, /Inter,/);
});

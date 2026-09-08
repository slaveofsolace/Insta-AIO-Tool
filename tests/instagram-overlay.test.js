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
const overlayFiles = instagramEntry.js.filter((file) => ![
  'action-labels.js',
  'content-instagram.js',
].includes(file));
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
    'action-confirmation.js',
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
  assert.equal(manifest.version, '3.1.8');
});

test('sidecar migrates the visible capture and manual queue workflow', () => {
  assert.match(inspector, /querySelectorAll\('\[role="dialog"\]'\)/);
  assert.match(overlay, /kind: 'insta-toolbox-visible-list'/);
  assert.match(overlay, /insta-toolbox-manual-queue/);
  assert.match(overlay, /data-insta-toolbox-action="capture-visible"/);
  assert.match(overlay, /data-insta-toolbox-action="queue-complete"/);
  assert.match(overlay, /data-insta-toolbox-action="queue-skip"/);
  assert.match(overlay, /Download selected list/);
  assert.match(overlay, /compareCaptureWorkspace/);
  assert.match(overlay, /extension-local queue only/);
});

test('sidecar exposes every tool family and accessibility controls', () => {
  for (const section of ['now', 'capture', 'queue', 'messages', 'workspace']) {
    assert.match(overlay, new RegExp(`tab\\('${section}'`));
    assert.match(overlay, new RegExp(`data-insta-toolbox-view="${section}"`));
  }
  assert.match(overlay, /aria-live="polite"/);
  assert.match(overlay, /aria-selected=/);
  assert.match(overlay, /aria-expanded=/);
  assert.match(overlay, /prefers-reduced-motion: reduce/);
  assert.match(overlay, /Alt \+ Shift \+ I/);
  assert.match(overlay, /data-insta-toolbox-role="move-handle"/);
  assert.match(overlay, /data-insta-toolbox-role="resize-handle-start"/);
  assert.match(overlay, /data-insta-toolbox-role="resize-handle-end"/);
  assert.match(overlay, /\.insta-toolbox-header \{[^}]*min-height: 52px/);
  assert.match(overlay, /\.insta-toolbox-move-handle \{[^}]*min-width: 44px/);
  assert.match(overlay, /@container insta-toolbox-body \(max-width: 340px\)/);
  assert.match(overlay, /class="insta-toolbox-operational-status" role="status" aria-live="polite" aria-atomic="true"[^>]*hidden/);
  assert.equal((overlay.match(/aria-live=/g) || []).length, 1);
  assert.match(overlay, /const STATUS_VISIBLE_MS = 9_000/);
  assert.match(overlay, /liveRegion\.hidden = false/);
  assert.match(overlay, /statusHideTimer = window\.setTimeout/);
  assert.match(overlay, /liveRegion\.hidden = true/);
  assert.match(overlay, /<h1 data-insta-toolbox-role="view-title">Insta Toolbox<\/h1>/);
  assert.match(overlay, /class="insta-toolbox-launcher-mark" aria-hidden="true">IT<\/span>/);
  assert.match(overlay, /class="insta-toolbox-credit"/);
  assert.match(overlay, /href="https:\/\/github\.com\/slaveofsolace" target="_blank" rel="noopener noreferrer">created by @slaveofsolace<\/a>/);
  assert.doesNotMatch(overlay, /data-insta-toolbox-role="view-context"/);
  assert.doesNotMatch(overlay, /data-insta-toolbox-role="view-subtitle"/);
  assert.doesNotMatch(overlay, />Local only</);
  assert.match(overlay, /data-insta-toolbox-preference="opacity"/);
  assert.match(overlay, /data-insta-toolbox-preference="accent"/);
  assert.match(overlay, /data-insta-toolbox-preference="blur"/);
  assert.match(overlay, /data-insta-toolbox-preference="launcherSize"/);
  assert.match(overlay, /data-insta-toolbox-role="settings-dialog"/);
  assert.match(overlay, /Customize Insta Toolbox/);
  assert.match(overlay, /insta-toolbox-settings-dialog::backdrop/);
  assert.match(overlay, /event\.target === event\.currentTarget\) setSettingsOpen\(false\)/);
  assert.match(overlay, /\.insta-toolbox-range \{[^}]*accent-color: var\(--insta-toolbox-signal\)/);
  assert.match(overlay, /\.insta-toolbox-state-row\[data-tone="good"\] \.insta-toolbox-state-dot \{ background: var\(--insta-toolbox-good\)/);
  assert.match(overlay, /\.insta-toolbox-tool-card em \{ color: var\(--insta-toolbox-muted\)/);
  assert.match(overlay, /Mutual Checker/);
  assert.match(overlay, /Follow \/ Unfollow/);
  assert.match(overlay, /DM Unsend/);
  assert.match(overlay, /openShadow: globalThis\.__instaToolboxOverlayTestOpenShadow === true/);
  assert.match(overlay, /attachShadow\(\{ mode: openShadow \? 'open' : 'closed' \}\)/);
});

test('sidecar guides list capture, reviews account targets, and keeps one DM primary action', () => {
  assert.match(overlay, /data-insta-toolbox-role="checker-username"/);
  assert.match(overlay, /data-insta-toolbox-action="check-account-relationships"/);
  assert.match(overlay, /Check Followers \+ Following/);
  assert.match(overlay, /data-list-type="following"/);
  assert.match(overlay, /data-list-type="followers"/);
  assert.match(overlay, /data-insta-toolbox-role="compare-step-badge"/);
  assert.match(overlay, /comparisonComplete \? `Mutual comparison complete/);
  assert.match(overlay, /data-insta-toolbox-action="bot-review"/);
  assert.match(overlay, /function botPlan\(runtime\)/);
  assert.match(overlay, /reviewed\.signature !== current\.signature/);
  assert.match(overlay, /data-insta-toolbox-role="bot-review-list"/);
  assert.match(overlay, /class="insta-toolbox-primary-action" data-insta-toolbox-role="unsend-disclosure"/);
  assert.match(overlay, /data-insta-toolbox-action="mass-unsend">Unsend DMs/);
  assert.match(overlay, /data-insta-toolbox-action="scan-sent-dms">Check conversation/);
  assert.match(overlay, /data-insta-toolbox-role="unsend-plan">/);
  const dmPrimary = overlay.match(/<button[^>]*data-insta-toolbox-action="mass-unsend"[^>]*>/);
  assert.ok(dmPrimary, 'the permanent Unsend DMs button must be in the static shell');
  assert.doesNotMatch(dmPrimary[0], /\sdisabled(?:\s|>|=)/);
  assert.match(overlay, /Capture lists and export/);
  assert.match(overlay, /aria-labelledby="insta-toolbox-bot-composer-title"/);
  assert.match(overlay, /<summary>Advanced message options<\/summary>/);
});

test('sidecar can review only the exact profile already open without an imported queue', () => {
  assert.match(overlay, /<option value="current-profile">Current profile<\/option>/);
  assert.match(overlay, /source === 'current-profile'/);
  assert.match(overlay, /context\.pageKind !== 'profile' \|\| !context\.username/);
  assert.match(overlay, /return \{ pool: \[context\.username\], skipped \}/);
  assert.match(overlay, /const requested = source === 'current-profile'\s+\? 1/);
  assert.match(overlay, /Open one Instagram profile first\. No target was reviewed\./);
});

test('fresh installs open directly on the tools and follower comparisons can be filtered', () => {
  assert.doesNotMatch(overlay, /data-insta-toolbox-role="first-run"/);
  assert.doesNotMatch(overlay, /data-insta-toolbox-action="first-run-start"/);
  assert.doesNotMatch(overlay, /Start with Mutual Checker/);
  assert.match(overlay, /data-insta-toolbox-role="checker-category"/);
  assert.match(overlay, /data-insta-toolbox-role="checker-search"/);
  assert.match(overlay, /filterComparisonResults/);
  assert.match(overlay, /No captured username matches this search/);
});

test('visible DM evidence and its download stay bound to the open conversation', () => {
  assert.match(overlay, /function activeConversationId\(\)/);
  assert.match(overlay, /String\(result\?\.conversationId \|\| ''\) === conversationId/);
  assert.match(overlay, /const fragments = evidenceMatches \? \(result\.fragments \|\| \[\]\) : \[\]/);
  assert.match(overlay, /if \(evidence\) evidence\.hidden = !evidenceMatches \|\| !fragments\.length/);
  assert.match(overlay, /if \(evidenceMatches && fragments\.length\) \{\s+downloads\.update\('messages'/);
  assert.match(overlay, /downloads\.clear\('messages', download\)/);
  assert.match(overlay, /data-insta-toolbox-role="message-evidence" hidden/);
  assert.doesNotMatch(overlay, /No evidence yet|No visible text has been read yet/);
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
  assert.equal((inspector.match(/\.click\s*\(/g) || []).length, 2);
  assert.equal((inspector.match(/activateListNavigationControl\(/g) || []).length, 3);
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
  assert.doesNotMatch(dryRunBody, /insta-toolbox-perform-reviewed-profile-action/);
  assert.match(overlay, /Checks the relationship without clicking/);
});

test('sidecar uses one exact in-overlay finite confirmation without global arm controls', () => {
  assert.doesNotMatch(overlay, /account-live-disclosure|dm-live-disclosure|arm-dm-live|Arm for 90 seconds|ARM UNSEND/);
  assert.doesNotMatch(background, /insta-toolbox-arm-account-action|insta-toolbox-arm-dm-unsend|expectedPhrase/);
  assert.doesNotMatch(overlay, /window\.confirm|globalThis\.confirm/);
  assert.match(overlay, /data-insta-toolbox-role="action-confirmation"/);
  assert.match(overlay, /data-insta-toolbox-action="confirm-cancel"/);
  assert.match(overlay, /data-insta-toolbox-action="confirm-accept"/);
  assert.match(overlay, /function createController\(\{ root, attribute, status, unavailableTone = 'error' \}\)/);
  assert.match(overlay, /cancelButton\.focus\(\)/);
  assert.match(overlay, /current\.resolve\(confirmed === true && !expired \? current\.binding : null\)/);
  assert.match(overlay, /await runtime\.confirmAction\(\{/);
  assert.match(background, /function accountConfirmationMatches\(confirmation, intent\)/);
  assert.match(background, /function dmConfirmationMatches\(confirmation, intent\)/);
  assert.match(background, /consumeTransientCapability\(accountCapabilities/);
  assert.match(background, /consumeTransientCapability\(dmCapabilities/);
  assert.match(controlledPolicy, /ready: true/);
  assert.match(controlledDmPolicy, /ready: true/);
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
  assert.match(overlay, /Bulk runs touch only rows Instagram marks as yours/);
  assert.match(overlay, /Imported jobs also require an exact thread and message match/);
});

test('background reveals only sanitized pairing, intent, confirmation, and run summaries to Instagram', () => {
  const overlayStateBody = background.slice(
    background.indexOf('function overlayState'),
    background.indexOf('function isInstagramSender'),
  );
  assert.match(background, /insta-toolbox-overlay-state/);
  assert.match(background, /instagram-origin-required/);
  assert.match(background, /pendingLiveIntent: publicLiveIntent/);
  assert.match(background, /liveArm: null/);
  assert.match(background, /pendingDmIntent: publicDmIntent/);
  assert.match(background, /dmArm: null/);
  assert.match(background, /exactConfirmationRequired: true/);
  assert.match(background, /liveExecutionEnabled: false/);
  assert.doesNotMatch(overlayStateBody, /secret|signature|nonce/i);
});

test('runtime fixture exercises the actual production scripts', () => {
  assert.match(fixture, /\/extension\/content-instagram\.js/);
  assert.match(fixture, /\/extension\/overlay\/shared\.js/);
  assert.match(fixture, /\/extension\/overlay\/views\/messages\.js/);
  assert.match(fixture, /\/extension\/instagram-overlay\.js/);
  assert.match(fixture, /instaToolboxOverlayManualQueueV1/);
  assert.match(fixture, /resolved-no-click/);
  assert.match(fixture, /fixtureSearch\.get\('shadow'\) !== 'closed'/);
  assert.match(fixture, /messages-exact/);
  assert.match(fixture, /data-pagelet="IGDMessagesList"/);
  assert.match(fixture, /data-message-id="sent-1"/);
});

test('popup identifies itself as setup while directing work to the Instagram sidecar', () => {
  assert.match(popupHtml, /The toolbox lives on Instagram/);
  assert.match(popupHtml, /Pair exact workspace origin/);
  assert.match(popupCss, /#d8ff45/);
  assert.doesNotMatch(popupCss, /Inter,/);
});

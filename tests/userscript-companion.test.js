import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(
  new URL('../userscripts/insta-toolbox.user.js', import.meta.url),
  'utf8',
);
const shell = await readFile(
  new URL('../userscripts/src/toolbox-shell.js', import.meta.url),
  'utf8',
);
const engine = await readFile(
  new URL('../extension/content-instagram.js', import.meta.url),
  'utf8',
);
const confirmation = await readFile(
  new URL('../extension/action-confirmation.js', import.meta.url),
  'utf8',
);

test('the userscript carries the metadata Tampermonkey needs to install and auto-update from GitHub', () => {
  const stableUrl = 'https://github.com/slaveofsolace/Insta-Toolbox/releases/latest/download/insta-toolbox.user.js';
  assert.match(source, /^\/\/ ==UserScript==/);
  assert.ok(source.includes(`// @downloadURL  ${stableUrl}`), 'the release asset drives one-click install');
  assert.ok(source.includes(`// @updateURL    ${stableUrl}`), 'the release asset drives auto-update');
  assert.match(source, /@homepageURL\s+https:\/\/github\.com\/slaveofsolace\/Insta-Toolbox/);
  assert.match(source, /@supportURL\s+https:\/\/github\.com\/slaveofsolace\/Insta-Toolbox\/issues/);
  assert.match(source, /@license\s+MIT/);
  assert.doesNotMatch(source, /raw\.githubusercontent\.com\/[^\s]*\/(?!main\/)(?:refs\/)?heads/);
  const metadataBlock = source.slice(0, source.indexOf('==/UserScript=='));
  assert.match(metadataBlock, /@icon\s+data:image\/svg\+xml,/);
  assert.doesNotMatch(metadataBlock, /@icon\s+https?:/);
  assert.doesNotMatch(metadataBlock, /@require|@resource/);
  assert.match(metadataBlock, /@sandbox\s+DOM/);
  assert.match(metadataBlock, /@grant\s+GM_getTab/);
  assert.match(metadataBlock, /@grant\s+GM_saveTab/);
});

test('the bundle ships the extension engine itself rather than a second copy of it', () => {
  // The point of the build step: one audited DOM engine, two shells around it.
  assert.ok(source.includes(engine.trim()), 'the engine is embedded verbatim');
  assert.match(source, /Generated file\. Do not edit\./);
  assert.match(source, /pnpm run build:userscript/);
  // The shell must not reimplement the live paths.
  assert.doesNotMatch(shell, /function performReviewedDmUnsend|function performReviewedProfileAction/);
  assert.match(shell, /const engine = globalThis\.InstaToolboxInstagramInspector;/);
});

test('live Follow, Unfollow, and Unsend are available and go through the engine', () => {
  assert.match(shell, /engine\.performReviewedProfileAction\(/);
  assert.doesNotMatch(shell, /engine\.performReviewedDmUnsend\(/);
  assert.match(source, /InstaToolboxDmThreadUnsender/);
  assert.match(source, /await dmRunner\.start\(\{/);
  assert.match(shell, /engine\.collectAccountList\(/);
  assert.match(shell, /dmRunner\.inspectAll\(\)/);
  assert.match(source, /data-action="review-accounts"/);
  assert.match(shell, /button\.dataset\.action = 'run-accounts'/);
  assert.match(shell, /accountRunDraft\.signature !== current\.signature/);
  assert.match(source, /data-action="run-unsend"/);
  // Scanning is now a guided two-step sequence; the underlying handler is
  // still what both steps and the context prompt call.
  assert.match(source, /data-action="scan-following"/);
  assert.match(source, /data-action="scan-followers"/);
  assert.match(shell, /'scan-list':/);
  assert.match(source, /data-action="scan-sent"/);
  // The old read-only refusals must be gone.
  assert.doesNotMatch(source, /intentionally unavailable in userscript mode/);
});

test('the userscript can review the current exact profile as a one-item run', () => {
  assert.match(source, /<option value="current-profile">Current profile<\/option>/);
  assert.match(shell, /const source = query\('\[data-role="bot-source"\]'\)\?\.value \|\| 'current-profile'/);
  assert.match(shell, /const count = source === 'current-profile' \? 1 : requestedCount/);
  assert.match(shell, /engine\.normalizeUsername\?\.\(location\.pathname\)/);
});

test('each mutation uses one exact transient capability without a global unlock', () => {
  assert.match(source, /<h1>Insta Toolbox<\/h1>/);
  assert.match(source, /created by @slaveofsolace/);
  assert.doesNotMatch(source, /Userscript mode · local controls/);
  assert.doesNotMatch(source, /data-role="live-actions"|live actions locked/);
  assert.match(shell, /RUN_CAPABILITY_MS = 20 \* 60 \* 1_000/);
  assert.match(shell, /DM_PLAN_CAPABILITY_MS = 15 \* 60 \* 1_000/);
  assert.doesNotMatch(shell, /ENABLE LIVE ACTIONS|LIVE_AUTHORIZATION_PHRASE|setLiveActionsUnlocked|InstaToolboxUserscriptLiveAuthority/);
  assert.match(shell, /function accountCapabilityDigest\(action, usernames\)/);
  assert.match(shell, /capabilityExpiresAt: Date\.now\(\) \+ RUN_CAPABILITY_MS/);
  assert.match(shell, /approvedTargets: \[\.\.\.queue\]/);
  assert.match(shell, /const confirmation = await confirmRun\(\{/);
  assert.match(source, /data-role="action-confirmation"/);
  assert.match(source, /data-action="confirm-cancel"/);
  assert.match(source, /data-action="confirm-accept"/);
  assert.doesNotMatch(source, /globalThis\.confirm|window\.confirm/);
  assert.match(confirmation, /cancelButton\.focus\(\)/);
  assert.match(confirmation, /current\.binding/);
  assert.match(shell, /normalizeResumableAccountRun\(tabState\?\.\[TAB_RUN_FIELD\]\)/);
  assert.match(shell, /GM_setValue\(STATE_KEY, \{ \.\.\.state, run: null \}\)/);
  assert.match(shell, /if \(!runCapabilityValid\(run\)\)/);
  assert.match(shell, /This run expired\. No further Instagram action was made/);
  assert.match(source, /const PLAN_VERSION = 2/);
  assert.match(source, /plan\.limit === null \? MAX_PLAN_MESSAGES : plan\.limit/);
  assert.doesNotMatch(source, /currentEligibleCount !== plan\.eligibleCount/);
  assert.doesNotMatch(shell, /live actions enabled|global unlock/i);
});

test('every live action still has to clear the exact-target checks first', () => {
  // A run must resolve its target immediately before acting and pass the token
  // that resolution minted. Without this a batch could act on whatever happens
  // to be on screen when its turn arrives.
  assert.match(shell, /const observation = engine\.inspectProfile\(username\);/);
  assert.match(shell, /resolutionToken: observation\.resolutionToken/);
  assert.match(shell, /observation\?\.relationship !== expected/);
  assert.match(shell, /observation\?\.username !== username/);

  assert.match(engine, /function inspectReviewedDmItem\(item\)/);
  assert.match(engine, /dmContentDigest\(content\) === item\?\.contentDigest/);
  assert.match(engine, /sentByMe !== true/);
  assert.match(engine, /exactIdentityAvailable/);
  assert.match(engine, /ownershipAvailable/);
});

test('a run stops itself on any Instagram interruption and can be aborted', () => {
  assert.match(shell, /function sessionStop\(observation\)/);
  assert.match(shell, /observation\?\.rateLimited/);
  assert.match(shell, /observation\?\.challenge/);
  assert.match(shell, /observation\?\.actionBlocked/);
  assert.match(shell, /observation\?\.sessionExpired/);
  assert.match(shell, /if \(outcome\.fatal\)/);
  assert.match(source, /while \(!signal\.aborted && processed < maxMessages/);
  assert.match(source, /activeController\.abort\('Stopped by user'\)/);
  assert.match(source, /data-action="stop-run"/);
});

test('account and DM runs stay bounded and paced without arbitrary daily quotas', () => {
  assert.doesNotMatch(shell, /data-role="limit-daily/);
  assert.doesNotMatch(shell, /remaining account actions|remaining Unsends|Daily limit reached/);
  assert.match(shell, /minDelayMs: \[1_000, 600_000\]/);
  assert.match(shell, /REST_EVERY = 20/);
  assert.match(shell, /Math\.random\(\)/);
  assert.match(source, /const maxMessages = plan\.limit/);
  assert.match(source, /randomDelay\(options\.minDelayMs, options\.maxDelayMs\)/);
  assert.match(source, /Permanently unsend \$\{scopeLabel\}/);
  assert.match(shell, /function reserveUnsendPlan\(plan\)/);
  assert.match(shell, /const reservation = reserveUnsendPlan\(plan\)/);
  assert.match(shell, /activeUnsendCapability = \{/);
  assert.match(shell, /minDelayMs: 1_000/);
  assert.match(shell, /maxDelayMs: 2_000/);
  assert.doesNotMatch(shell, /ledger\.day === today\(\)/);
  assert.match(shell, /function recordAction\(kind\)/);
});

test('the userscript records each verified Unsend once and never double-counts finalization', () => {
  const recordBody = shell.slice(
    shell.indexOf('function recordVerifiedUnsend'),
    shell.indexOf('function finalizeUnsendOutcome'),
  );
  assert.match(shell, /recordedProcessed: 0/);
  assert.match(recordBody, /const increment = Math\.max\(0, removed - recorded\)/);
  assert.match(recordBody, /current\.unsends = Number\(current\.unsends \|\| 0\) \+ increment/);
  assert.match(recordBody, /activeUnsendCapability\.recordedProcessed = removed/);
  assert.match(recordBody, /saveState\(\)/, 'each verified callback persists immediately');
  assert.match(shell, /onVerifiedRemoval: \(progress\) => recordVerifiedUnsend/);
  assert.match(shell, /finalizeUnsendOutcome\(plan, outcome\)/);
  assert.match(source, /onVerifiedRemoval: \(progress\) => recordVerifiedUnsend/);
});

test('an account run moves between profiles and survives the navigation it causes', () => {
  // Navigating tears the userscript down, so without a persisted queue a
  // multi-account run would only ever act on the profile already open.
  assert.match(shell, /function resumableAccountRun\(\)/);
  assert.match(shell, /async function continueAccountRun\(\)/);
  assert.match(shell, /location\.href = `https:\/\/www\.instagram\.com\/\$\{encodeURIComponent\(username\)\}\/`;/);
  assert.match(shell, /const onTarget = engine\.normalizeUsername\(location\.pathname\) === username;/);
  assert.match(shell, /const managerTabStorageAvailable = managerTab !== null/);
  assert.match(shell, /GM_saveTab\(managerTab\)/);
  // Resuming must never inherit trust: the target is re-resolved on arrival.
  assert.match(shell, /Resuming run: \$\{pending\} account/);
  assert.match(shell, /resuming never inherits trust from the previous page/);
  // Stopping has to clear the queue, or the next page load would carry on.
  assert.match(shell, /status: 'aborted', stopReason: 'stopped by you', nextAt: null, current: '', queue: \[\]/);
});

test('a DM run is dropped on reload while an account run is kept', () => {
  assert.match(shell, /value\.kind !== 'account' \|\| value\.status !== 'running'/);
  assert.match(shell, /run: normalizeResumableAccountRun\(tabState\?\.\[TAB_RUN_FIELD\]\)/);
  assert.match(shell, /else delete managerTab\[TAB_RUN_FIELD\]/);
  assert.match(shell, /the thread it was working in is gone/);
});

test('DM evidence and saved Unsend candidates stay bound to the active conversation', () => {
  assert.match(engine, /function currentDirectThreadId\(\)/);
  assert.match(engine, /conversationId: ''/);
  assert.match(shell, /function sentMessagesForThread\(messages, threadId = currentDirectThreadId\(\)\)/);
  assert.match(shell, /state\.messageEvidence\?\.threadId === activeThreadId/);
  assert.match(shell, /state\.dmCheck\?\.threadId === activeThreadId/);
  assert.match(shell, /dmThreadPreview\.threadId === currentDirectThreadId\(\)/);
  assert.match(shell, /dmThreadPreview = outcome\?\.ready \? outcome : null/);
  assert.match(shell, /sent messages found/);
  assert.match(source, /if \(!expectedThreadId \|\| context\.threadId !== expectedThreadId\)/);
  assert.doesNotMatch(source, /currentEligibleCount !== plan\.eligibleCount/);
  assert.match(shell, /if \(currentHref !== lastLocationHref\)/);
  assert.match(shell, /lastLocationHref = currentHref;\s+confirmationController\?\.cancel\(\);\s+contextStatus = null;\s+dmThreadPreview = null;\s+state\.messageEvidence = null;/);
  assert.match(shell, /state\.dmCheck = null;\s+state\.sentDms = \[\];/);
  // Clearing must persist and re-render. Additional fields may be reset in the
  // same block, so match the intent rather than an exact three-line sequence.
  assert.match(shell, /state\.sentDmsComplete = false;[\s\S]{0,160}?saveState\(\);\s+renderAll\(\);/);
  assert.match(shell, /state\.sentDmsChecked = false;/);
});

test('the Mutual Checker remembers whether a scan actually finished', () => {
  // A partial scan that forgets it was partial would silently under-report.
  assert.match(shell, /const requiresCountReconciledRescan = Number\(value\.schemaVersion\) < 4/);
  assert.match(shell, /complete: \{ followers: false, following: false \}/);
  assert.match(shell, /verified: \{ followers: false, following: false \}/);
  assert.match(shell, /value\.capture\?\.verified\?\.followers === true[\s\S]{0,100}?value\.capture\?\.complete\?\.followers === true/);
  assert.match(shell, /value\.capture\?\.verified\?\.following === true[\s\S]{0,100}?value\.capture\?\.complete\?\.following === true/);
});

test('the toolbox has no credential access or third-party connector and keeps follower reads Instagram-only', () => {
  assert.doesNotMatch(source, /GM_xmlhttpRequest|new\s+XMLHttpRequest|XMLHttpRequest\s*\(|document\.cookie/);
  assert.doesNotMatch(source, /fetch\s*\(/);
  assert.match(source, /const INSTAGRAM_WEB_ORIGIN = 'https:\/\/www\.instagram\.com'/);
  assert.match(source, /\/api\/v1\/web\/search\/topsearch\//);
  assert.match(source, /\/api\/v1\/friendships\/\$\{userId\}\/\$\{listType\}\//);
  assert.match(source, /credentials: 'include'/);
  const metadataBlock = source.slice(0, source.indexOf('==/UserScript=='));
  assert.doesNotMatch(metadataBlock, /@connect/);
});

test('the toolbox still yields when the extension panel is installed', () => {
  assert.match(shell, /document\.getElementById\(EXTENSION_ROOT_ID\)/);
  assert.match(shell, /duplicateObserver\.disconnect\(\)/);
  assert.match(shell, /host\.remove\(\)/);
});

test('the userscript tablist exposes one selected tab and explicit panel relationships', () => {
  assert.doesNotMatch(shell, /aria-selected="true"\s+aria-selected="false"/);
  assert.match(shell, /id="insta-toolbox-tab-checker"[^>]*aria-controls="insta-toolbox-panel-checker"[^>]*aria-selected="true"[^>]*tabindex="0"/);
  assert.match(shell, /id="insta-toolbox-tab-account"[^>]*aria-controls="insta-toolbox-panel-account"[^>]*aria-selected="false"[^>]*tabindex="-1"/);
  assert.match(shell, /id="insta-toolbox-tab-messages"[^>]*aria-controls="insta-toolbox-panel-messages"[^>]*aria-selected="false"[^>]*tabindex="-1"/);
  assert.match(shell, /id="insta-toolbox-panel-checker"[^>]*aria-labelledby="insta-toolbox-tab-checker"/);
  assert.match(shell, /id="insta-toolbox-panel-account"[^>]*aria-labelledby="insta-toolbox-tab-account"/);
  assert.match(shell, /id="insta-toolbox-panel-messages"[^>]*aria-labelledby="insta-toolbox-tab-messages"/);
});

test('userscript tab focus stays inside the tab strip without drawing a clipped box', () => {
  assert.match(shell, /\.tab:focus-visible\s*\{[^}]*outline:\s*0;[^}]*box-shadow:\s*inset 0 -3px 0 var\(--insta-toolbox-focus/);
  assert.match(shell, /@media \(forced-colors: active\)[\s\S]{0,500}?\.tab:focus-visible\s*\{[^}]*outline:\s*2px solid Highlight;[^}]*outline-offset:\s*-3px;[^}]*box-shadow:\s*none;/);
});

test('the movable panel and local follower comparison are preserved', () => {
  assert.match(source, /Insta Toolbox/);
  assert.match(source, /Mutual Checker/);
  assert.match(source, /Follow \/ Unfollow/);
  assert.match(source, /DM Unsend/);
  assert.match(source, /data-role="move"/);
  assert.match(source, /data-role="resize-start"/);
  assert.match(source, /data-role="resize-end"/);
  assert.match(source, /Open Insta Toolbox; drag or use arrow keys to move/);
  assert.match(source, /data-preference="opacity"/);
  assert.match(source, /id="insta-toolbox-opacity" type="range" min="55"/);
  assert.match(shell, /event\.altKey.*event\.shiftKey.*event\.key\.toLowerCase\(\) !== 'i'/);
  assert.match(shell, /savePreferences\(\{ open: !preferences\.open \}\)/);
  assert.match(source, /instaToolboxManualQueueV1/);
  assert.match(shell, /function compareCapture\(\{ allowPartial = false \} = \{\}\)/);
  assert.match(shell, /notFollowingMeBack/);
  assert.match(shell, /iDoNotFollowBack/);
});

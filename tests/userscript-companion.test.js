import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(
  new URL('../userscripts/insta-aio-companion.user.js', import.meta.url),
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

test('the userscript carries the metadata Tampermonkey needs to install and auto-update from GitHub', () => {
  const rawUrl = 'https://raw.githubusercontent.com/slaveofsolace/Insta-AIO-Tool/main/userscripts/insta-aio-companion.user.js';
  assert.match(source, /^\/\/ ==UserScript==/);
  assert.ok(source.includes(`// @downloadURL  ${rawUrl}`), 'a raw @downloadURL drives one-click install');
  assert.ok(source.includes(`// @updateURL    ${rawUrl}`), 'a raw @updateURL drives auto-update');
  assert.match(source, /@homepageURL\s+https:\/\/github\.com\/slaveofsolace\/Insta-AIO-Tool/);
  assert.match(source, /@supportURL\s+https:\/\/github\.com\/slaveofsolace\/Insta-AIO-Tool\/issues/);
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
  assert.match(shell, /const engine = globalThis\.InstaAioInstagramInspector;/);
});

test('live Follow, Unfollow, and Unsend are available and go through the engine', () => {
  assert.match(shell, /engine\.performReviewedProfileAction\(/);
  assert.doesNotMatch(shell, /engine\.performReviewedDmUnsend\(/);
  assert.match(source, /InstaAioDmThreadUnsender/);
  assert.match(source, /await runner\.start\(\{/);
  assert.match(shell, /engine\.collectAccountList\(/);
  assert.match(shell, /engine\.enumerateSentDms\(/);
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
  assert.match(source, /<option value="current-profile">Current exact profile<\/option>/);
  assert.match(shell, /const source = query\('\[data-role="bot-source"\]'\)\?\.value \|\| 'current-profile'/);
  assert.match(shell, /const count = source === 'current-profile' \? 1 : requestedCount/);
  assert.match(shell, /engine\.normalizeUsername\?\.\(location\.pathname\)/);
});

test('live mutation controls are locked by default and authorization expires during a run', () => {
  assert.match(source, /Userscript mode · live actions locked/);
  assert.match(source, /data-role="live-actions"/);
  assert.match(source, /data-live-action/);
  assert.match(shell, /LIVE_AUTHORIZATION_MS = 15 \* 60 \* 1_000/);
  assert.match(shell, /LIVE_AUTHORIZATION_PHRASE = 'ENABLE LIVE ACTIONS'/);
  assert.match(shell, /let liveActionsUnlockedUntil = 0/);
  assert.match(shell, /function requireNewRunAuthorization\(\)/);
  assert.match(shell, /authorizationExpiresAt: liveActionsUnlockedUntil/);
  assert.match(shell, /normalizeResumableAccountRun\(tabState\?\.\[TAB_RUN_FIELD\]\)/);
  assert.match(shell, /GM_setValue\(STATE_KEY, \{ \.\.\.state, run: null \}\)/);
  assert.match(shell, /if \(!runAuthorizationValid\(run\)\)/);
  assert.match(shell, /The run stopped before another Instagram action/);
  assert.match(shell, /InstaAioUserscriptLiveAuthority/);
  assert.match(source, /A fresh, count-specific reviewed plan is required before Unsend can start/);
  assert.match(source, /currentEligibleCount !== plan\.eligibleCount/);
  assert.doesNotMatch(shell, /live actions enabled/);
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

test('account runs use daily pacing while DM plans remain finite and paced', () => {
  assert.match(shell, /dailyActions: \[1, 400\]/);
  assert.match(shell, /dailyUnsends: \[1, 300\]/);
  assert.match(shell, /minDelayMs: \[1_500, 600_000\]/);
  assert.match(shell, /REST_EVERY = 20/);
  assert.match(shell, /Math\.random\(\)/);
  assert.match(shell, /const allowance = Math\.max\(0, bounds\.dailyActions - usedToday\('actions'\)\)/);
  assert.match(source, /const maxMessages = plan\.limit/);
  assert.match(source, /randomDelay\(options\.minDelayMs, options\.maxDelayMs\)/);
  assert.match(source, /Permanently unsend \$\{scopeLabel\}/);
  assert.match(shell, /function reserveUnsendPlan\(plan\)/);
  assert.match(shell, /bounds\.dailyUnsends - Number\(current\.unsends \|\| 0\)/);
  assert.match(source, /liveAuthority\.reserveUnsendPlan\?\.\(plan\)/);
  // The allowance is spent against today's ledger, so a resumed run cannot
  // reset its own budget by reloading.
  assert.match(shell, /function usedToday\(kind\)/);
  assert.match(shell, /ledger\.day === today\(\)/);
  assert.match(shell, /function recordAction\(kind\)/);
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
  assert.match(shell, /directThreadId\(outcome\?\.conversationId\) === activeThreadId/);
  assert.match(shell, /state\.sentDmsComplete = scanMatchesThread && outcome\?\.complete === true/);
  assert.match(source, /if \(!expectedThreadId \|\| context\.threadId !== expectedThreadId\)/);
  assert.match(source, /currentEligibleCount !== plan\.eligibleCount/);
  assert.match(shell, /if \(currentHref !== lastLocationHref\)/);
  assert.match(shell, /lastLocationHref = currentHref;\s+state\.messageEvidence = null;/);
  assert.match(shell, /state\.dmCheck = null;\s+state\.sentDms = \[\];/);
  // Clearing must persist and re-render. Additional fields may be reset in the
  // same block, so match the intent rather than an exact three-line sequence.
  assert.match(shell, /state\.sentDmsComplete = false;[\s\S]{0,160}?saveState\(\);\s+renderAll\(\);/);
  assert.match(shell, /state\.sentDmsChecked = false;/);
});

test('the follower checker remembers whether a scan actually finished', () => {
  // A partial scan that forgets it was partial would silently under-report.
  assert.match(shell, /complete: \{ followers: false, following: false \}/);
  assert.match(shell, /verified: \{ followers: false, following: false \}/);
  assert.match(shell, /value\.capture\?\.verified\?\.followers === true[\s\S]{0,100}?value\.capture\?\.complete\?\.followers === true/);
  assert.match(shell, /value\.capture\?\.verified\?\.following === true[\s\S]{0,100}?value\.capture\?\.complete\?\.following === true/);
});

test('the toolbox keeps every byte local and never calls out', () => {
  assert.doesNotMatch(source, /GM_xmlhttpRequest|XMLHttpRequest|document\.cookie/);
  assert.doesNotMatch(source, /fetch\s*\(/);
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
  assert.match(shell, /id="aio-tab-checker"[^>]*aria-controls="aio-panel-checker"[^>]*aria-selected="true"[^>]*tabindex="0"/);
  assert.match(shell, /id="aio-tab-account"[^>]*aria-controls="aio-panel-account"[^>]*aria-selected="false"[^>]*tabindex="-1"/);
  assert.match(shell, /id="aio-tab-messages"[^>]*aria-controls="aio-panel-messages"[^>]*aria-selected="false"[^>]*tabindex="-1"/);
  assert.match(shell, /id="aio-panel-checker"[^>]*aria-labelledby="aio-tab-checker"/);
  assert.match(shell, /id="aio-panel-account"[^>]*aria-labelledby="aio-tab-account"/);
  assert.match(shell, /id="aio-panel-messages"[^>]*aria-labelledby="aio-tab-messages"/);
});

test('the movable panel and local follower comparison are preserved', () => {
  assert.match(source, /Insta AIO Instagram Toolbox/);
  assert.match(source, /Follower checker/);
  assert.match(source, /Follow \/ Unfollow/);
  assert.match(source, /DM Unsend/);
  assert.match(source, /data-role="move"/);
  assert.match(source, /data-role="resize"/);
  assert.match(source, /data-preference="opacity"/);
  assert.match(source, /id="aio-opacity" type="range" min="55"/);
  assert.match(shell, /event\.altKey.*event\.shiftKey.*event\.key\.toLowerCase\(\) !== 'i'/);
  assert.match(shell, /savePreferences\(\{ open: !preferences\.open \}\)/);
  assert.match(source, /instaAioManualQueueV1/);
  assert.match(shell, /function compareCapture\(\)/);
  assert.match(shell, /notFollowingMeBack/);
  assert.match(shell, /iDoNotFollowBack/);
});

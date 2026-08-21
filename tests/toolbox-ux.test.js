import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const shell = await readFile(new URL('../userscripts/src/toolbox-shell.js', import.meta.url), 'utf8');
const labels = await readFile(new URL('../extension/action-labels.js', import.meta.url), 'utf8');
const generated = await readFile(new URL('../userscripts/insta-aio-companion.user.js', import.meta.url), 'utf8');

test('first use explains the tools, local storage, and the read-only boundary', () => {
  assert.match(generated, /data-role="intro"/);
  assert.match(generated, /Follower checker/);
  assert.match(generated, /Follow \/ Unfollow/);
  assert.match(generated, /DM Unsend/);
  assert.match(generated, /Everything stays in this browser/);
  // The distinction a first-time user most needs: checks read, actions change.
  assert.match(generated, /Checks are read-only/);
  assert.match(generated, /stays locked until you unlock it/);
  // It is dismissible and remembered, not shown on every load.
  assert.match(shell, /'intro-done':/);
  assert.match(shell, /introDone: value\.introDone === true/);
  assert.match(
    shell,
    /'intro-done': \(\) => \{[\s\S]*?savePreferences\(\{ view: 'checker' \}\);[\s\S]*?query\('\[data-view="checker"\]'\)\?\.focus\(\);/,
    'the button labelled Start with the checker must actually select the checker',
  );
});

test('the panel names the current Instagram context for every handled state', () => {
  for (const state of [
    'Signed out',
    'security check',
    'Action blocked',
    'Rate limited',
    'Conversation open',
    'Inbox open',
    'Nothing to work on here',
  ]) {
    assert.ok(shell.includes(state), `context state missing: ${state}`);
  }
  assert.match(shell, /listType: 'followers', label: 'Followers'/);
  assert.match(shell, /listType: 'following', label: 'Following'/);
  assert.match(shell, /action: `scan-\$\{followerList\.listType\}`/);
  assert.match(shell, /new MutationObserver\(\(records\) => \{[\s\S]*?renderContext\(\);/);
  // Blocked states must not offer an action that cannot work.
  assert.match(shell, /tone: 'blocked'/);
  assert.match(shell, /const show = Boolean\(context\.cta\) && state\.run\?\.status !== 'running'/);
});

test('the checker is a sequence that reports completeness per list', () => {
  assert.match(shell, /function scanState\(listType\)/);
  assert.match(shell, /state\.capture\.verified\?\.\[listType\] !== true\) return 'partial'/);
  assert.match(shell, /state\.capture\.complete\?\.\[listType\] === true \? 'done' : 'partial'/);
  assert.match(generated, /data-step="following"/);
  assert.match(generated, /data-step="followers"/);
  assert.match(generated, /data-step="compare"/);
  // A partial scan must say so on the step and on the comparison.
  assert.match(shell, /did not reach the end/);
  assert.match(shell, /\(partial\)/);
  assert.match(shell, /Scanned \$\{found\} \$\{listType\} — incomplete\./);
  assert.match(shell, /outcome\?\.reason === 'list-count-mismatch'/);
  assert.match(shell, /Instagram reports \$\{outcome\.expectedCount\}, so this capture stays incomplete/);
});

test('legacy checker rows are quarantined until an exact list dialog is rescanned', () => {
  assert.match(shell, /const requiresCountReconciledRescan = Number\(value\.schemaVersion\) < 4/);
  assert.match(shell, /schemaVersion: 4/);
  assert.match(shell, /verified: \{ followers: false, following: false \}/);
  assert.match(shell, /'scanned-followers': \(\) => names\(verifiedCapture\('followers'\)\)/);
  assert.match(shell, /'scanned-following': \(\) => names\(verifiedCapture\('following'\)\)/);
  assert.match(shell, /cannot drive comparisons or runs until rescanned/);
  assert.match(shell, /if \(observedTypes\.size !== 1\) continue/);
  assert.equal(
    shell.match(/new Map\(verifiedCapture\(listType\)\.map\(/g)?.length,
    2,
    'both full and visible rescans must replace quarantined rows instead of promoting them',
  );
});

test('the checker scan controls name the exact list they operate on', () => {
  const following = generated.match(/<button[^>]*data-action="scan-following"[^>]*>([^<]+)<\/button>/);
  const followers = generated.match(/<button[^>]*data-action="scan-followers"[^>]*>([^<]+)<\/button>/);
  assert.equal(following?.[1], 'Scan Following');
  assert.equal(followers?.[1], 'Scan Followers');
  assert.notEqual(following?.[1], followers?.[1]);
  assert.match(shell, /button\.textContent = `\$\{status === 'todo' \? 'Scan' : 'Rescan'\} \$\{listLabel\}`/);
});

test('the userscript migrates the old opaque default while preserving explicit choices', () => {
  assert.match(shell, /schemaVersion: 2,[\s\S]*?opacity: 0\.88/);
  assert.match(shell, /source\.schemaVersion === 1 && Number\(source\.opacity\) === 0\.94/);
  assert.match(shell, /clamp\(opacity \?\? 0\.88, 0\.55, 1\)/);
  assert.match(generated, /<input[^>]*value="88"[^>]*data-preference="opacity"/);
});

test('the settings popover uses the resized layout viewport on every desktop', () => {
  assert.match(shell, /\.settings-panel \{[^}]*max-height: var\(--aio-settings-max-height\)/);
  assert.match(shell, /const renderedPanelHeight = innerWidth <= 600/);
  assert.match(shell, /Math\.min\(size\.height, Math\.max\(0, innerHeight - 74\)\)/);
  assert.match(shell, /host\.style\.setProperty\('--aio-settings-max-height', `\$\{settingsMaxHeight\}px`\)/);
  assert.doesNotMatch(shell, /\.settings-panel \{[^}]*max-height:[^;}]*dvh/);
});

test('the context strip keeps explicit readable text in dark Instagram themes', () => {
  assert.match(shell, /\.context \{[^}]*background: var\(--aio-bg-sunken[^}]*color: var\(--aio-text/);
  assert.match(shell, /\.context-copy strong \{[^}]*color: currentColor[^}]*!important/);
});

test('a partial scan is never presented as a complete comparison', () => {
  // The compare step only reads "done" when both scans reached the end.
  assert.match(
    shell,
    /const complete = scanState\('following'\) === 'done' && scanState\('followers'\) === 'done';/,
  );
  assert.match(shell, /compareStep\.dataset\.state = both \? \(complete \? 'done' : 'partial'\) : 'todo'/);
});

test('a run shows its targets and skip reasons before it starts', () => {
  assert.match(shell, /function renderRunReview\(items, \{ omitted = 0, removed = 0 \} = \{\}\)/);
  assert.match(generated, /data-role="run-review"/);
  assert.match(shell, /function reviewAccountRun\(\)/);
  assert.match(shell, /renderRunReview\(plan\.items, plan\)/);
  assert.match(shell, /data-action="review-accounts"/);
  assert.match(shell, /duplicate or already-followed/);
  // Review is read-only. The action-specific confirmation happens before the
  // run opens its temporary live window.
  const runBody = shell.slice(shell.indexOf("'run-accounts': async"), shell.indexOf("'run-unsend': ()"));
  assert.ok(runBody.indexOf('accountRunDraft.signature !== current.signature') < runBody.indexOf('confirmRun('));
  assert.ok(runBody.indexOf('confirmRun(') < runBody.indexOf('startAccountRun('));
  const startBody = shell.slice(shell.indexOf('async function startAccountRun'), shell.indexOf('function confirmRun'));
  assert.ok(startBody.indexOf('requireNewRunAuthorization()') < startBody.indexOf("status: 'running'"));
});

test('the open exact profile is the direct bounded Follow or Unfollow source', () => {
  assert.match(generated, /<option value="current-profile">Current exact profile<\/option>/);
  assert.match(shell, /const source = query\('\[data-role="bot-source"\]'\)\?\.value \|\| 'current-profile'/);
  assert.match(shell, /const count = source === 'current-profile' \? 1 : requestedCount/);
  assert.match(shell, /'current-profile': \(\) => \{/);
  assert.match(shell, /source !== 'current-profile' && action === 'follow'/);
  assert.match(shell, /view: 'account'/);
  assert.match(shell, /Open one Instagram profile first\. No target was reviewed\./);
});

test('read-only conversation resolution precedes the count-specific Unsend plan', () => {
  const checkButton = generated.match(/<button[^>]*class="button primary big"[^>]*data-action="scan-sent"[^>]*>/);
  assert.ok(checkButton, 'the read-only conversation check must be the visible primary action');
  assert.doesNotMatch(checkButton[0], /\shidden(?![-\w])/);
  const plan = generated.match(/<div[^>]*data-role="unsend-plan"[^>]*>/);
  assert.ok(plan, 'the DM action area must always be visible');
  assert.doesNotMatch(plan[0], /\shidden(?![-\w])/);
  assert.match(generated, /data-action="run-unsend"[^>]*disabled[^>]*>Check conversation first/);
  assert.match(labels, /'Unsend messages'/);
  assert.match(labels, /'No sent messages eligible'/);
  assert.match(labels, /reviewedPreview = result\.complete && result\.eligibleCount > 0 \? result : null/);
  assert.match(labels, /if \(planPanel\) planPanel\.hidden = false/);
  assert.match(labels, /const result = await runner\.inspectAll\(\)/);
  assert.match(labels, /runner\.createPlan\(\{/);
  assert.match(labels, /phrase = `UNSEND \$\{limit\} \$\{plan\.reviewedDigest\}`/);
  assert.match(labels, /The eligible count is revalidated before any message menu opens/);
  assert.match(labels, /complete: quietRounds >= 10/);
  assert.match(labels, /if \(!history\.complete \|\| resolvedCount > MAX_PLAN_MESSAGES\)/);
  assert.doesNotMatch(shell, /'unsend-all':/);
  const fallback = shell.slice(shell.indexOf("'run-unsend': ()"), shell.indexOf("'save-limits':"));
  assert.match(fallback, /reviewed DM runner is not ready/);
  assert.doesNotMatch(fallback, /runBatch|performReviewedDmUnsend|\.click\(/);
  // An empty result says nothing was touched rather than implying success.
  assert.match(shell, /so nothing will be touched/);
  // A partial read is never reported as full coverage.
  assert.match(shell, /there may be more further back/);
});

test('temporary live access is one click and never asks for a global phrase', () => {
  assert.doesNotMatch(shell, /ENABLE LIVE ACTIONS|LIVE_AUTHORIZATION_PHRASE/);
  assert.doesNotMatch(shell, /Type .*unlock Follow, Unfollow, and Unsend/);
  assert.match(shell, /function setLiveActionsUnlocked\(enabled\)/);
  assert.match(shell, /setLiveActionsUnlocked\(true\);[\s\S]*?return newLiveRunAuthorized\(\)/);
  assert.match(labels, /!liveAuthority\?\.canStart\?\.\(\) && !liveAuthority\?\.enable\?\.\(\)/);
});

test('the tablist keeps one selected tab and moves with the arrow keys', () => {
  assert.match(shell, /function syncTabs\(active\)/);
  assert.match(shell, /tab\.setAttribute\('aria-selected', String\(selected\)\)/);
  // Roving tabindex: exactly one tab in the tab order at a time.
  assert.match(shell, /tab\.tabIndex = selected \? 0 : -1/);
  assert.match(shell, /ArrowRight: 1, ArrowLeft: -1, Home: 'first', End: 'last'/);
  assert.match(shell, /next\.focus\(\)/);
});

test('motion is tied to state and removed under reduced motion', () => {
  assert.match(shell, /transition: border-color var\(--aio-motion-base/);
  assert.match(shell, /transition: width var\(--aio-motion-base/);
  assert.match(shell, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(shell, /\.intro \{ animation: none; \}/);
  // No ambient motion: nothing loops.
  assert.doesNotMatch(shell, /animation:[^;]*infinite/);
});

test('the panels lead with one action instead of a row of peers', () => {
  // Button clutter was the complaint. Secondary tools moved behind disclosures.
  const toolbars = (generated.match(/<div class="toolbar">/g) || []).length;
  const disclosures = (generated.match(/class="settings-inline"/g) || []).length;
  assert.ok(disclosures >= 3, 'each tool should keep its secondary actions behind a disclosure');
  assert.ok(toolbars < 24, `toolbars grew to ${toolbars}; keep secondary actions disclosed`);
});

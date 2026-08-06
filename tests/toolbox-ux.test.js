import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const shell = await readFile(new URL('../userscripts/src/toolbox-shell.js', import.meta.url), 'utf8');
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
});

test('the panel names the current Instagram context for every handled state', () => {
  for (const state of [
    'Signed out',
    'security check',
    'Action blocked',
    'Rate limited',
    'Conversation open',
    'Inbox open',
    'Follower list open',
    'Nothing to work on here',
  ]) {
    assert.ok(shell.includes(state), `context state missing: ${state}`);
  }
  // Blocked states must not offer an action that cannot work.
  assert.match(shell, /tone: 'blocked'/);
  assert.match(shell, /const show = Boolean\(context\.cta\) && state\.run\?\.status !== 'running'/);
});

test('the checker is a sequence that reports completeness per list', () => {
  assert.match(shell, /function scanState\(listType\)/);
  assert.match(shell, /state\.capture\.complete\?\.\[listType\] === true \? 'done' : 'partial'/);
  assert.match(generated, /data-step="following"/);
  assert.match(generated, /data-step="followers"/);
  assert.match(generated, /data-step="compare"/);
  // A partial scan must say so on the step and on the comparison.
  assert.match(shell, /did not reach the end/);
  assert.match(shell, /\(partial\)/);
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
  assert.match(shell, /function renderRunReview\(items, skipped\)/);
  assert.match(generated, /data-role="run-review"/);
  assert.match(shell, /already followed, or not in the scanned list/);
});

test('the unsend action is always reachable and confirms before removing', () => {
  // Hiding the primary action behind a separate check removed the one-click
  // path without adding any safety: the action reads the conversation itself
  // and asks for confirmation before anything is removed.
  assert.match(shell, /if \(primary\) primary\.hidden = false;/);
  // Match the button tag itself. A looser pattern runs past the markup into
  // unrelated script and reports a false positive.
  const unsendButton = generated.match(/<button[^>]*data-role="unsend-primary"[^>]*>/);
  assert.ok(unsendButton, 'the unsend button must exist in the shipped bundle');
  assert.doesNotMatch(unsendButton[0], /\shidden(?![-\w])/);
  assert.match(shell, /state\.sentDmsChecked = true/);
  assert.match(generated, /data-action="scan-sent"/);
  // An empty result says nothing was touched rather than implying success.
  assert.match(shell, /so nothing will be touched/);
  // A partial read is never reported as full coverage.
  assert.match(shell, /there may be more further back/);
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

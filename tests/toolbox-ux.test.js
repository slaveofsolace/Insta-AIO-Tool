import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const shell = await readFile(new URL('../userscripts/src/toolbox-shell.js', import.meta.url), 'utf8');
const extensionShell = await readFile(new URL('../extension/overlay/shell.js', import.meta.url), 'utf8');
const extensionCapture = await readFile(new URL('../extension/overlay/views/capture.js', import.meta.url), 'utf8');
const labels = await readFile(new URL('../extension/action-labels.js', import.meta.url), 'utf8');
const confirmation = await readFile(new URL('../extension/action-confirmation.js', import.meta.url), 'utf8');
const generated = await readFile(new URL('../userscripts/insta-toolbox.user.js', import.meta.url), 'utf8');
const pwaOverview = await readFile(new URL('../src/app.parts/part-01.jsfrag', import.meta.url), 'utf8');
const pwaTools = await readFile(new URL('../src/app.parts/part-02.jsfrag', import.meta.url), 'utf8');
const pwaSettings = await readFile(new URL('../src/app.parts/part-03.jsfrag', import.meta.url), 'utf8');
const pwaStyles = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8');

function loadSourceFunction(source, name, globals = {}) {
  const match = source.match(new RegExp(`  (?:async )?function ${name}\\([\\s\\S]*?\\n  \\}`));
  assert.ok(match, `${name} must remain available for runtime copy checks`);
  return vm.runInNewContext(`(${match[0].trim()})`, globals);
}

function loadShellFunction(name, globals = {}) {
  return loadSourceFunction(shell, name, globals);
}

test('first use opens directly on the three tools without an onboarding card', () => {
  assert.doesNotMatch(generated, /data-role="intro"/);
  assert.match(generated, /Mutual Checker/);
  assert.match(generated, /Follow \/ Unfollow/);
  assert.match(generated, /DM Unsend/);
  assert.doesNotMatch(generated, /Start with Mutual Checker|Open Mutual Checker/);
  assert.match(shell, /introDone: value\.introDone === true/);
  assert.doesNotMatch(shell, /'intro-done':/);
});

test('the tool body remains the only panel scroll owner', () => {
  assert.doesNotMatch(shell, /\.intro \{/);
  assert.match(shell, /\.scroll \{[^}]*overflow: auto/);
  assert.doesNotMatch(shell, /function renderNow\(|\.tool-grid|\.live-toggle/);
});

test('the PWA Messages page uses a compact inline summary', () => {
  const messagesBody = pwaTools.slice(
    pwaTools.indexOf('function renderMessages()'),
    pwaTools.indexOf('function renderActivity()'),
  );
  assert.match(messagesBody, /class="message-summary" aria-label="Message summary"/);
  assert.doesNotMatch(messagesBody, /class="grid metrics"/);
  assert.match(pwaStyles, /\.message-summary \{[^}]*display: flex;[^}]*flex-wrap: wrap;/s);
  assert.match(messagesBody, /Create unsend plan/);
  assert.doesNotMatch(messagesBody, /Create reviewed Unsend plan|Export reviewed plan/);
});

test('public relationship and settings copy uses plain labels', () => {
  assert.match(pwaTools, /Don't follow you back/);
  assert.match(pwaTools, /You don't follow back/);
  assert.match(pwaOverview, /Build an exact target list before opening Instagram/);
  assert.match(pwaSettings, /Unfollow review delay/);
  assert.match(pwaSettings, /Always-protected accounts/);
  assert.match(pwaSettings, /You don't follow back/);
  assert.match(pwaSettings, /Don't follow you back/);
  assert.doesNotMatch(pwaSettings, /Waiting period before unfollow review|Your sender\/display names|I do not follow back|Not following me back/);
});

test('every userscript operational notice expires without hiding persistent page safety state', () => {
  assert.match(
    shell,
    /contextStatus = text \? \{ message: text, tone: tone \|\| statusTone\(text\) \} : null;[\s\S]*?if \(contextStatus\) \{\s*contextStatusTimer = setTimeout/,
  );
  assert.doesNotMatch(shell, /contextStatus\?\.tone !== 'blocked'/);
  assert.match(shell, /const blockedContext = context\.tone === 'blocked'/);
});

test('PWA state colors reserve green for completed work', () => {
  assert.match(pwaStyles, /\.badge\.completed \{ color: var\(--success\)/);
  assert.match(pwaStyles, /\.badge\.waiting, \.badge\.processing \{ color: var\(--warning\)/);
  assert.doesNotMatch(pwaStyles, /\.badge\.ready[^\n]*var\(--success\)|\.badge\.protected[^\n]*var\(--success\)|\.badge\.pending[^\n]*var\(--info\)/);
  assert.match(pwaStyles, /\.notice \{[^}]*border: 1px solid var\(--border\);[^}]*color: var\(--muted\)/);
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
  assert.match(shell, /Manual capture is optional\./);
  assert.doesNotMatch(shell, /action: `scan-\$\{followerList\.listType\}`/);
  assert.match(shell, /new MutationObserver\(\(records\) => \{[\s\S]*?renderContext\(\);/);
  // Blocked states must not offer an action that cannot work.
  assert.match(shell, /tone: 'blocked'/);
  assert.match(shell, /const show = Boolean\(context\.cta\) && state\.run\?\.status !== 'running'/);
});

test('the checker is a sequence that reports completeness per list', () => {
  assert.match(shell, /function scanState\(listType\)/);
  assert.match(shell, /state\.capture\.verified\?\.\[listType\] !== true\) return count \? 'partial' : 'todo'/);
  assert.match(shell, /state\.capture\.complete\?\.\[listType\] === true \? 'done' : 'partial'/);
  assert.match(generated, /data-step="following"/);
  assert.match(generated, /data-step="followers"/);
  assert.match(generated, /data-step="compare"/);
  // A partial scan must say so on the step and on the comparison.
  assert.match(shell, /accessible accounts found — partial/);
  assert.match(shell, /some accounts may be missing/);
  assert.match(shell, /Comparison withheld to avoid false non-mutuals/);
  assert.match(shell, /Scanned \$\{found\} \$\{listType\} — incomplete\./);
  assert.match(shell, /outcome\?\.reason === 'list-count-mismatch'/);
  assert.match(shell, /Instagram reports \$\{outcome\.expectedCount\}, so this capture stays incomplete/);
});

test('the Mutual Checker uses one traversal and settles final detail', () => {
  const formatCount = (value) => Number(value || 0).toLocaleString('en-US');
  const completedDetail = loadShellFunction('completedRelationshipScanDetail', { formatCount });
  const failedDetail = loadShellFunction('failedRelationshipScanDetail', {
    safeText: (value, fallback = '') => String(value ?? '').trim() || fallback,
  });

  assert.equal(
    completedDetail({
      followers: Array(2_101),
      following: Array(101),
      complete: { followers: true, following: true },
    }),
    'Checked 2,101 followers and 101 following — complete.',
  );
  assert.equal(
    completedDetail({
      followers: Array(2_071),
      following: Array(100),
      complete: { followers: false, following: false },
    }),
    'Checked 2,071 followers and 100 following — partial.',
  );
  assert.equal(
    failedDetail({ code: 'stopped' }),
    'Mutual check stopped. Saved comparison unchanged.',
  );
  assert.equal(
    failedDetail({ message: 'Instagram returned an unreadable page.' }),
    'Mutual check failed: Instagram returned an unreadable page. Saved comparison unchanged.',
  );

  assert.doesNotMatch(shell, /progress\.phase === 'reconciling'/);
  assert.doesNotMatch(shell, /reconciliationScanDetail/);
  assert.match(shell, /setText\('scan-detail', completedRelationshipScanDetail\(result\)\)/);
  assert.match(shell, /const detail = failedRelationshipScanDetail\(error\)/);
  assert.match(shell, /setText\('scan-detail', detail\);\s*status\(detail\)/);
});

test('Mutual Checker progress is determinate only when verified totals are known', () => {
  const progressPercent = loadShellFunction('scanProgressPercent');
  assert.equal(progressPercent({ followers: 12 }, {}, false), null);
  assert.equal(progressPercent({ followers: 0, following: 0 }, { followers: 0, following: 0 }, false), 0);
  assert.equal(progressPercent(
    { followers: 50, following: 0 },
    { followers: 100, following: 100 },
    false,
  ), 25);
  assert.equal(progressPercent(
    { followers: 100, following: 50 },
    { followers: 100, following: 100 },
    false,
  ), 75);
  assert.equal(progressPercent(
    { followers: 5_000, following: 50 },
    { followers: 100, following: 100 },
    false,
  ), 75);
  assert.equal(progressPercent(
    { followers: 99, following: 1 },
    { followers: 100, following: 1 },
    false,
  ), 99);
  assert.equal(progressPercent({}, {}, true), 100);
  assert.match(shell, /bar\.removeAttribute\('aria-valuenow'\)/);
  assert.doesNotMatch(shell, /found % 95/);

  const attributes = new Map([['aria-valuenow', '72']]);
  const bar = {
    dataset: { indeterminate: 'false' },
    removeAttribute(name) { attributes.delete(name); },
    setAttribute(name, value) { attributes.set(name, value); },
  };
  const fill = { style: { width: '72%' } };
  const settleFailure = loadShellFunction('settleFailedRelationshipProgress', {
    query(selector) {
      if (selector === '[data-role="scan-bar"]') return bar;
      if (selector === '[data-role="scan-fill"]') return fill;
      return null;
    },
  });
  settleFailure(new Error('request failed'));
  assert.equal(fill.style.width, '0%');
  assert.equal(attributes.has('aria-valuenow'), false);
  assert.equal(attributes.get('aria-valuetext'), 'Mutual check failed');
  assert.equal(bar.dataset.indeterminate, 'false');
});

test('legacy checker rows are quarantined until an exact list dialog is rescanned', () => {
  assert.match(shell, /const requiresCountReconciledRescan = Number\(value\.schemaVersion\) < 4/);
  assert.match(shell, /schemaVersion: 6/);
  assert.match(shell, /verified: \{ followers: false, following: false \}/);
  assert.match(shell, /'scanned-followers': \(\) => capturePool\(completeCapture\('followers'\)\)/);
  assert.match(shell, /'scanned-following': \(\) => capturePool\(completeCapture\('following'\)\)/);
  assert.match(shell, /cannot drive comparisons or runs until rescanned/);
  assert.match(shell, /if \(observedTypes\.size !== 1\) continue/);
  assert.match(shell, /function reconciledRelationshipAccounts\(existing, incoming, complete\)/);
});

test('complete list rescans replace stale rows while partial rescans remain partial merges', () => {
  const normalizeAccounts = (items) => [...new Map((items || []).map((item) => [
    String(item.username).toLowerCase(),
    { ...item, username: String(item.username).toLowerCase() },
  ])).values()];
  const reconcile = loadShellFunction('reconciledRelationshipAccounts', { normalizeAccounts, Map });
  assert.deepEqual(
    JSON.parse(JSON.stringify(reconcile([{ username: 'stale' }], [{ username: 'fresh' }], true))),
    [{ username: 'fresh' }],
  );
  assert.deepEqual(
    JSON.parse(JSON.stringify(reconcile([{ username: 'stale' }], [{ username: 'fresh' }], false))),
    [{ username: 'stale' }, { username: 'fresh' }],
  );

  const state = {
    capture: {
      subjectUsername: 'account_a',
      followers: [{ username: 'stale' }],
      following: [],
      source: { followers: 'list-dialog', following: '' },
    },
  };
  const prepare = loadShellFunction('prepareCaptureWorkspace', {
    engine: { normalizeUsername: (value) => String(value || '').toLowerCase() },
    state,
    stateDefaults: () => ({
      capture: {
        subjectUsername: '', followers: [], following: [], source: { followers: '', following: '' },
      },
    }),
  });
  prepare('account_b');
  assert.deepEqual(state.capture.followers, []);
  assert.equal(state.capture.subjectUsername, '');

  const currentSubject = loadShellFunction('currentProfileCaptureSubject', {
    engine: { normalizeUsername: (value) => String(value || '').replace(/^\/+|\/+$/g, '').toLowerCase() },
    location: { pathname: '/external_account/' },
  });
  assert.equal(currentSubject(), 'external_account');
});

test('the checker scan controls name the exact list they operate on', () => {
  const following = generated.match(/<button[^>]*data-action="scan-following"[^>]*>([^<]+)<\/button>/);
  const followers = generated.match(/<button[^>]*data-action="scan-followers"[^>]*>([^<]+)<\/button>/);
  assert.equal(following?.[1], 'Scan Following');
  assert.equal(followers?.[1], 'Scan Followers');
  assert.notEqual(following?.[1], followers?.[1]);
  assert.match(shell, /button\.textContent = `\$\{status === 'todo' \? 'Scan' : 'Rescan'\} \$\{listLabel\}`/);
});

test('userscript restores the previous checker comparison when local persistence fails', () => {
  assert.match(
    shell,
    /const previousCapture = state\.capture;[\s\S]*?state\.capture = nextCapture;[\s\S]*?catch \(error\) \{\s*state\.capture = previousCapture;\s*throw error;/,
  );
});

test('the userscript migrates the old opaque default while preserving explicit choices', () => {
  assert.match(shell, /schemaVersion: 3,[\s\S]*?opacity: 0\.88/);
  assert.match(shell, /source\.schemaVersion === 1 && Number\(source\.opacity\) === 0\.94/);
  assert.match(shell, /clamp\(opacity \?\? 0\.88, 0\.55, 1\)/);
  assert.match(generated, /<input[^>]*value="88"[^>]*data-preference="opacity"/);
  assert.match(shell, /const launcherPosition = source\.launcherPosition[\s\S]*?Math\.round\(source\.launcherPosition\.x\)/);
  assert.match(shell, /accent: ACCENTS\.has\(source\.accent\) \? source\.accent : 'rose'/);
});

test('customization is a named modal that dims the toolbox and dismisses outside', () => {
  assert.match(generated, /data-role="settings-dialog"[^>]*aria-labelledby="insta-toolbox-settings-title"/);
  assert.match(generated, /<h2 id="insta-toolbox-settings-title">Customize Insta Toolbox<\/h2>/);
  assert.match(shell, /\.settings-dialog::backdrop \{[^}]*grayscale\(\.65\) blur\(1px\)/);
  assert.match(shell, /dialog\.showModal\(\)/);
  assert.match(shell, /event\.target === event\.currentTarget\) setSettingsOpen\(false\)/);
  assert.match(generated, /data-preference="accent"/);
  assert.match(generated, /data-preference="blur"/);
  assert.match(generated, /data-preference="launcherSize"/);
});

test('the collapsed userscript launcher moves from its own viewport position', () => {
  assert.match(shell, /const rectangle = \(kind === 'launcher' \? launcher : panel\)\.getBoundingClientRect\(\)/);
  assert.match(shell, /savePreferences\(\{ launcherPosition: constrainedPosition/);
  assert.match(shell, /suppressLauncherClick = true/);
});

test('the userscript claims the page before asynchronous startup can duplicate the launcher', () => {
  const claimCheck = generated.indexOf('document.getElementById(claimId)');
  const claimMount = generated.indexOf('document.documentElement.append(bootstrapClaim)');
  const asynchronousStartup = generated.indexOf('await readManagerTab()');
  const hostMount = generated.indexOf('document.documentElement.append(host)');
  const claimRemoval = generated.indexOf('bootstrapClaim.remove()', hostMount);
  assert.ok(claimCheck >= 0, 'the duplicate claim must be checked');
  assert.ok(claimMount > claimCheck, 'the page claim must be mounted after the guard');
  assert.ok(claimMount < asynchronousStartup, 'the page claim must precede asynchronous startup');
  assert.ok(asynchronousStartup < hostMount, 'the real host mounts after startup completes');
  assert.ok(claimRemoval > hostMount, 'the page claim clears only after the real host mounts');
});

test('the context strip keeps explicit readable text in dark Instagram themes', () => {
  assert.match(shell, /\.context \{[^}]*background: var\(--insta-toolbox-bg-sunken[^}]*color: var\(--insta-toolbox-text/);
  assert.match(shell, /\.context-copy strong \{[^}]*color: var\(--insta-toolbox-text[^}]*!important/);
});

test('a partial scan is never presented as a complete comparison', () => {
  // The compare step only reads "done" when both scans reached the end.
  assert.match(
    shell,
    /const complete = scanState\('following'\) === 'done' && scanState\('followers'\) === 'done';/,
  );
  assert.match(shell, /compareStep\.dataset\.state = both \? \(complete \? 'done' : 'partial'\) : 'todo'/);
});

test('userscript comparison and downloads wait for both complete lists', () => {
  const state = { capture: {
    followers: [{ username: 'mutual' }], following: [{ username: 'mutual' }, { username: 'missing' }],
    verified: { followers: true, following: true },
    complete: { followers: false, following: true },
  } };
  const comparisonIsReady = loadShellFunction('comparisonIsReady', { state });
  const compare = loadShellFunction('compareCapture', {
    state, comparisonIsReady, verifiedCapture: (type) => state.capture[type],
  });
  assert.equal(comparisonIsReady(), false);
  assert.deepEqual(JSON.parse(JSON.stringify(compare())), {
    mutuals: [], iDoNotFollowBack: [], notFollowingMeBack: [],
  });
  state.capture.complete.followers = true;
  assert.equal(comparisonIsReady(), true);
  assert.equal(compare().notFollowingMeBack[0].username, 'missing');
  state.capture.complete.following = false;
  assert.equal(comparisonIsReady(), false);
  assert.match(shell, /const comparisonReady = comparisonIsReady\(\)/);
  assert.match(extensionCapture, /const comparisonReady = followersVerified && followingVerified\s*&& workspace\.complete\?\.followers === true && workspace\.complete\?\.following === true/);
});

test('a run shows its targets and skip reasons before it starts', () => {
  assert.match(shell, /function renderRunReview\(items, \{ omitted = 0, removed = 0, skippedReasons = \[\] \} = \{\}\)/);
  assert.match(generated, /data-role="run-review"/);
  assert.match(shell, /function reviewAccountRun\(\)/);
  assert.match(shell, /renderRunReview\(plan\.items, plan\)/);
  assert.match(shell, /data-action="review-accounts"/);
  assert.match(shell, /Duplicates or already-correct targets removed/);
  // Review is read-only. The action-specific confirmation happens before the
  // finite capability is minted.
  const runBody = shell.slice(shell.indexOf("'run-accounts': async"), shell.indexOf("'run-unsend': ()"));
  assert.ok(runBody.indexOf('accountRunDraft.signature !== current.signature') < runBody.indexOf('await confirmRun({'));
  assert.ok(runBody.indexOf('await confirmRun({') < runBody.indexOf('startAccountRun('));
  const startBody = shell.slice(shell.indexOf('async function startAccountRun'), shell.indexOf('// --- Section 2:'));
  assert.ok(startBody.indexOf('const capabilityId') < startBody.indexOf("status: 'running'"));
  assert.ok(startBody.indexOf('approvedTargets: [...queue]') < startBody.indexOf('await continueAccountRun()'));
});

test('extension run review keeps the action name explicit in its primary label', async () => {
  const queueView = await readFile(new URL('../extension/overlay/views/queue.js', import.meta.url), 'utf8');
  assert.match(queueView, /`Review \$\{plan\.requested\} \$\{label\} target/);
  assert.doesNotMatch(queueView, /label\.toLocaleLowerCase\(\)/);
});

test('the open exact profile is the direct bounded Follow or Unfollow source', () => {
  assert.match(generated, /<option value="current-profile">Current profile<\/option>/);
  assert.match(shell, /const source = query\('\[data-role="bot-source"\]'\)\?\.value \|\| 'current-profile'/);
  assert.match(shell, /const count = source === 'current-profile' \? 1 : requestedCount/);
  assert.match(shell, /'current-profile': \(\) => \{/);
  assert.match(shell, /source !== 'current-profile' && action === 'follow'/);
  assert.match(shell, /Automatically open and scan both lists\./);
  assert.match(shell, /mode: 'dialog'/);
  assert.match(shell, /Please leave this tab open and untouched/);
  assert.match(shell, /Open one Instagram profile first\. No target was reviewed\./);
});

test('the primary Unsend action requires an explicit in-overlay second click without a history prescan', () => {
  const unsendButton = generated.match(/<button[^>]*class="button danger big"[^>]*data-action="run-unsend"[^>]*>Unsend DMs<\/button>/);
  assert.ok(unsendButton, 'Unsend DMs must remain the visible primary action');
  assert.doesNotMatch(unsendButton[0], /\shidden(?![-\w])/);
  const plan = generated.match(/<div[^>]*data-role="unsend-plan"[^>]*>/);
  assert.ok(plan, 'the DM action area must always be visible');
  assert.doesNotMatch(plan[0], /\shidden(?![-\w])/);
  assert.match(generated, /data-action="scan-sent">Check conversation/);
  assert.match(shell, /async function runDmUnsend\(\)/);
  assert.match(shell, /const inspection = dmRunner\.inspect\(\)/);
  assert.doesNotMatch(
    shell.slice(shell.indexOf('async function runDmUnsend()'), shell.indexOf('// --- Section 7:')),
    /scanSentConversation\(|inspectAll\(/,
  );
  assert.match(shell, /const plan = dmRunner\.createPlan\(\{/);
  assert.match(shell, /Permanently unsend \$\{scopeLabel\} in this conversation/);
  assert.match(generated, /<dialog[^>]*data-role="action-confirmation"/);
  assert.match(generated, /data-action="confirm-cancel"/);
  assert.match(generated, /data-action="confirm-accept"/);
  assert.match(shell, /const confirmation = await confirmRun\(\{/);
  assert.match(shell, /confirmation\.reviewedDigest !== plan\.reviewedDigest/);
  assert.match(shell, /const confirmedInspection = dmRunner\.inspect\(\)/);
  assert.doesNotMatch(shell, /globalThis\.confirm|window\.confirm/);
  assert.match(shell, /await dmRunner\.start\(\{/);
  assert.match(labels, /function createPlan\(value = \{\}\)/);
  assert.doesNotMatch(labels, /phrase = `UNSEND|ENABLE LIVE ACTIONS/);
  assert.match(labels, /countExact: false/);
  assert.match(labels, /stableEmptyPasses < STABLE_EMPTY_PASSES/);
  assert.match(labels, /plan\.limit === null \? MAX_PLAN_MESSAGES : plan\.limit/);
  assert.doesNotMatch(shell, /'unsend-all':/);
  assert.match(shell, /'run-unsend': \(\) => runDmUnsend\(\)/);
  // An empty result says nothing was touched rather than implying success.
  assert.match(shell, /No sent messages found/);
  // The optional check stays advisory because Instagram virtualizes the thread.
  assert.match(shell, /Read-only estimate\. Instagram may load more while Unsend runs/);
  assert.match(generated, /data-role="dm-result" hidden/);
  assert.match(generated, /data-role="message-list" hidden/);
  assert.doesNotMatch(generated, /No visible thread evidence captured/);
});

test('the userscript starts the confirmed Unsend plan and surfaces async failures', () => {
  const reservationBody = shell.slice(
    shell.indexOf('function reserveUnsendPlan(plan)'),
    shell.indexOf('function recordVerifiedUnsend(plan, outcome)'),
  );
  assert.match(reservationBody, /activeUnsendCapability = \{/);
  assert.match(reservationBody, /minDelayMs: 1_000/);
  assert.match(reservationBody, /maxDelayMs: 2_000/);
  assert.doesNotMatch(reservationBody, /saveState\(\)/);

  const clickBody = shell.slice(
    shell.indexOf("shadow.addEventListener('click'"),
    shell.indexOf("shadow.addEventListener('change'"),
  );
  assert.match(clickBody, /async \(event\) =>/);
  assert.match(clickBody, /await actions\[target\.dataset\.action\]\?\.\(\);/);
  assert.match(clickBody, /status\(`Stopped: \$\{error\.message\}`\)/);

  const runBody = shell.slice(
    shell.indexOf('async function runDmUnsend()'),
    shell.indexOf('// --- Section 7:'),
  );
  assert.ok(runBody.indexOf('await confirmRun({') < runBody.indexOf('reserveUnsendPlan(plan)'));
  assert.ok(runBody.indexOf('confirmedInspection.threadId !== plan.threadId') < runBody.indexOf('reserveUnsendPlan(plan)'));
  assert.ok(runBody.indexOf('reserveUnsendPlan(plan)') < runBody.indexOf('await dmRunner.start({'));
});

test('finite run confirmation replaces global unlock controls and phrases', () => {
  assert.doesNotMatch(shell, /ENABLE LIVE ACTIONS|LIVE_AUTHORIZATION_PHRASE/);
  assert.doesNotMatch(shell, /Type .*unlock Follow, Unfollow, and Unsend/);
  assert.doesNotMatch(shell, /setLiveActionsUnlocked|InstaToolboxUserscriptLiveAuthority|data-role="live-actions"/);
  assert.match(shell, /InstaToolboxActionConfirmation\?\.createController/);
  assert.match(confirmation, /function createController\(/);
  assert.match(confirmation, /dialog\.showModal\(\)/);
  assert.match(confirmation, /cancelButton\.focus\(\)/);
  assert.match(confirmation, /immutableCopy\(request\.binding \|\| \{\}\)/);
  assert.doesNotMatch(shell, /globalThis\.confirm|window\.confirm/);
  assert.match(shell, /approvedTargets: \[\.\.\.queue\]/);
  assert.match(shell, /capabilityExpiresAt: Date\.now\(\) \+ RUN_CAPABILITY_MS/);
  assert.doesNotMatch(labels, /currentEligibleCount !== plan\.eligibleCount/);
  assert.match(labels, /Number\(value\?\.version\) !== PLAN_VERSION/);
  assert.doesNotMatch(labels, /liveAuthority\?\.enable|ARM UNSEND/);
});

test('the extension keeps Stop available and labels read-only checks truthfully', async () => {
  const messages = await readFile(new URL('../extension/overlay/views/messages.js', import.meta.url), 'utf8');
  assert.match(messages, /const readOnlyCheck = state\.operation === 'check'/);
  assert.match(messages, /readOnlyCheck \? 'Stop check' : 'Stop unsending'/);
  assert.match(messages, /button\.textContent = pendingReservation\s*\? 'Stop unsending'/);
  assert.match(messages, /if \(pendingReservation\) button\.disabled = false/);
  assert.match(messages, /readOnlyCheck\s*\?\s*'Read-only check · nothing changed'/);
});

test('the tablist keeps one selected tab and moves with the arrow keys', () => {
  assert.match(shell, /function syncTabs\(active\)/);
  assert.match(shell, /tab\.setAttribute\('aria-selected', String\(selected\)\)/);
  // Roving tabindex: exactly one tab in the tab order at a time.
  assert.match(shell, /tab\.tabIndex = selected \? 0 : -1/);
  assert.match(shell, /ArrowRight: 1, ArrowLeft: -1, Home: 'first', End: 'last'/);
  assert.match(shell, /next\.focus\(\)/);
});

test('the userscript moves focus into the panel and restores a safe opener', () => {
  const focusLog = [];
  const panel = { hidden: true };
  const launcher = {
    hidden: false,
    isConnected: true,
    setAttribute() {},
    focus() { focusLog.push('launcher'); },
  };
  const selectedTab = {
    dataset: { view: 'checker' },
    setAttribute() {},
    focus() { focusLog.push('checker'); },
  };
  const otherTab = { dataset: { view: 'messages' }, setAttribute() {} };
  const views = [{ dataset: { panel: 'checker' } }, { dataset: { panel: 'messages' } }];
  const disconnectedOpener = { isConnected: false, focus() { focusLog.push('disconnected'); } };
  const documentState = { activeElement: disconnectedOpener, body: {}, documentElement: {} };
  const preferences = { open: true, view: 'checker' };
  const globals = {
    preferences,
    lastFocusedElement: null,
    shadow: { activeElement: null },
    document: documentState,
    requestAnimationFrame(callback) { callback(); },
    setTimeout(callback) { callback(); },
    setSettingsOpen() {},
    query(selector) {
      if (selector === '.panel') return panel;
      if (selector === '.launcher') return launcher;
      if (selector === '[data-view="checker"]') return selectedTab;
      return null;
    },
    queryAll(selector) {
      if (selector === '[data-view]') return [selectedTab, otherTab];
      if (selector === '[data-panel]') return views;
      return [];
    },
  };
  const renderShellState = loadShellFunction('renderShellState', globals);

  renderShellState();
  assert.deepEqual(focusLog, ['checker']);
  assert.equal(panel.hidden, false);
  assert.equal(launcher.hidden, true);

  preferences.open = false;
  renderShellState();
  assert.deepEqual(focusLog, ['checker', 'launcher']);
  assert.equal(panel.hidden, true);
  assert.equal(launcher.hidden, false);
  assert.doesNotMatch(focusLog.join(','), /disconnected/);
});

test('motion is tied to state and removed under reduced motion', () => {
  assert.match(shell, /transition: border-color var\(--insta-toolbox-motion-base/);
  assert.match(shell, /transition: width var\(--insta-toolbox-motion-base/);
  assert.match(shell, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(shell, /\.panel \{ animation: none; \}/);
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

test('secondary disclosures use visible open and closed triangle indicators', () => {
  assert.match(shell, /\.settings-inline > summary::after \{[^}]*border-left: 7px solid currentColor;/s);
  assert.match(shell, /\.settings-inline\[open\] > summary::after \{ transform: rotate\(90deg\); \}/);
  assert.match(extensionShell, /\.insta-toolbox-disclosure > summary::after \{[^}]*border-left: 7px solid currentColor;/s);
  assert.match(extensionShell, /\.insta-toolbox-disclosure\[open\] > summary::after \{ transform: rotate\(90deg\); \}/);
  assert.doesNotMatch(extensionShell, /summary::after \{ content: "\+"/);
});

test('Mutual Checker filters stack inside a narrow custom panel', () => {
  assert.match(
    extensionShell,
    /@container insta-toolbox-body \(max-width: 340px\) \{[\s\S]*?\.insta-toolbox-filter-grid \{ grid-template-columns: 1fr; \}/,
  );
});

test('partial Mutual Checker captures cannot become userscript action targets', () => {
  const state = {
    capture: {
      subjectUsername: 'signed_in',
      followers: [{ username: 'follower_one' }],
      following: [{ username: 'unsafe_target' }],
      complete: { followers: false, following: true },
      verified: { followers: true, following: true },
    },
    queue: { queue: [] },
  };
  let source = 'not-following-me-back';
  const globals = {
    state,
    ACTIONABLE_STATUSES: new Set(['pending']),
    clampNumber: (value, _bounds, fallback) => Number(value) || fallback,
    completeCapture: (listType) => (
      state.capture.verified[listType] && state.capture.complete[listType]
        ? state.capture[listType]
        : []
    ),
    compareCapture: () => ({
      mutuals: [],
      iDoNotFollowBack: [],
      notFollowingMeBack: [{ username: 'unsafe_target' }],
    }),
    engine: {
      detectAuthenticatedUsername: () => 'signed_in',
      normalizeUsername: (value) => String(value || '').replace(/^@/, '').toLowerCase(),
    },
    query(selector) {
      if (selector === '[data-role="bot-action"]') return { value: 'unfollow' };
      if (selector === '[data-role="bot-source"]') return { value: source };
      if (selector === '[data-role="bot-count"]') return { value: '20' };
      return null;
    },
  };
  const accountRunPlan = loadShellFunction('accountRunPlan', globals);

  let plan = accountRunPlan();
  assert.equal(plan.items.length, 0);
  assert.match(plan.skippedReasons[0].reason, /data is partial/);

  state.capture.complete.followers = true;
  plan = accountRunPlan();
  assert.equal(plan.items[0].username, 'unsafe_target');

  state.capture.subjectUsername = 'other_person';
  plan = accountRunPlan();
  assert.equal(plan.items.length, 0);
  assert.match(plan.skippedReasons[0].reason, /signed-in account/);
  state.capture.subjectUsername = 'signed_in';

  source = 'scanned-followers';
  state.capture.complete.followers = false;
  plan = accountRunPlan();
  assert.equal(plan.items.length, 0);
  state.capture.complete.followers = true;
  plan = accountRunPlan();
  assert.equal(plan.items[0].username, 'follower_one');
});

test('failed manual scans replace the visible scanning message', async () => {
  let outcome = null;
  const details = [];
  const bar = {
    dataset: {},
    removeAttribute() {},
    setAttribute(_name, value) { this.valueText = value; },
  };
  const fill = { style: {} };
  const select = { value: '' };
  const scanInto = loadShellFunction('scanInto', {
    actions: { 'scan-list': async () => outcome },
    query(selector) {
      if (selector === '[data-role="list-type"]') return select;
      if (selector === '[data-role="scan-bar"]') return bar;
      if (selector === '[data-role="scan-fill"]') return fill;
      return null;
    },
    renderAll() {},
    resetRelationshipProgress() {},
    safeText: (value, fallback = '') => String(value ?? '').trim() || fallback,
    setText(role, value) { if (role === 'scan-detail') details.push(value); },
    showScanProgress() {},
  });

  for (const detail of [
    'No verified followers dialog was open.',
    'No rows were readable.',
    'Stopped: Instagram rate limit.',
  ]) {
    outcome = { applied: false, detail };
    await scanInto('followers');
    assert.equal(details.at(-1), detail);
    assert.equal(bar.valueText, detail);
    assert.equal(fill.style.width, '0%');
  }
  assert.equal((shell.match(/return \{ applied: false, detail \};/g) || []).length, 3);
});

test('verified empty extension lists are rendered as scanned', () => {
  const detail = loadSourceFunction(extensionCapture, 'relationshipListDetail', {
    formatCount: (value) => Number(value || 0).toLocaleString('en-US'),
  });
  assert.equal(detail('followers', [], true, true), '0 unique · complete');
  assert.equal(detail('followers', [], true, false), '0 unique · partial');
  assert.equal(detail('followers', [], false, false), 'Open your Followers list next');
});

test('comparison changes and coarse scan phases use the existing live feedback', () => {
  assert.match(shell, /function announceComparisonCount\(\)/);
  assert.match(shell, /checkerResultAnnouncementTimer = setTimeout\([\s\S]*?status\(message, 'neutral'\)/);
  assert.equal((shell.match(/announceComparisonCount\(\);/g) || []).length, 2);
  assert.match(extensionCapture, /function announceComparisonResult\(runtime, message\)/);
  assert.match(extensionCapture, /const announceProgress = \(key, message\) =>/);
  assert.match(extensionCapture, /announceProgress\(\s*`loading-\$\{progress\.listType\}`/s);
  assert.doesNotMatch(shell, /Complete both follower lists before downloading a comparison/);
  assert.match(shell, /Both lists must be complete before downloading a comparison/);
});

test('verified empty relationship lists keep an honest complete or partial state', () => {
  const state = {
    capture: {
      followers: [],
      complete: { followers: true },
      verified: { followers: true },
    },
  };
  const scanState = loadShellFunction('scanState', { state });
  assert.equal(scanState('followers'), 'done');
  state.capture.complete.followers = false;
  assert.equal(scanState('followers'), 'partial');
  state.capture.verified.followers = false;
  assert.equal(scanState('followers'), 'todo');
});

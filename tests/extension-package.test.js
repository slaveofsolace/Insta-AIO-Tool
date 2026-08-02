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
const actionLabels = await readFile(
  new URL('../extension/action-labels.js', import.meta.url),
  'utf8',
);
const instagramContent = await readFile(
  new URL('../extension/content-instagram.js', import.meta.url),
  'utf8',
);
const instagramEntry = manifest.content_scripts.find((entry) => (
  entry.matches.includes('https://www.instagram.com/*')
));
const instagramOverlay = (await Promise.all(instagramEntry.js.slice(2).map((file) => readFile(
  new URL(`../extension/${file}`, import.meta.url),
  'utf8',
)))).join('\n');
const pwaContent = await readFile(
  new URL('../extension/content-pwa.js', import.meta.url),
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
  assert.deepEqual(instagramEntry.js.slice(0, 2), [
    'action-labels.js',
    'content-instagram.js',
  ]);
});

test('Instagram content script isolates its only page-control call behind the reviewed live driver', () => {
  assert.match(instagramContent, /insta-aio-inspect-profile/);
  assert.match(instagramContent, /insta-aio-capture-visible-accounts/);
  assert.match(instagramContent, /replace\(\/\^\\\/\+\/, ''\)/);
  assert.equal((instagramContent.match(/\.click\s*\(/g) || []).length, 1);
  assert.match(instagramContent, /function activateLiveControl\(control\)[\s\S]*?control\.click\(\)/);
  assert.match(instagramContent, /profileResolutions\.delete\(token\)/);
  assert.match(instagramContent, /globalThis\.__instaAioActionLabels/);
  assert.match(instagramContent, /secure-random-unavailable/);
  assert.match(instagramContent, /typeof secureCrypto\?\.getRandomValues !== 'function'/);
  assert.match(instagramContent, /unfollow-confirmation-not-exact/);
  assert.match(instagramContent, /insta-aio-inspect-reviewed-dm-item/);
  assert.match(instagramContent, /exact-message-identity-unavailable/);
  assert.match(instagramContent, /extension-stable-visible-message-identity/);
  assert.doesNotMatch(instagramContent, /cookies?|authorization/i);
  assert.doesNotMatch(instagramOverlay, /\.click\s*\(/);
  assert.match(instagramOverlay, /tab\('queue', 'Queue'/);
  assert.match(instagramOverlay, /data-ia-view="queue"/);
});

test('reviewed action labels preserve exact UTF-8 localization without mojibake', () => {
  assert.match(actionLabels, /'zurücknehmen'/);
  assert.doesNotMatch(actionLabels, /\u00c3[\u0080-\u00bf]/u);
  assert.match(actionLabels, /normalize\('NFKC'\)/);
  assert.match(actionLabels, /relationshipForLabel/);
  assert.match(actionLabels, /isDmUnsendLabel/);
});

test('extension DM dry run stays no-click while live Unsend is isolated behind exact one-use gates', () => {
  const dmDryRunBody = background.slice(
    background.indexOf('async function inspectDmJob'),
    background.indexOf('function accountActionDay'),
  );
  assert.match(dmDryRunBody, /insta-aio-inspect-reviewed-dm-item/);
  assert.match(dmDryRunBody, /resolved-no-click/);
  assert.doesNotMatch(dmDryRunBody, /perform|Unsend|\.click\s*\(/i);
  assert.match(instagramContent, /insta-aio-perform-reviewed-dm-unsend/);
  assert.match(instagramContent, /dmResolutions\.delete\(token\)/);
  assert.match(instagramContent, /preexisting-surface-before-live-unsend/);
  assert.match(instagramContent, /dm-message-changed-before-final-confirmation/);
  assert.match(instagramContent, /surfaceBoundToControl/);
  assert.match(instagramContent, /identity-ancestor-flex-end-layout/);
  assert.match(instagramContent, /retainedIdentityNodeDisconnected/);
  assert.doesNotMatch(instagramContent, /closest\?\.\('button,[^\n]+\) \|\| element/);
  assert.match(controlledDmPolicy, /controlled-live-dm-batch-must-be-one/);
  assert.match(controlledDmPolicy, /dm-destructive-confirmation-expired/);
  assert.match(controlledDmPolicy, /verifiedControlledDmResult/);
  assert.match(background, /Reserve and consume the one-shot DM capability durably/);
  assert.match(background, /dmActionLedger/);
  assert.match(background, /reserveExtensionDmAction/);
});

test('bridge transport pins the page origin and requires one fresh, armed live account intent', () => {
  assert.match(pwaContent, /event\.origin !== location\.origin/);
  assert.match(pwaContent, /window\.postMessage/);
  assert.match(background, /bridgeSenderOrigin\(sender\)/);
  assert.match(background, /origin !== request\.origin/);
  assert.match(controlledPolicy, /controlled-live-batch-must-be-one/);
  assert.match(controlledPolicy, /live-confirmation-expired/);
  assert.match(background, /live-arm-required/);
  assert.match(background, /Reserve and consume the one-shot capability durably before the first page control is used/);
  assert.match(background, /accountActionLedger/);
  assert.match(background, /reserveExtensionAction/);
  assert.match(instagramContent, /function verifiedProfileHeader\(username\)/);
  assert.match(instagramContent, /profileRoot !== resolution\.profileRoot/);
  assert.match(instagramContent, /preexisting-dialog-before-live-action/);
  assert.match(instagramContent, /dialogNamesUsername\(dialog, username\)/);
  assert.match(background, /state\.liveArm = null;[\s\S]*state\.pendingLiveIntent = null;[\s\S]*await saveBridgeState\(state\)/);
});

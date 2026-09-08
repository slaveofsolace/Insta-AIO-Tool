import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { canonicalizeExtensionEntry } from '../scripts/canonical-extension-entry.mjs';

const manifest = JSON.parse(await readFile(
  new URL('../extension/manifest.json', import.meta.url),
  'utf8',
));
const packageMetadata = JSON.parse(await readFile(
  new URL('../package.json', import.meta.url),
  'utf8',
));
const userscriptMetadata = await readFile(
  new URL('../userscripts/src/metadata.txt', import.meta.url),
  'utf8',
);
const ciWorkflow = await readFile(
  new URL('../.github/workflows/ci.yml', import.meta.url),
  'utf8',
);
const background = await readFile(
  new URL('../extension/background.js', import.meta.url),
  'utf8',
);
const popup = await readFile(
  new URL('../extension/popup.js', import.meta.url),
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
const instagramOverlay = (await Promise.all(instagramEntry.js
  .filter((file) => !['action-labels.js', 'content-instagram.js'].includes(file))
  .map((file) => readFile(
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
const license = await readFile(new URL('../LICENSE', import.meta.url), 'utf8');
const readme = await readFile(new URL('../README.md', import.meta.url), 'utf8');
const serviceWorker = await readFile(new URL('../sw.js', import.meta.url), 'utf8');
const userscriptBuilder = await readFile(
  new URL('../scripts/build-userscript.mjs', import.meta.url),
  'utf8',
);
const extensionBuilder = await readFile(
  new URL('../scripts/build-extension.mjs', import.meta.url),
  'utf8',
);
const extensionPackageFiles = await readFile(
  new URL('../scripts/extension-package-files.mjs', import.meta.url),
  'utf8',
);

test('desktop, extension, and userscript release versions stay aligned', () => {
  const userscriptVersion = userscriptMetadata.match(/@version\s+(\d+\.\d+\.\d+)/)?.[1];
  assert.equal(packageMetadata.version, manifest.version);
  assert.equal(userscriptVersion, manifest.version);
});

test('extension release archive is exact-inventory and cross-platform reproducible', () => {
  assert.equal(packageMetadata.scripts['verify:extension-package'], 'node scripts/verify-extension-package.mjs');
  assert.equal(
    canonicalizeExtensionEntry('overlay/shell.js', Buffer.from('one\r\ntwo\rthree')).toString(),
    'one\ntwo\nthree',
  );
  const icon = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]);
  assert.strictEqual(canonicalizeExtensionEntry('icons/icon-16.png', icon), icon);
});

test('public builds carry the author and complete MIT attribution', () => {
  assert.equal(packageMetadata.author, 'slaveofsolace (https://github.com/slaveofsolace)');
  assert.match(userscriptMetadata, /@author\s+@slaveofsolace/);
  assert.match(license, /Copyright \(c\) 2026 slaveofsolace \(https:\/\/github\.com\/slaveofsolace\)/);
  assert.match(license, /Permission is hereby granted, free of charge/);
  assert.match(readme, /redistributed original or modified\s+copies/i);
  assert.match(readme, /keep the copyright and MIT license notice/i);
  assert.match(userscriptBuilder, /const licenseFile = path\.join\(repositoryRoot, 'LICENSE'\)/);
  assert.match(userscriptBuilder, /licenseBanner/);
  assert.match(extensionBuilder, /extensionLegalFiles/);
  assert.match(extensionPackageFiles, /extensionLegalFiles = Object\.freeze\(\[[\s\S]*?'LICENSE'[\s\S]*?'THIRD_PARTY_NOTICES\.md'/);
  assert.match(serviceWorker, /'\.\/LICENSE'/);
  assert.match(serviceWorker, /'\.\/THIRD_PARTY_NOTICES\.md'/);
});

test('package scripts always disable electron-builder publishing in CI and local builds', () => {
  assert.match(packageMetadata.scripts['dist:win'], /electron-builder --win nsis --publish never$/);
  assert.match(packageMetadata.scripts['dist:mac'], /electron-builder --mac dmg zip --universal --publish never$/);
  assert.match(ciWorkflow, /run: pnpm run dist:win\n/);
  assert.match(ciWorkflow, /run: pnpm run dist:mac\n/);
  assert.doesNotMatch(ciWorkflow, /dist:(?:win|mac) -- --publish never/);
});

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
  assert.deepEqual(instagramEntry.js.slice(0, 3), [
    'action-confirmation.js',
    'action-labels.js',
    'content-instagram.js',
  ]);
});

test('v3 pairing and bridge updates use only the Insta Toolbox storage namespace', () => {
  assert.match(background, /bridgePairings: 'instaToolboxBridgePairings'/);
  assert.match(popup, /const BRIDGE_PAIRINGS_KEY = 'instaToolboxBridgePairings'/);
  assert.match(popup, /chrome\.storage\.local\.get\(BRIDGE_PAIRINGS_KEY\)/);
  assert.doesNotMatch(popup, /['"]bridgePairings['"]/);
  assert.match(instagramOverlay, /bridgePairings: 'instaToolboxBridgePairings'/);
  assert.doesNotMatch(instagramOverlay, /['"]bridgePairings['"]/);
});

test('Instagram content script separates exact list navigation from reviewed mutations', () => {
  assert.match(instagramContent, /insta-toolbox-inspect-profile/);
  assert.match(instagramContent, /insta-toolbox-capture-visible-accounts/);
  assert.match(instagramContent, /replace\(\/\^\\\/\+\/, ''\)/);
  assert.equal((instagramContent.match(/\.click\s*\(/g) || []).length, 2);
  assert.equal((instagramContent.match(/activateListNavigationControl\(/g) || []).length, 3);
  assert.match(instagramContent, /function activateListNavigationControl\(resolve\)/);
  assert.match(instagramContent, /function activateLiveControl\(control\)[\s\S]*?control\.click\(\)/);
  assert.match(instagramContent, /profileResolutions\.delete\(token\)/);
  assert.match(instagramContent, /globalThis\.__instaToolboxActionLabels/);
  assert.match(instagramContent, /secure-random-unavailable/);
  assert.match(instagramContent, /typeof secureCrypto\?\.getRandomValues !== 'function'/);
  assert.match(instagramContent, /unfollow-confirmation-not-exact/);
  assert.match(instagramContent, /insta-toolbox-inspect-reviewed-dm-item/);
  assert.match(instagramContent, /exact-message-identity-unavailable/);
  assert.match(instagramContent, /extension-stable-visible-message-identity/);
  assert.doesNotMatch(instagramContent, /cookies?|authorization/i);
  assert.doesNotMatch(instagramOverlay, /\.click\s*\(/);
  assert.match(instagramOverlay, /tab\('queue', 'Follow \/ Unfollow'/);
  assert.match(instagramOverlay, /data-insta-toolbox-view="queue"/);
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
  assert.match(dmDryRunBody, /insta-toolbox-inspect-reviewed-dm-item/);
  assert.match(dmDryRunBody, /resolved-no-click/);
  assert.doesNotMatch(dmDryRunBody, /perform|Unsend|\.click\s*\(/i);
  assert.match(instagramContent, /insta-toolbox-perform-reviewed-dm-unsend/);
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

test('bridge transport pins the page origin and requires one fresh exact transient capability', () => {
  assert.match(pwaContent, /event\.origin !== location\.origin/);
  assert.match(pwaContent, /window\.postMessage/);
  assert.match(background, /bridgeSenderOrigin\(sender\)/);
  assert.match(background, /origin !== request\.origin/);
  assert.match(controlledPolicy, /controlled-live-batch-must-be-one/);
  assert.match(controlledPolicy, /live-confirmation-expired/);
  assert.match(background, /function accountConfirmationMatches\(confirmation, intent\)/);
  assert.match(background, /consumeTransientCapability\(accountCapabilities/);
  assert.match(background, /Reserve durably before the/);
  assert.match(background, /accountActionLedger/);
  assert.match(background, /reserveExtensionAction/);
  assert.match(instagramContent, /function verifiedProfileHeader\(username\)/);
  assert.match(instagramContent, /profileRoot !== resolution\.profileRoot/);
  assert.match(instagramContent, /preexisting-dialog-before-live-action/);
  assert.match(instagramContent, /dialogNamesUsername\(dialog, username\)/);
  assert.match(background, /exactConfirmationRequired: true/);
  assert.match(background, /liveExecutionEnabled: false/);
  assert.match(background, /liveArm: null/);
});

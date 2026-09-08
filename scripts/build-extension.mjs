import {
  copyFile,
  mkdir,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import {
  instagramScriptOrder,
} from './instagram-script-order.mjs';
import { canonicalizeExtensionEntry } from './canonical-extension-entry.mjs';
import {
  expectedExtensionArchiveEntries,
  extensionIconFiles,
  extensionIcons,
  extensionLegalFiles,
  extensionLibraryFiles,
  extensionSourceFiles,
} from './extension-package-files.mjs';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourceRoot = path.join(repositoryRoot, 'extension');
const outputRoot = path.join(repositoryRoot, 'dist', 'extension');
const checkOnly = process.argv.includes('--check');

const liveSafetyTests = [
  'tests/content-instagram-dm-live.test.js',
  'tests/content-instagram-live.test.js',
  'tests/controlled-account-action.test.js',
  'tests/controlled-dm-unsend.test.js',
  'tests/extension-background-dm.test.js',
  'tests/extension-background-live.test.js',
];

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function storedZip(entries) {
  const localRecords = [];
  const centralRecords = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name.replaceAll('\\', '/'));
    const data = Buffer.from(entry.data);
    const checksum = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(0x0021, 12);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    localRecords.push(local, name, data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(0x0021, 14);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    centralRecords.push(central, name);
    offset += local.length + name.length + data.length;
  }

  const centralOffset = offset;
  const centralSize = centralRecords.reduce((total, record) => total + record.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(centralOffset, 16);
  return Buffer.concat([...localRecords, ...centralRecords, end]);
}

async function validateSources() {
  const manifest = JSON.parse(await readFile(path.join(sourceRoot, 'manifest.json'), 'utf8'));
  if (manifest.manifest_version !== 3) {
    throw new Error('Companion extension must use Manifest V3.');
  }
  if (
    JSON.stringify(manifest.icons) !== JSON.stringify(extensionIcons)
    || JSON.stringify(manifest.action?.default_icon) !== JSON.stringify(extensionIcons)
  ) {
    throw new Error('Companion extension must declare the complete local icon set.');
  }
  for (const [declaredSize, file] of Object.entries(extensionIcons)) {
    const icon = await readFile(path.join(sourceRoot, ...file.split('/')));
    const signature = icon.subarray(0, 8).toString('hex');
    const width = icon.length >= 24 ? icon.readUInt32BE(16) : 0;
    const height = icon.length >= 24 ? icon.readUInt32BE(20) : 0;
    if (signature !== '89504e470d0a1a0a' || width !== Number(declaredSize) || height !== Number(declaredSize)) {
      throw new Error(`Companion extension icon ${file} must be a ${declaredSize}x${declaredSize} PNG.`);
    }
  }
  const forbiddenPermissions = ['cookies', 'webRequest', 'webRequestBlocking'];
  const declaredPermissions = [
    ...(manifest.permissions || []),
    ...(manifest.host_permissions || []),
  ];
  for (const permission of forbiddenPermissions) {
    if (declaredPermissions.includes(permission)) {
      throw new Error(`Companion extension may not request ${permission}.`);
    }
  }
  const instagramSource = await readFile(path.join(sourceRoot, 'content-instagram.js'), 'utf8');
  const actionLabelsSource = await readFile(path.join(sourceRoot, 'action-labels.js'), 'utf8');
  const overlaySource = (await Promise.all(
    instagramScriptOrder
      .filter((file) => !['action-labels.js', 'content-instagram.js'].includes(file))
      .map((file) => readFile(path.join(sourceRoot, file), 'utf8')),
  )).join('\n');
  const allowedLiveActivator = `function activateLiveControl(control) {
    control.click();
  }`;
  if (!instagramSource.includes(allowedLiveActivator)) {
    throw new Error('Instagram content script is missing the isolated live-control activator.');
  }
  const allowedListNavigation = `function activateListNavigationControl(resolve) {
    const control = resolve();
    if (!control) throw relationshipError('ambiguous-list-control', 'The list control changed.');
    control.click();
  }`;
  if (!instagramSource.includes(allowedListNavigation)
    || (instagramSource.match(/activateListNavigationControl\(/g) || []).length !== 3) {
    throw new Error('Exact read-only list navigation is missing or has extra callers.');
  }
  if (/\.click\s*\(/.test(instagramSource.replace(allowedLiveActivator, '').replace(allowedListNavigation, ''))) {
    throw new Error('Instagram content script contains an unreviewed click path.');
  }
  if (/\.click\s*\(|dispatchEvent\s*\(/.test(overlaySource)) {
    throw new Error('Instagram overlay must not directly control the page.');
  }
  if (/setInterval\s*\(/.test(overlaySource)) {
    throw new Error('Instagram overlay must not use a recurring polling interval.');
  }
  if ((overlaySource.match(/\.innerHTML\s*=/g) || []).length !== 1
    || !overlaySource.includes('shadow.innerHTML = `')) {
    throw new Error('Instagram overlay may use only the audited static shell markup assignment.');
  }
  if (/@import\s+url|url\(\s*['"]?https?:|<script[^>]+src=['"]https?:/i.test(overlaySource)) {
    throw new Error('Instagram overlay may not load remote UI assets.');
  }
  if (!instagramSource.includes('insta-toolbox-inspect-profile')) {
    throw new Error('Instagram content script is missing profile inspection.');
  }
  const instagramEntry = manifest.content_scripts?.find((entry) => (
    entry.matches?.includes('https://www.instagram.com/*')
  ));
  if (
    JSON.stringify(instagramEntry?.js) !== JSON.stringify(instagramScriptOrder)
    || !actionLabelsSource.includes("'zurücknehmen'")
    || /\u00c3[\u0080-\u00bf]/u.test(actionLabelsSource)
    || !instagramSource.includes("reason: 'secure-random-unavailable'")
  ) {
    throw new Error('Instagram action labels or secure resolution-token gates are incomplete.');
  }
  if (
    !instagramSource.includes('function verifiedProfileHeader(username)')
    || !instagramSource.includes('profileRoot !== resolution.profileRoot')
    || !instagramSource.includes('preexisting-dialog-before-live-action')
    || !instagramSource.includes('dialogNamesUsername(dialog, username)')
  ) {
    throw new Error('Instagram content script is missing exact-target DOM binding.');
  }
  if (
    !overlaySource.includes('data-insta-toolbox-section="${section}"')
    || !overlaySource.includes("tab('queue', 'Follow / Unfollow'")
    || !overlaySource.includes('data-insta-toolbox-view="queue"')
  ) {
    throw new Error('Instagram overlay is missing the in-page queue workspace.');
  }
  const backgroundSource = await readFile(path.join(sourceRoot, 'background.js'), 'utf8');
  const controlledSource = await readFile(
    path.join(repositoryRoot, 'src', 'core', 'controlled-account-action.js'),
    'utf8',
  );
  const controlledDmSource = await readFile(
    path.join(repositoryRoot, 'src', 'core', 'controlled-dm-unsend.js'),
    'utf8',
  );
  if (
    !controlledSource.includes('controlled-live-batch-must-be-one')
    || !controlledSource.includes('live-confirmation-expired')
    || !backgroundSource.includes('accountCapabilities')
    || !backgroundSource.includes('accountConfirmationMatches')
    || !backgroundSource.includes('consumeTransientCapability(accountCapabilities')
    || !backgroundSource.includes('Reserve durably before the')
    || !backgroundSource.includes('accountActionLedger')
    || !backgroundSource.includes('reserveExtensionAction')
  ) {
    throw new Error('Controlled live account-action gates are incomplete.');
  }
  if (
    !controlledDmSource.includes('controlled-live-dm-batch-must-be-one')
    || !controlledDmSource.includes('dm-destructive-confirmation-expired')
    || !backgroundSource.includes('dmCapabilities')
    || !backgroundSource.includes('dmConfirmationMatches')
    || !backgroundSource.includes('consumeTransientCapability(dmCapabilities')
    || !backgroundSource.includes('Reserve and consume the one-shot DM capability durably')
    || !backgroundSource.includes('dmActionLedger')
    || !backgroundSource.includes('reserveExtensionDmAction')
    || !backgroundSource.includes('verifiedControlledDmResult')
    || !instagramSource.includes('insta-toolbox-perform-reviewed-dm-unsend')
    || !instagramSource.includes('preexisting-surface-before-live-unsend')
    || !instagramSource.includes('dm-message-changed-before-final-confirmation')
    || !instagramSource.includes('surfaceBoundToControl')
    || !instagramSource.includes('retainedIdentityNodeDisconnected')
  ) {
    throw new Error('Controlled live DM-unsend gates are incomplete.');
  }
  for (const file of extensionSourceFiles) {
    await readFile(path.join(sourceRoot, file));
  }
  for (const file of extensionLibraryFiles) {
    await readFile(path.join(repositoryRoot, 'src', 'core', file));
  }
  for (const file of extensionLegalFiles) {
    await readFile(path.join(repositoryRoot, file));
  }
  return manifest;
}

function validateLiveSafetyBehavior() {
  const result = spawnSync(process.execPath, ['--test', ...liveSafetyTests], {
    cwd: repositoryRoot,
    encoding: 'utf8',
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.status !== 0) {
    throw new Error('Executable controlled-live safety tests failed; extension packaging stopped.');
  }
}

const manifest = await validateSources();
validateLiveSafetyBehavior();
if (checkOnly) {
  console.log('Companion extension sources and controlled-live behavior validated.');
  process.exit(0);
}

const resolvedOutput = path.resolve(outputRoot);
const resolvedDist = path.resolve(repositoryRoot, 'dist');
if (!resolvedOutput.startsWith(`${resolvedDist}${path.sep}`)) {
  throw new Error('Extension output must remain inside the repository dist directory.');
}
await rm(resolvedOutput, { recursive: true, force: true });
await mkdir(path.join(resolvedOutput, 'lib'), { recursive: true });
for (const file of extensionSourceFiles) {
  const target = path.join(resolvedOutput, ...file.split('/'));
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(
    target,
    canonicalizeExtensionEntry(file, await readFile(path.join(sourceRoot, file))),
  );
}
for (const file of extensionIconFiles) {
  const target = path.join(resolvedOutput, ...file.split('/'));
  await mkdir(path.dirname(target), { recursive: true });
  await copyFile(path.join(sourceRoot, ...file.split('/')), target);
}
for (const file of extensionLibraryFiles) {
  const relative = `lib/${file}`;
  await writeFile(
    path.join(resolvedOutput, 'lib', file),
    canonicalizeExtensionEntry(
      relative,
      await readFile(path.join(repositoryRoot, 'src', 'core', file)),
    ),
  );
}
for (const file of extensionLegalFiles) {
  await writeFile(
    path.join(resolvedOutput, file),
    canonicalizeExtensionEntry(file, await readFile(path.join(repositoryRoot, file))),
  );
}

const artifactEntries = [];
for (const file of expectedExtensionArchiveEntries) {
  artifactEntries.push({
    name: file,
    data: await readFile(path.join(resolvedOutput, ...file.split('/'))),
  });
}
const artifact = path.join(repositoryRoot, 'dist', `Insta-Toolbox-Extension-${manifest.version}.zip`);
await writeFile(artifact, storedZip(artifactEntries));
console.log(`Built unpacked extension at ${path.relative(repositoryRoot, resolvedOutput)}.`);
console.log(`Built extension archive at ${path.relative(repositoryRoot, artifact)}.`);

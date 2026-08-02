import {
  copyFile,
  mkdir,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourceRoot = path.join(repositoryRoot, 'extension');
const outputRoot = path.join(repositoryRoot, 'dist', 'extension');
const checkOnly = process.argv.includes('--check');

const sourceFiles = [
  'background.js',
  'content-instagram.js',
  'content-pwa.js',
  'instagram-overlay.js',
  'manifest.json',
  'popup.css',
  'popup.html',
  'popup.js',
];
const libraryFiles = [
  'bridge-protocol.js',
  'controlled-account-action.js',
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
  const overlaySource = await readFile(path.join(sourceRoot, 'instagram-overlay.js'), 'utf8');
  const allowedLiveActivator = `function activateLiveControl(control) {
    control.click();
  }`;
  if (!instagramSource.includes(allowedLiveActivator)) {
    throw new Error('Instagram content script is missing the isolated live-control activator.');
  }
  if (/\.click\s*\(/.test(instagramSource.replace(allowedLiveActivator, ''))) {
    throw new Error('Instagram content script contains an unreviewed click path.');
  }
  if (/\.click\s*\(|dispatchEvent\s*\(/.test(overlaySource)) {
    throw new Error('Instagram overlay must not directly control the page.');
  }
  if (!instagramSource.includes('insta-aio-inspect-profile')) {
    throw new Error('Instagram content script is missing profile inspection.');
  }
  if (
    !instagramSource.includes('function verifiedProfileHeader(username)')
    || !instagramSource.includes('profileRoot !== resolution.profileRoot')
    || !instagramSource.includes('preexisting-dialog-before-live-action')
    || !instagramSource.includes('dialogNamesUsername(dialog, username)')
  ) {
    throw new Error('Instagram content script is missing exact-target DOM binding.');
  }
  if (!overlaySource.includes('data-ia-section="queue"')) {
    throw new Error('Instagram overlay is missing the in-page queue workspace.');
  }
  const backgroundSource = await readFile(path.join(sourceRoot, 'background.js'), 'utf8');
  const controlledSource = await readFile(
    path.join(repositoryRoot, 'src', 'core', 'controlled-account-action.js'),
    'utf8',
  );
  if (
    !controlledSource.includes('controlled-live-batch-must-be-one')
    || !controlledSource.includes('live-confirmation-expired')
    || !backgroundSource.includes('Reserve and consume the one-shot capability durably')
    || !backgroundSource.includes('accountActionLedger')
    || !backgroundSource.includes('reserveExtensionAction')
  ) {
    throw new Error('Controlled live account-action gates are incomplete.');
  }
  for (const file of sourceFiles) {
    await readFile(path.join(sourceRoot, file));
  }
  for (const file of libraryFiles) {
    await readFile(path.join(repositoryRoot, 'src', 'core', file));
  }
  return manifest;
}

const manifest = await validateSources();
if (checkOnly) {
  console.log('Companion extension sources validated.');
  process.exit(0);
}

const resolvedOutput = path.resolve(outputRoot);
const resolvedDist = path.resolve(repositoryRoot, 'dist');
if (!resolvedOutput.startsWith(`${resolvedDist}${path.sep}`)) {
  throw new Error('Extension output must remain inside the repository dist directory.');
}
await rm(resolvedOutput, { recursive: true, force: true });
await mkdir(path.join(resolvedOutput, 'lib'), { recursive: true });
for (const file of sourceFiles) {
  await copyFile(path.join(sourceRoot, file), path.join(resolvedOutput, file));
}
for (const file of libraryFiles) {
  await copyFile(
    path.join(repositoryRoot, 'src', 'core', file),
    path.join(resolvedOutput, 'lib', file),
  );
}

const artifactEntries = [];
for (const file of [
  ...sourceFiles,
  ...libraryFiles.map((libraryFile) => `lib/${libraryFile}`),
].sort()) {
  artifactEntries.push({
    name: file,
    data: await readFile(path.join(resolvedOutput, ...file.split('/'))),
  });
}
const artifact = path.join(repositoryRoot, 'dist', `insta-aio-companion-${manifest.version}.zip`);
await writeFile(artifact, storedZip(artifactEntries));
console.log(`Built unpacked extension at ${path.relative(repositoryRoot, resolvedOutput)}.`);
console.log(`Built extension archive at ${path.relative(repositoryRoot, artifact)}.`);

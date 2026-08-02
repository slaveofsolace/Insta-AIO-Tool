import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import {
  cp,
  mkdir,
  mkdtemp,
  readdir,
  rm,
  stat,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

if (process.platform !== 'darwin') {
  throw new Error('macOS package acceptance must run on macOS.');
}

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outputRoot = path.join(repositoryRoot, 'dist', 'desktop');
const qaEntitlements = path.join(repositoryRoot, 'build', 'entitlements.mac.qa.plist');

async function walk(root) {
  const found = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const target = path.join(root, entry.name);
    found.push(target);
    if (entry.isDirectory() && !entry.name.endsWith('.app')) found.push(...await walk(target));
  }
  return found;
}

function run(command, args, { env = process.env, timeoutMs = 30_000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: repositoryRoot,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`${command} timed out after ${timeoutMs}ms.`));
    }, timeoutMs);
    child.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once('exit', (code, signal) => {
      clearTimeout(timer);
      if (signal || code !== 0) {
        reject(new Error(
          `${command} failed (${signal || code}).\n${stdout}\n${stderr}`,
        ));
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

const artifacts = await walk(outputRoot);
const dmgFiles = artifacts.filter((target) => target.endsWith('.dmg'));
const zipFiles = artifacts.filter((target) => target.endsWith('.zip'));
assert.equal(dmgFiles.length, 1, `expected one DMG, found ${dmgFiles.length}`);
assert.equal(zipFiles.length, 1, `expected one ZIP, found ${zipFiles.length}`);
for (const artifact of [...dmgFiles, ...zipFiles]) {
  assert.ok((await stat(artifact)).size > 1_000_000, `${path.basename(artifact)} is unexpectedly small`);
}
await run('/usr/bin/unzip', ['-t', zipFiles[0]]);

const temporaryRoot = await mkdtemp(path.join(tmpdir(), 'insta-aio-macos-package-'));
const mountPoint = path.join(temporaryRoot, 'mounted-dmg');
const installRoot = path.join(temporaryRoot, 'Applications');
const smokeParent = path.join(temporaryRoot, 'insta-aio-desktop-smoke-parent');
await mkdir(mountPoint);
await mkdir(installRoot);
await mkdir(smokeParent);
let mounted = false;
try {
  await run('/usr/bin/hdiutil', [
    'attach', '-nobrowse', '-readonly', '-mountpoint', mountPoint, dmgFiles[0],
  ]);
  mounted = true;
  const mountedApps = (await readdir(mountPoint, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory() && entry.name.endsWith('.app'));
  assert.equal(mountedApps.length, 1, `expected one mounted app, found ${mountedApps.length}`);
  const mountedApp = path.join(mountPoint, mountedApps[0].name);
  const installedApp = path.join(installRoot, mountedApps[0].name);
  await cp(mountedApp, installedApp, {
    recursive: true,
    errorOnExist: true,
    verbatimSymlinks: true,
  });
  await run('/usr/bin/plutil', ['-lint', path.join(installedApp, 'Contents', 'Info.plist')]);
  await run('/usr/bin/plutil', ['-lint', qaEntitlements]);
  await run('/usr/bin/codesign', [
    '--force', '--deep', '--sign', '-', '--options', 'runtime',
    '--entitlements', qaEntitlements, installedApp,
  ]);
  await run('/usr/bin/codesign', ['--verify', '--deep', '--strict', '--verbose=2', installedApp]);

  const executable = path.join(installedApp, 'Contents', 'MacOS', 'Insta AIO Tool');
  const smoke = await run(executable, ['--smoke-test'], {
    env: {
      ...process.env,
      INSTA_AIO_DESKTOP_SMOKE_PARENT: smokeParent,
    },
    timeoutMs: 30_000,
  });
  assert.match(smoke.stdout, /Insta AIO desktop smoke test passed/);
  await rm(installedApp, { recursive: true, force: true });
  await assert.rejects(stat(installedApp), { code: 'ENOENT' });
  console.log(`Accepted macOS DMG/ZIP build, ad-hoc signing, install, launch, and removal: ${path.basename(dmgFiles[0])}`);
} finally {
  if (mounted) {
    await run('/usr/bin/hdiutil', ['detach', mountPoint], { timeoutMs: 30_000 });
  }
  const resolvedTemporaryRoot = path.resolve(temporaryRoot);
  const resolvedSystemTemp = path.resolve(tmpdir());
  if (
    resolvedTemporaryRoot.startsWith(`${resolvedSystemTemp}${path.sep}`)
    && path.basename(resolvedTemporaryRoot).startsWith('insta-aio-macos-package-')
  ) {
    await rm(resolvedTemporaryRoot, { recursive: true, force: true });
  }
}

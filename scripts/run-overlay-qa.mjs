import { spawn } from 'node:child_process';
import { mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import electronPath from 'electron';

const update = process.argv.includes('--update');
const check = process.argv.includes('--check');
if (update === check) {
  throw new Error('Choose exactly one overlay QA mode: --update or --check.');
}

const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(moduleDirectory, '..');
const resultsRoot = path.resolve(repositoryRoot, 'test-results', 'overlay-qa');
const userDataRoot = path.join(resultsRoot, 'user-data', String(process.pid));
const qaScript = path.join(moduleDirectory, 'overlay-qa.mjs');
const childWatchdogMs = 5 * 60 * 1000;
const childTerminationGraceMs = 2_000;

if (!userDataRoot.startsWith(`${resultsRoot}${path.sep}`)) {
  throw new Error('Overlay QA user data must stay inside test-results/overlay-qa.');
}

await mkdir(userDataRoot, { recursive: true });

function hasExited(child) {
  return child.exitCode !== null || child.signalCode !== null;
}

function waitForChildExit(child, timeoutMs) {
  if (hasExited(child)) return Promise.resolve(true);
  return new Promise((resolve) => {
    let settled = false;
    let timeout = null;
    const finish = (exited) => {
      if (settled) return;
      settled = true;
      if (timeout !== null) clearTimeout(timeout);
      child.off('exit', onExit);
      resolve(exited);
    };
    const onExit = () => finish(true);
    child.once('exit', onExit);
    timeout = setTimeout(() => finish(false), timeoutMs);
    if (hasExited(child)) finish(true);
  });
}

async function terminateChild(child) {
  if (hasExited(child)) return true;
  try {
    child.kill('SIGTERM');
  } catch {
    // The process may have exited between the state check and the signal.
  }
  if (await waitForChildExit(child, childTerminationGraceMs)) return true;
  try {
    child.kill('SIGKILL');
  } catch {
    // A concurrent exit is handled by the final bounded wait.
  }
  return waitForChildExit(child, childTerminationGraceMs);
}

async function waitForQaChild(child) {
  let watchdog = null;
  let watchdogFired = false;
  let watchdogTermination = null;
  const exit = new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code, signal) => resolve({ code, signal }));
  });
  const timedOut = new Promise((_, reject) => {
    watchdog = setTimeout(() => {
      watchdogFired = true;
      watchdogTermination = terminateChild(child);
      void watchdogTermination.then(
        (terminated) => reject(new Error(
          `Electron overlay QA exceeded ${childWatchdogMs}ms and ${terminated ? 'was terminated' : 'did not exit after forced termination'}.`,
        )),
        (error) => reject(new Error(`Electron overlay QA watchdog termination failed: ${error.message}`)),
      );
    }, childWatchdogMs);
  });

  try {
    const { code, signal } = await Promise.race([exit, timedOut]);
    if (watchdogFired) {
      const terminated = await watchdogTermination;
      throw new Error(
        `Electron overlay QA exceeded ${childWatchdogMs}ms and ${terminated ? 'was terminated' : 'did not exit after forced termination'}.`,
      );
    }
    if (signal) throw new Error(`Electron overlay QA exited after signal ${signal}.`);
    return code ?? 1;
  } finally {
    if (watchdog !== null) clearTimeout(watchdog);
  }
}

let exitCode = 1;
try {
  const child = spawn(electronPath, [qaScript, update ? '--update' : '--check'], {
    cwd: repositoryRoot,
    env: {
      ...process.env,
      INSTA_AIO_OVERLAY_QA_USER_DATA: userDataRoot,
      // Fixture timestamps must render identically on local and hosted runners.
      // Product sessions still use the operator's local timezone.
      TZ: 'UTC',
    },
    stdio: 'inherit',
    windowsHide: true,
  });
  exitCode = await waitForQaChild(child);
} catch (error) {
  console.error(`Overlay QA runner failed: ${error.message}`);
  exitCode = 1;
} finally {
  try {
    await rm(userDataRoot, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 100,
    });
  } catch (error) {
    console.error(`Overlay QA user-data cleanup failed: ${error.message}`);
    exitCode = 1;
  }
}

process.exitCode = exitCode;

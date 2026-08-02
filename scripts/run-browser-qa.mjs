import { spawn } from 'node:child_process';
import { mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import electronPath from 'electron';

const mode = process.argv.includes('--update')
  ? '--update'
  : process.argv.includes('--check')
    ? '--check'
    : '';

if (!mode || (process.argv.includes('--update') && process.argv.includes('--check'))) {
  throw new Error('Choose exactly one browser QA mode: --update or --check.');
}

const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(moduleDirectory, '..');
const resultsRoot = path.resolve(repositoryRoot, 'test-results', 'browser-qa');
const userDataRoot = path.resolve(resultsRoot, 'user-data', String(process.pid));
const browserQaPath = path.join(moduleDirectory, 'browser-qa.mjs');

if (!userDataRoot.startsWith(`${resultsRoot}${path.sep}`)) {
  throw new Error('Refusing to create browser QA user data outside test-results.');
}

await mkdir(userDataRoot, { recursive: true });
let exitCode = 1;
try {
  const child = spawn(electronPath, [browserQaPath, mode], {
    cwd: repositoryRoot,
    env: {
      ...process.env,
      INSTA_AIO_BROWSER_QA_USER_DATA: userDataRoot,
    },
    stdio: 'inherit',
    windowsHide: true,
  });
  exitCode = await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (signal) {
        reject(new Error(`Electron browser QA exited after signal ${signal}.`));
        return;
      }
      resolve(code ?? 1);
    });
  });
} catch (error) {
  exitCode = 1;
  console.error(`Browser QA runner failed: ${error.message}`);
} finally {
  try {
    await rm(userDataRoot, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 100,
    });
  } catch (error) {
    exitCode = 1;
    console.error(`Isolated browser QA user-data cleanup failed: ${error.message}`);
  }
}

process.exitCode = exitCode;

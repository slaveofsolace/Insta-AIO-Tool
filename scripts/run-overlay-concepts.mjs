import { spawn } from 'node:child_process';
import { mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import electronPath from 'electron';

const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(moduleDirectory, '..');
const resultsRoot = path.join(repositoryRoot, 'test-results', 'overlay-concepts');
const userDataRoot = path.join(resultsRoot, 'user-data', String(process.pid));
const rendererPath = path.join(moduleDirectory, 'overlay-concepts.mjs');

if (!userDataRoot.startsWith(`${resultsRoot}${path.sep}`)) {
  throw new Error('Refusing to create concept data outside test-results.');
}

await mkdir(userDataRoot, { recursive: true });
let exitCode = 1;
try {
  const child = spawn(electronPath, [rendererPath], {
    cwd: repositoryRoot,
    env: {
      ...process.env,
      INSTA_AIO_OVERLAY_CONCEPT_USER_DATA: userDataRoot,
    },
    stdio: 'inherit',
    windowsHide: true,
  });
  exitCode = await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (signal) {
        reject(new Error(`Overlay concept renderer exited after signal ${signal}.`));
        return;
      }
      resolve(code ?? 1);
    });
  });
} catch (error) {
  console.error(error?.stack || error);
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
    console.error(`Overlay concept cleanup failed: ${error.message}`);
  }
}

process.exitCode = exitCode;

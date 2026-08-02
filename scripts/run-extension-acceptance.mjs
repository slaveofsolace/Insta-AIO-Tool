import { spawn } from 'node:child_process';
import { mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import electronPath from 'electron';

const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(moduleDirectory, '..');
const resultsRoot = path.resolve(repositoryRoot, 'test-results', 'extension-acceptance');
const userDataRoot = path.resolve(resultsRoot, 'user-data', String(process.pid));
const acceptancePath = path.join(moduleDirectory, 'extension-acceptance.mjs');
const hostedLinuxNoSandbox =
  process.platform === 'linux' && process.env.INSTA_AIO_ACCEPTANCE_NO_SANDBOX === '1';

if (!userDataRoot.startsWith(`${resultsRoot}${path.sep}`)) {
  throw new Error('Refusing to create extension acceptance data outside test-results.');
}

await mkdir(userDataRoot, { recursive: true });
let exitCode = 1;
try {
  const child = spawn(
    electronPath,
    [...(hostedLinuxNoSandbox ? ['--no-sandbox'] : []), acceptancePath],
    {
      cwd: repositoryRoot,
      env: {
        ...process.env,
        INSTA_AIO_EXTENSION_ACCEPTANCE_USER_DATA: userDataRoot,
      },
      stdio: 'inherit',
      windowsHide: true,
    },
  );
  exitCode = await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (signal) {
        reject(new Error(`Extension acceptance exited after signal ${signal}.`));
        return;
      }
      resolve(code ?? 1);
    });
  });
} catch (error) {
  console.error(`Extension acceptance runner failed: ${error.message}`);
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
    console.error(`Extension acceptance cleanup failed: ${error.message}`);
  }
}

process.exitCode = exitCode;

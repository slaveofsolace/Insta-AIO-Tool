// Builds the Tampermonkey entry point.
//
// The userscript loads the same reviewed Instagram engine and UI source files
// that live in this repository. Keeping the entry point small means extension
// and Tampermonkey behavior cannot drift while the update URL remains stable.
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const checkOnly = process.argv.includes('--check');
const metadataPath = path.join(repositoryRoot, 'userscripts', 'src', 'metadata.txt');
const output = path.join(repositoryRoot, 'userscripts', 'insta-aio-companion.user.js');
const requiredSources = [
  'extension/action-labels.js',
  'extension/content-instagram.js',
  'userscripts/src/toolbox-shell.js',
];

const metadata = await readFile(metadataPath, 'utf8');
for (const source of requiredSources) {
  await readFile(path.join(repositoryRoot, ...source.split('/')), 'utf8');
  const expected = `// @require      https://raw.githubusercontent.com/slaveofsolace/Insta-AIO-Tool/main/${source}`;
  if (!metadata.includes(expected)) {
    throw new Error(`Userscript metadata is missing ${source}.`);
  }
}
if (!metadata.includes('// @version      0.8.0')) {
  throw new Error('Userscript metadata version must be 0.8.0.');
}

const body = `
(() => {
  'use strict';
  if (!globalThis.InstaAioInstagramInspector || !globalThis.InstaAioDmThreadUnsender) {
    console.error('Insta AIO could not start. Reinstall or update the userscript.');
  }
})();
`;
const assembled = `${metadata.trimEnd()}\n${body.trimStart()}`;

if (checkOnly) {
  const current = await readFile(output, 'utf8').catch(() => '');
  if (current !== assembled) {
    throw new Error('userscripts/insta-aio-companion.user.js is stale; run pnpm run build:userscript.');
  }
  console.log('Userscript entry point matches its repository sources.');
  process.exit(0);
}

await writeFile(output, assembled);
console.log(`Built ${path.relative(repositoryRoot, output)}.`);

// Assembles the Tampermonkey userscript from the same engine the extension ships.
//
// Tampermonkey installs exactly one file, so the userscript has to be flat. It
// is built rather than hand-maintained so the live Follow, Unfollow, and Unsend
// paths cannot drift from the extension's audited copy: both surfaces run the
// identical `extension/content-instagram.js` engine, and only the shell around
// it differs.
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const checkOnly = process.argv.includes('--check');
const output = path.join(repositoryRoot, 'userscripts', 'insta-aio-companion.user.js');

const parts = [
  path.join(repositoryRoot, 'userscripts', 'src', 'metadata.txt'),
  path.join(repositoryRoot, 'extension', 'action-labels.js'),
  path.join(repositoryRoot, 'extension', 'content-instagram.js'),
  path.join(repositoryRoot, 'userscripts', 'src', 'toolbox-shell.js'),
];

const banner = `
// ---------------------------------------------------------------------------
// Generated file. Do not edit.
//
// Built by scripts/build-userscript.mjs from:
//   extension/action-labels.js
//   extension/content-instagram.js      <- shared engine, identical to the extension
//   userscripts/src/toolbox-shell.js    <- userscript-only UI and batch runner
//
// Edit those sources and run: pnpm run build:userscript
// ---------------------------------------------------------------------------
`.trimStart();

const [metadata, ...sources] = await Promise.all(parts.map((file) => readFile(file, 'utf8')));

const engine = sources.join('\n');
if (!engine.includes('performReviewedProfileAction')
  || !engine.includes('performReviewedDmUnsend')) {
  throw new Error('The shared engine no longer exports the live executors.');
}
if (!engine.includes("if (!globalThis.chrome?.runtime?.onMessage?.addListener) return;")) {
  throw new Error('The shared engine must tolerate running without an extension runtime.');
}

const assembled = `${metadata}${banner}${engine}`;

if (checkOnly) {
  const current = await readFile(output, 'utf8').catch(() => '');
  if (current !== assembled) {
    throw new Error('userscripts/insta-aio-companion.user.js is stale; run pnpm run build:userscript.');
  }
  console.log('Userscript bundle matches its sources.');
  process.exit(0);
}

await writeFile(output, assembled);
console.log(`Built ${path.relative(repositoryRoot, output)} from ${parts.length} sources.`);

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(
  new URL('../userscripts/insta-aio-companion.user.js', import.meta.url),
  'utf8',
);
const shell = await readFile(
  new URL('../userscripts/src/toolbox-shell.js', import.meta.url),
  'utf8',
);
const engine = await readFile(
  new URL('../extension/content-instagram.js', import.meta.url),
  'utf8',
);

test('the userscript carries the metadata Tampermonkey needs to install and auto-update from GitHub', () => {
  const rawUrl = 'https://raw.githubusercontent.com/slaveofsolace/Insta-AIO-Tool/main/userscripts/insta-aio-companion.user.js';
  assert.match(source, /^\/\/ ==UserScript==/);
  assert.ok(source.includes(`// @downloadURL  ${rawUrl}`), 'a raw @downloadURL drives one-click install');
  assert.ok(source.includes(`// @updateURL    ${rawUrl}`), 'a raw @updateURL drives auto-update');
  assert.match(source, /@homepageURL\s+https:\/\/github\.com\/slaveofsolace\/Insta-AIO-Tool/);
  assert.match(source, /@supportURL\s+https:\/\/github\.com\/slaveofsolace\/Insta-AIO-Tool\/issues/);
  assert.match(source, /@license\s+MIT/);
  assert.doesNotMatch(source, /raw\.githubusercontent\.com\/[^\s]*\/(?!main\/)(?:refs\/)?heads/);
  const metadataBlock = source.slice(0, source.indexOf('==/UserScript=='));
  assert.match(metadataBlock, /@icon\s+data:image\/svg\+xml,/);
  assert.doesNotMatch(metadataBlock, /@icon\s+https?:/);
  assert.doesNotMatch(metadataBlock, /@require|@resource/);
});

test('the bundle ships the extension engine itself rather than a second copy of it', () => {
  // The point of the build step: one audited DOM engine, two shells around it.
  assert.ok(source.includes(engine.trim()), 'the engine is embedded verbatim');
  assert.match(source, /Generated file\. Do not edit\./);
  assert.match(source, /pnpm run build:userscript/);
  // The shell must not reimplement the live paths.
  assert.doesNotMatch(shell, /function performReviewedDmUnsend|function performReviewedProfileAction/);
  assert.match(shell, /const engine = globalThis\.InstaAioInstagramInspector;/);
});

test('live Follow, Unfollow, and Unsend are available and go through the engine', () => {
  assert.match(shell, /engine\.performReviewedProfileAction\(/);
  assert.match(shell, /engine\.performReviewedDmUnsend\(/);
  assert.match(shell, /engine\.collectAccountList\(/);
  assert.match(shell, /engine\.enumerateSentDms\(/);
  assert.match(source, /data-action="run-accounts"/);
  assert.match(source, /data-action="run-unsend"/);
  assert.match(source, /data-action="scan-list"/);
  assert.match(source, /data-action="scan-sent"/);
  // The old read-only refusals must be gone.
  assert.doesNotMatch(source, /intentionally unavailable in userscript mode/);
});

test('every live action still has to clear the exact-target checks first', () => {
  // A run must resolve its target immediately before acting and pass the token
  // that resolution minted. Without this a batch could act on whatever happens
  // to be on screen when its turn arrives.
  assert.match(shell, /const observation = engine\.inspectProfile\(username\);/);
  assert.match(shell, /resolutionToken: observation\.resolutionToken/);
  assert.match(shell, /observation\?\.relationship !== expected/);
  assert.match(shell, /observation\?\.username !== username/);

  assert.match(shell, /const observation = engine\.inspectReviewedDmItem\(/);
  assert.match(shell, /observation\?\.contentDigest !== message\.contentDigest/);
  assert.match(shell, /observation\?\.sentByMe !== true/);
  assert.match(shell, /observation\?\.exactIdentityAvailable !== true/);
  assert.match(shell, /observation\?\.ownershipAvailable !== true/);
});

test('a run stops itself on any Instagram interruption and can be aborted', () => {
  assert.match(shell, /function sessionStop\(observation\)/);
  assert.match(shell, /observation\?\.rateLimited/);
  assert.match(shell, /observation\?\.challenge/);
  assert.match(shell, /observation\?\.actionBlocked/);
  assert.match(shell, /observation\?\.sessionExpired/);
  assert.match(shell, /if \(outcome\.fatal\)/);
  assert.match(shell, /if \(batchAbort\) break;/);
  assert.match(source, /data-action="stop-run"/);
});

test('runs are paced and bounded, and a reload never resumes one', () => {
  assert.match(shell, /dailyActions: \[1, 400\]/);
  assert.match(shell, /dailyUnsends: \[1, 300\]/);
  assert.match(shell, /minDelayMs: \[1_500, 600_000\]/);
  assert.match(shell, /REST_EVERY = 20/);
  assert.match(shell, /Math\.random\(\)/);
  assert.match(shell, /const allowance = Math\.max\(0, cap - already\);/);
  // Destructive runs are confirmed before they start.
  assert.match(shell, /Permanently unsend \$\{selected\.length\}/);
  assert.match(shell, /This cannot be undone/);
  // A stored run must not restart against a page nobody verified.
  assert.match(shell, /A run never survives a reload/);
});

test('the toolbox keeps every byte local and never calls out', () => {
  assert.doesNotMatch(source, /GM_xmlhttpRequest|XMLHttpRequest|document\.cookie/);
  assert.doesNotMatch(source, /fetch\s*\(/);
  const metadataBlock = source.slice(0, source.indexOf('==/UserScript=='));
  assert.doesNotMatch(metadataBlock, /@connect/);
});

test('the toolbox still yields when the extension panel is installed', () => {
  assert.match(shell, /document\.getElementById\(EXTENSION_ROOT_ID\)/);
  assert.match(shell, /duplicateObserver\.disconnect\(\)/);
  assert.match(shell, /host\.remove\(\)/);
});

test('the movable panel and local follower comparison are preserved', () => {
  assert.match(source, /Insta AIO Instagram Toolbox/);
  assert.match(source, /Follower checker/);
  assert.match(source, /Follow \/ Unfollow/);
  assert.match(source, /DM Unsend/);
  assert.match(source, /data-role="move"/);
  assert.match(source, /data-role="resize"/);
  assert.match(source, /data-preference="opacity"/);
  assert.match(source, /instaAioManualQueueV1/);
  assert.match(shell, /function compareCapture\(\)/);
  assert.match(shell, /notFollowingMeBack/);
  assert.match(shell, /iDoNotFollowBack/);
});

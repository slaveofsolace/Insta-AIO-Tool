import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(
  new URL('../userscripts/insta-aio-companion.user.js', import.meta.url),
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
  // The update URL must track the default branch, otherwise installs pin to a
  // feature branch that later disappears.
  assert.doesNotMatch(source, /raw\.githubusercontent\.com\/[^\s]*\/(?!main\/)(?:refs\/)?heads/);
  // Metadata must not pull a remote image; the icon stays self-contained.
  const metadataBlock = source.slice(0, source.indexOf('==/UserScript=='));
  assert.match(metadataBlock, /@icon\s+data:image\/svg\+xml,/);
  assert.doesNotMatch(metadataBlock, /@icon\s+https?:/);
  assert.doesNotMatch(metadataBlock, /@require|@resource/);
});

test('Tampermonkey installs a movable translucent three-tool Instagram overlay', () => {
  assert.match(source, /@version\s+0\.5\.0/);
  assert.match(source, /@match\s+https:\/\/www\.instagram\.com\/\*/);
  assert.match(source, /Insta AIO Instagram Toolbox/);
  assert.match(source, /Follower checker/);
  assert.match(source, /Follow \/ Unfollow/);
  assert.match(source, /DM Unsend/);
  assert.match(source, /data-role="move"/);
  assert.match(source, /data-role="resize"/);
  assert.match(source, /data-preference="opacity"/);
  assert.match(source, /attachShadow\(\{ mode: 'open' \}\)/);
});

test('Tampermonkey preserves the manual queue while adding local follower comparison', () => {
  assert.match(source, /instaAioManualQueueV1/);
  assert.match(source, /instaAioUserscriptStateV2/);
  assert.match(source, /function compareCapture\(\)/);
  assert.match(source, /notFollowingMeBack/);
  assert.match(source, /iDoNotFollowBack/);
  assert.match(source, /kind: 'insta-aio-visible-list'/);
  assert.match(source, /kind: 'insta-aio-companion-state'/);
});

test('Tampermonkey no-click reviews cannot activate Instagram controls', () => {
  const downloadBody = source.slice(
    source.indexOf('function downloadJson'),
    source.indexOf('const host = document.createElement'),
  );
  assert.equal((source.match(/\.click\s*\(/g) || []).length, 1);
  assert.match(downloadBody, /anchor\.click\(\)/);
  assert.doesNotMatch(source.replace(downloadBody, ''), /\.click\s*\(|dispatchEvent\s*\(/);
  assert.doesNotMatch(source, /GM_xmlhttpRequest|fetch\s*\(|XMLHttpRequest|document\.cookie|setInterval\s*\(/);
  assert.match(source, /One exact sent-message identity resolved without opening a menu/);
  assert.match(source, /Live Unsend is intentionally unavailable in userscript mode/);
  assert.match(source, /Live Follow and Unfollow are intentionally unavailable in userscript mode/);
});

test('Tampermonkey yields when the signed extension overlay is installed', () => {
  assert.match(source, /document\.getElementById\(EXTENSION_ROOT_ID\)/);
  assert.match(source, /duplicateObserver\.disconnect\(\)/);
  assert.match(source, /host\.remove\(\)/);
});

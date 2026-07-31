import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { importFileRecords } from '../src/core/imports.js';
import {
  inspectZipArchive,
  readZipJsonRecords,
  ZipImportError,
} from '../src/core/zip.js';
import { createZip } from './support/zip-fixture.js';

const exportPaths = [
  'connections/followers_and_following/followers_1.json',
  'connections/followers_and_following/followers_2.json',
  'connections/followers_and_following/following.json',
  'your_instagram_activity/messages/inbox/friend_123/message_1.json',
  'your_instagram_activity/messages/inbox/friend_123/message_2.json',
];

async function currentExportFixtureEntries() {
  return Promise.all(exportPaths.map(async (path) => ({
    path,
    content: await readFile(new URL(`./fixtures/instagram-export/${path}`, import.meta.url)),
  })));
}

test('inspects and imports a split current-layout Instagram archive offline', async () => {
  const archive = createZip(await currentExportFixtureEntries());
  const manifest = inspectZipArchive(archive);

  assert.equal(manifest.kind, 'insta-aio-zip-manifest');
  assert.equal(manifest.counts.followers, 2);
  assert.equal(manifest.counts.following, 1);
  assert.equal(manifest.counts.messages, 2);
  assert.deepEqual(manifest.entries.map((entry) => entry.path), exportPaths);

  const progress = [];
  const extracted = await readZipJsonRecords(archive, {
    manifest,
    onProgress(value) {
      progress.push(value);
    },
  });
  const result = importFileRecords(extracted.records, {
    ownerNames: ['Owner Example'],
  });

  assert.equal(extracted.records.length, 5);
  assert.equal(progress.at(-1).processed, 5);
  assert.equal(result.snapshot.followers.length, 3);
  assert.equal(result.snapshot.following.length, 2);
  assert.equal(result.messages.length, 3);
  assert.equal(result.messages.filter((message) => message.isMine).length, 2);
  assert.equal(
    result.snapshot.metadata.importedFiles.includes(
      'connections/followers_and_following/followers_2.json',
    ),
    true,
  );
  assert.equal(
    result.messages.some((message) => (
      message.source === 'meta-export'
      && message.conversationId === 'inbox/friend_123'
    )),
    true,
  );
});

test('supports stored entries and rejects integrity failures', async () => {
  const valid = createZip([
    { path: 'followers_1.json', content: '[]' },
  ], { compression: 'store' });
  const extracted = await readZipJsonRecords(valid);
  assert.equal(extracted.records[0].text, '[]');

  const wrongCrc = createZip([
    { path: 'followers_1.json', content: '[]', crcOverride: 1 },
  ], { compression: 'store' });
  await assert.rejects(
    readZipJsonRecords(wrongCrc),
    (error) => error instanceof ZipImportError && error.code === 'CRC_MISMATCH',
  );
});

test('rejects encrypted, unsafe, mismatched, and malformed archives clearly', () => {
  const encrypted = createZip([
    { path: 'followers_1.json', content: '[]', flags: 0x0801 },
  ]);
  assert.throws(
    () => inspectZipArchive(encrypted),
    (error) => error instanceof ZipImportError && error.code === 'ENCRYPTED_ARCHIVE',
  );

  const unsafe = createZip([
    { path: '../followers_1.json', content: '[]' },
  ]);
  assert.throws(
    () => inspectZipArchive(unsafe),
    (error) => error instanceof ZipImportError && error.code === 'UNSAFE_PATH',
  );

  const mismatched = createZip([
    {
      path: 'followers_1.json',
      localPath: 'following.json',
      centralPath: 'followers_1.json',
      content: '[]',
    },
  ]);
  assert.throws(
    () => inspectZipArchive(mismatched),
    (error) => error instanceof ZipImportError && error.code === 'LOCAL_HEADER_MISMATCH',
  );

  assert.throws(
    () => inspectZipArchive(new Uint8Array(22)),
    (error) => (
      error instanceof ZipImportError
      && error.code === 'MISSING_CENTRAL_DIRECTORY'
    ),
  );
});

test('enforces archive limits and supports cancellation', async () => {
  const archive = createZip([
    { path: 'followers_1.json', content: '[]' },
    { path: 'following.json', content: '{}' },
  ]);
  assert.throws(
    () => inspectZipArchive(archive, { limits: { maxEntries: 1 } }),
    (error) => error instanceof ZipImportError && error.code === 'TOO_MANY_ENTRIES',
  );

  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    readZipJsonRecords(archive, { signal: controller.signal }),
    (error) => error.name === 'AbortError',
  );
});

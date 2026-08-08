import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { inspectLegacyComponentRecord } from '../src/adapters/legacy-components.js';
import { importFileRecords } from '../src/core/imports.js';
import { migrateFollowerCheckerResult } from '../src/migrations/follower-checker.js';
import { migrateInstagramHelperData } from '../src/migrations/instagram-helper.js';
import {
  inspectSimpleInstaBotLikedPhotos,
  migrateSimpleInstaBotHistory,
} from '../src/migrations/simpleinstabot.js';
import { migrateState } from '../src/core/storage.js';

async function fixture(path) {
  return JSON.parse(await readFile(new URL(`./fixtures/${path}`, import.meta.url), 'utf8'));
}

test('migrates Instagram Helper messages with complete dispositions', async () => {
  const source = await fixture('instagram-helper/messages.json');
  const result = migrateInstagramHelperData(source, {
    sourceName: 'InstagramHelperData.json',
  });

  assert.equal(result.report.inputCount, 5);
  assert.equal(result.report.importedCount, 3);
  assert.equal(result.report.duplicateCount, 1);
  assert.equal(result.report.skippedCount, 1);
  assert.equal(result.messages.length, 3);
  assert.equal(result.messages.find((message) => message.id === 'sent-1').isMine, true);
  assert.equal(result.messages.find((message) => message.id === 'received-1').isMine, false);
  assert.equal(result.report.manualCorrections.some((entry) => (
    entry.includes('conversation identity')
  )), true);
});

test('migrates SimpleInstaBot history without silently dropping records', async () => {
  const source = await fixture('simpleinstabot/fixture.owner-followed.json');
  const result = migrateSimpleInstaBotHistory(source, {
    action: 'follow',
    sourceName: 'fixture.owner-followed.json',
  });

  assert.equal(result.report.inputCount, 7);
  assert.equal(result.report.importedCount, 3);
  assert.equal(result.report.duplicateCount, 1);
  assert.equal(result.report.skippedCount, 3);
  assert.deepEqual(result.legacyActions.map((entry) => entry.status), [
    'completed',
    'failed',
    'skipped',
  ]);
});

test('reports unsupported SimpleInstaBot liked-photo records', async () => {
  const source = await fixture('simpleinstabot/fixture.owner-liked-photos.json');
  const result = inspectSimpleInstaBotLikedPhotos(source, {
    sourceName: 'fixture.owner-liked-photos.json',
  });

  assert.equal(result.report.inputCount, 1);
  assert.equal(result.report.importedCount, 0);
  assert.equal(result.report.skippedCount, 1);
  assert.match(result.report.warnings[0], /outside the Insta AIO data contract/);
});

test('preserves follower-checker output as a non-actionable partial report', async () => {
  const source = await fixture('follower-checker/result.json');
  const result = migrateFollowerCheckerResult(source, {
    sourceName: 'result.json',
  });

  assert.equal(result.report.inputCount, 8);
  assert.equal(result.report.importedCount, 4);
  assert.equal(result.report.duplicateCount, 2);
  assert.equal(result.report.skippedCount, 2);
  assert.equal(result.relationshipReport.complete, false);
  assert.equal(result.relationshipReport.actionable, false);
  assert.deepEqual(
    result.relationshipReport.iDoNotFollowBack.map((account) => account.username),
    ['follower.only', 'second_follower'],
  );
  assert.deepEqual(
    result.relationshipReport.notFollowingBack.map((account) => account.username),
    ['following.only', 'second_following'],
  );
});

test('legacy adapter detects all three audited component families', async () => {
  const helper = inspectLegacyComponentRecord({
    name: 'InstagramHelperData.json',
    data: await fixture('instagram-helper/messages.json'),
  });
  const bot = inspectLegacyComponentRecord({
    name: 'fixture.owner-unfollowed.json',
    data: await fixture('simpleinstabot/fixture.owner-unfollowed.json'),
  });
  const checker = inspectLegacyComponentRecord({
    name: 'result.json',
    data: await fixture('follower-checker/result.json'),
    lastModified: 1700000000000,
  });

  assert.equal(helper.component, 'instagram-helper');
  assert.equal(bot.component, 'simpleinstabot');
  assert.equal(checker.component, 'follower-checker');
  assert.equal(bot.legacyActions.length, 3);
  assert.equal(bot.migrationReport.inputCount, 3);
  assert.equal(bot.migrationReport.importedCount, 3);
  assert.equal(bot.migrationReport.duplicateCount, 0);
  assert.equal(bot.migrationReport.skippedCount, 0);
  assert.equal(checker.relationshipReports[0].actionable, false);
});

test('migrates schema version 1 state additively for source reports', () => {
  const migrated = migrateState({
    schemaVersion: 1,
    snapshots: [{ id: 'preserved-snapshot' }],
    queue: [{ id: 'preserved-queue-item' }],
    messages: [{ id: 'preserved-message' }],
    activity: [{ id: 'preserved-activity' }],
  });

  assert.equal(migrated.schemaVersion, 3);
  assert.equal(migrated.snapshots[0].id, 'preserved-snapshot');
  assert.equal(migrated.queue[0].id, 'preserved-queue-item');
  assert.equal(migrated.messages[0].id, 'preserved-message');
  assert.equal(migrated.activity[0].id, 'preserved-activity');
  assert.deepEqual(migrated.migrationReports, []);
  assert.deepEqual(migrated.relationshipReports, []);
  assert.deepEqual(migrated.actionJobs, []);
  assert.deepEqual(migrated.actionLedger, []);
  assert.deepEqual(migrated.dmJobs, []);
  assert.deepEqual(migrated.dmLedger, []);
  assert.deepEqual(migrated.selectedQueueItemIds, []);
  assert.equal(migrated.settings.liveActionEnabled, false);
  assert.equal(migrated.settings.liveDmUnsendEnabled, false);
});

test('normalizes restored daily limits before they reach the live ledger', () => {
  const malformed = migrateState({
    settings: {
      dailyFollowLimit: 'not-a-number',
      dailyUnfollowLimit: 'Infinity',
    },
  });
  assert.equal(malformed.settings.dailyFollowLimit, 1);
  assert.equal(malformed.settings.dailyUnfollowLimit, 1);

  const bounded = migrateState({
    settings: {
      dailyFollowLimit: 12.9,
      dailyUnfollowLimit: 50_000,
    },
  });
  assert.equal(bounded.settings.dailyFollowLimit, 12);
  assert.equal(bounded.settings.dailyUnfollowLimit, 500);
});

test('imports all audited component formats through the application pipeline', async () => {
  const helper = await fixture('instagram-helper/messages.json');
  const followed = await fixture('simpleinstabot/fixture.owner-followed.json');
  const unfollowed = await fixture('simpleinstabot/fixture.owner-unfollowed.json');
  const likedPhotos = await fixture('simpleinstabot/fixture.owner-liked-photos.json');
  const checker = await fixture('follower-checker/result.json');

  const result = importFileRecords([
    { name: 'InstagramHelperData.json', data: helper, lastModified: 1700000000000 },
    { name: 'fixture.owner-followed.json', data: followed, lastModified: 1700000001000 },
    { name: 'fixture.owner-unfollowed.json', data: unfollowed, lastModified: 1700000002000 },
    { name: 'fixture.owner-liked-photos.json', data: likedPhotos, lastModified: 1700000003000 },
    { name: 'follower-checker-result.json', data: checker, lastModified: 1700000004000 },
  ]);

  assert.equal(result.messages.length, 3);
  assert.equal(result.legacyActions.length, 6);
  assert.equal(result.relationshipReports.length, 1);
  assert.equal(result.relationshipReports[0].actionable, false);
  assert.equal(result.migrationReports.length, 5);
  assert.deepEqual(
    result.migrationReports.map((report) => report.source),
    [
      'instagram-helper',
      'simpleinstabot',
      'simpleinstabot',
      'simpleinstabot-liked-photos',
      'abir-taheer-follower-checker',
    ],
  );
});

test('handles an invalid follower-checker capture time without throwing', () => {
  const result = migrateFollowerCheckerResult({
    PeopleIDontFollowBack: [],
    PeopleNotFollowingMeBack: [],
  }, {
    sourceName: 'result.json',
    capturedAt: 'not-a-date',
  });

  assert.equal(result.relationshipReport.capturedAt, null);
  assert.equal(result.report.manualCorrections.some((entry) => (
    entry.includes('capture time')
  )), true);
});

test('precaches component migration modules for offline PWA startup', async () => {
  const serviceWorker = await readFile(new URL('../sw.js', import.meta.url), 'utf8');
  for (const path of [
    './src/adapters/legacy-components.js',
    './src/migrations/migration-report.js',
    './src/migrations/instagram-helper.js',
    './src/migrations/simpleinstabot.js',
    './src/migrations/follower-checker.js',
  ]) {
    assert.equal(serviceWorker.includes(`'${path}'`), true, `${path} is not precached`);
  }
});

test('PWA refreshes online assets while retaining an offline cache fallback', async () => {
  const serviceWorker = await readFile(new URL('../sw.js', import.meta.url), 'utf8');
  const loader = await readFile(new URL('../src/app.parts/part-04.jsfrag', import.meta.url), 'utf8');

  assert.match(serviceWorker, /const CACHE_NAME = 'insta-aio-v11'/);
  assert.ok(
    serviceWorker.indexOf('await fetch(event.request)') < serviceWorker.indexOf('await caches.match(event.request)'),
    'online fetch must be attempted before the offline cache fallback',
  );
  assert.match(serviceWorker, /requestUrl\.origin === self\.location\.origin/);
  assert.match(loader, /updateViaCache: 'none'/);
  assert.match(loader, /registration\.update\(\)/);
});

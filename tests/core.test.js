import test from 'node:test';
import assert from 'node:assert/strict';

import { normalizeAccount } from '../src/core/accounts.js';
import { importFileRecords } from '../src/core/imports.js';
import {
  createUnsendPlan,
  filterMessages,
  parseInstagramHelperData,
  parseMetaConversation,
} from '../src/core/messages.js';
import {
  addFollowTargets,
  markQueueItem,
  refreshQueue,
} from '../src/core/queue.js';
import {
  classifyRelationships,
  compareSnapshots,
  createSnapshot,
} from '../src/core/snapshots.js';

test('normalizes Instagram profile URLs into usernames', () => {
  assert.equal(normalizeAccount('https://www.instagram.com/Example.User/?hl=en').username, 'example.user');
  assert.equal(normalizeAccount('@Another_User').username, 'another_user');
});

test('compares snapshots and recognizes ID-backed username changes', () => {
  const previous = createSnapshot({
    capturedAt: 1_700_000_000_000,
    followers: [
      { id: '1', username: 'old_name' },
      { id: '2', username: 'lost_user' },
    ],
    following: [{ id: '3', username: 'kept' }],
  });
  const current = createSnapshot({
    capturedAt: 1_700_086_400_000,
    followers: [
      { id: '1', username: 'new_name' },
      { id: '4', username: 'new_follower' },
    ],
    following: [{ id: '3', username: 'kept' }],
  });

  const diff = compareSnapshots(previous, current);
  assert.deepEqual(diff.lostFollowers.map((a) => a.username), ['lost_user']);
  assert.deepEqual(diff.newFollowers.map((a) => a.username), ['new_follower']);
  assert.deepEqual(diff.renamed, [{ id: '1', from: 'old_name', to: 'new_name' }]);
});

test('classifies mutual and non-mutual relationships', () => {
  const snapshot = createSnapshot({
    followers: ['mutual', 'fan_only'],
    following: ['mutual', 'not_back'],
  });
  const relationships = classifyRelationships(snapshot);
  assert.deepEqual(relationships.mutuals.map((a) => a.username), ['mutual']);
  assert.deepEqual(relationships.notFollowingBack.map((a) => a.username), ['not_back']);
  assert.deepEqual(relationships.iDoNotFollowBack.map((a) => a.username), ['fan_only']);
});

test('creates an unfollow review after the waiting period when no follow-back exists', () => {
  const startedAt = Date.UTC(2026, 0, 1);
  let queue = addFollowTargets([], ['target_user'], { createdAt: startedAt });
  queue = markQueueItem(queue, queue[0].id, 'completed', startedAt);

  const snapshot = createSnapshot({
    capturedAt: startedAt + 8 * 86_400_000,
    followers: [],
    following: ['target_user'],
  });
  queue = refreshQueue(queue, snapshot, {
    waitingDays: 7,
    protectMutuals: true,
    whitelist: [],
    preexistingFollowing: [],
  }, startedAt + 8 * 86_400_000);

  assert.equal(queue.find((item) => item.action === 'unfollow')?.status, 'ready');
});

test('waiting follow entries are reevaluated after their due date', () => {
  const startedAt = Date.UTC(2026, 0, 1);
  let queue = addFollowTargets([], ['later_target'], { createdAt: startedAt });
  queue = markQueueItem(queue, queue[0].id, 'completed', startedAt);
  const snapshot = createSnapshot({ followers: [], following: ['later_target'] });
  queue = refreshQueue(queue, snapshot, { waitingDays: 7 }, startedAt + 1_000);
  assert.equal(queue[0].status, 'waiting');
  queue = refreshQueue(queue, snapshot, { waitingDays: 7 }, startedAt + 8 * 86_400_000);
  assert.equal(queue.some((item) => item.action === 'unfollow' && item.status === 'ready'), true);
});

test('protects a completed follow when the account followed back', () => {
  const startedAt = Date.UTC(2026, 0, 1);
  let queue = addFollowTargets([], ['mutual_user'], { createdAt: startedAt });
  queue = markQueueItem(queue, queue[0].id, 'completed', startedAt);
  const snapshot = createSnapshot({ followers: ['mutual_user'], following: ['mutual_user'] });
  queue = refreshQueue(queue, snapshot, { waitingDays: 7, protectMutuals: true }, startedAt + 8 * 86_400_000);
  assert.equal(queue[0].status, 'protected');
  assert.equal(queue.some((item) => item.action === 'unfollow'), false);
});

test('does not turn migration-only history into a new action', () => {
  const startedAt = Date.UTC(2026, 0, 1);
  let queue = addFollowTargets([], ['historical_target'], { createdAt: startedAt });
  queue = markQueueItem(queue, queue[0].id, 'completed', startedAt);
  queue[0].migrationOnly = true;
  const snapshot = createSnapshot({ followers: [], following: ['historical_target'] });

  queue = refreshQueue(queue, snapshot, { waitingDays: 7 }, startedAt + 30 * 86_400_000);

  assert.equal(queue[0].status, 'completed');
  assert.equal(queue.some((item) => item.action === 'unfollow'), false);
});

test('imports Meta follower and following JSON formats', () => {
  const result = importFileRecords([
    {
      name: 'followers_1.json',
      text: JSON.stringify([
        { string_list_data: [{ value: 'Follower.One', href: 'https://instagram.com/follower.one/', timestamp: 1_700_000_000 }] },
      ]),
      lastModified: 100,
    },
    {
      name: 'following.json',
      text: JSON.stringify({
        relationships_following: [
          { string_list_data: [{ value: 'Following.One', href: 'https://instagram.com/following.one/', timestamp: 1_700_000_001 }] },
        ],
      }),
      lastModified: 200,
    },
  ]);

  assert.equal(result.snapshot.followers[0].username, 'follower.one');
  assert.equal(result.snapshot.following[0].username, 'following.one');
});

test('migrates SimpleInstaBot history records', () => {
  const result = importFileRecords([
    {
      name: 'myaccount-followed.json',
      text: JSON.stringify([{ username: 'target', time: 1_700_000_000_000 }]),
      lastModified: 1,
    },
    {
      name: 'myaccount-unfollowed.json',
      text: JSON.stringify([{ username: 'old_target', time: 1_700_100_000_000, failed: true }]),
      lastModified: 2,
    },
  ]);
  assert.deepEqual(result.legacyActions.map((item) => [item.action, item.status]), [
    ['follow', 'completed'],
    ['unfollow', 'failed'],
  ]);
});

test('parses old InstagramHelper message data', () => {
  const messages = parseInstagramHelperData({
    myUserId: 1,
    usersChatParticipants: [{ pk: 1, username: 'me' }, { pk: 2, username: 'friend' }],
    allMessagesItemsArray: [
      { item_id: 'a', user_id: 1, item_type: 'text', text: 'sent', timestamp: 1_700_000_000_000_000 },
      { item_id: 'b', user_id: 2, item_type: 'text', text: 'received', timestamp: 1_700_000_001_000 },
    ],
  });
  assert.equal(messages[0].isMine, true);
  assert.equal(messages[0].timestamp, 1_700_000_000_000);
  assert.equal(messages[1].isMine, false);
});

test('parses Meta conversations and produces sent-only unsend plans', () => {
  const messages = parseMetaConversation({
    participants: [{ name: 'Sam' }, { name: 'Friend' }],
    messages: [
      { sender_name: 'Sam', timestamp_ms: 10, content: 'remove me' },
      { sender_name: 'Friend', timestamp_ms: 20, content: 'do not remove' },
    ],
  }, { sourceName: 'thread/message_1.json', ownerNames: ['Sam'] });

  const filtered = filterMessages(messages, { onlyMine: true, keyword: 'remove' });
  assert.equal(filtered.length, 1);
  const plan = createUnsendPlan(messages, messages.map((message) => message.id));
  assert.equal(plan.total, 1);
  assert.equal(plan.messages[0].preview, 'remove me');
});

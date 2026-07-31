import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createInstagramDmUnsenderAdapter,
  directThreadId,
  INSTAGRAM_DM_UNSENDER_SOURCE,
  resolveExactDmCandidate,
} from '../src/adapters/instagram-dm-unsender.js';
import { reportInstagramDmUnsenderMigration } from '../src/migrations/instagram-dm-unsender.js';

const item = {
  conversationId: 'inbox/friend_123456',
  messageId: 'message-1',
  timestamp: 1_700_000_000_000,
  contentDigest: 'deadbeef',
  sentByMe: true,
  resolutionToken: 'row-token',
};

function candidate(overrides = {}) {
  return {
    conversationId: item.conversationId,
    messageId: item.messageId,
    timestamp: item.timestamp,
    contentDigest: item.contentDigest,
    sentByMe: true,
    resolutionToken: 'row-token',
    ...overrides,
  };
}

test('pins the supplied DM-unsender source and reports its stateless migration', () => {
  assert.equal(INSTAGRAM_DM_UNSENDER_SOURCE.version, '0.7.2');
  assert.equal(
    INSTAGRAM_DM_UNSENDER_SOURCE.sha256,
    '2DC5D357B6C3BBFE1F9E10E8D2F9252E7446C490FB3C16DF1B59719CB1D1FE2C',
  );
  const report = reportInstagramDmUnsenderMigration();
  assert.equal(report.inputCount, 0);
  assert.equal(report.importedCount, 0);
  assert.equal(report.sourceRevision, INSTAGRAM_DM_UNSENDER_SOURCE.sha256);
  assert.match(report.warnings[0], /no durable queue, checkpoint, or message-identity/);
});

test('maps export conversation paths only when a stable thread ID is present', () => {
  assert.equal(directThreadId('inbox/friend_123456'), '123456');
  assert.equal(directThreadId('https://www.instagram.com/direct/t/123456/'), '123456');
  assert.equal(directThreadId('inbox/friend_without_id'), null);
});

test('requires one exact sent-message candidate with a durable resolution token', () => {
  assert.equal(resolveExactDmCandidate(item, []).missing, true);
  assert.equal(resolveExactDmCandidate(item, [candidate(), candidate()]).ambiguous, true);
  assert.equal(
    resolveExactDmCandidate(item, [candidate({ sentByMe: false })]).sentByMe,
    false,
  );
  assert.equal(
    resolveExactDmCandidate(item, [candidate({ resolutionToken: null })]).unexpectedUi,
    true,
  );
  assert.equal(resolveExactDmCandidate(item, [candidate()]).resolutionToken, 'row-token');
});

test('source adapter revalidates identity and uses only exact Unsend controls', async () => {
  const calls = [];
  const boundary = {
    async inspectSession() {
      calls.push('session');
      return {};
    },
    async inspectConversation() {
      calls.push('conversation');
      return { url: 'https://www.instagram.com/direct/t/123456/' };
    },
    async inspectMessages() {
      calls.push('messages');
      return [candidate()];
    },
    async openMessageActions(token) {
      calls.push(`open-menu:${token}`);
      return { options: [{ label: 'Unsend', token: 'unsend-token' }] };
    },
    async openUnsendConfirmation(token) {
      calls.push(`open-confirm:${token}`);
      return {
        conversationId: item.conversationId,
        messageId: item.messageId,
        sentByMe: true,
        label: 'Unsend',
        confirmToken: 'confirm-token',
      };
    },
    async confirmUnsend(token) {
      calls.push(`confirm:${token}`);
      return { result: 'unsent' };
    },
  };
  const adapter = createInstagramDmUnsenderAdapter(boundary);
  assert.equal((await adapter.resolveConversation(item.conversationId)).conversationId, item.conversationId);
  assert.equal((await adapter.resolveMessage(item)).resolutionToken, 'row-token');
  const result = await adapter.performReviewedUnsend(item);
  assert.equal(result.result, 'unsent');
  assert.deepEqual(calls, [
    'conversation',
    'messages',
    'messages',
    'open-menu:row-token',
    'open-confirm:unsend-token',
    'confirm:confirm-token',
  ]);
});

test('source adapter safe-stops before confirmation when the menu is ambiguous', async () => {
  let confirmationCalls = 0;
  const adapter = createInstagramDmUnsenderAdapter({
    async inspectSession() {
      return {};
    },
    async inspectConversation() {
      return { url: 'https://www.instagram.com/direct/t/123456/' };
    },
    async inspectMessages() {
      return [candidate()];
    },
    async openMessageActions() {
      return {
        options: [
          { label: 'Unsend', token: 'first' },
          { label: 'Unsend', token: 'second' },
        ],
      };
    },
    async openUnsendConfirmation() {
      confirmationCalls += 1;
      return {};
    },
    async confirmUnsend() {
      confirmationCalls += 1;
      return {};
    },
  });

  const result = await adapter.performReviewedUnsend(item);
  assert.equal(result.unexpectedUi, true);
  assert.equal(result.reason, 'unsend-menu-item-not-exact');
  assert.equal(confirmationCalls, 0);
});

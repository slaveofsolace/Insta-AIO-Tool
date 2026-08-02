import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

import { dmContentDigest } from '../src/core/dm-jobs.js';

const source = await readFile(
  new URL('../extension/content-instagram.js', import.meta.url),
  'utf8',
);

class FakeElement {
  constructor({
    attributes = {},
    children = [],
    justifyContent = 'normal',
    text = '',
  } = {}) {
    this.attributes = { ...attributes };
    this.children = children;
    this.justifyContent = justifyContent;
    this.ownText = text;
    this.parent = null;
    this.isConnected = true;
    for (const child of children) child.parent = this;
  }

  get textContent() {
    return `${this.ownText}${this.children.map((child) => child.textContent).join('')}`;
  }

  getAttribute(name) {
    return Object.hasOwn(this.attributes, name) ? this.attributes[name] : null;
  }

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] || null;
  }

  querySelectorAll(selector) {
    const descendants = [];
    const visit = (element) => {
      for (const child of element.children) {
        descendants.push(child);
        visit(child);
      }
    };
    visit(this);
    if (selector === '[data-insta-aio-message-content]') {
      return descendants.filter((element) => element.getAttribute('data-insta-aio-message-content') != null);
    }
    if (selector === '[dir="auto"]') {
      return descendants.filter((element) => element.getAttribute('dir') === 'auto');
    }
    if (selector === 'time[datetime]') {
      return descendants.filter((element) => element.getAttribute('datetime') != null);
    }
    return [];
  }

  closest(selector) {
    let current = this;
    while (current) {
      const role = current.getAttribute('role');
      if (selector.includes('[role="row"]') && role === 'row') return current;
      if (selector.includes('[role="listitem"]') && role === 'listitem') return current;
      current = current.parent;
    }
    return null;
  }

  click() {
    throw new Error('DM inspection must never click.');
  }
}

function messageRow({
  content = 'Yes — reviewing it now.',
  justifyContent = 'normal',
  messageId = 'sent-1',
  sentByMe = true,
  timestamp = 1_700_000_000_100,
} = {}) {
  const contentElement = new FakeElement({
    attributes: {
      'data-insta-aio-message-content': '',
      dir: 'auto',
    },
    text: content,
  });
  return new FakeElement({
    attributes: {
      'data-message-id': messageId,
      ...(typeof sentByMe === 'boolean' ? { 'data-sent-by-me': String(sentByMe) } : {}),
      'data-timestamp-ms': String(timestamp),
      role: 'row',
    },
    children: [contentElement],
    justifyContent,
  });
}

function createHarness(rows, { pathname = '/direct/t/123/' } = {}) {
  let runtimeListener = null;
  const scope = {
    querySelectorAll(selector) {
      if (selector === '[data-message-id], [data-item-id]') return rows;
      return [];
    },
  };
  const document = {
    body: { innerText: '' },
    querySelector(selector) {
      if (selector === '[data-pagelet="IGDMessagesList"]' || selector === 'main') return scope;
      return null;
    },
    querySelectorAll() {
      return [];
    },
  };
  const context = vm.createContext({
    chrome: {
      runtime: {
        onMessage: {
          addListener(listener) {
            runtimeListener = listener;
          },
        },
      },
    },
    console,
    crypto: webcrypto,
    document,
    getComputedStyle: (element) => ({
      display: 'block',
      justifyContent: element.justifyContent,
      visibility: 'visible',
    }),
    location: {
      href: `https://www.instagram.com${pathname}`,
      pathname,
    },
    setTimeout,
  });
  vm.runInContext(source, context);

  return {
    send(request) {
      return new Promise((resolve) => {
        const result = runtimeListener(request, {}, resolve);
        if (result !== true) queueMicrotask(() => resolve(undefined));
      });
    },
  };
}

function reviewedItem(overrides = {}) {
  const content = overrides.content || 'Yes — reviewing it now.';
  return {
    conversationId: 'inbox/friend_123',
    contentDigest: dmContentDigest(content),
    messageId: 'sent-1',
    sentByMe: true,
    timestamp: 1_700_000_000_100,
    ...overrides,
  };
}

test('resolves one stable sent-message identity without opening a menu', async () => {
  const harness = createHarness([messageRow()]);
  const observed = await harness.send({
    kind: 'insta-aio-inspect-reviewed-dm-item',
    item: reviewedItem(),
  });

  assert.equal(observed.conversationId, 'inbox/friend_123');
  assert.equal(observed.messageId, 'sent-1');
  assert.equal(observed.sentByMe, true);
  assert.equal(observed.exactIdentityAvailable, true);
  assert.equal(observed.ownershipAvailable, true);
  assert.equal(typeof observed.resolutionToken, 'string');
  assert.equal(observed.evidence.identityAttribute, 'data-message-id');
  assert.equal(observed.evidence.timestampBasis, 'data-timestamp-ms');
});

test('missing stable identity and wrong conversations fail closed', async () => {
  const missing = createHarness([]);
  const missingResult = await missing.send({
    kind: 'insta-aio-inspect-reviewed-dm-item',
    item: reviewedItem(),
  });
  assert.equal(missingResult.reason, 'exact-message-identity-unavailable');
  assert.equal(missingResult.resolutionToken, undefined);

  const wrongConversation = createHarness([messageRow()], { pathname: '/direct/t/999/' });
  const wrongResult = await wrongConversation.send({
    kind: 'insta-aio-inspect-reviewed-dm-item',
    item: reviewedItem(),
  });
  assert.equal(wrongResult.reason, 'wrong-conversation');
  assert.equal(wrongResult.resolutionToken, undefined);
});

test('duplicate identities, changed content, and received ownership fail closed', async () => {
  const duplicate = createHarness([messageRow(), messageRow()]);
  const duplicateResult = await duplicate.send({
    kind: 'insta-aio-inspect-reviewed-dm-item',
    item: reviewedItem(),
  });
  assert.equal(duplicateResult.reason, 'exact-message-ambiguous');

  const changed = createHarness([messageRow({ content: 'Changed content' })]);
  const changedResult = await changed.send({
    kind: 'insta-aio-inspect-reviewed-dm-item',
    item: reviewedItem(),
  });
  assert.equal(changedResult.reason, 'exact-message-not-found');

  const received = createHarness([messageRow({ sentByMe: false })]);
  const receivedResult = await received.send({
    kind: 'insta-aio-inspect-reviewed-dm-item',
    item: reviewedItem(),
  });
  assert.equal(receivedResult.reason, 'received-message');
  assert.equal(receivedResult.resolutionToken, undefined);
});

test('source-audited sent layout resolves while unknown ownership fails closed', async () => {
  const sentLayout = createHarness([messageRow({
    justifyContent: 'flex-end',
    sentByMe: null,
  })]);
  const sentResult = await sentLayout.send({
    kind: 'insta-aio-inspect-reviewed-dm-item',
    item: reviewedItem(),
  });
  assert.equal(sentResult.sentByMe, true);
  assert.equal(sentResult.evidence.ownershipBasis, 'flex-end-layout');

  const unknown = createHarness([messageRow({ sentByMe: null })]);
  const unknownResult = await unknown.send({
    kind: 'insta-aio-inspect-reviewed-dm-item',
    item: reviewedItem(),
  });
  assert.equal(unknownResult.reason, 'message-ownership-unavailable');
  assert.equal(unknownResult.resolutionToken, undefined);
});

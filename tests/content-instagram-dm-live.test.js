import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

import { dmContentDigest } from '../src/core/dm-jobs.js';

const [actionLabelsSource, source] = await Promise.all([
  readFile(new URL('../extension/action-labels.js', import.meta.url), 'utf8'),
  readFile(new URL('../extension/content-instagram.js', import.meta.url), 'utf8'),
]);

class FakeEvent {
  constructor(type, options = {}) {
    this.type = type;
    Object.assign(this, options);
  }
}

class FakeElement {
  constructor({
    attributes = {},
    children = [],
    onClick = null,
    tagName = 'DIV',
    text = '',
  } = {}) {
    this.attributes = { ...attributes };
    this.children = children;
    this.isConnected = true;
    this.justifyContent = 'normal';
    this.onClick = onClick;
    this.ownText = text;
    this.parent = null;
    this.tagName = tagName.toUpperCase();
    for (const child of children) child.parent = this;
  }

  get textContent() {
    return `${this.ownText}${this.children.map((child) => child.textContent).join('')}`;
  }

  getAttribute(name) {
    return Object.hasOwn(this.attributes, name) ? this.attributes[name] : null;
  }

  setAttribute(name, value) {
    this.attributes[name] = String(value);
  }

  removeAttribute(name) {
    delete this.attributes[name];
  }

  descendants() {
    const result = [];
    const visit = (element) => {
      for (const child of element.children) {
        result.push(child);
        visit(child);
      }
    };
    visit(this);
    return result;
  }

  contains(candidate) {
    return candidate === this || this.descendants().includes(candidate);
  }

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] || null;
  }

  querySelectorAll(selector) {
    const descendants = this.descendants();
    if (selector === '[data-message-id], [data-item-id]') {
      return descendants.filter((element) => (
        element.getAttribute('data-message-id') != null
        || element.getAttribute('data-item-id') != null
      ));
    }
    if (selector === '[data-insta-aio-message-content]') {
      return descendants.filter((element) => element.getAttribute('data-insta-aio-message-content') != null);
    }
    if (selector === '[dir="auto"]') {
      return descendants.filter((element) => element.getAttribute('dir') === 'auto');
    }
    if (selector === 'time[datetime]') {
      return descendants.filter((element) => element.getAttribute('datetime') != null);
    }
    if (selector === '[role="button"][aria-haspopup="menu"]') {
      return descendants.filter((element) => (
        element.getAttribute('role') === 'button'
        && element.getAttribute('aria-haspopup') === 'menu'
      ));
    }
    if (selector === 'button, [role="button"], [role="menuitem"], span, div') {
      return descendants.filter((element) => (
        element.tagName === 'BUTTON'
        || element.tagName === 'SPAN'
        || element.tagName === 'DIV'
        || ['button', 'menuitem'].includes(element.getAttribute('role'))
      ));
    }
    const ariaStarts = selector.match(/^\[aria-label\^='([^']+)'\]$/);
    if (ariaStarts) {
      return descendants.filter((element) => (
        String(element.getAttribute('aria-label') || '').startsWith(ariaStarts[1])
      ));
    }
    const ariaIncludes = selector.match(/^\[aria-label\*='([^']+)'\]$/);
    if (ariaIncludes) {
      return descendants.filter((element) => (
        String(element.getAttribute('aria-label') || '').includes(ariaIncludes[1])
      ));
    }
    return [];
  }

  closest(selector) {
    let current = this;
    while (current) {
      const role = current.getAttribute('role');
      if (selector.includes('[role="row"]') && role === 'row') return current;
      if (selector.includes('[role="listitem"]') && role === 'listitem') return current;
      if (
        selector.includes('button')
        && (
          current.tagName === 'BUTTON'
          || role === 'button'
          || role === 'menuitem'
        )
      ) return current;
      current = current.parent;
    }
    return null;
  }

  getBoundingClientRect() {
    return { x: 0, y: 0, width: 100, height: 40 };
  }

  dispatchEvent() {
    return true;
  }

  click() {
    this.onClick?.();
  }

  disconnect() {
    this.isConnected = false;
    for (const child of this.children) child.disconnect();
  }
}

function createHarness({
  bindSurfaces = true,
  nestedFlexEnd = false,
  plainTextUnsendControls = false,
  postConfirmation = 'remove',
  preexistingDialog = false,
  secureCrypto = webcrypto,
  unsendLabel = 'Unsend',
} = {}) {
  let runtimeListener = null;
  const activations = [];
  const surfaces = { dialogs: [], menus: [] };
  const locationState = {
    href: 'https://www.instagram.com/direct/t/123/',
    pathname: '/direct/t/123/',
  };
  const content = 'Reviewed exact message';
  const item = {
    conversationId: 'inbox/friend_123',
    contentDigest: dmContentDigest(content),
    messageId: 'sent-live-1',
    sentByMe: true,
    timestamp: 1_700_000_000_100,
  };

  const scope = new FakeElement({ attributes: { 'data-pagelet': 'IGDMessagesList' } });
  const confirmation = new FakeElement({
    attributes: bindSurfaces ? { 'data-insta-aio-bound-control': 'dm-dialog-1' } : {},
    tagName: plainTextUnsendControls ? 'SPAN' : 'BUTTON',
    text: unsendLabel,
    onClick() {
      activations.push('confirmation');
      const row = scope.children[0];
      if (postConfirmation === 'remove') {
        row?.disconnect();
        scope.children = scope.children.filter((child) => child !== row);
      } else if (postConfirmation === 'wrong-thread') {
        locationState.href = 'https://www.instagram.com/direct/t/999/';
        locationState.pathname = '/direct/t/999/';
      } else if (postConfirmation === 'identity-loss') {
        row?.removeAttribute('data-message-id');
      }
      surfaces.dialogs.forEach((dialog) => dialog.disconnect());
      surfaces.dialogs = [];
      surfaces.menus = [];
    },
  });
  const menuChoice = new FakeElement({
    attributes: {
      ...(plainTextUnsendControls ? {} : { role: 'menuitem' }),
      ...(bindSurfaces ? { 'aria-controls': 'dm-dialog-1', id: 'dm-menu-choice-1' } : {}),
    },
    children: plainTextUnsendControls ? [] : [new FakeElement({ tagName: 'SPAN', text: unsendLabel })],
    tagName: plainTextUnsendControls ? 'SPAN' : 'DIV',
    text: plainTextUnsendControls ? unsendLabel : '',
    onClick() {
      activations.push('menu-choice');
      surfaces.menus.forEach((menu) => menu.disconnect());
      surfaces.menus = [];
      surfaces.dialogs = [new FakeElement({
        attributes: {
          role: 'dialog',
          ...(bindSurfaces ? { id: 'dm-dialog-1', 'aria-labelledby': 'dm-menu-choice-1' } : {}),
        },
        children: [confirmation],
      })];
    },
  });
  const actionControl = new FakeElement({
    attributes: {
      'aria-haspopup': 'menu',
      'aria-label': 'See more options for message sent-live-1',
      ...(bindSurfaces ? { 'aria-controls': 'dm-menu-1', id: 'dm-action-1' } : {}),
      role: 'button',
    },
    onClick() {
      activations.push('action-menu');
      surfaces.menus = [new FakeElement({
        attributes: {
          role: 'menu',
          ...(bindSurfaces ? { id: 'dm-menu-1', 'aria-labelledby': 'dm-action-1' } : {}),
        },
        children: [menuChoice],
      })];
    },
  });
  const contentElement = new FakeElement({
    attributes: { 'data-insta-aio-message-content': '', dir: 'auto' },
    text: content,
  });
  const row = new FakeElement({
    attributes: {
      'data-message-id': item.messageId,
      ...(nestedFlexEnd ? {} : { 'data-sent-by-me': 'true' }),
      'data-timestamp-ms': String(item.timestamp),
      role: 'row',
    },
    children: [contentElement, actionControl],
  });
  const retainedIdentityControl = new FakeElement({
    attributes: { 'data-insta-aio-message-content': '', dir: 'auto' },
    text: 'Another message keeps stable identity coverage available',
  });
  const retainedIdentityRow = new FakeElement({
    attributes: {
      'data-message-id': 'other-message',
      'data-sent-by-me': 'true',
      'data-timestamp-ms': String(item.timestamp - 1_000),
      role: 'row',
    },
    children: [retainedIdentityControl],
  });
  scope.children = [row, retainedIdentityRow];
  row.parent = scope;
  retainedIdentityRow.parent = scope;
  if (nestedFlexEnd) actionControl.justifyContent = 'flex-end';

  if (preexistingDialog) {
    surfaces.dialogs = [new FakeElement({
      attributes: { role: 'dialog' },
      children: [new FakeElement({ tagName: 'BUTTON', text: 'Unrelated' })],
    })];
  }

  const document = {
    body: { innerText: '' },
    querySelector(selector) {
      if (selector === '[data-pagelet="IGDMessagesList"]' || selector === 'main') return scope;
      return null;
    },
    querySelectorAll(selector) {
      if (selector === '[role="dialog"]') return surfaces.dialogs;
      if (selector === '[role="menu"], [role="listbox"]') return surfaces.menus;
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
    crypto: secureCrypto,
    document,
    getComputedStyle: (element) => ({
      display: 'block',
      justifyContent: element.justifyContent,
      visibility: 'visible',
    }),
    location: locationState,
    MouseEvent: FakeEvent,
    PointerEvent: FakeEvent,
    setTimeout,
  });
  vm.runInContext(actionLabelsSource, context);
  vm.runInContext(source, context);

  return {
    activations,
    item,
    send(request) {
      return new Promise((resolve) => {
        const result = runtimeListener(request, {}, resolve);
        if (result !== true) queueMicrotask(() => resolve(undefined));
      });
    },
  };
}

test('one exact DM token drives only its menu, Unsend choice, and confirmation once', async () => {
  const harness = createHarness();
  const resolution = await harness.send({
    kind: 'insta-aio-inspect-reviewed-dm-item',
    item: harness.item,
  });
  assert.equal(typeof resolution.resolutionToken, 'string');

  const result = await harness.send({
    kind: 'insta-aio-perform-reviewed-dm-unsend',
    item: { ...harness.item, resolutionToken: resolution.resolutionToken },
  });
  assert.equal(result.result, 'unsent');
  assert.deepEqual(harness.activations, ['action-menu', 'menu-choice', 'confirmation']);

  const replay = await harness.send({
    kind: 'insta-aio-perform-reviewed-dm-unsend',
    item: { ...harness.item, resolutionToken: resolution.resolutionToken },
  });
  assert.equal(replay.reason, 'dm-resolution-expired-or-changed');
  assert.deepEqual(harness.activations, ['action-menu', 'menu-choice', 'confirmation']);
});

test('the reviewed German Unsend label remains exact UTF-8 and executable', async () => {
  const harness = createHarness({ unsendLabel: 'Zurücknehmen' });
  const resolution = await harness.send({
    kind: 'insta-aio-inspect-reviewed-dm-item',
    item: harness.item,
  });
  const result = await harness.send({
    kind: 'insta-aio-perform-reviewed-dm-unsend',
    item: { ...harness.item, resolutionToken: resolution.resolutionToken },
  });

  assert.equal(result.result, 'unsent');
  assert.deepEqual(harness.activations, ['action-menu', 'menu-choice', 'confirmation']);
});

test('a pre-existing dialog consumes the token and stops before every DM control', async () => {
  const harness = createHarness({ preexistingDialog: true });
  const resolution = await harness.send({
    kind: 'insta-aio-inspect-reviewed-dm-item',
    item: harness.item,
  });
  const result = await harness.send({
    kind: 'insta-aio-perform-reviewed-dm-unsend',
    item: { ...harness.item, resolutionToken: resolution.resolutionToken },
  });
  assert.equal(result.reason, 'preexisting-surface-before-live-unsend');
  assert.deepEqual(harness.activations, []);
});

test('an unbound exact-text Unsend surface never receives a destructive activation', async () => {
  const harness = createHarness({ bindSurfaces: false });
  const resolution = await harness.send({
    kind: 'insta-aio-inspect-reviewed-dm-item',
    item: harness.item,
  });
  const result = await harness.send({
    kind: 'insta-aio-perform-reviewed-dm-unsend',
    item: { ...harness.item, resolutionToken: resolution.resolutionToken },
  });
  assert.equal(result.reason, 'dm-unsend-menu-not-exact');
  assert.deepEqual(harness.activations, ['action-menu']);
});

test('a bound but noninteractive exact-text Unsend node never receives a destructive activation', async () => {
  const harness = createHarness({ plainTextUnsendControls: true });
  const resolution = await harness.send({
    kind: 'insta-aio-inspect-reviewed-dm-item',
    item: harness.item,
  });
  const result = await harness.send({
    kind: 'insta-aio-perform-reviewed-dm-unsend',
    item: { ...harness.item, resolutionToken: resolution.resolutionToken },
  });
  assert.equal(result.reason, 'dm-unsend-menu-not-exact');
  assert.deepEqual(harness.activations, ['action-menu']);
});

test('wrong-thread transition after confirmation never becomes a successful Unsend', async () => {
  const harness = createHarness({ postConfirmation: 'wrong-thread' });
  const resolution = await harness.send({
    kind: 'insta-aio-inspect-reviewed-dm-item',
    item: harness.item,
  });
  const result = await harness.send({
    kind: 'insta-aio-perform-reviewed-dm-unsend',
    item: { ...harness.item, resolutionToken: resolution.resolutionToken },
  });
  assert.notEqual(result.result, 'unsent');
  assert.equal(result.reason, 'dm-unsend-not-confirmed');
});

test('identity loss while the retained row remains connected never becomes a successful Unsend', async () => {
  const harness = createHarness({ postConfirmation: 'identity-loss' });
  const resolution = await harness.send({
    kind: 'insta-aio-inspect-reviewed-dm-item',
    item: harness.item,
  });
  const result = await harness.send({
    kind: 'insta-aio-perform-reviewed-dm-unsend',
    item: { ...harness.item, resolutionToken: resolution.resolutionToken },
  });
  assert.notEqual(result.result, 'unsent');
  assert.equal(result.reason, 'dm-unsend-not-confirmed');
});

test('a nested flex-end toolbar cannot prove that the reviewed message was sent by me', async () => {
  const harness = createHarness({ nestedFlexEnd: true });
  const resolution = await harness.send({
    kind: 'insta-aio-inspect-reviewed-dm-item',
    item: harness.item,
  });
  assert.equal(resolution.resolutionToken, undefined);
  assert.equal(resolution.sentByMe, null);
  assert.equal(resolution.reason, 'message-ownership-unavailable');
});

test('DM inspection issues no capability when secure randomness is unavailable', async () => {
  const harness = createHarness({ secureCrypto: {} });
  const resolution = await harness.send({
    kind: 'insta-aio-inspect-reviewed-dm-item',
    item: harness.item,
  });

  assert.equal(resolution.resolutionToken, null);
  assert.equal(resolution.unexpectedUi, true);
  assert.equal(resolution.reason, 'secure-random-unavailable');
  assert.deepEqual(harness.activations, []);
});

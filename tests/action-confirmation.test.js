import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(new URL('../extension/action-confirmation.js', import.meta.url), 'utf8');

function fixture() {
  const document = {
    activeElement: null,
    createElement() {
      return element(document);
    },
  };
  function element(ownerDocument) {
    const listeners = new Map();
    return {
      children: [],
      hidden: false,
      isConnected: true,
      open: false,
      ownerDocument,
      textContent: '',
      addEventListener(type, listener) {
        const entries = listeners.get(type) || [];
        entries.push(listener);
        listeners.set(type, entries);
      },
      close() {
        this.open = false;
        for (const listener of listeners.get('close') || []) listener({ type: 'close' });
      },
      dispatch(type, init = {}) {
        let prevented = false;
        let propagationStopped = false;
        const event = {
          isTrusted: init.isTrusted === true,
          preventDefault() { prevented = true; },
          stopPropagation() { propagationStopped = true; },
          type,
        };
        for (const listener of listeners.get(type) || []) listener(event);
        return { prevented, propagationStopped };
      },
      focus() {
        ownerDocument.activeElement = this;
      },
      removeEventListener(type, listener) {
        listeners.set(type, (listeners.get(type) || []).filter((entry) => entry !== listener));
      },
      replaceChildren(...children) {
        this.children = children;
      },
      showModal() {
        this.open = true;
      },
    };
  }

  const roles = new Map([
    'action-confirmation', 'confirm-cancel', 'confirm-accept', 'confirm-title',
    'confirm-message', 'confirm-detail', 'confirm-facts', 'confirm-items',
  ].map((role) => [role, element(document)]));
  const root = {
    activeElement: null,
    ownerDocument: document,
    querySelector(selector) {
      const match = String(selector).match(/="([^"]+)"/);
      return roles.get(match?.[1]) || null;
    },
  };
  const context = vm.createContext({ Date, Object, Promise });
  vm.runInContext(source, context, { filename: 'action-confirmation.js' });
  return { api: context.InstaToolboxActionConfirmation, document, roles, root };
}

test('shared confirmation requires a distinct second activation and focuses Cancel', async () => {
  const { api, document, roles, root } = fixture();
  const opener = { focusCalls: 0, isConnected: true, focus() { this.focusCalls += 1; } };
  root.activeElement = opener;
  const statuses = [];
  const controller = api.createController({
    attribute: 'data-role',
    root,
    status: (message, tone) => statuses.push({ message, tone }),
  });
  const expiresAt = Date.now() + 60_000;
  const pending = controller.confirm({
    binding: { action: 'unsend', expiresAt, threadId: 'thread-safe' },
    confirmLabel: 'Unsend all my messages',
    detail: 'This cannot be undone.',
    facts: [{ label: 'Conversation', value: 'Thread thread-safe' }],
    items: ['message one', 'message two'],
    message: 'Permanently unsend messages?',
    title: 'Unsend DMs?',
  });

  assert.equal(roles.get('action-confirmation').open, true);
  assert.equal(document.activeElement, roles.get('confirm-cancel'));
  assert.equal(roles.get('confirm-items').children.length, 2);
  assert.equal(roles.get('confirm-facts').children.length, 2);
  assert.equal(await controller.confirm({ binding: { action: 'duplicate' } }), null);
  assert.equal('settle' in controller, false, 'raw positive settlement is not public');

  let resolved = false;
  pending.then(() => { resolved = true; });
  const syntheticClick = roles.get('confirm-accept').dispatch('click');
  await Promise.resolve();
  assert.deepEqual(syntheticClick, { prevented: true, propagationStopped: true });
  assert.equal(resolved, false, 'synthetic click cannot authorize the action');
  assert.equal(roles.get('action-confirmation').open, true);

  roles.get('confirm-accept').dispatch('click', { isTrusted: true });
  const binding = await pending;
  assert.deepEqual({ ...binding }, { action: 'unsend', expiresAt, threadId: 'thread-safe' });
  assert.equal(Object.isFrozen(binding), true);
  assert.equal(opener.focusCalls, 1);
  assert.deepEqual(statuses, []);
});

test('Cancel, Escape, expiry, and teardown settle fail closed exactly once', async () => {
  const { api, roles, root } = fixture();
  const statuses = [];
  const controller = api.createController({
    attribute: 'data-role',
    root,
    status: (message, tone) => statuses.push({ message, tone }),
  });

  const canceled = controller.confirm({ binding: { expiresAt: Date.now() + 60_000 } });
  assert.equal(roles.get('action-confirmation').dispatch('cancel').prevented, true);
  assert.equal(await canceled, null);
  roles.get('confirm-accept').dispatch('click', { isTrusted: true });
  assert.equal(controller.isPending(), false, 'a settled review cannot be replayed');

  const expired = controller.confirm({ binding: { expiresAt: Date.now() - 1 } });
  roles.get('confirm-accept').dispatch('click', { isTrusted: true });
  assert.equal(await expired, null);
  assert.match(statuses.at(-1).message, /expired/);

  const destroyed = controller.confirm({ binding: { expiresAt: Date.now() + 60_000 } });
  controller.destroy();
  assert.equal(await destroyed, null);
  assert.equal(controller.isPending(), false);
});

test('a delayed close event cannot cancel a newly opened review', async () => {
  const { api, roles, root } = fixture();
  const dialog = roles.get('action-confirmation');
  const controller = api.createController({ attribute: 'data-role', root });
  dialog.close = function closeLater() { this.open = false; };
  const first = controller.confirm({ binding: { action: 'follow' } });
  controller.cancel();
  assert.equal(await first, null);

  const second = controller.confirm({ binding: { action: 'unfollow' } });
  dialog.dispatch('close');
  assert.equal(dialog.open, true);
  assert.equal(controller.isPending(), true);
  roles.get('confirm-accept').dispatch('click', { isTrusted: true });
  assert.equal((await second).action, 'unfollow');

  const third = controller.confirm({ binding: { action: 'follow' } });
  dialog.close();
  dialog.dispatch('close');
  assert.equal(await third, null, 'closing the current review still cancels it');
});

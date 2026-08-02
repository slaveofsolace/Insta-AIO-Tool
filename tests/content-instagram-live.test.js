import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { webcrypto } from 'node:crypto';
import vm from 'node:vm';

const [actionLabelsSource, source] = await Promise.all([
  readFile(new URL('../extension/action-labels.js', import.meta.url), 'utf8'),
  readFile(new URL('../extension/content-instagram.js', import.meta.url), 'utf8'),
]);

function createHarness(mode, { secureCrypto = webcrypto } = {}) {
  let clickCount = 0;
  let staleClickCount = 0;
  const dialogs = [];
  const profileControls = [];
  const suggestedControls = [];

  class FakeElement {
    constructor(text, onClick = null, { href = null } = {}) {
      this.textContent = text;
      this.onClick = onClick;
      this.isConnected = true;
      this.children = [];
      this.identities = [];
      this.href = href;
    }

    getAttribute(name) {
      if (name === 'href') return this.href;
      return null;
    }

    querySelectorAll(selector) {
      if (selector === 'button, [role="button"]') {
        return this.children.filter((child) => child.isConnected);
      }
      if (selector === 'a[href], h1, h2, [role="heading"]') {
        return this.identities.filter((child) => child.isConnected);
      }
      if (selector === 'a[href]') {
        return this.identities.filter((child) => child.isConnected && child.href);
      }
      return [];
    }

    querySelector() {
      return null;
    }

    click() {
      clickCount += 1;
      this.onClick?.();
    }
  }

  const profileControl = new FakeElement(mode === 'follow' ? 'Follow' : 'Following');
  profileControl.onClick = () => {
    if (mode === 'follow') {
      profileControl.textContent = 'Following';
      return;
    }
    const confirmation = new FakeElement('Unfollow demo_creator?');
    const confirmControl = new FakeElement('Unfollow', () => {
      profileControl.textContent = 'Follow';
      confirmControl.isConnected = false;
      confirmation.isConnected = false;
      dialogs.splice(0, dialogs.length);
    });
    confirmation.children = [confirmControl];
    dialogs.push(confirmation);
  };
  profileControls.push(profileControl);
  const profileHeader = new FakeElement('demo_creator profile');
  profileHeader.identities = [new FakeElement('demo_creator', null, {
    href: '/demo_creator/',
  })];
  profileHeader.children = profileControls;
  const main = {};

  let runtimeListener = null;
  const document = {
    body: { innerText: '' },
    querySelector(selector) {
      if (selector === 'main') return main;
      return null;
    },
    querySelectorAll(selector) {
      if (selector === 'main header') {
        return [profileHeader];
      }
      if (selector === 'main button, main [role="button"]') {
        return [...profileControls, ...suggestedControls]
          .filter((control) => control.isConnected);
      }
      if (selector === '[role="dialog"]') {
        return dialogs.filter((dialog) => dialog.isConnected);
      }
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
    getComputedStyle: () => ({ display: 'block', visibility: 'visible' }),
    location: {
      href: 'https://www.instagram.com/demo_creator/',
      pathname: '/demo_creator/',
    },
    setTimeout,
  });
  vm.runInContext(actionLabelsSource, context);
  vm.runInContext(source, context);

  async function send(request) {
    return new Promise((resolve) => {
      const asyncResponse = runtimeListener(request, {}, resolve);
      if (asyncResponse !== true) queueMicrotask(() => resolve(undefined));
    });
  }

  return {
    addControl(label) {
      profileControls.push(new FakeElement(label));
    },
    addSuggestedControl(label) {
      const control = new FakeElement(label, () => {
        control.textContent = label.toLocaleLowerCase() === 'following'
          ? 'Follow'
          : 'Following';
      });
      suggestedControls.push(control);
      return control;
    },
    addStaleUnfollowDialog(username = 'other_account') {
      const dialog = new FakeElement(`Unfollow ${username}?`);
      const control = new FakeElement('Unfollow', () => {
        staleClickCount += 1;
      });
      dialog.children = [control];
      dialogs.push(dialog);
      return dialog;
    },
    clickCount: () => clickCount,
    staleClickCount: () => staleClickCount,
    profileControl,
    send,
  };
}

for (const scenario of [
  { action: 'follow', before: 'not-following', after: 'following', clicks: 1 },
  { action: 'unfollow', before: 'following', after: 'not-following', clicks: 2 },
]) {
  test(`reviewed ${scenario.action} consumes one exact profile token and verifies completion`, async () => {
    const harness = createHarness(scenario.action);
    const observed = await harness.send({
      kind: 'insta-aio-inspect-profile',
      username: 'demo_creator',
    });
    assert.equal(observed.username, 'demo_creator');
    assert.equal(observed.relationship, scenario.before);
    assert.equal(observed.ambiguous, false);
    assert.equal(observed.profileIdentityVerified, true);
    assert.equal(typeof observed.resolutionToken, 'string');
    assert.equal(harness.clickCount(), 0);

    const result = await harness.send({
      kind: 'insta-aio-perform-reviewed-profile-action',
      item: {
        action: scenario.action,
        expectedRelationship: scenario.before,
        resolutionToken: observed.resolutionToken,
        username: 'demo_creator',
      },
    });
    assert.equal(Boolean(result.result), true);
    assert.equal(result.relationship, scenario.after);
    assert.equal(harness.clickCount(), scenario.clicks);

    const replay = await harness.send({
      kind: 'insta-aio-perform-reviewed-profile-action',
      item: {
        action: scenario.action,
        expectedRelationship: scenario.before,
        resolutionToken: observed.resolutionToken,
        username: 'demo_creator',
      },
    });
    assert.equal(replay.ambiguous, true);
    assert.equal(replay.reason, 'profile-resolution-expired-or-changed');
    assert.equal(harness.clickCount(), scenario.clicks);
  });
}

test('duplicate relationship controls make inspection ambiguous and issue no token', async () => {
  const harness = createHarness('follow');
  harness.addControl('Follow');
  const observed = await harness.send({
    kind: 'insta-aio-inspect-profile',
    username: 'demo_creator',
  });
  assert.equal(observed.ambiguous, true);
  assert.equal(observed.observedControlCount, 2);
  assert.equal(observed.resolutionToken, null);
  assert.equal(harness.clickCount(), 0);
});

test('a sole suggested-account control cannot impersonate the reviewed profile control', async () => {
  const harness = createHarness('follow');
  harness.profileControl.isConnected = false;
  const suggestedControl = harness.addSuggestedControl('Follow');
  const observed = await harness.send({
    kind: 'insta-aio-inspect-profile',
    username: 'demo_creator',
  });
  assert.equal(observed.ambiguous, true);
  assert.equal(observed.profileIdentityVerified, true);
  assert.equal(observed.observedControlCount, 0);
  assert.equal(observed.resolutionToken, null);
  assert.equal(suggestedControl.textContent, 'Follow');
  assert.equal(harness.clickCount(), 0);
});

test('a pre-existing unrelated dialog safe-stops before either live control is clicked', async () => {
  const harness = createHarness('unfollow');
  const observed = await harness.send({
    kind: 'insta-aio-inspect-profile',
    username: 'demo_creator',
  });
  harness.addStaleUnfollowDialog('other_account');

  const result = await harness.send({
    kind: 'insta-aio-perform-reviewed-profile-action',
    item: {
      action: 'unfollow',
      expectedRelationship: 'following',
      resolutionToken: observed.resolutionToken,
      username: 'demo_creator',
    },
  });

  assert.equal(result.unexpectedUi, true);
  assert.equal(result.reason, 'preexisting-dialog-before-live-action');
  assert.equal(harness.clickCount(), 0);
  assert.equal(harness.staleClickCount(), 0);
});

test('profile inspection issues no capability when secure randomness is unavailable', async () => {
  const harness = createHarness('follow', { secureCrypto: {} });
  const observed = await harness.send({
    kind: 'insta-aio-inspect-profile',
    username: 'demo_creator',
  });

  assert.equal(observed.relationship, 'not-following');
  assert.equal(observed.resolutionToken, null);
  assert.equal(observed.unexpectedUi, true);
  assert.equal(observed.reason, 'secure-random-unavailable');
  assert.equal(harness.clickCount(), 0);
});

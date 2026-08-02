(() => {
  'use strict';

  const modules = globalThis.__instaAioOverlayModules;
  const shared = modules?.shared;
  if (!shared || modules.messagesView) return;

  function matchingArm(intent, arm) {
    return Boolean(
      intent
      && arm
      && arm.jobId === intent.jobId
      && arm.itemId === intent.itemId
      && arm.conversationId === intent.conversationId
      && arm.messageId === intent.messageId
      && shared.armRemainingMs(arm) > 0,
    );
  }

  function inspectIntent(runtime, intent) {
    if (!intent || typeof runtime.inspector.inspectReviewedDmItem !== 'function') return null;
    return runtime.inspector.inspectReviewedDmItem({
      conversationId: intent.conversationId,
      contentDigest: intent.contentDigest,
      messageId: intent.messageId,
      sentByMe: true,
      timestamp: intent.timestamp,
    });
  }

  function observationMatches(intent, observation) {
    return Boolean(
      intent
      && observation?.conversationId === intent.conversationId
      && observation?.messageId === intent.messageId
      && Number(observation?.timestamp) === Number(intent.timestamp)
      && observation?.contentDigest === intent.contentDigest
      && observation?.sentByMe === true
      && observation?.exactIdentityAvailable === true
      && observation?.ownershipAvailable === true
      && observation?.resolutionToken
      && !observation?.ambiguous
      && !observation?.unexpectedUi
      && !observation?.sessionExpired
      && !observation?.challenge
      && !observation?.actionBlocked
      && !observation?.rateLimited,
    );
  }

  function renderGate(runtime) {
    const { model, query, setText } = runtime;
    const intent = model.bridge.pendingDmIntent;
    const arm = model.bridge.dmArm;
    const armButton = query('[data-ia-action="arm-dm-live"]');
    const cancelButton = query('[data-ia-action="cancel-dm-live"]');
    const badge = query('[data-ia-role="dm-live-badge"]');
    const disclosure = query('[data-ia-role="dm-live-disclosure"]');
    const countdown = query('[data-ia-role="dm-live-countdown"]');
    if (!armButton || !cancelButton || !badge || !disclosure || !countdown) return;
    cancelButton.hidden = !intent;
    disclosure.open = Boolean(intent || matchingArm(intent, arm));

    if (!intent) {
      setText('dm-live-title', 'Live Unsend locked');
      setText('dm-live-detail', 'A twice-confirmed exact sent-message intent from the paired PWA is required.');
      badge.textContent = 'locked';
      badge.dataset.tone = 'warning';
      armButton.textContent = 'Arm exact message';
      armButton.disabled = true;
      countdown.hidden = true;
      return;
    }

    setText('dm-live-title', `Message ${intent.messageId}`);
    if (matchingArm(intent, arm)) {
      setText('dm-live-detail', 'One exact sent message is armed. The PWA must revalidate both durable ledgers before execution.');
      countdown.textContent = shared.countdownLabel(arm);
      countdown.hidden = false;
      badge.textContent = 'armed';
      badge.dataset.tone = 'danger';
      armButton.textContent = 'One message armed';
      armButton.disabled = true;
      return;
    }

    const observation = inspectIntent(runtime, intent);
    const ready = observationMatches(intent, observation);
    setText(
      'dm-live-detail',
      ready
        ? 'Exactly one rendered sent-message identity matches. Arming does not open a menu or remove anything.'
        : `Open the exact conversation and keep sent message ${intent.messageId} rendered before arming.`,
    );
    countdown.hidden = true;
    badge.textContent = ready ? 'ready' : 'open message';
    badge.dataset.tone = ready ? 'warning' : 'danger';
    armButton.textContent = 'Arm one Unsend';
    armButton.disabled = !ready;
  }

  function render(runtime) {
    const {
      document, downloads, model, query, setText,
    } = runtime;
    const list = query('[data-ia-role="message-list"]');
    if (!list) return;
    list.replaceChildren();
    const result = model.messages;
    const fragments = result?.fragments || [];
    setText('message-count', String(fragments.length));
    setText(
      'message-detail',
      result
        ? `${shared.safeText(result.conversationLabel, 'Open conversation')} · ${shared.safeText(result.reason, 'read only')}`
        : 'No evidence yet',
    );

    const state = query('[data-ia-role="message-state"]');
    if (state) state.dataset.tone = fragments.length ? 'good' : 'neutral';
    setText('message-state-title', fragments.length ? 'Visible evidence captured' : 'Open a conversation');
    setText(
      'message-state-detail',
      fragments.length
        ? 'Text fragments are local evidence only; exact identity and sender ownership remain unresolved.'
        : 'Visible evidence is read-only until exact identity is available.',
    );

    for (const fragment of fragments) {
      const row = document.createElement('li');
      row.className = 'ia-message-row';
      row.dataset.ownership = 'unknown';
      const text = document.createElement('div');
      text.textContent = fragment.text;
      const meta = document.createElement('div');
      meta.className = 'ia-message-meta';
      meta.textContent = `Visible fragment ${Number(fragment.index) + 1} · ownership unknown`;
      row.append(text, meta);
      list.append(row);
    }
    if (!fragments.length) {
      const empty = document.createElement('li');
      empty.className = 'ia-empty';
      empty.textContent = result?.pageKind === 'messages'
        ? 'No stable visible text fragments were found in the open thread.'
        : 'Open an Instagram conversation, then read the visible thread.';
      list.append(empty);
    }

    setText(
      'message-identity-detail',
      'Visible text alone cannot authorize removal. Exact message ID, timestamp, digest, conversation, and sent-by-me ownership must all match.',
    );
    const download = query('[data-ia-role="message-download"]');
    if (result) {
      downloads.update('messages', download, {
        filename: `insta-aio-visible-message-evidence-${Date.now()}.json`,
        payload: {
          schemaVersion: 1,
          kind: 'insta-aio-visible-message-evidence',
          ...result,
          note: 'Read-only visible DOM evidence. Exact identity and sender ownership were not resolved.',
        },
      });
    } else {
      downloads.clear('messages', download);
    }
    renderGate(runtime);
  }

  async function inspect(runtime) {
    runtime.model.messages = runtime.inspector.inspectVisibleMessages();
    render(runtime);
    const count = runtime.model.messages.fragments.length;
    runtime.status(
      count
        ? `Captured ${count} visible text fragment${count === 1 ? '' : 's'} without opening a menu.`
        : 'Message inspection stopped safely; no Instagram control was used.',
      count ? 'good' : 'error',
    );
  }

  async function arm(runtime) {
    const intent = runtime.model.bridge.pendingDmIntent;
    if (!intent) return;
    const observation = inspectIntent(runtime, intent);
    if (!observationMatches(intent, observation)) {
      runtime.status(`Open the exact conversation and resolve sent message ${intent.messageId} before arming.`, 'error');
      renderGate(runtime);
      return;
    }
    const phrase = await runtime.requestArmPhrase({
      description: `This arms only message ${intent.messageId}. The paired PWA must still revalidate both ledgers.`,
      phrase: `ARM UNSEND ${intent.armCode}`,
    });
    if (phrase == null) return;
    const response = await runtime.sendBridge({
      kind: 'insta-aio-arm-dm-unsend',
      conversationId: intent.conversationId,
      itemId: intent.itemId,
      jobId: intent.jobId,
      messageId: intent.messageId,
      phrase,
    });
    if (response.error) throw new Error(`DM arm rejected: ${response.error}.`);
    runtime.applyBridgeState(response.state);
    runtime.status(`Armed one Unsend for message ${intent.messageId} for 90 seconds. Nothing was removed.`, 'good');
  }

  async function cancel(runtime) {
    const response = await runtime.sendBridge({ kind: 'insta-aio-cancel-dm-unsend' });
    if (response.error) throw new Error(`Could not cancel the DM intent: ${response.error}.`);
    runtime.applyBridgeState(response.state, { guardArmDrop: false });
    runtime.status('Canceled the pending DM intent. No Instagram control was used.', 'good');
  }

  shared.install('messagesView', {
    arm,
    cancel,
    inspect,
    inspectIntent,
    matchingArm,
    observationMatches,
    render,
    renderGate,
  });
})();

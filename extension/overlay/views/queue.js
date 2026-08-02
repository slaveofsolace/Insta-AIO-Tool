(() => {
  'use strict';

  const modules = globalThis.__instaAioOverlayModules;
  const shared = modules?.shared;
  if (!shared || modules.queueView) return;

  function matchingArm(intent, arm) {
    return Boolean(
      intent
      && arm
      && arm.jobId === intent.jobId
      && arm.itemId === intent.itemId
      && arm.username === intent.username
      && arm.action === intent.action
      && shared.armRemainingMs(arm) > 0,
    );
  }

  function liveContextMatches(runtime, intent) {
    const profile = runtime.model.context?.profile || {};
    const expectedRelationship = intent?.action === 'follow' ? 'not-following' : 'following';
    return Boolean(
      intent
      && ['follow', 'unfollow'].includes(intent.action)
      && runtime.model.context?.pageKind === 'profile'
      && runtime.model.context.username === intent.username
      && profile.relationship === expectedRelationship
      && !profile.ambiguous
      && !profile.unexpectedUi
      && !runtime.model.context.sessionExpired
      && !runtime.model.context.challenge
      && !runtime.model.context.actionBlocked
      && !runtime.model.context.rateLimited,
    );
  }

  function renderCurrent(runtime) {
    const {
      document, downloads, model, query,
    } = runtime;
    const current = shared.currentQueueItem(model);
    const container = query('[data-ia-role="queue-current"]');
    const controls = query('[data-ia-role="queue-controls"]');
    if (!container || !controls) return;
    container.replaceChildren();
    container.className = 'ia-card ia-card-pad';

    if (!current) {
      const title = document.createElement('strong');
      title.textContent = model.manualQueue.queue.length ? 'Queue reviewed' : 'No queue loaded';
      const detail = document.createElement('p');
      detail.className = 'ia-note';
      detail.textContent = model.manualQueue.queue.length
        ? 'No pending, ready, paused, or failed items remain.'
        : 'Export a manual queue from the PWA, then import it here.';
      container.append(title, detail);
      controls.hidden = true;
    } else {
      const meta = document.createElement('p');
      meta.className = 'ia-next-label';
      const remaining = shared.queueRemaining(model);
      meta.textContent = `${remaining} actionable item${remaining === 1 ? '' : 's'} remaining`;
      const handle = document.createElement('h2');
      handle.textContent = `@${current.account.username}`;
      const detail = document.createElement('p');
      detail.className = 'ia-note';
      detail.textContent = `${current.action} · ${current.status} · ${current.reason}`;
      container.append(meta, handle, detail);
      const open = query('[data-ia-role="queue-open"]');
      open.href = `https://www.instagram.com/${encodeURIComponent(current.account.username)}/`;
      open.target = '_self';
      controls.hidden = false;
    }

    const anchor = query('[data-ia-role="queue-download"]');
    if (!model.manualQueue.queue.length) {
      downloads.clear('queue', anchor);
      return;
    }
    downloads.update('queue', anchor, {
      filename: `insta-aio-companion-state-${Date.now()}.json`,
      payload: {
        schemaVersion: 1,
        kind: 'insta-aio-companion-state',
        exportedAt: new Date().toISOString(),
        ...model.manualQueue,
      },
    });
  }

  function renderRuns(runtime) {
    const { document, model, query } = runtime;
    const list = query('[data-ia-role="run-list"]');
    if (!list) return;
    list.replaceChildren();
    const runs = (model.bridge.recentRuns || []).slice(0, 12);
    if (!runs.length) {
      const empty = document.createElement('li');
      empty.className = 'ia-empty';
      empty.textContent = 'No signed dry run or controlled live result has reached this extension yet.';
      list.append(empty);
      return;
    }
    for (const run of runs) {
      const row = document.createElement('li');
      row.className = 'ia-list-item ia-list-item--split';
      const copy = document.createElement('div');
      const title = document.createElement('strong');
      const isDm = run.kind === 'insta-aio-reviewed-dm-job';
      title.textContent = isDm
        ? 'DM identity check'
        : run.mode === 'live'
          ? 'Controlled account action'
          : 'Account profile check';
      const detail = document.createElement('small');
      const first = run.results?.[0];
      const target = first?.username
        ? `@${first.username}`
        : first?.messageId
          ? `message ${first.messageId}`
          : shared.safeText(run.jobId, 'unknown job');
      detail.textContent = `${target} · ${shared.shortDate(run.receivedAt)}${run.stopReason ? ` · ${run.stopReason}` : ''}`;
      copy.append(title, detail);
      const badge = document.createElement('span');
      badge.className = 'ia-badge';
      const succeeded = run.status === 'dry-run-complete' || run.status === 'completed';
      badge.dataset.tone = succeeded ? 'good' : 'danger';
      badge.textContent = run.status === 'completed'
        ? 'completed'
        : run.status === 'dry-run-complete'
          ? 'resolved'
          : 'safe stop';
      row.append(copy, badge);
      list.append(row);
    }
  }

  function renderLiveGate(runtime) {
    const { model, query, setText } = runtime;
    const intent = model.bridge.pendingLiveIntent;
    const arm = model.bridge.liveArm;
    const armButton = query('[data-ia-action="arm-account-live"]');
    const cancelButton = query('[data-ia-action="cancel-account-live"]');
    const badge = query('[data-ia-role="live-badge"]');
    const disclosure = query('[data-ia-role="account-live-disclosure"]');
    const countdown = query('[data-ia-role="live-countdown"]');
    if (!armButton || !cancelButton || !badge || !disclosure || !countdown) return;
    cancelButton.hidden = !intent;
    disclosure.open = Boolean(intent || matchingArm(intent, arm));

    if (!intent) {
      setText('live-title', 'Live actions locked');
      setText('live-detail', 'Confirm one live item in the paired PWA before an exact arm is even available.');
      badge.textContent = 'locked';
      badge.dataset.tone = 'warning';
      armButton.textContent = 'Arm exact action';
      armButton.disabled = true;
      countdown.hidden = true;
      return;
    }

    setText('live-title', `${intent.action} @${intent.username}`);
    if (matchingArm(intent, arm)) {
      setText('live-detail', 'One reviewed item is armed. Return to the PWA to revalidate and reserve it before execution.');
      countdown.textContent = shared.countdownLabel(arm);
      countdown.hidden = false;
      badge.textContent = 'armed';
      badge.dataset.tone = 'danger';
      armButton.textContent = 'One action armed';
      armButton.disabled = true;
      return;
    }

    const ready = liveContextMatches(runtime, intent);
    setText(
      'live-detail',
      ready
        ? 'This profile and relationship exactly match the signed intent. Arming alone does not click.'
        : `Open @${intent.username} and resolve its exact ${intent.action === 'follow' ? 'Follow' : 'Following'} state before arming.`,
    );
    countdown.hidden = true;
    badge.textContent = ready ? 'ready' : 'open target';
    badge.dataset.tone = ready ? 'warning' : 'danger';
    armButton.textContent = `Arm one ${intent.action}`;
    armButton.disabled = !ready;
  }

  function render(runtime) {
    renderCurrent(runtime);
    renderRuns(runtime);
    renderLiveGate(runtime);
  }

  async function importQueue(runtime, file) {
    if (file.size > 5_000_000) throw new Error('Queue imports are limited to five megabytes.');
    const parsed = JSON.parse(await file.text());
    if (parsed?.kind !== 'insta-aio-manual-queue' || !Array.isArray(parsed.queue)) {
      throw new Error('Select an Insta AIO manual queue export.');
    }
    const next = shared.normalizeManualQueue({
      queue: parsed.queue,
      importedAt: new Date().toISOString(),
    }, runtime.inspector.normalizeUsername);
    if (parsed.queue.length && !next.queue.length) {
      throw new Error('The queue contained no valid Instagram usernames.');
    }
    runtime.model.manualQueue = next;
    await runtime.persistManualQueue(next);
    render(runtime);
    runtime.renderSection('now');
    runtime.status(`Imported ${next.queue.length} local queue item${next.queue.length === 1 ? '' : 's'}.`, 'good');
  }

  async function updateCurrent(runtime, statusValue) {
    const current = shared.currentQueueItem(runtime.model);
    if (!current || !['completed', 'skipped'].includes(statusValue)) return;
    runtime.model.manualQueue.queue = runtime.model.manualQueue.queue.map((candidate) => (
      candidate.id === current.id
        ? { ...candidate, status: statusValue, companionUpdatedAt: new Date().toISOString() }
        : candidate
    ));
    await runtime.persistManualQueue(runtime.model.manualQueue);
    render(runtime);
    runtime.renderSection('now');
    runtime.status(
      `Marked @${current.account.username} ${statusValue}. This updates the extension-local queue only.`,
      'good',
    );
  }

  async function arm(runtime) {
    const intent = runtime.model.bridge.pendingLiveIntent;
    if (!intent) return;
    await runtime.refreshContext({ announce: false });
    if (!liveContextMatches(runtime, intent)) {
      runtime.status(`Open @${intent.username} and resolve its exact ${intent.action} control before arming.`, 'error');
      renderLiveGate(runtime);
      return;
    }
    const phrase = await runtime.requestArmPhrase({
      description: `This arms one ${intent.action} for @${intent.username}. The paired PWA must still revalidate and reserve it.`,
      phrase: `ARM ${String(intent.action || '').toUpperCase()} @${intent.username}`,
    });
    if (phrase == null) return;
    const response = await runtime.sendBridge({
      kind: 'insta-aio-arm-account-action',
      action: intent.action,
      itemId: intent.itemId,
      jobId: intent.jobId,
      phrase,
      username: intent.username,
    });
    if (response.error) throw new Error(`Live arm rejected: ${response.error}.`);
    runtime.applyBridgeState(response.state);
    runtime.status(`Armed one ${intent.action} for @${intent.username} for 90 seconds. No action has run.`, 'good');
  }

  async function cancel(runtime) {
    const response = await runtime.sendBridge({ kind: 'insta-aio-cancel-account-action' });
    if (response.error) throw new Error(`Could not cancel the live intent: ${response.error}.`);
    runtime.applyBridgeState(response.state, { guardArmDrop: false });
    runtime.status('Canceled the pending live intent. No Instagram action was performed.', 'good');
  }

  shared.install('queueView', {
    arm,
    cancel,
    importQueue,
    liveContextMatches,
    matchingArm,
    render,
    renderLiveGate,
    updateCurrent,
  });
})();

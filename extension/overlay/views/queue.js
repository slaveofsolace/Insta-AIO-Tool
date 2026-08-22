(() => {
  'use strict';

  const modules = globalThis.__instaAioOverlayModules;
  const shared = modules?.shared;
  if (!shared || modules.queueView) return;
  const botDrafts = new WeakMap();

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
    const notice = model.armNotice?.kind === 'account' ? model.armNotice : null;
    const armButton = query('[data-ia-action="arm-account-live"]');
    const cancelButton = query('[data-ia-action="cancel-account-live"]');
    const badge = query('[data-ia-role="live-badge"]');
    const disclosure = query('[data-ia-role="account-live-disclosure"]');
    const countdown = query('[data-ia-role="live-countdown"]');
    if (!armButton || !cancelButton || !badge || !disclosure || !countdown) return;
    cancelButton.hidden = !intent;
    disclosure.open = Boolean(intent || matchingArm(intent, arm) || notice);

    if (!intent) {
      const noticeCopy = notice?.state === 'expired'
        ? ['Arm expired', `The arm for @${notice.target} expired. Create a fresh reviewed intent before any later attempt.`, 'expired']
        : notice?.state === 'canceled'
          ? ['Action canceled', `The pending action for @${notice.target} was canceled without using an Instagram control.`, 'canceled']
          : notice?.state === 'executing'
            ? ['Executing in PWA', `The arm for @${notice.target} was consumed. Wait for its signed result; do not retry.`, 'executing']
            : ['Live actions locked', 'Confirm one live item in the paired PWA before an exact arm is even available.', 'locked'];
      setText('live-title', noticeCopy[0]);
      setText('live-detail', noticeCopy[1]);
      badge.textContent = noticeCopy[2];
      badge.dataset.tone = notice ? 'danger' : 'warning';
      armButton.textContent = 'Arm exact action';
      armButton.disabled = true;
      countdown.hidden = true;
      return;
    }

    setText('live-title', `${intent.action} @${intent.username}`);
    if (notice?.state === 'expired') {
      const ready = liveContextMatches(runtime, intent);
      setText(
        'live-detail',
        ready
          ? 'The prior arm expired. Type the exact phrase again to create a new 90-second arm; the old expiry is never extended.'
          : `The prior arm expired. Reopen @${intent.username} and resolve its exact state before arming again.`,
      );
      countdown.hidden = true;
      badge.textContent = 'expired';
      badge.dataset.tone = 'danger';
      armButton.textContent = `Arm fresh ${intent.action}`;
      armButton.disabled = !ready;
      return;
    }
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
    renderBotDraft(runtime, botDrafts.get(runtime.model) || null);
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
    const intent = runtime.model.bridge.pendingLiveIntent;
    const response = await runtime.sendBridge({ kind: 'insta-aio-cancel-account-action' });
    if (response.error) throw new Error(`Could not cancel the live intent: ${response.error}.`);
    runtime.applyBridgeState(response.state, { guardArmDrop: false });
    runtime.setArmNotice({
      kind: 'account',
      state: 'canceled',
      target: intent?.username || 'reviewed target',
    });
    runtime.status('Canceled the pending live intent. No Instagram action was performed.', 'good');
  }

  function botTargets(runtime, source) {
    if (source === 'current-profile') {
      const context = runtime.model.context || {};
      return context.pageKind === 'profile' && context.username ? [context.username] : [];
    }
    if (source === 'queue') {
      return (runtime.model.manualQueue?.queue || runtime.model.manualQueue?.items || [])
        .filter((entry) => shared.ACTIONABLE_QUEUE_STATUSES.has(entry.status))
        .map((entry) => entry.account?.username)
        .filter(Boolean);
    }
    const workspace = runtime.model.capture || shared.captureWorkspaceDefaults();
    const comparison = shared.compareCaptureWorkspace(workspace);
    const list = source === 'i-do-not-follow-back'
      ? comparison.iDoNotFollowBack
      : comparison.notFollowingMeBack;
    return list.map((account) => account.username || account).filter(Boolean);
  }

  function botPlan(runtime) {
    const { query } = runtime;
    const source = query('[data-ia-role="bot-source"]')?.value || 'current-profile';
    const action = query('[data-ia-role="bot-action"]')?.value === 'follow' ? 'follow' : 'unfollow';
    const requested = source === 'current-profile'
      ? 1
      : Math.max(1, Math.min(250, Number(query('[data-ia-role="bot-count"]')?.value) || 20));
    const pool = botTargets(runtime, source);
    const unique = [...new Set(pool)];
    const selected = unique.slice(0, requested);
    return Object.freeze({
      action,
      omitted: Math.max(0, unique.length - selected.length),
      removed: Math.max(0, pool.length - unique.length),
      requested,
      selected: Object.freeze(selected),
      signature: JSON.stringify({ action, requested, selected, source }),
      source,
    });
  }

  function renderBotDraft(runtime, draft) {
    const { document, query, setText } = runtime;
    const review = query('[data-ia-role="bot-review"]');
    const reviewButton = query('[data-ia-action="bot-review"]');
    const startButton = query('[data-ia-action="bot-start"]');
    const badge = query('[data-ia-role="bot-badge"]');
    if (review) review.hidden = !draft;
    if (reviewButton) reviewButton.hidden = Boolean(draft);
    if (startButton) {
      startButton.hidden = !draft;
      if (draft) startButton.textContent = `Start ${draft.action} run`;
    }
    if (badge) {
      badge.textContent = draft ? `${draft.selected.length} reviewed` : 'idle';
      badge.dataset.tone = draft ? 'warning' : 'neutral';
    }
    if (!draft) {
      setText('bot-detail', 'Each target is opened, verified, and acted on one at a time with randomised pacing.');
      return;
    }
    const preview = draft.selected.slice(0, 3).map((username) => `@${username}`).join(', ');
    setText(
      'bot-detail',
      `Reviewed: ${preview}${draft.selected.length > 3 ? `, +${draft.selected.length - 3} more` : ''}. Every profile is rechecked before action.`,
    );
    setText('bot-review-title', `${draft.selected.length} target${draft.selected.length === 1 ? '' : 's'} ready to confirm`);
    setText(
      'bot-review-detail',
      `${draft.removed} duplicate${draft.removed === 1 ? '' : 's'} removed; ${draft.omitted} left outside this bounded run. Every profile is rechecked before action.`,
    );
    const list = query('[data-ia-role="bot-review-list"]');
    if (!list) return;
    list.replaceChildren();
    for (const username of draft.selected.slice(0, 8)) {
      const row = document.createElement('li');
      row.className = 'ia-list-item';
      row.textContent = `@${username}`;
      list.append(row);
    }
    if (draft.selected.length > 8) {
      const row = document.createElement('li');
      row.className = 'ia-list-item';
      row.textContent = `+ ${draft.selected.length - 8} more`;
      list.append(row);
    }
  }

  function invalidateBotReview(runtime) {
    botDrafts.delete(runtime.model);
    renderBotDraft(runtime, null);
  }

  function botReview(runtime) {
    const draft = botPlan(runtime);
    if (!draft.selected.length) {
      runtime.status(
        draft.source === 'current-profile'
          ? 'Open one Instagram profile first. No target was reviewed.'
          : draft.source === 'queue'
          ? 'The manual queue has no pending accounts.'
          : 'Capture both Followers and Following in the checker first.',
        'error',
      );
      invalidateBotReview(runtime);
      return;
    }
    botDrafts.set(runtime.model, draft);
    renderBotDraft(runtime, draft);
    const start = runtime.query('[data-ia-action="bot-start"]');
    const scroll = start?.closest('.ia-scroll');
    const startRect = start?.getBoundingClientRect?.();
    const scrollRect = scroll?.getBoundingClientRect?.();
    if (startRect && scrollRect && startRect.bottom > scrollRect.bottom - 12) {
      scroll.scrollTop += startRect.bottom - scrollRect.bottom + 12;
    }
    start?.focus?.({ preventScroll: true });
    runtime.status(`Reviewed ${draft.selected.length} ${draft.action} target${draft.selected.length === 1 ? '' : 's'}. Nothing has run.`, 'good');
  }

  async function botStart(runtime) {
    const reviewed = botDrafts.get(runtime.model);
    const current = botPlan(runtime);
    if (!reviewed || reviewed.signature !== current.signature) {
      invalidateBotReview(runtime);
      runtime.status('Targets changed. Review the run again before any live authorization.', 'error');
      return;
    }
    const items = reviewed.selected.map((username, index) => ({
      id: `bot-${reviewed.action}-${username}-${index}`,
      username,
    }));

    await modules.batch.start(runtime, {
      kind: 'account',
      action: reviewed.action,
      items,
      description: `This opens and ${reviewed.action}s ${items.length} reviewed account${items.length === 1 ? '' : 's'}, one at a time, with randomised pacing. Each profile is verified before the action runs. This tab will navigate between profiles.`,
    });
    invalidateBotReview(runtime);
  }

  shared.install('queueView', {
    arm,
    botReview,
    botStart,
    botTargets,
    cancel,
    importQueue,
    invalidateBotReview,
    liveContextMatches,
    matchingArm,
    render,
    renderLiveGate,
    updateCurrent,
  });
})();

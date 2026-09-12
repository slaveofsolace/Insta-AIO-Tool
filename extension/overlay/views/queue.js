(() => {
  'use strict';

  const modules = globalThis.__instaToolboxOverlayModules;
  const shared = modules?.shared;
  if (!shared || modules.queueView) return;
  const botDrafts = new WeakMap();

  function renderCurrent(runtime) {
    const {
      document, downloads, model, query,
    } = runtime;
    const current = shared.currentQueueItem(model);
    const container = query('[data-insta-toolbox-role="queue-current"]');
    const controls = query('[data-insta-toolbox-role="queue-controls"]');
    if (!container || !controls) return;
    container.replaceChildren();
    container.className = 'insta-toolbox-card insta-toolbox-card-pad';

    if (!current) {
      const title = document.createElement('strong');
      title.textContent = model.manualQueue.queue.length ? 'Queue reviewed' : 'No queue loaded';
      const detail = document.createElement('p');
      detail.className = 'insta-toolbox-note';
      detail.textContent = model.manualQueue.queue.length
        ? 'No pending, ready, paused, or failed items remain.'
        : 'Export a manual queue from the PWA, then import it here.';
      container.append(title, detail);
      controls.hidden = true;
    } else {
      const meta = document.createElement('p');
      meta.className = 'insta-toolbox-next-label';
      const remaining = shared.queueRemaining(model);
      meta.textContent = `${remaining} actionable item${remaining === 1 ? '' : 's'} remaining`;
      const handle = document.createElement('h2');
      handle.textContent = `@${current.account.username}`;
      const detail = document.createElement('p');
      detail.className = 'insta-toolbox-note';
      detail.textContent = `${current.action} · ${current.status} · ${current.reason}`;
      container.append(meta, handle, detail);
      const open = query('[data-insta-toolbox-role="queue-open"]');
      open.href = `https://www.instagram.com/${encodeURIComponent(current.account.username)}/`;
      open.target = '_self';
      controls.hidden = false;
    }

    const anchor = query('[data-insta-toolbox-role="queue-download"]');
    if (!model.manualQueue.queue.length) {
      downloads.clear('queue', anchor);
      return;
    }
    downloads.update('queue', anchor, {
      filename: `insta-toolbox-companion-state-${Date.now()}.json`,
      payload: {
        schemaVersion: 1,
        kind: 'insta-toolbox-companion-state',
        exportedAt: new Date().toISOString(),
        ...model.manualQueue,
      },
    });
  }

  function renderRuns(runtime) {
    const { document, model, query } = runtime;
    const list = query('[data-insta-toolbox-role="run-list"]');
    if (!list) return;
    list.replaceChildren();
    const runs = (model.bridge.recentRuns || []).slice(0, 12);
    if (!runs.length) {
      const empty = document.createElement('li');
      empty.className = 'insta-toolbox-empty';
      empty.textContent = 'No signed dry run or controlled live result has reached this extension yet.';
      list.append(empty);
      return;
    }
    for (const run of runs) {
      const row = document.createElement('li');
      row.className = 'insta-toolbox-list-item insta-toolbox-list-item--split';
      const copy = document.createElement('div');
      const title = document.createElement('strong');
      const isDm = run.kind === 'insta-toolbox-reviewed-dm-job';
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
      badge.className = 'insta-toolbox-badge';
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

  function render(runtime) {
    renderCurrent(runtime);
    renderRuns(runtime);
    syncBotComposer(runtime);
    renderBotDraft(runtime, botDrafts.get(runtime.model) || null);
  }

  async function importQueue(runtime, file) {
    if (file.size > 5_000_000) throw new Error('Queue imports are limited to five megabytes.');
    const parsed = JSON.parse(await file.text());
    if (parsed?.kind !== 'insta-toolbox-manual-queue' || !Array.isArray(parsed.queue)) {
      throw new Error('Select an Insta Toolbox queue export.');
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

  function compatibleSources(action) {
    return action === 'follow'
      ? [
        ['current-profile', 'Current profile'],
        ['i-do-not-follow-back', 'Followers you do not follow'],
        ['scanned-followers', 'Scanned Followers'],
        ['queue', 'Queue items'],
      ]
      : [
        ['current-profile', 'Current profile'],
        ['not-following-me-back', "People who don't follow you back"],
        ['scanned-following', 'Scanned Following'],
        ['queue', 'Queue items'],
      ];
  }

  function syncBotComposer(runtime) {
    const { document, query } = runtime;
    const action = query('[data-insta-toolbox-role="bot-action"]')?.value === 'unfollow' ? 'unfollow' : 'follow';
    const sourceControl = query('[data-insta-toolbox-role="bot-source"]');
    if (!sourceControl) return;
    const previous = sourceControl.value;
    const sources = compatibleSources(action);
    sourceControl.replaceChildren();
    for (const [value, label] of sources) {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = label;
      sourceControl.append(option);
    }
    sourceControl.value = sources.some(([value]) => value === previous) ? previous : sources[0][0];
    const currentProfile = sourceControl.value === 'current-profile';
    const countField = query('[data-insta-toolbox-role="bot-count-field"]');
    if (countField) countField.hidden = currentProfile;
    const count = query('[data-insta-toolbox-role="bot-count"]');
    if (currentProfile && count) count.value = '1';
  }

  function botTargets(runtime, source, action) {
    if (source === 'current-profile') {
      const context = runtime.model.context || {};
      const skipped = [];
      if (context.pageKind !== 'profile' || !context.username) return { pool: [], skipped };
      const relationship = context.profile?.relationship;
      const alreadyCorrect = action === 'follow'
        ? ['following', 'requested'].includes(relationship)
        : relationship === 'not-following';
      if (alreadyCorrect) {
        skipped.push({ count: 1, reason: `@${context.username} already has the requested relationship.` });
        return { pool: [], skipped };
      }
      return { pool: [context.username], skipped };
    }
    if (source === 'queue') {
      const queue = runtime.model.manualQueue?.queue || runtime.model.manualQueue?.items || [];
      const protectedCount = queue.filter((entry) => entry.status === 'protected').length;
      const incompatibleCount = queue.filter((entry) => (
        shared.ACTIONABLE_QUEUE_STATUSES.has(entry.status) && entry.action !== action
      )).length;
      return {
        pool: queue
        .filter((entry) => shared.ACTIONABLE_QUEUE_STATUSES.has(entry.status) && entry.action === action)
        .map((entry) => entry.account?.username)
        .filter(Boolean),
        skipped: [
          protectedCount ? { count: protectedCount, reason: 'Protected queue items stay excluded.' } : null,
          incompatibleCount ? { count: incompatibleCount, reason: `Queue items for the opposite action were excluded.` } : null,
        ].filter(Boolean),
      };
    }
    const workspace = runtime.model.capture || shared.captureWorkspaceDefaults();
    const requiredLists = source === 'scanned-followers'
      ? ['followers']
      : source === 'scanned-following'
        ? ['following']
        : ['followers', 'following'];
    const authenticatedUsername = runtime.inspector?.normalizeUsername?.(
      runtime.inspector.detectAuthenticatedUsername?.(),
    ) || '';
    const captureSubject = runtime.inspector?.normalizeUsername?.(workspace.subjectUsername) || '';
    const captureBoundToAccount = Boolean(
      captureSubject && authenticatedUsername && captureSubject === authenticatedUsername,
    );
    const captureReady = captureBoundToAccount && requiredLists.every((listType) => (
      workspace.verified?.[listType] === true
    ));
    if (!captureReady) {
      return {
        pool: [],
        skipped: [{
          count: 0,
          reason: captureBoundToAccount
            ? 'Scan the required lists in Mutual Checker before creating account actions.'
            : 'Run Mutual Checker for your signed-in account before creating account actions.',
        }],
      };
    }
    const comparison = shared.compareCaptureWorkspace(workspace, { allowPartial: true });
    const list = source === 'i-do-not-follow-back'
      ? comparison.iDoNotFollowBack
      : source === 'not-following-me-back'
        ? comparison.notFollowingMeBack
        : source === 'scanned-followers'
          ? shared.verifiedCaptureAccounts(workspace, 'followers')
          : shared.verifiedCaptureAccounts(workspace, 'following');
    return {
      pool: list.map((account) => account.username || account).filter(Boolean),
      skipped: [],
      partial: requiredLists.some((listType) => workspace.complete?.[listType] !== true),
    };
  }

  function botPlan(runtime) {
    const { query } = runtime;
    const source = query('[data-insta-toolbox-role="bot-source"]')?.value || 'current-profile';
    const action = query('[data-insta-toolbox-role="bot-action"]')?.value === 'follow' ? 'follow' : 'unfollow';
    const requested = source === 'current-profile'
      ? 1
      : Math.max(1, Math.min(250, Number(query('[data-insta-toolbox-role="bot-count"]')?.value) || 20));
    const targetSet = botTargets(runtime, source, action);
    const pool = targetSet.pool;
    const unique = [...new Set(pool)];
    const selected = unique.slice(0, requested);
    const partial = targetSet.partial === true;
    return Object.freeze({
      action,
      omitted: Math.max(0, unique.length - selected.length),
      removed: Math.max(0, pool.length - unique.length),
      requested,
      partial,
      selected: Object.freeze(selected),
      skipped: Object.freeze(targetSet.skipped),
      signature: JSON.stringify({ action, requested, selected, source, partial }),
      source,
    });
  }

  function renderBotDraft(runtime, draft) {
    const { document, query, setText } = runtime;
    const review = query('[data-insta-toolbox-role="bot-review"]');
    const reviewButton = query('[data-insta-toolbox-action="bot-review"]');
    const startButton = query('[data-insta-toolbox-action="bot-start"]');
    const badge = query('[data-insta-toolbox-role="bot-badge"]');
    if (review) review.hidden = !draft;
    if (reviewButton) reviewButton.hidden = Boolean(draft);
    if (startButton) {
      startButton.hidden = !draft;
      if (draft) {
        const label = draft.action === 'follow' ? 'Follow' : 'Unfollow';
        startButton.textContent = `Start ${label} on ${draft.selected.length} account${draft.selected.length === 1 ? '' : 's'}`;
      }
    }
    if (badge) {
      badge.textContent = draft ? `${draft.selected.length} reviewed` : 'idle';
      badge.dataset.tone = draft ? 'warning' : 'neutral';
    }
    if (!draft) {
      const plan = botPlan(runtime);
      const label = plan.action === 'follow' ? 'Follow' : 'Unfollow';
      if (reviewButton) reviewButton.textContent = `Review ${plan.requested} ${label} target${plan.requested === 1 ? '' : 's'}`;
      setText('bot-detail', 'One profile at a time. Stops on blocks, rate limits, or unexpected pages.');
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
      `${draft.partial ? 'Partial comparison: some targets may still be mutuals. ' : ''}Duplicates removed: ${draft.removed}. Outside this run: ${draft.omitted}. Skipped: ${draft.skipped.reduce((total, entry) => total + entry.count, 0)}. Every profile is rechecked before action.`,
    );
    const list = query('[data-insta-toolbox-role="bot-review-list"]');
    if (!list) return;
    list.replaceChildren();
    for (const username of draft.selected) {
      const row = document.createElement('li');
      row.className = 'insta-toolbox-list-item';
      row.textContent = `@${username}`;
      list.append(row);
    }
    for (const entry of draft.skipped) {
      const row = document.createElement('li');
      row.className = 'insta-toolbox-list-item';
      row.textContent = `${entry.count} skipped — ${entry.reason}`;
      list.append(row);
    }
  }

  function invalidateBotReview(runtime) {
    botDrafts.delete(runtime.model);
    syncBotComposer(runtime);
    renderBotDraft(runtime, null);
  }

  function botReview(runtime) {
    const draft = botPlan(runtime);
    if (!draft.selected.length) {
      runtime.status(
        draft.skipped[0]?.reason
          || (draft.source === 'current-profile'
          ? 'Open one Instagram profile first. No target was reviewed.'
          : draft.source === 'queue'
          ? 'The manual queue has no pending accounts.'
          : 'Capture both Followers and Following in the checker first.'),
        'error',
      );
      invalidateBotReview(runtime);
      return;
    }
    botDrafts.set(runtime.model, draft);
    renderBotDraft(runtime, draft);
    const start = runtime.query('[data-insta-toolbox-action="bot-start"]');
    const scroll = start?.closest('.insta-toolbox-scroll');
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

    const started = await modules.batch.start(runtime, {
      kind: 'account',
      action: reviewed.action,
      items,
      description: `${reviewed.partial ? 'Partial comparison: some targets may still be mutuals. ' : ''}This opens and ${reviewed.action}s ${items.length} reviewed account${items.length === 1 ? '' : 's'}, one at a time, with randomised pacing. Each profile is verified before the action runs. This tab will navigate between profiles.`,
    });
    if (started) invalidateBotReview(runtime);
  }

  shared.install('queueView', {
    botReview,
    botStart,
    botTargets,
    importQueue,
    invalidateBotReview,
    render,
    syncBotComposer,
    updateCurrent,
  });
})();

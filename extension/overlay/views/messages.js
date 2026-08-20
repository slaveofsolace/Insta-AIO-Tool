(() => {
  'use strict';

  const modules = globalThis.__instaAioOverlayModules;
  const shared = modules?.shared;
  if (!shared || modules.messagesView) return;

  const runner = globalThis.InstaAioDmThreadUnsender;
  const subscriptions = new WeakMap();
  const styledShadows = new WeakSet();
  const DM_PLAN_TTL_MS = 15 * 60 * 1_000;

  function activeConversationId() {
    const match = String(location.pathname || '').match(/^\/direct\/t\/([^/?#]+)\/?$/i);
    return match?.[1] || '';
  }

  function currentPreview(runtime) {
    const preview = runtime.model.dmThreadPreview;
    return preview?.ready
      && preview.complete === true
      && preview.threadId === activeConversationId()
      && Number(preview.eligibleCount) >= 0
      ? preview
      : null;
  }

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

  function applyInstagramDesign(runtime) {
    if (styledShadows.has(runtime.shadow)) return;
    styledShadows.add(runtime.shadow);
    const style = runtime.document.createElement('style');
    style.id = 'insta-aio-instagram-design-v2';
    style.textContent = `
      :host {
        --ia-surface: rgb(var(--ig-primary-background, 255, 255, 255)) !important;
        --ia-surface-raised: rgb(var(--ig-elevated-background, 255, 255, 255)) !important;
        --ia-rail: rgb(var(--ig-secondary-background, 250, 250, 250)) !important;
        --ia-ink: rgb(var(--ig-primary-text, 38, 38, 38)) !important;
        --ia-muted: rgb(var(--ig-secondary-text, 115, 115, 115)) !important;
        --ia-line: rgb(var(--ig-separator, 219, 219, 219)) !important;
        --ia-signal: rgb(var(--ig-primary-button, 0, 149, 246)) !important;
        --ia-signal-ink: #fff !important;
        --ia-focus: rgb(var(--ig-primary-button, 0, 149, 246)) !important;
        --ia-good: rgb(var(--ig-primary-button, 0, 149, 246)) !important;
        --ia-shadow: 0 12px 38px rgba(0, 0, 0, .18) !important;
        font-family: var(--font-family-system, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif) !important;
      }
      .ia-panel {
        border-radius: 16px !important;
        backdrop-filter: blur(14px) saturate(1.02) !important;
        -webkit-backdrop-filter: blur(14px) saturate(1.02) !important;
        animation: ia-instagram-open 160ms cubic-bezier(.2,.8,.2,1) !important;
      }
      .ia-brand-mark {
        border: 1px solid var(--ia-line) !important;
        background: var(--ia-surface-raised) !important;
        color: var(--ia-ink) !important;
        font-size: 12px !important;
      }
      .ia-tab, .ia-icon-button, .ia-settings summary {
        transition: background 140ms ease, color 140ms ease, transform 140ms ease !important;
      }
      .ia-tab:hover, .ia-icon-button:hover, .ia-settings summary:hover { transform: translateY(-1px); }
      .ia-tab[aria-selected="true"] {
        box-shadow: none !important;
        background: var(--ia-surface-raised) !important;
        color: var(--ia-ink) !important;
      }
      .ia-tab[aria-selected="true"]::after {
        position: absolute;
        bottom: 4px;
        width: 16px;
        height: 2px;
        border-radius: 999px;
        background: var(--ia-signal);
        content: "";
      }
      .ia-card, .ia-tool-card, .ia-next, .ia-checker-metric, .ia-disclosure {
        border-radius: 12px !important;
      }
      .ia-tool-card, .ia-button, .ia-link-button, .ia-file-label, .ia-disclosure summary {
        transition: background 140ms ease, border-color 140ms ease, filter 140ms ease, transform 140ms ease !important;
      }
      .ia-tool-card:hover { transform: translateY(-1px); background: var(--ia-rail) !important; }
      .ia-button, .ia-link-button, .ia-file-label {
        min-height: 44px !important;
        border-color: var(--ia-line) !important;
        border-radius: 8px !important;
        background: var(--ia-rail) !important;
        color: var(--ia-ink) !important;
        font-size: var(--system-14-font-size, 14px) !important;
        line-height: var(--system-14-line-height, 18px) !important;
        font-weight: 600 !important;
      }
      .ia-button:hover, .ia-link-button:hover, .ia-file-label:hover { filter: brightness(.97); }
      .ia-button--signal {
        border-color: var(--ia-signal) !important;
        background: var(--ia-signal) !important;
        color: #fff !important;
      }
      .ia-button--danger {
        border-color: var(--ia-danger) !important;
        background: var(--ia-danger) !important;
        color: #fff !important;
      }
      .ia-badge { font-weight: 600 !important; }
      .ia-message-row { border-color: var(--ia-line) !important; border-radius: 12px !important; background: var(--ia-surface-raised) !important; }
      .ia-direct-unsend-progress {
        display: grid;
        gap: 6px;
        margin-top: 10px;
        padding: 10px 12px;
        border: 1px solid var(--ia-line);
        border-radius: 10px;
        background: var(--ia-surface-raised);
      }
      .ia-direct-unsend-progress strong { font-size: 13px; }
      .ia-direct-unsend-progress span { color: var(--ia-muted); font-size: 12px; }
      @keyframes ia-instagram-open {
        from { opacity: 0; transform: translateY(6px) scale(.99); }
        to { opacity: 1; transform: none; }
      }
      @media (prefers-reduced-motion: reduce) {
        .ia-panel, .ia-tab, .ia-icon-button, .ia-tool-card, .ia-button, .ia-link-button, .ia-file-label { animation: none !important; transition: none !important; }
      }
    `;
    runtime.shadow.append(style);

    const brand = runtime.query('.ia-brand-mark');
    if (brand) brand.textContent = 'AIO';
    const scan = runtime.query('[data-ia-action="scan-sent-dms"]');
    if (scan) scan.textContent = 'Check conversation';
    const disclosure = runtime.query('[data-ia-role="unsend-disclosure"]');
    if (disclosure) {
      disclosure.hidden = false;
      const summary = disclosure.querySelector('strong');
      if (summary) summary.textContent = 'Conversation plan';
      let progress = disclosure.querySelector('.ia-direct-unsend-progress');
      if (!progress) {
        progress = runtime.document.createElement('div');
        progress.className = 'ia-direct-unsend-progress';
        progress.hidden = true;
        const title = runtime.document.createElement('strong');
        title.dataset.iaRole = 'thread-unsend-progress-title';
        const detail = runtime.document.createElement('span');
        detail.dataset.iaRole = 'thread-unsend-progress-detail';
        progress.append(title, detail);
        disclosure.querySelector('.ia-disclosure-body')?.append(progress);
      }
    }
  }

  function renderGate(runtime) {
    const { model, query, setText } = runtime;
    const intent = model.bridge.pendingDmIntent;
    const arm = model.bridge.dmArm;
    const notice = model.armNotice?.kind === 'dm' ? model.armNotice : null;
    const armButton = query('[data-ia-action="arm-dm-live"]');
    const cancelButton = query('[data-ia-action="cancel-dm-live"]');
    const badge = query('[data-ia-role="dm-live-badge"]');
    const disclosure = query('[data-ia-role="dm-live-disclosure"]');
    const countdown = query('[data-ia-role="dm-live-countdown"]');
    if (!armButton || !cancelButton || !badge || !disclosure || !countdown) return;
    cancelButton.hidden = !intent;
    disclosure.open = Boolean(intent || matchingArm(intent, arm) || notice);

    if (!intent) {
      const copy = notice?.state === 'expired'
        ? ['Unsend arm expired', `The arm for message ${notice.target} expired. A fresh review is required.`, 'expired']
        : notice?.state === 'canceled'
          ? ['Unsend canceled', `The pending intent for message ${notice.target} was canceled.`, 'canceled']
          : notice?.state === 'executing'
            ? ['Executing in workspace', `The arm for message ${notice.target} was consumed. Wait for its signed result.`, 'executing']
            : ['Exact-message review', 'Use this section only for a reviewed message imported from the workspace.', 'locked'];
      setText('dm-live-title', copy[0]);
      setText('dm-live-detail', copy[1]);
      badge.textContent = copy[2];
      badge.dataset.tone = notice ? 'danger' : 'neutral';
      armButton.textContent = 'Arm exact message';
      armButton.disabled = true;
      countdown.hidden = true;
      return;
    }

    setText('dm-live-title', `Message ${intent.messageId}`);
    if (notice?.state === 'expired') {
      const observation = inspectIntent(runtime, intent);
      const ready = observationMatches(intent, observation);
      setText('dm-live-detail', ready
        ? 'The prior arm expired. Type the exact phrase again for a new 90-second arm; the old expiry is never extended.'
        : `Reopen the exact conversation and keep message ${intent.messageId} rendered.`);
      countdown.hidden = true;
      badge.textContent = 'expired';
      badge.dataset.tone = 'danger';
      armButton.textContent = 'Arm fresh Unsend';
      armButton.disabled = !ready;
      return;
    }
    if (matchingArm(intent, arm)) {
      setText('dm-live-detail', 'One exact sent message is armed. The workspace must revalidate before execution.');
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
    setText('dm-live-detail', ready
      ? 'Exactly one rendered sent-message identity matches. Arming does not open its menu.'
      : `Open the exact conversation and keep sent message ${intent.messageId} rendered.`);
    countdown.hidden = true;
    badge.textContent = ready ? 'ready' : 'open message';
    badge.dataset.tone = ready ? 'warning' : 'danger';
    armButton.textContent = 'Arm one Unsend';
    armButton.disabled = !ready;
  }

  function runnerState(runtime) {
    return runtime.model.threadUnsend || runner?.snapshot?.() || {
      status: 'idle', processed: 0, failed: 0, message: 'Ready', canStop: false,
    };
  }

  function renderDirect(runtime) {
    applyInstagramDesign(runtime);
    const state = runnerState(runtime);
    const disclosure = runtime.query('[data-ia-role="unsend-disclosure"]');
    const badge = runtime.query('[data-ia-role="unsend-badge"]');
    const detail = runtime.query('[data-ia-role="unsend-detail"]');
    const button = runtime.query('[data-ia-action="mass-unsend"]');
    const progress = disclosure?.querySelector('.ia-direct-unsend-progress');
    const active = ['preparing', 'running', 'waiting', 'stopping'].includes(state.status);
    const preview = currentPreview(runtime);
    const checked = runtime.model.dmThreadPreview?.ready
      && runtime.model.dmThreadPreview.threadId === activeConversationId()
      ? runtime.model.dmThreadPreview
      : null;
    const plan = runtime.query('[data-ia-role="unsend-plan"]');
    const eligible = runtime.query('[data-ia-role="unsend-eligible"]');
    const scope = runtime.query('[data-ia-role="unsend-scope"]')?.value || 'all';
    const countField = runtime.query('[data-ia-role="unsend-count"]')?.closest('.ia-field');
    if (disclosure) disclosure.hidden = false;
    if (plan) plan.hidden = active || !preview || preview.eligibleCount < 1;
    if (countField) countField.hidden = scope === 'all';
    if (eligible) eligible.textContent = preview
      ? `${preview.eligibleCount} sent message${preview.eligibleCount === 1 ? '' : 's'} eligible`
      : checked
        ? `${checked.eligibleCount} found · completeness not proven`
        : 'Check this conversation to resolve the eligible count';
    if (badge) {
      badge.textContent = active
        ? `${state.processed} unsent`
        : state.status === 'completed'
          ? 'complete'
          : preview
            ? `${preview.eligibleCount} ready`
            : checked
              ? 'incomplete'
            : 'check first';
      badge.dataset.tone = state.status === 'error' || (checked && !preview)
        ? 'danger'
        : active ? 'warning' : state.status === 'completed' ? 'good' : 'neutral';
    }
    if (detail) {
      detail.textContent = active || ['completed', 'stopped', 'error'].includes(state.status)
        ? state.message
        : preview
          ? `Read-only check complete for thread ${preview.threadId}. Choose a finite scope, then review the exact plan.`
          : checked
            ? `${checked.reason} Destructive plans stay locked.`
          : 'Check conversation loads sent-message history without opening a message menu or removing anything.';
    }
    if (button) {
      button.textContent = active
        ? 'Stop unsending'
        : 'Review Unsend plan';
      button.disabled = state.status === 'stopping' || !preview || preview.eligibleCount < 1;
    }
    if (progress) {
      progress.hidden = !active && !['completed', 'stopped', 'error'].includes(state.status);
      const title = progress.querySelector('[data-ia-role="thread-unsend-progress-title"]');
      const copy = progress.querySelector('[data-ia-role="thread-unsend-progress-detail"]');
      if (title) title.textContent = active ? 'Working in this conversation' : 'Last run';
      if (copy) copy.textContent = `${state.processed} unsent${state.failed ? ` · ${state.failed} failed attempt${state.failed === 1 ? '' : 's'}` : ''}`;
    }
    runtime.setText('message-identity-detail', 'The bulk thread runner identifies sent rows from Instagram’s rendered conversation layout. Exact message ID, timestamp, digest, conversation, and sent-by-me ownership must all match for an imported one-message job. Visible text alone cannot authorize removal.');
  }

  function ensureRunnerSubscription(runtime) {
    if (!runner || subscriptions.has(runtime.model)) return;
    const unsubscribe = runner.subscribe((state) => {
      runtime.model.threadUnsend = state;
      renderDirect(runtime);
      if (['preparing', 'running', 'waiting', 'stopping', 'completed', 'stopped', 'error'].includes(state.status)) {
        runtime.status(state.message, state.status === 'error' ? 'error' : state.status === 'completed' ? 'good' : 'neutral');
      }
    });
    subscriptions.set(runtime.model, unsubscribe);
  }

  function render(runtime) {
    applyInstagramDesign(runtime);
    ensureRunnerSubscription(runtime);
    const { document, downloads, model, query, setText } = runtime;
    const list = query('[data-ia-role="message-list"]');
    if (!list) return;
    list.replaceChildren();
    const result = model.messages;
    const conversationId = activeConversationId();
    const conversationReady = Boolean(conversationId);
    const evidenceMatches = conversationReady
      && String(result?.conversationId || '') === conversationId;
    const fragments = evidenceMatches ? (result.fragments || []) : [];
    setText('message-count', String(fragments.length));
    setText('message-detail', evidenceMatches
      ? shared.safeText(result.conversationLabel, 'Open conversation')
        + ' · '
        + shared.safeText(result.reason, 'read only')
      : 'No evidence yet');

    const state = query('[data-ia-role="message-state"]');
    if (state) state.dataset.tone = conversationReady ? 'good' : 'neutral';
    setText('message-state-title', conversationReady ? 'Conversation ready' : 'Open a conversation');
    setText('message-state-detail', conversationReady
      ? 'Read visible evidence or check the full conversation. Unsend controls stay hidden until the eligible count is resolved.'
      : 'Choose a conversation before using message tools.');

    for (const fragment of fragments) {
      const row = document.createElement('li');
      row.className = 'ia-message-row';
      row.dataset.ownership = 'unknown';
      const text = document.createElement('div');
      text.textContent = fragment.text;
      const meta = document.createElement('div');
      meta.className = 'ia-message-meta';
      meta.textContent = `Visible fragment ${Number(fragment.index) + 1}`;
      row.append(text, meta);
      list.append(row);
    }
    if (!fragments.length) {
      const empty = document.createElement('li');
      empty.className = 'ia-empty';
      empty.textContent = conversationReady
        ? 'No visible text has been read yet.'
        : 'Open an Instagram conversation, then use the message tools.';
      list.append(empty);
    }

    const download = query('[data-ia-role="message-download"]');
    if (evidenceMatches) {
      downloads.update('messages', download, {
        filename: `insta-aio-visible-message-evidence-${Date.now()}.json`,
        payload: {
          schemaVersion: 1,
          kind: 'insta-aio-visible-message-evidence',
          ...result,
          note: 'Read-only visible DOM evidence.',
        },
      });
    } else {
      downloads.clear('messages', download);
    }
    renderDirect(runtime);
    renderGate(runtime);
  }

  async function inspect(runtime) {
    runtime.model.messages = runtime.inspector.inspectVisibleMessages();
    render(runtime);
    const count = runtime.model.messages.fragments.length;
    runtime.status(count
      ? `Read ${count} visible text fragment${count === 1 ? '' : 's'} without opening a menu.`
      : 'No visible message text was found. Nothing was changed.', count ? 'good' : 'neutral');
  }

  async function scanSent(runtime) {
    if (!runner) {
      runtime.status('Reload Instagram to load the current message runner.', 'error');
      return;
    }
    const result = await runner.inspectAll();
    runtime.model.dmThreadPreview = result.ready ? result : null;
    renderDirect(runtime);
    runtime.status(result.ready && result.complete
      ? `${result.eligibleCount} sent message${result.eligibleCount === 1 ? '' : 's'} eligible in this conversation. Nothing was changed.`
      : result.reason, result.ready && result.complete ? 'good' : 'error');
  }

  async function massUnsend(runtime) {
    if (!runner) throw new Error('Reload Instagram to load the current message runner.');
    const current = runner.snapshot();
    if (current.canStop || ['preparing', 'running', 'waiting', 'stopping'].includes(current.status)) {
      runner.stop();
      return;
    }
    const preview = currentPreview(runtime);
    if (!preview || preview.eligibleCount < 1) {
      runtime.status('Check this conversation first. No destructive control was used.', 'error');
      renderDirect(runtime);
      return;
    }
    const inspection = runner.inspect();
    if (!inspection.ready) throw new Error(inspection.reason);
    if (inspection.threadId !== preview.threadId) {
      runtime.model.dmThreadPreview = null;
      renderDirect(runtime);
      runtime.status('The conversation changed. Check it again before reviewing an Unsend plan.', 'error');
      return;
    }
    const scope = runtime.query('[data-ia-role="unsend-scope"]')?.value || 'all';
    const requested = Math.floor(Number(runtime.query('[data-ia-role="unsend-count"]')?.value) || 1);
    const limit = scope === 'all'
      ? preview.eligibleCount
      : Math.min(preview.eligibleCount, Math.max(1, requested));
    const plan = runner.createPlan({
      threadId: preview.threadId,
      scope,
      limit,
      eligibleCount: preview.eligibleCount,
      expiresAt: Date.now() + DM_PLAN_TTL_MS,
    });
    if (!plan) throw new Error('The reviewed Unsend plan could not be created. Check the conversation again.');
    const scopeLabel = scope === 'all'
      ? 'all eligible sent messages'
      : `${scope} ${limit} sent message${limit === 1 ? '' : 's'}`;
    const phrase = `UNSEND ${limit} ${plan.reviewedDigest}`;
    const entered = await runtime.requestArmPhrase({
      description: `Thread ${plan.threadId} · ${scopeLabel}. This count-specific plan expires in 15 minutes.`,
      phrase,
    });
    if (entered == null) return;
    if (String(entered).trim() !== phrase) {
      runtime.status('Unsend stayed locked because the count-specific phrase did not match.', 'error');
      return;
    }
    const confirmed = runtime.window.confirm(
      `Permanently unsend ${scopeLabel} from thread ${plan.threadId}?\n\n`
      + `Reviewed digest: ${plan.reviewedDigest}. The eligible count will be revalidated immediately before any message menu opens.`,
    );
    if (!confirmed) {
      runtime.status('Canceled. Nothing was changed.', 'neutral');
      return;
    }
    const reservation = await runtime.sendBridge({
      kind: 'insta-aio-reserve-thread-unsend',
      plan,
    });
    if (reservation?.error) {
      const detail = reservation.error === 'thread-unsend-daily-limit'
        ? `Only ${reservation.remaining || 0} of ${reservation.limit || 0} daily Unsends remain.`
        : 'The reviewed plan could not be reserved. Check the conversation again.';
      runtime.status(`${detail} Nothing was changed.`, 'error');
      return;
    }
    runtime.model.dmThreadPreview = null;
    renderDirect(runtime);
    await runner.start({
      plan,
      minDelayMs: reservation.pacing?.minDelayMs,
      maxDelayMs: reservation.pacing?.maxDelayMs,
    });
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
      description: `This arms only message ${intent.messageId}. The paired workspace must still revalidate both ledgers.`,
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
    const intent = runtime.model.bridge.pendingDmIntent;
    const response = await runtime.sendBridge({ kind: 'insta-aio-cancel-dm-unsend' });
    if (response.error) throw new Error(`Could not cancel the DM intent: ${response.error}.`);
    runtime.applyBridgeState(response.state, { guardArmDrop: false });
    runtime.setArmNotice({ kind: 'dm', state: 'canceled', target: intent?.messageId || 'reviewed message' });
    runtime.status('Canceled the pending DM intent. No Instagram control was used.', 'good');
  }

  shared.install('messagesView', {
    arm,
    cancel,
    inspect,
    inspectIntent,
    massUnsend,
    matchingArm,
    observationMatches,
    render,
    renderGate,
    renderSentScan: renderDirect,
    scanSent,
  });
})();

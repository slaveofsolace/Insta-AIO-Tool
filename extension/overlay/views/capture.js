(() => {
  'use strict';

  const modules = globalThis.__instaAioOverlayModules;
  const shared = modules?.shared;
  if (!shared || modules.captureView) return;

  function setState(runtime, title, detail, tone = 'neutral') {
    const state = runtime.query('[data-ia-role="capture-state"]');
    if (state) state.dataset.tone = tone;
    runtime.setText('capture-state-title', title);
    runtime.setText('capture-state-detail', detail);
  }

  function renderComparisonBrowser(runtime, comparison, ready) {
    const {
      document, query, setText,
    } = runtime;
    const slot = query('[data-ia-role="checker-browser-slot"]');
    if (!slot) return;
    if (!ready) {
      slot.replaceChildren();
      return;
    }
    if (!query('[data-ia-role="checker-browser"]')) {
      const template = query('template[data-ia-template="checker-browser"]');
      if (template) slot.append(template.content.cloneNode(true));
    }
    const list = query('[data-ia-role="checker-filtered-list"]');
    if (!list) return;
    list.replaceChildren();

    const categoryControl = query('[data-ia-role="checker-category"]');
    const searchControl = query('[data-ia-role="checker-search"]');
    const result = shared.filterComparisonResults(
      comparison,
      categoryControl?.value,
      searchControl?.value,
    );
    const selectedLabel = categoryControl?.selectedOptions?.[0]?.textContent || 'accounts';
    const hasQuery = Boolean(String(searchControl?.value || '').trim());
    setText('checker-filter-count', String(result.total));
    setText(
      'checker-filter-detail',
      hasQuery ? `matching ${selectedLabel.toLocaleLowerCase()}` : selectedLabel.toLocaleLowerCase(),
    );

    for (const account of result.accounts) {
      const row = document.createElement('li');
      row.className = 'ia-list-item';
      const title = document.createElement('strong');
      title.textContent = `@${account.username}`;
      const detail = document.createElement('small');
      detail.textContent = account.displayName || account.profileUrl;
      row.append(title, detail);
      list.append(row);
    }
    if (!result.total) {
      const empty = document.createElement('li');
      empty.className = 'ia-empty';
      empty.textContent = hasQuery
        ? 'No captured username matches this search.'
        : 'No accounts are in this comparison group.';
      list.append(empty);
    } else if (result.truncated) {
      const more = document.createElement('li');
      more.className = 'ia-list-item';
      more.textContent = `+ ${result.total - result.accounts.length} more; narrow the username search to see them.`;
      list.append(more);
    }
  }

  function render(runtime) {
    const {
      document, downloads, model, query, setText,
    } = runtime;
    const list = query('[data-ia-role="capture-list"]');
    if (!list) return;
    list.replaceChildren();
    const workspace = model.capture || shared.captureWorkspaceDefaults();
    const listType = query('[data-ia-role="list-type"]')?.value === 'followers'
      ? 'followers'
      : 'following';
    const accounts = workspace[listType] || [];
    const comparison = shared.compareCaptureWorkspace(workspace);
    const batch = model.captureMeta;
    const followersVerified = workspace.verified?.followers === true;
    const followingVerified = workspace.verified?.following === true;
    const selectedVerified = workspace.verified?.[listType] === true;
    const comparisonReady = followersVerified && followingVerified
      && workspace.followers.length > 0
      && workspace.following.length > 0;
    setText('followers-count', String(followersVerified ? workspace.followers.length : 0));
    setText('following-count', String(followingVerified ? workspace.following.length : 0));
    setText('capture-count', String(accounts.length));
    setText(
      'capture-detail',
      accounts.length && selectedVerified
        ? `captured ${listType} · updated ${shared.shortDate(workspace.capturedAt[listType])}`
        : accounts.length
          ? `${listType} · saved rows require a verified rescan`
          : `${listType} · not captured yet`,
    );
    const followersComplete = followersVerified && workspace.complete?.followers === true;
    const followingComplete = followingVerified && workspace.complete?.following === true;
    const comparisonComplete = followersComplete && followingComplete;
    setText('following-step-detail', workspace.following.length
      ? `${workspace.following.length} unique · ${!followingVerified ? 'rescan required' : followingComplete ? 'complete' : 'partial'}`
      : 'Open your Following list first');
    setText('followers-step-detail', workspace.followers.length
      ? `${workspace.followers.length} unique · ${!followersVerified ? 'rescan required' : followersComplete ? 'complete' : 'partial'}`
      : 'Open your Followers list next');
    setText('compare-step-detail', comparisonReady
      ? `${comparison.mutuals.length} mutual · ${comparison.notFollowingMeBack.length} not following back`
      : 'Scan both lists first');
    const compareBadge = query('[data-ia-role="compare-step-badge"]');
    if (compareBadge) {
      compareBadge.textContent = comparisonComplete ? 'complete' : comparisonReady ? 'partial' : 'waiting';
      compareBadge.dataset.tone = comparisonComplete ? 'good' : comparisonReady ? 'warning' : 'neutral';
    }
    if (comparisonReady) {
      setState(
        runtime,
        comparisonComplete ? 'Follower comparison complete' : 'Partial follower comparison ready',
        `${comparison.mutuals.length} mutual; ${comparison.notFollowingMeBack.length} not following you back; ${comparison.iDoNotFollowBack.length} you do not follow back.`,
        comparisonComplete ? 'good' : 'warning',
      );
    } else {
      const missing = followersVerified ? 'Following' : 'Followers';
      setState(
        runtime,
        'Capture both Instagram lists',
        `The ${missing} draft is still empty. Open that list, scroll manually, and capture its rendered rows.`,
      );
    }

    const checker = query('[data-ia-role="checker-result"]');
    if (checker) {
      checker.replaceChildren();
      const heading = document.createElement('h2');
      heading.textContent = comparisonReady
        ? 'Rendered-row comparison'
        : 'How the checker works';
      checker.append(heading);
      if (comparisonReady) {
        const facts = document.createElement('dl');
        for (const [label, value] of [
          ['Mutuals', comparison.mutuals.length],
          ['Not following me back', comparison.notFollowingMeBack.length],
          ["I don't follow back", comparison.iDoNotFollowBack.length],
        ]) {
          const term = document.createElement('dt');
          term.textContent = label;
          const detail = document.createElement('dd');
          detail.textContent = String(value);
          facts.append(term, detail);
        }
        checker.append(facts);
      } else {
        const detail = document.createElement('p');
        detail.className = 'ia-note';
        detail.textContent = 'Capture visible Followers, then visible Following. The overlay compares normalized usernames locally without private endpoints or console code.';
        checker.append(detail);
      }
    }
    renderComparisonBrowser(
      runtime,
      comparison,
      comparisonReady,
    );

    if (batch?.listType === listType) {
      setState(
        runtime,
        `${accounts.length} unique ${listType} account${accounts.length === 1 ? '' : 's'} captured`,
        `${batch.visible} rendered; ${batch.added} added; ${batch.duplicates} duplicate${batch.duplicates === 1 ? '' : 's'} ignored.`,
        'good',
      );
    }

    for (const account of accounts.slice(0, 12)) {
      const row = document.createElement('li');
      row.className = 'ia-list-item';
      const title = document.createElement('strong');
      title.textContent = `@${account.username}`;
      const detail = document.createElement('small');
      detail.textContent = account.displayName || account.profileUrl;
      row.append(title, detail);
      list.append(row);
    }
    if (accounts.length > 12) {
      const more = document.createElement('li');
      more.className = 'ia-list-item';
      more.textContent = `+ ${accounts.length - 12} more in the download`;
      list.append(more);
    }
    if (accounts.length) {
      downloads.update('capture', query('[data-ia-role="capture-download"]'), {
        filename: `insta-aio-visible-${listType}-${Date.now()}.json`,
        payload: shared.captureRecord(workspace, listType),
      });
    } else {
      const empty = document.createElement('li');
      empty.className = 'ia-empty';
      empty.textContent = 'Instagram is not auto-scrolled and hidden accounts are not inferred.';
      list.append(empty);
      downloads.clear('capture', query('[data-ia-role="capture-download"]'));
    }
  }

  async function captureVisible(runtime) {
    const { inspector, model, query, status } = runtime;
    const listType = query('[data-ia-role="manual-list-type"]')?.value === 'followers'
      ? 'followers'
      : 'following';
    const source = query('[data-ia-role="list-type"]');
    if (source) source.value = listType;
    const visible = inspector.captureVisibleAccounts(listType);
    if (!visible.length) {
      status('No rendered account rows were found. Open or scroll the Instagram list and try again.', 'error');
      return;
    }
    const workspace = model.capture || shared.captureWorkspaceDefaults();
    const existing = shared.verifiedCaptureAccounts(workspace, listType);
    const accounts = new Map(existing.map((account) => [account.username, account]));
    const before = accounts.size;
    for (const account of visible) accounts.set(account.username, account);
    const capturedAt = new Date().toISOString();
    model.capture = shared.normalizeCaptureWorkspace({
      ...workspace,
      [listType]: [...accounts.values()],
      capturedAt: { ...workspace.capturedAt, [listType]: capturedAt },
      complete: { ...(workspace.complete || {}), [listType]: false },
      verified: { ...(workspace.verified || {}), [listType]: true },
    }, inspector.normalizeUsername);
    model.captureMeta = {
      listType,
      added: model.capture[listType].length - before,
      duplicates: Math.max(0, visible.length - (model.capture[listType].length - before)),
      visible: visible.length,
    };
    await runtime.persistCapture(model.capture);
    render(runtime);
    status(
      `Read ${visible.length} rendered row${visible.length === 1 ? '' : 's'}; ${model.capture[listType].length} unique in the local draft.`,
      'good',
    );
  }

  async function mergeAccounts(runtime, listType, accounts, { complete, label }) {
    const { inspector, model, status } = runtime;
    const workspace = model.capture || shared.captureWorkspaceDefaults();
    const existing = shared.verifiedCaptureAccounts(workspace, listType);
    const merged = new Map(existing.map((account) => [account.username, account]));
    const before = merged.size;
    for (const account of accounts) merged.set(account.username, account);
    const capturedAt = new Date().toISOString();
    model.capture = shared.normalizeCaptureWorkspace({
      ...workspace,
      [listType]: [...merged.values()],
      capturedAt: { ...workspace.capturedAt, [listType]: capturedAt },
      complete: { ...(workspace.complete || {}), [listType]: complete === true },
      verified: { ...(workspace.verified || {}), [listType]: true },
    }, inspector.normalizeUsername);
    const added = model.capture[listType].length - before;
    model.captureMeta = {
      listType,
      added,
      duplicates: Math.max(0, accounts.length - added),
      visible: accounts.length,
    };
    await runtime.persistCapture(model.capture);
    render(runtime);
    status(
      `${label} ${accounts.length} row${accounts.length === 1 ? '' : 's'}; ${model.capture[listType].length} unique in the ${listType} draft.${complete ? '' : ' The list did not reach its end — scroll further or rerun.'}`,
      complete ? 'good' : 'warning',
    );
  }

  // Auto-scrolls the open Followers/Following dialog and reads every rendered row.
  async function scanFullList(runtime, requestedListType = null) {
    const { inspector, query, status } = runtime;
    const listType = requestedListType === 'followers'
      ? 'followers'
      : requestedListType === 'following'
        ? 'following'
        : query('[data-ia-role="list-type"]')?.value === 'followers'
          ? 'followers'
          : 'following';
    const source = query('[data-ia-role="list-type"]');
    if (source) source.value = listType;
    if (typeof inspector.collectAccountList !== 'function') {
      status('This page is running an older content script. Reload Instagram and try again.', 'error');
      return;
    }
    status(`Scanning the open ${listType} list. Leave the dialog open and this tab in front.`, 'warning');
    const outcome = await inspector.collectAccountList({ listType });
    if (outcome?.sessionExpired || outcome?.challenge || outcome?.actionBlocked || outcome?.rateLimited) {
      status('Instagram interrupted the scan (session, checkpoint, or rate limit). Nothing was changed.', 'error');
      return;
    }
    const accounts = outcome?.accounts || [];
    if (!accounts.length) {
      status(`No rows were readable. Open the ${listType} dialog on your profile first.`, 'error');
      return;
    }
    await mergeAccounts(runtime, listType, accounts, {
      complete: outcome.complete === true,
      label: 'Scanned',
    });
  }

  async function reset(runtime) {
    runtime.model.capture = shared.captureWorkspaceDefaults();
    runtime.model.captureMeta = null;
    await runtime.persistCapture(null);
    render(runtime);
    runtime.status('Follower checker drafts cleared. Instagram data was not changed.', 'neutral');
  }

  shared.install('captureView', {
    captureVisible, render, reset, scanFullList,
  });
})();

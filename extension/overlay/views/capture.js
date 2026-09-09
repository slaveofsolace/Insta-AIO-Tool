(() => {
  'use strict';

  const modules = globalThis.__instaToolboxOverlayModules;
  const shared = modules?.shared;
  if (!shared || modules.captureView) return;
  let relationshipController = null;
  const formatCount = (value) => Number(value || 0).toLocaleString('en-US');
  const comparisonAnnouncements = new WeakMap();

  function setState(runtime, title, detail, tone = 'neutral') {
    const state = runtime.query('[data-insta-toolbox-role="capture-state"]');
    if (state) state.dataset.tone = tone;
    runtime.setText('capture-state-title', title);
    runtime.setText('capture-state-detail', detail);
  }

  function currentProfileCaptureSubject(runtime) {
    const { inspector, model } = runtime;
    return model.context?.pageKind === 'profile'
      ? inspector.normalizeUsername?.(model.context.username) || ''
      : '';
  }

  function reconciledAccounts(existing, incoming, complete) {
    const merged = new Map(
      (complete === true ? [] : existing).map((account) => [account.username, account]),
    );
    for (const account of incoming) merged.set(account.username, account);
    return [...merged.values()];
  }

  function relationshipListDetail(listType, accounts, verified, complete) {
    const count = Array.isArray(accounts) ? accounts.length : 0;
    if (verified) return `${formatCount(count)} unique · ${complete ? 'complete' : 'partial'}`;
    if (count) return `${formatCount(count)} unique · rescan required`;
    return listType === 'followers'
      ? 'Open your Followers list next'
      : 'Open your Following list first';
  }

  function announceComparisonResult(runtime, message) {
    const key = runtime.model;
    if (!key || typeof key !== 'object') return;
    const previous = comparisonAnnouncements.get(key) || {};
    clearTimeout(previous.timer);
    if (!message || message === previous.message) return;
    const next = { message: previous.message, timer: null };
    next.timer = setTimeout(() => {
      next.message = message;
      next.timer = null;
      runtime.status(message, 'neutral');
    }, 250);
    comparisonAnnouncements.set(key, next);
  }

  function renderComparisonBrowser(runtime, comparison, ready) {
    const {
      document, query, setText,
    } = runtime;
    const slot = query('[data-insta-toolbox-role="checker-browser-slot"]');
    if (!slot) return;
    if (!ready) {
      const pending = comparisonAnnouncements.get(runtime.model);
      clearTimeout(pending?.timer);
      comparisonAnnouncements.delete(runtime.model);
      slot.replaceChildren();
      return;
    }
    if (!query('[data-insta-toolbox-role="checker-browser"]')) {
      const template = query('template[data-insta-toolbox-template="checker-browser"]');
      if (template) slot.append(template.content.cloneNode(true));
    }
    const list = query('[data-insta-toolbox-role="checker-filtered-list"]');
    if (!list) return;
    list.replaceChildren();

    const categoryControl = query('[data-insta-toolbox-role="checker-category"]');
    const searchControl = query('[data-insta-toolbox-role="checker-search"]');
    const result = shared.filterComparisonResults(
      comparison,
      categoryControl?.value,
      searchControl?.value,
    );
    const hasQuery = Boolean(String(searchControl?.value || '').trim());
    setText('checker-filter-count', String(result.total));
    setText('checker-filter-detail', result.total === 1 ? 'account' : 'accounts');
    const categoryLabel = categoryControl?.selectedOptions?.[0]?.textContent
      || 'Comparison';
    if (!relationshipController) {
      announceComparisonResult(
        runtime,
        `${categoryLabel}: ${formatCount(result.total)} ${result.total === 1 ? 'account' : 'accounts'}${hasQuery ? ' match this search' : ''}.`,
      );
    }

    for (const account of result.accounts) {
      const row = document.createElement('li');
      row.className = 'insta-toolbox-list-item';
      const title = document.createElement('strong');
      title.textContent = `@${account.username}`;
      const detail = document.createElement('small');
      detail.textContent = account.displayName || account.profileUrl;
      row.append(title, detail);
      list.append(row);
    }
    if (!result.total) {
      const empty = document.createElement('li');
      empty.className = 'insta-toolbox-empty';
      empty.textContent = hasQuery
        ? 'No captured username matches this search.'
        : 'No accounts are in this comparison group.';
      list.append(empty);
    } else if (result.truncated) {
      const more = document.createElement('li');
      more.className = 'insta-toolbox-list-item';
      more.textContent = `+ ${result.total - result.accounts.length} more; narrow the username search to see them.`;
      list.append(more);
    }
  }

  function render(runtime) {
    const {
      document, downloads, inspector, model, query, setText,
    } = runtime;
    const list = query('[data-insta-toolbox-role="capture-list"]');
    if (!list) return;
    list.replaceChildren();
    const workspace = model.capture || shared.captureWorkspaceDefaults();
    const usernameInput = query('[data-insta-toolbox-role="checker-username"]');
    if (usernameInput && document.activeElement !== usernameInput && !usernameInput.value) {
      usernameInput.value = workspace.subjectUsername
        || runtime.inspector.detectAuthenticatedUsername?.()
        || '';
    }
    const runButton = query('[data-insta-toolbox-role="checker-run"]');
    if (runButton) {
      runButton.textContent = relationshipController
        ? 'Stop mutual check'
        : 'Check Followers + Following';
      runButton.classList.toggle('insta-toolbox-button--danger', Boolean(relationshipController));
    }
    const listType = query('[data-insta-toolbox-role="list-type"]')?.value === 'followers'
      ? 'followers'
      : 'following';
    const accounts = workspace[listType] || [];
    const comparison = shared.compareCaptureWorkspace(workspace);
    const batch = model.captureMeta;
    const followersVerified = workspace.verified?.followers === true;
    const followingVerified = workspace.verified?.following === true;
    const selectedVerified = workspace.verified?.[listType] === true;
    const comparisonReady = followersVerified && followingVerified
      && workspace.complete?.followers === true && workspace.complete?.following === true;
    const reportDownload = query('[data-insta-toolbox-role="comparison-report-download"]');
    const jsonDownload = query('[data-insta-toolbox-role="comparison-json-download"]');
    if (comparisonReady
      && typeof inspector.followerComparisonReport === 'function'
      && typeof inspector.followerComparisonRecord === 'function') {
      const generatedAt = new Date().toISOString();
      const filenameSuffix = generatedAt.replace(/[:.]/g, '-');
      downloads.update('comparison-report', reportDownload, {
        filename: `insta-toolbox-mutual-comparison-${filenameSuffix}.txt`,
        text: inspector.followerComparisonReport(workspace, comparison, generatedAt),
      });
      downloads.update('comparison-json', jsonDownload, {
        filename: `insta-toolbox-mutual-comparison-${filenameSuffix}.json`,
        payload: inspector.followerComparisonRecord(workspace, comparison, generatedAt),
      });
    } else {
      downloads.clear('comparison-report', reportDownload);
      downloads.clear('comparison-json', jsonDownload);
    }
    setText('followers-count', formatCount(followersVerified ? workspace.followers.length : 0));
    setText('following-count', formatCount(followingVerified ? workspace.following.length : 0));
    setText('capture-count', formatCount(accounts.length));
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
    setText('following-step-detail', relationshipListDetail(
      'following', workspace.following, followingVerified, followingComplete,
    ));
    setText('followers-step-detail', relationshipListDetail(
      'followers', workspace.followers, followersVerified, followersComplete,
    ));
    setText('compare-step-detail', comparisonReady
      ? `${formatCount(comparison.mutuals.length)} mutual · ${formatCount(comparison.notFollowingMeBack.length)} don't follow you back`
      : followersVerified && followingVerified ? 'Waiting for two complete lists' : 'Scan both lists first');
    const compareBadge = query('[data-insta-toolbox-role="compare-step-badge"]');
    if (compareBadge) {
      compareBadge.textContent = comparisonComplete ? 'complete' : 'waiting';
      compareBadge.dataset.tone = comparisonComplete ? 'good' : 'neutral';
    }
    const authenticatedCheck = workspace.source?.followers === 'authenticated-web'
      && workspace.source?.following === 'authenticated-web';
    if (relationshipController) {
      setState(
        runtime,
        'Mutual check running',
        'Instagram relationship pages are being read. Use Stop mutual check to cancel safely.',
        'warning',
      );
    } else if (comparisonReady) {
      setState(
        runtime,
        comparisonComplete ? `Mutual comparison complete${workspace.subjectUsername ? ` for @${workspace.subjectUsername}` : ''}` : 'Partial mutual comparison ready',
        `Followers ${formatCount(workspace.followers.length)} · Following ${formatCount(workspace.following.length)} · Don't follow you back ${formatCount(comparison.notFollowingMeBack.length)}.`,
        comparisonComplete ? 'good' : 'warning',
      );
    } else if (followersVerified || followingVerified) {
      setState(runtime, 'Comparison withheld',
        'Both lists must be complete to avoid false non-mutuals. Captured rows are under Advanced.', 'warning');
    } else {
      setState(
        runtime,
        'Ready for a read-only check',
        'Check both lists from your profile. No need to open them.',
      );
    }

    const checker = query('[data-insta-toolbox-role="checker-result"]');
    if (checker) {
      checker.replaceChildren();
      const heading = document.createElement('h2');
      heading.textContent = comparisonReady
        ? authenticatedCheck ? 'Account comparison' : 'Scanned-list comparison'
        : 'No comparison loaded';
      checker.append(heading);
      if (comparisonReady) {
        const facts = document.createElement('dl');
        for (const [label, value] of [
          ['Mutuals', comparison.mutuals.length],
          ["Don't follow you back", comparison.notFollowingMeBack.length],
          ["You don't follow back", comparison.iDoNotFollowBack.length],
        ]) {
          const term = document.createElement('dt');
          term.textContent = label;
          const detail = document.createElement('dd');
          detail.textContent = formatCount(value);
          facts.append(term, detail);
        }
        checker.append(facts);
      } else {
        const detail = document.createElement('p');
        detail.className = 'insta-toolbox-note';
        detail.textContent = followersVerified && followingVerified
          ? 'Both lists must be complete before comparing. Run Check mutuals to load them.'
          : 'Enter a username to compare Followers and Following.';
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
        `Rendered ${batch.visible} · Added ${batch.added} · Duplicates ignored ${batch.duplicates}.`,
        'good',
      );
    }

    for (const account of accounts.slice(0, 12)) {
      const row = document.createElement('li');
      row.className = 'insta-toolbox-list-item';
      const title = document.createElement('strong');
      title.textContent = `@${account.username}`;
      const detail = document.createElement('small');
      detail.textContent = account.displayName || account.profileUrl;
      row.append(title, detail);
      list.append(row);
    }
    if (accounts.length > 12) {
      const more = document.createElement('li');
      more.className = 'insta-toolbox-list-item';
      more.textContent = `+ ${accounts.length - 12} more in the download`;
      list.append(more);
    }
    if (accounts.length) {
      downloads.update('capture', query('[data-insta-toolbox-role="capture-download"]'), {
        filename: `insta-toolbox-visible-${listType}-${Date.now()}.json`,
        payload: shared.captureRecord(workspace, listType),
      });
    } else {
      const empty = document.createElement('li');
      empty.className = 'insta-toolbox-empty';
      empty.textContent = 'Instagram is not auto-scrolled and hidden accounts are not inferred.';
      list.append(empty);
      downloads.clear('capture', query('[data-insta-toolbox-role="capture-download"]'));
    }
  }

  async function captureVisible(runtime) {
    const { inspector, model, query, status } = runtime;
    const listType = query('[data-insta-toolbox-role="list-type"]')?.value === 'followers'
      ? 'followers'
      : 'following';
    const source = query('[data-insta-toolbox-role="list-type"]');
    if (source) source.value = listType;
    const visible = inspector.captureVisibleAccounts(listType);
    if (!visible.length) {
      status('No rendered account rows were found. Open or scroll the Instagram list and try again.', 'error');
      return;
    }
    const currentWorkspace = model.capture || shared.captureWorkspaceDefaults();
    const subjectUsername = currentProfileCaptureSubject(runtime);
    const currentSubject = inspector.normalizeUsername?.(currentWorkspace.subjectUsername) || '';
    const workspace = currentWorkspace.source?.followers === 'authenticated-web'
      || currentWorkspace.source?.following === 'authenticated-web'
      || currentSubject !== subjectUsername
      ? shared.captureWorkspaceDefaults()
      : currentWorkspace;
    const existing = shared.verifiedCaptureAccounts(workspace, listType);
    const before = existing.length;
    const accounts = reconciledAccounts(existing, visible, false);
    const capturedAt = new Date().toISOString();
    model.capture = shared.normalizeCaptureWorkspace({
      ...workspace,
      [listType]: accounts,
      capturedAt: { ...workspace.capturedAt, [listType]: capturedAt },
      complete: { ...(workspace.complete || {}), [listType]: false },
      verified: { ...(workspace.verified || {}), [listType]: true },
      source: { ...(workspace.source || {}), [listType]: 'list-dialog' },
      subjectUsername,
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

  async function mergeAccounts(runtime, listType, accounts, {
    complete, expectedCount, label, reason,
  }) {
    const { inspector, model, status } = runtime;
    const currentWorkspace = model.capture || shared.captureWorkspaceDefaults();
    const subjectUsername = currentProfileCaptureSubject(runtime);
    const currentSubject = inspector.normalizeUsername?.(currentWorkspace.subjectUsername) || '';
    const workspace = currentWorkspace.source?.followers === 'authenticated-web'
      || currentWorkspace.source?.following === 'authenticated-web'
      || currentSubject !== subjectUsername
      ? shared.captureWorkspaceDefaults()
      : currentWorkspace;
    const existing = shared.verifiedCaptureAccounts(workspace, listType);
    const before = complete === true ? 0 : existing.length;
    const reconciled = reconciledAccounts(existing, accounts, complete);
    const capturedAt = new Date().toISOString();
    model.capture = shared.normalizeCaptureWorkspace({
      ...workspace,
      [listType]: reconciled,
      capturedAt: { ...workspace.capturedAt, [listType]: capturedAt },
      complete: { ...(workspace.complete || {}), [listType]: complete === true },
      verified: { ...(workspace.verified || {}), [listType]: true },
      source: { ...(workspace.source || {}), [listType]: 'list-dialog' },
      subjectUsername,
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
    const mismatch = reason === 'list-count-mismatch' && Number.isSafeInteger(expectedCount);
    status(
      `${label} ${accounts.length} row${accounts.length === 1 ? '' : 's'}; ${model.capture[listType].length} unique in the ${listType} draft.${complete
        ? ''
        : mismatch
          ? ` Instagram reports ${expectedCount}, so this capture stays incomplete.`
          : reason === 'list-count-changed'
            ? ' The profile count changed during the scan, so this capture stays incomplete.'
            : ' The list did not reach its end — scroll further or rerun.'}`,
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
        : query('[data-insta-toolbox-role="list-type"]')?.value === 'followers'
          ? 'followers'
          : 'following';
    const source = query('[data-insta-toolbox-role="list-type"]');
    if (source) source.value = listType;
    if (typeof inspector.collectAccountList !== 'function') {
      status('This page is running an older content script. Reload Instagram and try again.', 'error');
      return;
    }
    status(`Scanning the open ${listType} list. Leave the dialog open and this tab in front.`, 'warning');
    const outcome = await inspector.collectAccountList({ listType });
    if (outcome?.sessionExpired || outcome?.challenge || outcome?.actionBlocked || outcome?.rateLimited) {
      status('Instagram interrupted the scan. Previous results kept.', 'error');
      return;
    }
    const accounts = outcome?.accounts || [];
    if (!accounts.length) {
      status(`No rows were readable. Open the ${listType} dialog on your profile first.`, 'error');
      return;
    }
    await mergeAccounts(runtime, listType, accounts, {
      complete: outcome.complete === true,
      expectedCount: outcome.expectedCount,
      label: 'Scanned',
      reason: outcome.reason,
    });
  }

  async function checkAccount(runtime) {
    const {
      inspector, model, query, status,
    } = runtime;
    if (relationshipController) {
      relationshipController.abort();
      status('Stopping the mutual check. Saved comparison data was not changed.', 'neutral');
      return;
    }
    if (typeof inspector.fetchFollowerComparison !== 'function') {
      status('This page is running an older checker engine. Reload Instagram and try again.', 'error');
      return;
    }
    const input = query('[data-insta-toolbox-role="checker-username"]');
    const username = inspector.normalizeUsername(input?.value)
      || inspector.detectAuthenticatedUsername?.()
      || '';
    if (!username) {
      status('Enter the Instagram username whose Followers and Following should be checked.', 'error');
      input?.focus();
      return;
    }
    if (input) input.value = username;
    const controller = new AbortController();
    relationshipController = controller;
    let announcedProgressKey = '';
    const announceProgress = (key, message) => {
      if (key === announcedProgressKey) return;
      announcedProgressKey = key;
      status(message, 'neutral');
    };
    render(runtime);
    setState(runtime, `Resolving @${username}`, 'No page controls are being opened or clicked.', 'warning');
    announceProgress('resolving', `Starting the read-only mutual check for @${username}.`);
    try {
      const result = await inspector.fetchFollowerComparison({
        username,
        retryRateLimits: true,
        signal: controller.signal,
        onProgress(progress) {
          if (relationshipController !== controller) return;
          if (progress.phase === 'cooldown') {
            const seconds = Math.ceil(progress.remainingMs / 1000);
            const clock = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
            const source = progress.cooldownSource === 'server'
              ? 'Wait supplied by Instagram.' : 'Automatic backoff; Instagram gave no reset time.';
            setState(runtime, `Retrying in ${clock}`, `${source} Stop cancels the retry.`, 'warning');
            announceProgress(`cooldown-${progress.attempt}`, `Instagram rate limit. ${source} Waiting before retrying.`);
            return;
          }
          if (progress.phase === 'resolving') {
            setState(runtime, `Resolving @${username}`, 'Finding the exact Instagram account.', 'warning');
            announceProgress('resolving', `Finding the exact @${username} account.`);
            return;
          }
          if (progress.phase === 'verifying-profile') {
            setState(runtime, `Checking @${username}`, 'Reading the exact profile totals before pagination.', 'warning');
            announceProgress('verifying-profile', `Reading the profile totals for @${username}.`);
            return;
          }
          if (progress.phase === 'counts-ready') {
            setState(
              runtime,
              `Checking @${username}`,
              `Instagram reports ${formatCount(progress.expectedCounts?.followers)} followers and ${formatCount(progress.expectedCounts?.following)} following.`,
              'warning',
            );
            announceProgress(
              'counts-ready',
              `Instagram reports ${formatCount(progress.expectedCounts?.followers)} followers and ${formatCount(progress.expectedCounts?.following)} following.`,
            );
            return;
          }
          if (progress.phase === 'revalidating-profile') {
            setState(runtime, `Finishing @${username}`, 'Confirming the profile totals did not change.', 'warning');
            announceProgress('revalidating-profile', `Finishing the mutual check for @${username}.`);
            return;
          }
          if (progress.phase === 'retrying') {
            const label = progress.listType === 'followers'
              ? 'Followers'
              : progress.listType === 'following'
                ? 'Following'
                : 'account lookup';
            setState(
              runtime,
              `Retrying ${label} for @${username}`,
              `Attempt ${progress.attempt} of ${progress.maxAttempts} starts in ${(progress.retryDelayMs / 1_000).toFixed(1)}s. ${progress.found} accounts across ${progress.pages} completed pages are preserved.`,
              'warning',
            );
            announceProgress(
              `retrying-${progress.listType || 'account'}-${progress.attempt}`,
              `Retrying ${label}. Attempt ${progress.attempt} of ${progress.maxAttempts}.`,
            );
            return;
          }
          if (progress.listType) {
            const label = progress.listType === 'followers' ? 'Followers' : 'Following';
            setState(
              runtime,
              `Loading ${label} for @${username}`,
              `${formatCount(progress.found)} of ${formatCount(progress.expectedCount)} expected accounts read across ${progress.pages} page${progress.pages === 1 ? '' : 's'}.`,
              'warning',
            );
            announceProgress(
              `loading-${progress.listType}`,
              `Loading ${label} for @${username}.`,
            );
          }
        },
      });
      const nextCapture = shared.normalizeCaptureWorkspace({
        ...shared.captureWorkspaceDefaults(),
        subjectUsername: result.username,
        followers: result.followers,
        following: result.following,
        capturedAt: {
          followers: result.capturedAt,
          following: result.capturedAt,
        },
        complete: result.complete,
        verified: { followers: true, following: true },
        source: { followers: 'authenticated-web', following: 'authenticated-web' },
      }, inspector.normalizeUsername);
      // Persist the complete pair before publishing it to the rendered model.
      // A storage/quota failure must leave the previous saved comparison visible.
      await runtime.persistCapture(nextCapture);
      model.capture = nextCapture;
      model.captureMeta = null;
      const reasons = result.reasons || {};
      const expectedCounts = result.expectedCounts || {};
      const partialDetails = [];
      for (const [listType, accounts] of [
        ['followers', result.followers],
        ['following', result.following],
      ]) {
        const label = listType === 'followers' ? 'Followers' : 'Following';
        const reason = reasons[listType];
        const expected = expectedCounts[listType];
        if (reason === 'instagram-limited-list' && Number.isSafeInteger(expected)) {
          partialDetails.push(`${label}: Instagram limited this list to ${accounts.length.toLocaleString('en-US')} of ${expected.toLocaleString('en-US')} accounts.`);
        } else if (reason === 'cursor-missing') {
          partialDetails.push(`${label}: Instagram ended pagination without returning the next page.`);
        } else if (reason === 'count-mismatch' && Number.isSafeInteger(expected)) {
          const difference = expected - accounts.length;
          partialDetails.push(difference > 0
            ? `${label}: Instagram returned ${accounts.length.toLocaleString('en-US')} of ${expected.toLocaleString('en-US')}; ${difference.toLocaleString('en-US')} were not returned.`
            : `${label}: the API returned ${accounts.length.toLocaleString('en-US')} unique accounts while the profile shows ${expected.toLocaleString('en-US')}.`);
        } else if (reason === 'count-changed') {
          partialDetails.push(`${label}: the profile total changed during the check.`);
        } else if (reason === 'profile-count-disagreement') {
          partialDetails.push(`${label}: Instagram's profile counters disagreed.`);
        }
      }
      const mismatch = ` ${partialDetails.join(' ') || 'A bounded read limit was reached.'}`;
      status(
        `Checked @${result.username}: ${result.followers.length.toLocaleString('en-US')} followers and ${result.following.length.toLocaleString('en-US')} following.${result.complete.followers && result.complete.following ? '' : mismatch}`,
        result.complete.followers && result.complete.following ? 'good' : 'warning',
      );
    } catch (error) {
      status(
        error?.code === 'stopped'
          ? 'Mutual check stopped. The previous saved comparison is unchanged.'
          : `Mutual check stopped: ${error?.message || 'Instagram did not return readable relationship data.'}`,
        error?.code === 'stopped' ? 'neutral' : 'error',
      );
    } finally {
      if (relationshipController === controller) relationshipController = null;
      render(runtime);
    }
  }

  async function reset(runtime) {
    relationshipController?.abort();
    relationshipController = null;
    runtime.model.capture = shared.captureWorkspaceDefaults();
    runtime.model.captureMeta = null;
    await runtime.persistCapture(null);
    render(runtime);
    runtime.status('Mutual Checker cleared.', 'neutral');
  }

  shared.install('captureView', {
    captureVisible, checkAccount, render, reset, scanFullList,
  });
})();

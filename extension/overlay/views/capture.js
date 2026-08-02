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

  function render(runtime) {
    const {
      document, downloads, model, query, setText,
    } = runtime;
    const list = query('[data-ia-role="capture-list"]');
    if (!list) return;
    list.replaceChildren();

    if (!model.capture) {
      setText('capture-count', '0');
      setText('capture-detail', 'No draft yet');
      setState(
        runtime,
        'Ready for a rendered list',
        'Open Followers or Following, scroll manually, then capture the visible batch.',
      );
      const empty = document.createElement('li');
      empty.className = 'ia-empty';
      empty.textContent = 'Instagram is not auto-scrolled and hidden accounts are not inferred.';
      list.append(empty);
      downloads.clear('capture', query('[data-ia-role="capture-download"]'));
      return;
    }

    const accounts = model.capture[model.capture.listType] || [];
    const batch = model.captureMeta;
    setText('capture-count', String(accounts.length));
    setText(
      'capture-detail',
      `${model.capture.listType} · updated ${shared.shortDate(model.capture.capturedAt)}`,
    );
    setState(
      runtime,
      `${accounts.length} unique account${accounts.length === 1 ? '' : 's'} in this draft`,
      batch
        ? `${batch.visible} rendered; ${batch.added} added; ${batch.duplicates} duplicate${batch.duplicates === 1 ? '' : 's'} ignored.`
        : 'Stored locally from rendered Instagram rows.',
      'good',
    );

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
    downloads.update('capture', query('[data-ia-role="capture-download"]'), {
      filename: `insta-aio-visible-${model.capture.listType}-${Date.now()}.json`,
      payload: model.capture,
    });
  }

  async function captureVisible(runtime) {
    const { inspector, model, query, status, storage } = runtime;
    const listType = query('[data-ia-role="list-type"]')?.value === 'followers'
      ? 'followers'
      : 'following';
    const visible = inspector.captureVisibleAccounts();
    if (!visible.length) {
      status('No rendered account rows were found. Open or scroll the Instagram list and try again.', 'error');
      return;
    }
    const existing = model.capture?.listType === listType ? model.capture[listType] : [];
    const accounts = new Map(existing.map((account) => [account.username, account]));
    const before = accounts.size;
    for (const account of visible) accounts.set(account.username, account);
    model.capture = shared.normalizeCapture({
      listType,
      capturedAt: new Date().toISOString(),
      [listType]: [...accounts.values()],
    }, inspector.normalizeUsername);
    model.captureMeta = {
      added: model.capture[listType].length - before,
      duplicates: Math.max(0, visible.length - (model.capture[listType].length - before)),
      visible: visible.length,
    };
    await storage.set({ [shared.STORAGE_KEYS.capture]: model.capture });
    render(runtime);
    status(
      `Read ${visible.length} rendered row${visible.length === 1 ? '' : 's'}; ${model.capture[listType].length} unique in the local draft.`,
      'good',
    );
  }

  async function reset(runtime) {
    runtime.model.capture = null;
    runtime.model.captureMeta = null;
    await runtime.storage.remove(shared.STORAGE_KEYS.capture);
    render(runtime);
    runtime.status('Visible-list draft cleared. Instagram data was not changed.', 'neutral');
  }

  shared.install('captureView', { captureVisible, render, reset });
})();

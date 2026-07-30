// ==UserScript==
// @name         Insta AIO Manual Companion
// @namespace    https://github.com/slaveofsolace/Insta-AIO-Tool
// @version      0.1.0
// @description  Read-only visible-list capture and manual queue navigation for Insta AIO Tool.
// @match        https://www.instagram.com/*
// @grant        GM_getValue
// @grant        GM_setValue
// @run-at       document-idle
// ==/UserScript==

(() => {
  'use strict';

  const STORAGE_KEY = 'instaAioManualQueueV1';
  const RESERVED = new Set([
    'accounts', 'about', 'api', 'developer', 'direct', 'emails', 'explore',
    'legal', 'privacy', 'reels', 'settings', 'stories', 'terms', 'web',
  ]);

  const normalizeUsername = (value) => {
    const username = String(value || '')
      .replace(/^https?:\/\/www\.instagram\.com\//i, '')
      .replace(/^@/, '')
      .split(/[/?#]/)[0]
      .trim()
      .toLowerCase();
    return /^[a-z0-9._]{1,30}$/i.test(username) && !RESERVED.has(username) ? username : '';
  };

  const downloadJson = (filename, data) => {
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const getQueue = () => GM_getValue(STORAGE_KEY, { queue: [], importedAt: null });
  const setQueue = (queueState) => GM_setValue(STORAGE_KEY, queueState);

  function captureVisibleAccounts() {
    const roots = [
      ...document.querySelectorAll('div[role="dialog"]'),
      document.querySelector('main'),
    ].filter(Boolean);
    const accounts = new Map();

    for (const root of roots) {
      for (const anchor of root.querySelectorAll('a[href^="/"]')) {
        const username = normalizeUsername(anchor.getAttribute('href'));
        if (!username) continue;
        accounts.set(username, {
          username,
          profileUrl: `https://www.instagram.com/${username}/`,
          displayName: anchor.textContent?.trim() === username ? '' : anchor.textContent?.trim() || '',
          source: 'tampermonkey-visible-dom',
        });
      }
    }

    return [...accounts.values()].sort((a, b) => a.username.localeCompare(b.username));
  }

  function currentItem(queueState) {
    return queueState.queue.find((item) => ['pending', 'ready', 'failed', 'paused'].includes(item.status)) || null;
  }

  function updateItem(itemId, status) {
    const queueState = getQueue();
    queueState.queue = queueState.queue.map((item) => item.id === itemId
      ? { ...item, status, companionUpdatedAt: new Date().toISOString() }
      : item);
    setQueue(queueState);
    renderPanel();
  }

  function importQueue(file) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(reader.result);
        if (parsed.kind !== 'insta-aio-manual-queue' || !Array.isArray(parsed.queue)) {
          throw new Error('Select an Insta AIO manual queue export.');
        }
        setQueue({ queue: parsed.queue, importedAt: new Date().toISOString() });
        renderPanel();
      } catch (error) {
        window.alert(error.message);
      }
    };
    reader.readAsText(file);
  }

  const panel = document.createElement('section');
  panel.id = 'insta-aio-companion';
  panel.style.cssText = [
    'position:fixed', 'right:16px', 'bottom:16px', 'z-index:2147483647',
    'width:330px', 'max-height:78vh', 'overflow:auto', 'background:#111318',
    'color:#f4f5f7', 'border:1px solid #30343d', 'border-radius:12px',
    'box-shadow:0 18px 60px rgba(0,0,0,.45)', 'font:13px/1.45 system-ui,sans-serif',
    'padding:14px',
  ].join(';');

  function button(label, action, secondary = false) {
    return `<button data-ia-action="${action}" style="border:1px solid #363b46;border-radius:8px;padding:8px 10px;background:${secondary ? '#181b21' : '#c6ff4a'};color:${secondary ? '#f4f5f7' : '#11140d'};font:600 12px system-ui;cursor:pointer">${label}</button>`;
  }

  function renderPanel() {
    const queueState = getQueue();
    const item = currentItem(queueState);
    const remaining = queueState.queue.filter((entry) => ['pending', 'ready', 'failed', 'paused'].includes(entry.status)).length;

    panel.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:12px">
        <strong style="font-size:14px">Insta AIO Companion</strong>
        <button data-ia-action="toggle" style="border:0;background:transparent;color:#9ca3af;cursor:pointer">—</button>
      </div>
      <div data-ia-body>
        <p style="margin:0 0 12px;color:#aab1bd">Manual navigation and read-only visible-list capture. This script does not click Follow, Unfollow, or Unsend.</p>
        <div style="display:flex;flex-wrap:wrap;gap:7px;margin-bottom:12px">
          ${button('Capture visible accounts', 'capture')}
          ${button('Import queue', 'import', true)}
          ${button('Export queue state', 'export', true)}
        </div>
        <input data-ia-file type="file" accept=".json,application/json" style="display:none">
        <div style="border-top:1px solid #2a2e37;padding-top:12px">
          <div style="color:#9ca3af;font-size:11px;text-transform:uppercase;letter-spacing:.08em">Next manual item · ${remaining} remaining</div>
          ${item ? `
            <div style="margin-top:8px;padding:10px;border:1px solid #2a2e37;border-radius:9px;background:#171a20">
              <strong>@${item.account?.username || 'unknown'}</strong>
              <div style="color:#9ca3af;margin:3px 0 9px">${item.action} · ${item.status} · ${item.reason || 'manual'}</div>
              <div style="display:flex;flex-wrap:wrap;gap:7px">
                ${button('Open profile', 'open')}
                ${button('Mark complete', 'complete', true)}
                ${button('Skip', 'skip', true)}
              </div>
            </div>
          ` : '<div style="margin-top:8px;color:#9ca3af">No actionable queue item loaded.</div>'}
        </div>
      </div>
    `;
  }

  panel.addEventListener('click', (event) => {
    const target = event.target.closest('[data-ia-action]');
    if (!target) return;
    const action = target.dataset.iaAction;
    const queueState = getQueue();
    const item = currentItem(queueState);

    if (action === 'toggle') {
      const body = panel.querySelector('[data-ia-body]');
      body.hidden = !body.hidden;
      target.textContent = body.hidden ? '+' : '—';
      return;
    }
    if (action === 'capture') {
      const accounts = captureVisibleAccounts();
      const listType = window.prompt('Type followers or following for this visible capture:', 'following');
      if (!['followers', 'following'].includes(String(listType).toLowerCase())) return;
      downloadJson(`insta-aio-visible-${listType}-${Date.now()}.json`, {
        schemaVersion: 1,
        kind: 'insta-aio-visible-list',
        capturedAt: new Date().toISOString(),
        [String(listType).toLowerCase()]: accounts,
        note: 'Only rows currently rendered in the Instagram page were captured. Scroll the list manually and capture again if needed.',
      });
      return;
    }
    if (action === 'import') {
      panel.querySelector('[data-ia-file]').click();
      return;
    }
    if (action === 'export') {
      downloadJson(`insta-aio-companion-state-${Date.now()}.json`, {
        kind: 'insta-aio-companion-state',
        exportedAt: new Date().toISOString(),
        ...queueState,
      });
      return;
    }
    if (!item) return;
    if (action === 'open') {
      window.location.href = `https://www.instagram.com/${encodeURIComponent(item.account.username)}/`;
      return;
    }
    if (action === 'complete') updateItem(item.id, 'completed');
    if (action === 'skip') updateItem(item.id, 'skipped');
  });

  panel.addEventListener('change', (event) => {
    if (!event.target.matches('[data-ia-file]')) return;
    const file = event.target.files?.[0];
    if (file) importQueue(file);
  });

  document.documentElement.append(panel);
  renderPanel();
})();

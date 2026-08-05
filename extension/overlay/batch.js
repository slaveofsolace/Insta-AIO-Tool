(() => {
  'use strict';

  const modules = globalThis.__instaAioOverlayModules;
  const shared = modules?.shared;
  if (!shared || modules.batch) return;

  const POLL_MS = 1_000;
  let pollTimer = null;
  let lastRun = null;

  function armPhrase(kind, action, count) {
    if (kind === 'dm') return `ARM MASS UNSEND ${count}`;
    return `ARM BATCH ${String(action || '').toUpperCase()} ${count}`;
  }

  function running(run) {
    return run?.status === 'running';
  }

  function summarize(run) {
    if (!run) return 'No batch has run in this session.';
    const done = run.completed + run.failed + run.skipped;
    const base = `${done}/${run.total} processed · ${run.completed} done`;
    const extra = [];
    if (run.skipped) extra.push(`${run.skipped} skipped`);
    if (run.failed) extra.push(`${run.failed} failed`);
    return extra.length ? `${base} · ${extra.join(' · ')}` : base;
  }

  function statusTone(run) {
    if (!run) return 'neutral';
    if (run.status === 'running') return 'warning';
    if (run.status === 'completed') return 'good';
    return 'error';
  }

  function statusTitle(run) {
    if (!run) return 'Batch idle';
    if (run.status === 'running') {
      return run.currentLabel
        ? `Running · ${run.currentLabel}`
        : 'Running';
    }
    if (run.status === 'completed') return 'Batch finished';
    if (run.status === 'aborted') return 'Batch stopped by you';
    return `Batch stopped · ${run.stopReason || 'safe stop'}`;
  }

  function render(runtime, run = lastRun) {
    const { document, query } = runtime;
    const panel = query('[data-ia-role="batch-panel"]');
    if (!panel) return;
    panel.hidden = !run;
    if (!run) return;

    const state = query('[data-ia-role="batch-state"]');
    if (state) state.dataset.tone = statusTone(run);
    runtime.setText('batch-title', statusTitle(run));
    runtime.setText('batch-detail', summarize(run));

    const bar = query('[data-ia-role="batch-bar"]');
    if (bar) {
      const done = run.completed + run.failed + run.skipped;
      const percent = run.total ? Math.round((done / run.total) * 100) : 0;
      bar.style.width = `${percent}%`;
      const meter = query('[data-ia-role="batch-meter"]');
      if (meter) {
        meter.setAttribute('aria-valuenow', String(done));
        meter.setAttribute('aria-valuemax', String(run.total));
        meter.setAttribute('aria-valuetext', `${done} of ${run.total} processed`);
      }
    }

    const next = query('[data-ia-role="batch-next"]');
    if (next) {
      const waitMs = run.nextActionAt ? Date.parse(run.nextActionAt) - Date.now() : 0;
      const show = running(run) && waitMs > 0;
      next.hidden = !show;
      if (show) next.textContent = `Pacing · next item in ${Math.ceil(waitMs / 1000)}s`;
    }

    const stop = query('[data-ia-action="batch-stop"]');
    if (stop) stop.hidden = !running(run);

    const list = query('[data-ia-role="batch-results"]');
    if (list) {
      list.replaceChildren();
      for (const entry of (run.results || []).slice(0, 15)) {
        const row = document.createElement('li');
        row.className = 'ia-list-item';
        row.dataset.status = entry.status;
        const title = document.createElement('strong');
        title.textContent = entry.label ? String(entry.label) : `item ${entry.index + 1}`;
        const detail = document.createElement('small');
        detail.textContent = entry.reason ? `${entry.status} · ${entry.reason}` : entry.status;
        row.append(title, detail);
        list.append(row);
      }
    }
  }

  function stopPolling() {
    if (pollTimer != null) {
      clearTimeout(pollTimer);
      pollTimer = null;
    }
  }

  async function refresh(runtime, { announceEnd = true } = {}) {
    const response = await runtime.sendBridge({ kind: 'insta-aio-batch-status' });
    if (response?.error) return null;
    const previous = lastRun;
    lastRun = response.run || null;
    render(runtime, lastRun);
    if (
      announceEnd
      && previous?.status === 'running'
      && lastRun
      && lastRun.status !== 'running'
    ) {
      const tone = lastRun.status === 'completed' ? 'good' : 'error';
      runtime.status(`${statusTitle(lastRun)}. ${summarize(lastRun)}.`, tone);
    }
    return lastRun;
  }

  // Recursive timeout rather than setInterval: the overlay is not permitted a
  // recurring polling interval, and this stops itself when the run ends.
  function poll(runtime) {
    stopPolling();
    pollTimer = runtime.window.setTimeout(async () => {
      pollTimer = null;
      const run = await refresh(runtime).catch(() => null);
      if (running(run)) poll(runtime);
    }, POLL_MS);
  }

  async function start(runtime, {
    kind,
    action = null,
    items,
    description,
  }) {
    if (!Array.isArray(items) || !items.length) {
      runtime.status('Nothing to run. Scan a list first.', 'error');
      return;
    }
    const current = await refresh(runtime, { announceEnd: false });
    if (running(current)) {
      runtime.status('A batch is already running. Stop it before starting another.', 'error');
      return;
    }

    const count = items.length;
    const phrase = await runtime.requestArmPhrase({
      description,
      phrase: armPhrase(kind, action, count),
    });
    if (phrase == null) return;

    const armed = await runtime.sendBridge({
      kind: 'insta-aio-arm-batch',
      batchKind: kind,
      action,
      count,
      jobId: `batch-${Date.now()}`,
      phrase,
    });
    if (armed?.error) {
      throw new Error(`Batch arm rejected: ${armed.error}.`);
    }

    const started = await runtime.sendBridge({
      kind: 'insta-aio-start-batch',
      batchKind: kind,
      items,
    });
    if (started?.error) {
      throw new Error(`Batch start rejected: ${started.error}.`);
    }
    lastRun = started.run || null;
    render(runtime, lastRun);
    runtime.status(
      `Started ${count} ${kind === 'dm' ? 'unsend' : action} item${count === 1 ? '' : 's'}. Keep this tab open and in front.`,
      'warning',
    );
    poll(runtime);
  }

  async function abort(runtime) {
    stopPolling();
    const response = await runtime.sendBridge({ kind: 'insta-aio-abort-batch' });
    if (response?.error) throw new Error(`Could not stop the batch: ${response.error}.`);
    lastRun = response.run || lastRun;
    render(runtime, lastRun);
    runtime.status('Batch stopped. No further items will run.', 'good');
  }

  async function saveLimits(runtime) {
    const { query } = runtime;
    const limits = {
      dailyActionLimit: Number(query('[data-ia-role="limit-actions"]')?.value),
      dailyDmLimit: Number(query('[data-ia-role="limit-dms"]')?.value),
      minDelayMs: Number(query('[data-ia-role="limit-min-delay"]')?.value) * 1000,
      maxDelayMs: Number(query('[data-ia-role="limit-max-delay"]')?.value) * 1000,
    };
    const response = await runtime.sendBridge({ kind: 'insta-aio-batch-limits', limits });
    if (response?.error) throw new Error(`Could not save limits: ${response.error}.`);
    applyLimits(runtime, response.limits);
    runtime.status('Pacing limits saved.', 'good');
  }

  function applyLimits(runtime, limits) {
    if (!limits) return;
    const { query } = runtime;
    const set = (role, value) => {
      const field = query(`[data-ia-role="${role}"]`);
      if (field) field.value = String(value);
    };
    set('limit-actions', limits.dailyActionLimit);
    set('limit-dms', limits.dailyDmLimit);
    set('limit-min-delay', Math.round(limits.minDelayMs / 1000));
    set('limit-max-delay', Math.round(limits.maxDelayMs / 1000));
  }

  async function hydrate(runtime) {
    const response = await runtime.sendBridge({ kind: 'insta-aio-batch-status' })
      .catch(() => null);
    if (!response || response.error) return;
    applyLimits(runtime, response.limits);
    lastRun = response.run || null;
    render(runtime, lastRun);
    if (running(lastRun)) poll(runtime);
  }

  shared.install('batch', {
    abort,
    armPhrase,
    hydrate,
    refresh,
    render,
    saveLimits,
    start,
    stopPolling,
  });
})();

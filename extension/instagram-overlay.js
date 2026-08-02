(() => {
  'use strict';

  if (globalThis.__instaAioOverlayInstalled) return;

  const modules = globalThis.__instaAioOverlayModules;
  const requiredModules = [
    'shared',
    'preferences',
    'routeObserver',
    'theme',
    'bridge',
    'downloads',
    'accessibility',
    'collision',
    'icons',
    'shell',
    'nowView',
    'captureView',
    'queueView',
    'messagesView',
    'workspaceView',
  ];
  if (!modules || requiredModules.some((name) => !modules[name])) return;

  const inspector = globalThis.InstaAioInstagramInspector;
  const chromeApi = globalThis.chrome;
  if (!inspector || !chromeApi?.storage?.local || !chromeApi?.runtime) return;
  if (document.getElementById('insta-aio-sidecar-root')) return;

  const {
    accessibility,
    bridge,
    captureView,
    collision,
    downloads: downloadsModule,
    messagesView,
    nowView,
    preferences,
    queueView,
    routeObserver,
    shared,
    shell,
    theme,
    workspaceView,
  } = modules;
  const extensionVersion = chromeApi.runtime.getManifest?.().version || 'unknown';
  const model = shared.createModel(extensionVersion);
  const { host, shadow } = shell.create({
    document,
    openShadow: globalThis.__instaAioOverlayTestOpenShadow === true,
  });
  const storage = preferences.createStorage(chromeApi);
  const downloadManager = downloadsModule.create({ Blob, URL });

  let active = true;
  let bridgeLastContactAt = null;
  let collisionController = null;
  let countdownTimer = null;
  let lastFocusedElement = null;
  let routeController = null;
  let themeController = null;

  const query = (selector) => shadow.querySelector(selector);
  const queryAll = (selector) => [...shadow.querySelectorAll(selector)];

  function setText(role, value) {
    const element = query(`[data-ia-role="${role}"]`);
    if (element) element.textContent = String(value ?? '');
  }

  function status(message, tone = 'neutral') {
    const footer = query('[data-ia-role="status"]');
    if (footer) footer.dataset.tone = tone;
    setText('status-lead', tone === 'error' ? 'Stopped.' : tone === 'good' ? 'Ready.' : 'Note.');
    setText('status-text', shared.safeText(message, 'Live actions remain locked.'));
  }

  function safeHttpOrigin(value) {
    try {
      const parsed = new URL(String(value || ''));
      return ['http:', 'https:'].includes(parsed.protocol) ? parsed.origin : null;
    } catch {
      return null;
    }
  }

  function sanitizeAccountIntent(value) {
    const username = inspector.normalizeUsername(value?.username);
    const action = ['follow', 'unfollow'].includes(value?.action) ? value.action : null;
    const expiresAt = shared.safeText(value?.expiresAt);
    if (
      !username
      || !action
      || !shared.safeText(value?.jobId)
      || !shared.safeText(value?.itemId)
      || shared.armRemainingMs({ expiresAt }) <= 0
    ) return null;
    return {
      action,
      confirmedAt: shared.safeText(value.confirmedAt),
      expiresAt,
      itemId: shared.safeText(value.itemId),
      jobId: shared.safeText(value.jobId),
      username,
    };
  }

  function sanitizeDmIntent(value) {
    const required = ['armCode', 'contentDigest', 'conversationId', 'itemId', 'jobId', 'messageId'];
    if (!value || required.some((key) => !shared.safeText(value[key]))) return null;
    if (!Number.isFinite(Number(value.timestamp))) return null;
    const expiresAt = shared.safeText(value.expiresAt);
    if (shared.armRemainingMs({ expiresAt }) <= 0) return null;
    return {
      armCode: shared.safeText(value.armCode),
      confirmedAt: shared.safeText(value.confirmedAt),
      contentDigest: shared.safeText(value.contentDigest),
      conversationId: shared.safeText(value.conversationId),
      expiresAt,
      itemId: shared.safeText(value.itemId),
      jobId: shared.safeText(value.jobId),
      messageId: shared.safeText(value.messageId),
      timestamp: Number(value.timestamp),
    };
  }

  function sanitizeArm(value, kind) {
    if (!value || shared.armRemainingMs(value) <= 0) return null;
    const base = {
      armedAt: shared.safeText(value.armedAt),
      expiresAt: shared.safeText(value.expiresAt),
      itemId: shared.safeText(value.itemId),
      jobId: shared.safeText(value.jobId),
    };
    if (!base.expiresAt || !base.itemId || !base.jobId) return null;
    if (kind === 'account') {
      const username = inspector.normalizeUsername(value.username);
      const action = ['follow', 'unfollow'].includes(value.action) ? value.action : null;
      return username && action ? { ...base, action, username } : null;
    }
    const conversationId = shared.safeText(value.conversationId);
    const messageId = shared.safeText(value.messageId);
    return conversationId && messageId ? { ...base, conversationId, messageId } : null;
  }

  function sanitizeRuns(value) {
    if (!Array.isArray(value)) return [];
    return value.slice(0, 12).map((run) => ({
      jobId: shared.safeText(run?.jobId, 'unknown job'),
      kind: shared.safeText(run?.kind),
      mode: run?.mode === 'live' ? 'live' : 'dry-run',
      receivedAt: shared.safeText(run?.receivedAt),
      results: Array.isArray(run?.results)
        ? run.results.slice(0, 1).map((result) => ({
          action: shared.safeText(result?.action),
          messageId: shared.safeText(result?.messageId),
          status: shared.safeText(result?.status),
          username: inspector.normalizeUsername(result?.username),
        }))
        : [],
      status: shared.safeText(run?.status, 'stopped'),
      stopReason: shared.safeText(run?.stopReason),
    }));
  }

  function sanitizeBridgeState(value) {
    const fallback = shared.createModel(extensionVersion).bridge;
    if (!value || typeof value !== 'object') return fallback;
    const pairings = Array.isArray(value.pairings)
      ? value.pairings.slice(0, 8).map((pairing) => {
        const origin = safeHttpOrigin(pairing?.origin);
        if (!origin || !shared.safeText(pairing?.pairedAt)) return null;
        return {
          origin,
          pairedAt: shared.safeText(pairing.pairedAt),
          permissions: Array.isArray(pairing.permissions)
            ? pairing.permissions.filter((permission) => ['read', 'action'].includes(permission))
            : ['read'],
        };
      }).filter(Boolean)
      : [];
    return {
      controlledAccountActionsAvailable: value.controlledAccountActionsAvailable === true,
      controlledDmUnsendAvailable: value.controlledDmUnsendAvailable === true,
      dmArm: sanitizeArm(value.dmArm, 'dm'),
      extensionVersion: shared.safeText(value.extensionVersion, extensionVersion),
      liveArm: sanitizeArm(value.liveArm, 'account'),
      liveExecutionEnabled: value.liveExecutionEnabled === true,
      pairings,
      pendingDmIntent: sanitizeDmIntent(value.pendingDmIntent),
      pendingLiveIntent: sanitizeAccountIntent(value.pendingLiveIntent),
      recentRuns: sanitizeRuns(value.recentRuns),
    };
  }

  function applyPreferences(next) {
    model.preferences = preferences.normalize(next, model.preferences || preferences.defaults());
    model.open = model.preferences.open;
    model.section = model.preferences.section;
    host.dataset.density = model.preferences.density;
    host.dataset.dock = model.preferences.dock;
    host.dataset.width = model.preferences.width;
    for (const control of queryAll('[data-ia-preference]')) {
      const value = model.preferences[control.dataset.iaPreference];
      if (value !== undefined) control.value = value;
    }
    themeController?.setPreference(model.preferences.theme);
  }

  async function savePreference(patch) {
    const previous = model.preferences;
    const next = preferences.normalize({ ...previous, ...patch }, previous);
    applyPreferences(next);
    try {
      model.preferences = await preferences.save(storage, previous, patch);
    } catch (error) {
      applyPreferences(previous);
      setSection(previous.section, { persist: false });
      setOpen(previous.open, {
        focus: false,
        persist: false,
        refresh: false,
        restoreFocus: false,
      });
      status(`Overlay preference was not saved: ${error.message}`, 'error');
    }
  }

  function setOpen(open, {
    focus = true,
    persist = true,
    refresh = true,
    restoreFocus = true,
    } = {}) {
    const shouldOpen = Boolean(open);
    const focusBeforeOpen = shouldOpen
      ? shadow.activeElement || document.activeElement
      : null;
    model.open = shouldOpen;
    const panel = query('.ia-panel');
    const launcher = query('.ia-launcher');
    panel.hidden = !shouldOpen;
    launcher.hidden = shouldOpen;
    launcher.setAttribute('aria-expanded', String(shouldOpen));
    if (!shouldOpen) query('[data-ia-role="settings"]').open = false;
    if (persist) void savePreference({ open: shouldOpen });

    if (shouldOpen) {
      lastFocusedElement = focusBeforeOpen;
      if (focus && !model.collision.active) {
        requestAnimationFrame(() => query(`[data-ia-section="${model.section}"]`)?.focus());
      }
      if (refresh) {
        void Promise.all([
          refreshContext({ announce: false }),
          refreshBridge({ announce: false }),
        ]);
      }
    } else if (restoreFocus && focus) {
      requestAnimationFrame(() => {
        if (
          lastFocusedElement instanceof HTMLElement
          && lastFocusedElement.isConnected
          && lastFocusedElement !== document.body
          && lastFocusedElement !== document.documentElement
        ) {
          lastFocusedElement.focus();
        } else {
          launcher.focus();
        }
      });
    }
  }

  function renderSection(section = model.section) {
    if (section === 'now') nowView.render(runtime);
    if (section === 'capture') captureView.render(runtime);
    if (section === 'queue') queueView.render(runtime);
    if (section === 'messages') messagesView.render(runtime);
    if (section === 'workspace') workspaceView.render(runtime);
  }

  function setSection(section, { focus = false, persist = true } = {}) {
    if (!shared.SECTIONS.includes(section)) return;
    model.section = section;
    for (const button of queryAll('[data-ia-section]')) {
      const selected = button.dataset.iaSection === section;
      button.setAttribute('aria-selected', String(selected));
      button.tabIndex = selected ? 0 : -1;
    }
    for (const view of queryAll('[data-ia-view]')) {
      view.hidden = view.dataset.iaView !== section;
    }
    const [title, subtitle] = shared.SECTION_COPY[section];
    setText('view-context', `${section[0].toUpperCase()}${section.slice(1)} · Instagram`);
    setText('view-title', title);
    setText('view-subtitle', subtitle);
    renderSection(section);
    if (persist) void savePreference({ section });
    if (focus) requestAnimationFrame(() => query(`[data-ia-section="${section}"]`)?.focus());
  }

  function renderSignals() {
    const signal = Boolean(
      model.bridge.pendingLiveIntent
      || model.bridge.pendingDmIntent
      || model.bridge.liveArm
      || model.bridge.dmArm,
    );
    for (const role of ['launcher-signal', 'queue-signal']) {
      const element = query(`[data-ia-role="${role}"]`);
      if (element) element.hidden = !signal;
    }
  }

  function renderAll() {
    nowView.render(runtime);
    captureView.render(runtime);
    queueView.render(runtime);
    messagesView.render(runtime);
    workspaceView.render(runtime);
    renderSignals();
  }

  function sendBridge(message) {
    return bridge.send(chromeApi, message);
  }

  function persistCapture(value) {
    return value == null
      ? storage.remove(shared.STORAGE_KEYS.capture)
      : storage.set({ [shared.STORAGE_KEYS.capture]: value });
  }

  function persistManualQueue(value) {
    return storage.set({ [shared.STORAGE_KEYS.manualQueue]: value });
  }

  async function refreshContext({ announce = true } = {}) {
    try {
      model.context = inspector.inspectPageContext();
      nowView.render(runtime);
      queueView.renderLiveGate(runtime);
      if (announce) status('Current Instagram context refreshed without activating a page control.', 'good');
      return true;
    } catch (error) {
      model.context = null;
      nowView.render(runtime);
      queueView.renderLiveGate(runtime);
      status(`Instagram context inspection stopped: ${error.message}`, 'error');
      return false;
    }
  }

  function applyBridgeState(state, { guardArmDrop = true } = {}) {
    const previous = model.bridge;
    const next = sanitizeBridgeState(state);
    const priorAccountArm = shared.armRemainingMs(previous.liveArm) > 0 ? previous.liveArm : null;
    const priorDmArm = shared.armRemainingMs(previous.dmArm) > 0 ? previous.dmArm : null;
    if (guardArmDrop && priorAccountArm && !next.liveArm && !next.pendingLiveIntent) {
      model.executionGuard = {
        accountIntent: previous.pendingLiveIntent,
        expiresAt: new Date(Date.now() + 10_000).toISOString(),
        kind: 'account',
      };
    } else if (guardArmDrop && priorDmArm && !next.dmArm && !next.pendingDmIntent) {
      model.executionGuard = {
        dmIntent: previous.pendingDmIntent,
        expiresAt: new Date(Date.now() + 10_000).toISOString(),
        kind: 'dm',
      };
    } else if (!guardArmDrop || next.liveArm || next.dmArm) {
      model.executionGuard = null;
    }
    model.bridge = next;
    bridgeLastContactAt = new Date().toISOString();
    model.bridgeLastContactAt = bridgeLastContactAt;
    runtime.bridgeLastContactAt = bridgeLastContactAt;
    renderAll();
    scheduleCountdown();
    collisionController?.checkNow();
  }

  async function refreshBridge({ announce = false } = {}) {
    const response = await sendBridge({ kind: 'insta-aio-overlay-state' });
    if (response.state) {
      applyBridgeState(response.state);
      if (announce) status('Paired workspace state refreshed.', 'good');
      return true;
    }
    model.bridge = shared.createModel(extensionVersion).bridge;
    renderAll();
    scheduleCountdown();
    collisionController?.checkNow();
    status(`Extension bridge state unavailable: ${response.error || 'unknown error'}.`, 'error');
    return false;
  }

  function requestArmPhrase({ description, phrase }) {
    const dialog = query('[data-ia-role="arm-dialog"]');
    const input = query('[data-ia-role="arm-input"]');
    if (!dialog || !input || dialog.open) return Promise.resolve(null);
    setText('arm-description', description);
    setText('arm-phrase', phrase);
    input.value = '';
    dialog.returnValue = 'cancel';
    const focusBeforeDialog = shadow.activeElement;
    return new Promise((resolve) => {
      dialog.addEventListener('close', () => {
        requestAnimationFrame(() => focusBeforeDialog?.focus?.());
        resolve(dialog.returnValue === 'confirm' ? input.value : null);
      }, { once: true });
      dialog.showModal();
      requestAnimationFrame(() => input.focus());
    });
  }

  function scheduleCountdown() {
    if (countdownTimer !== null) clearTimeout(countdownTimer);
    countdownTimer = null;
    if (!active) return;

    const accountActive = shared.armRemainingMs(model.bridge.liveArm) > 0;
    const dmActive = shared.armRemainingMs(model.bridge.dmArm) > 0;
    const guardActive = shared.armRemainingMs(model.executionGuard) > 0;
    if (!accountActive && model.bridge.liveArm) model.bridge.liveArm = null;
    if (!dmActive && model.bridge.dmArm) model.bridge.dmArm = null;
    if (!guardActive && model.executionGuard) model.executionGuard = null;
    queueView.renderLiveGate(runtime);
    messagesView.renderGate(runtime);
    renderSignals();
    collisionController?.checkNow();
    if (accountActive || dmActive || guardActive) {
      countdownTimer = setTimeout(scheduleCountdown, 1_000);
    }
  }

  function applyCollision(next) {
    model.collision = next;
    host.dataset.collision = next.active ? 'active' : 'inactive';
    const strip = query('[data-ia-role="collision-strip"]');
    if (!strip) return;
    strip.hidden = !next.active;
    if (!next.active) {
      strip.style.removeProperty('left');
      strip.style.removeProperty('top');
      host.removeAttribute('data-collision-placement');
      return;
    }

    setText('collision-target', next.target || 'Exact reviewed target');
    setText(
      'collision-state',
      next.kind === 'native-surface'
        ? 'Instagram action surface visible · overlay controls suspended'
        : 'One-use arm active · page controls remain untouched',
    );
    const cancel = query('[data-ia-action="cancel-current-live"]');
    cancel.hidden = !(model.bridge.pendingLiveIntent || model.bridge.pendingDmIntent);
    requestAnimationFrame(() => {
      if (!active || !model.collision.active) return;
      const rectangle = strip.getBoundingClientRect();
      const position = collision.placement({
        dock: model.preferences?.dock || 'right',
        obstacles: next.rectangles,
        strip: {
          height: rectangle.height || 52,
          width: rectangle.width || 320,
        },
        viewport: { height: innerHeight, width: innerWidth },
      });
      if (!position) {
        strip.hidden = true;
        host.dataset.collisionPlacement = 'blocked';
        return;
      }
      host.dataset.collisionPlacement = 'safe';
      strip.style.left = `${position.left}px`;
      strip.style.top = `${position.top}px`;
    });
  }

  async function execute(action) {
    try {
      await action();
    } catch (error) {
      status(error.message, 'error');
    }
  }

  const runtime = {
    applyBridgeState,
    bridgeLastContactAt,
    document,
    downloads: downloadManager,
    inspector,
    model,
    persistCapture,
    persistManualQueue,
    query,
    queryAll,
    refreshBridge,
    refreshContext,
    renderAll,
    renderSection,
    requestArmPhrase,
    sendBridge,
    setText,
    shadow,
    status,
    window,
  };

  const actionHandlers = Object.freeze({
    'arm-account-live': () => queueView.arm(runtime),
    'arm-dm-live': () => messagesView.arm(runtime),
    'cancel-account-live': () => queueView.cancel(runtime),
    'cancel-current-live': () => (
      model.bridge.pendingDmIntent ? messagesView.cancel(runtime) : queueView.cancel(runtime)
    ),
    'cancel-dm-live': () => messagesView.cancel(runtime),
    'capture-visible': () => captureView.captureVisible(runtime),
    close: () => setOpen(false),
    'inspect-messages': () => messagesView.inspect(runtime),
    open: () => setOpen(true),
    'queue-complete': () => queueView.updateCurrent(runtime, 'completed'),
    'queue-skip': () => queueView.updateCurrent(runtime, 'skipped'),
    'refresh-context': () => refreshContext(),
    'reset-capture': () => captureView.reset(runtime),
  });

  function onShadowClick(event) {
    const disabledLink = event.target.closest?.('[aria-disabled="true"]');
    if (disabledLink) event.preventDefault();
    const sectionButton = event.target.closest?.('[data-ia-section]');
    if (sectionButton) {
      setSection(sectionButton.dataset.iaSection);
      return;
    }
    const target = event.target.closest?.('[data-ia-action]');
    if (!target || target.disabled) return;
    const handler = actionHandlers[target.dataset.iaAction];
    if (handler) void execute(handler);
  }

  function onShadowKeydown(event) {
    if (!event.target.closest?.('[data-ia-section]')) return;
    accessibility.handleTabKey(event, queryAll('[data-ia-section]'), (section) => {
      setSection(section);
    });
  }

  function onShadowChange(event) {
    const preference = event.target.dataset?.iaPreference;
    if (preference) {
      if (preference === 'theme') themeController?.setPreference(event.target.value);
      void savePreference({ [preference]: event.target.value });
      return;
    }
    if (!event.target.matches?.('[data-ia-role="queue-file"]')) return;
    const file = event.target.files?.[0];
    if (file) void execute(() => queueView.importQueue(runtime, file));
    event.target.value = '';
  }

  function onDocumentKeydown(event) {
    if (event.altKey && event.shiftKey && event.key.toLowerCase() === 'i') {
      event.preventDefault();
      setOpen(!model.open);
      return;
    }
    if (
      event.key === 'Escape'
      && model.open
      && shadow.activeElement
      && !query('[data-ia-role="arm-dialog"]')?.open
    ) setOpen(false);
  }

  function onStorageChanged(changes, areaName) {
    if (!active || areaName !== 'local') return;
    const preferenceChange = changes[shared.STORAGE_KEYS.preferencesV2];
    if (preferenceChange?.newValue) {
      applyPreferences(preferenceChange.newValue);
      setSection(model.preferences.section, { persist: false });
      setOpen(model.preferences.open, {
        focus: false,
        persist: false,
        refresh: false,
        restoreFocus: false,
      });
    }
    if (changes[shared.STORAGE_KEYS.capture]) {
      model.capture = changes[shared.STORAGE_KEYS.capture].newValue
        ? shared.normalizeCapture(
          changes[shared.STORAGE_KEYS.capture].newValue,
          inspector.normalizeUsername,
        )
        : null;
      captureView.render(runtime);
    }
    if (changes[shared.STORAGE_KEYS.manualQueue]) {
      model.manualQueue = shared.normalizeManualQueue(
        changes[shared.STORAGE_KEYS.manualQueue].newValue,
        inspector.normalizeUsername,
      );
      queueView.render(runtime);
      nowView.render(runtime);
    }
    if ([
      'bridgePairings',
      'pendingJobs',
      'pendingLiveIntent',
      'liveArm',
      'pendingDmIntent',
      'dmArm',
      'accountActionLedger',
      'dmActionLedger',
    ].some((key) => changes[key])) void refreshBridge({ announce: false });
  }

  function onRouteChange() {
    model.context = null;
    model.messages = null;
    renderAll();
    status('Instagram route changed. Prior page evidence was cleared.', 'neutral');
    if (model.open || model.bridge.pendingLiveIntent || model.bridge.pendingDmIntent) {
      void refreshContext({ announce: false });
    }
  }

  function teardown() {
    if (!active) return;
    active = false;
    if (countdownTimer !== null) clearTimeout(countdownTimer);
    countdownTimer = null;
    collisionController?.teardown();
    routeController?.teardown();
    themeController?.teardown();
    downloadManager.teardown();
    shadow.removeEventListener('click', onShadowClick);
    shadow.removeEventListener('keydown', onShadowKeydown);
    shadow.removeEventListener('change', onShadowChange);
    document.removeEventListener('keydown', onDocumentKeydown);
    window.removeEventListener('resize', collisionController?.checkNow);
    chromeApi.storage.onChanged.removeListener?.(onStorageChanged);
    host.remove();
    globalThis.__instaAioOverlayInstalled = false;
  }

  async function initialize() {
    let loadedPreferences;
    try {
      loadedPreferences = (await preferences.load(storage)).preferences;
    } catch (error) {
      loadedPreferences = preferences.defaults();
      status(`Preferences could not be loaded; safe defaults are active: ${error.message}`, 'error');
    }
    applyPreferences(loadedPreferences);

    try {
      const stored = await storage.get([
        shared.STORAGE_KEYS.capture,
        shared.STORAGE_KEYS.manualQueue,
      ]);
      model.capture = stored[shared.STORAGE_KEYS.capture]
        ? shared.normalizeCapture(stored[shared.STORAGE_KEYS.capture], inspector.normalizeUsername)
        : null;
      model.manualQueue = shared.normalizeManualQueue(
        stored[shared.STORAGE_KEYS.manualQueue],
        inspector.normalizeUsername,
      );
    } catch (error) {
      model.capture = null;
      model.manualQueue = { importedAt: null, queue: [] };
      status(`Local drafts could not be loaded: ${error.message}`, 'error');
    }

    themeController = theme.create({
      document,
      onChange: () => {},
      preference: model.preferences.theme,
      root: host,
      window,
    });
    routeController = routeObserver.create({
      document,
      onRouteChange,
      window,
    });
    collisionController = collision.create({
      actionLabels: globalThis.__instaAioActionLabels,
      document,
      getExecutionState: () => ({
        accountArm: model.bridge.liveArm || (
          model.executionGuard?.kind === 'account' ? model.executionGuard : null
        ),
        accountIntent: model.bridge.pendingLiveIntent || model.executionGuard?.accountIntent || null,
        dmArm: model.bridge.dmArm || (
          model.executionGuard?.kind === 'dm' ? model.executionGuard : null
        ),
        dmIntent: model.bridge.pendingDmIntent || model.executionGuard?.dmIntent || null,
      }),
      onChange: applyCollision,
      window,
    });
    window.addEventListener('resize', collisionController.checkNow);

    setSection(model.preferences.section, { persist: false });
    setOpen(model.preferences.open, {
      focus: model.preferences.open,
      persist: false,
      refresh: false,
      restoreFocus: false,
    });
    renderAll();
    const [contextOk, bridgeOk] = await Promise.all([
      refreshContext({ announce: false }),
      refreshBridge({ announce: false }),
    ]);
    if (contextOk && bridgeOk) {
      status('Inspection ready. Live actions remain locked until one signed exact-item intent is armed.', 'good');
    }
  }

  shadow.addEventListener('click', onShadowClick);
  shadow.addEventListener('keydown', onShadowKeydown);
  shadow.addEventListener('change', onShadowChange);
  document.addEventListener('keydown', onDocumentKeydown);
  chromeApi.storage.onChanged.addListener(onStorageChanged);
  document.documentElement.append(host);
  globalThis.__instaAioOverlayInstalled = true;
  globalThis.__instaAioOverlayTeardown = teardown;
  void initialize().catch((error) => status(`Overlay initialization stopped: ${error.message}`, 'error'));
})();

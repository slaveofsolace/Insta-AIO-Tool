(() => {
  'use strict';

  if (globalThis.__instaToolboxOverlayInstalled) return;

  const modules = globalThis.__instaToolboxOverlayModules;
  const requiredModules = [
    'shared',
    'preferences',
    'routeObserver',
    'theme',
    'bridge',
    'downloads',
    'accessibility',
    'layout',
    'collision',
    'icons',
    'batch',
    'shell',
    'nowView',
    'captureView',
    'queueView',
    'messagesView',
    'workspaceView',
  ];
  if (!modules || requiredModules.some((name) => !modules[name])) return;

  const inspector = globalThis.InstaToolboxInstagramInspector;
  const chromeApi = globalThis.chrome;
  if (!inspector || !chromeApi?.storage?.local || !chromeApi?.runtime) return;
  if (document.getElementById('insta-toolbox-sidecar-root')) return;

  const {
    accessibility,
    batch: batchController,
    bridge,
    captureView,
    collision,
    downloads: downloadsModule,
    layout,
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
    openShadow: globalThis.__instaToolboxOverlayTestOpenShadow === true,
  });
  const storage = preferences.createStorage(chromeApi);
  const downloadManager = downloadsModule.create({ Blob, URL });

  let active = true;
  let bridgeLastContactAt = null;
  let collisionController = null;
  let lastFocusedElement = null;
  let layoutController = null;
  let routeController = null;
  let statusHideTimer = null;
  let themeController = null;

  const STATUS_VISIBLE_MS = 9_000;

  const query = (selector) => shadow.querySelector(selector);
  const queryAll = (selector) => [...shadow.querySelectorAll(selector)];

  function setText(role, value) {
    const element = query(`[data-insta-toolbox-role="${role}"]`);
    if (element) element.textContent = String(value ?? '');
  }

  function status(message, tone = 'neutral') {
    const liveRegion = query('[data-insta-toolbox-role="status"]');
    if (!liveRegion) return;
    if (statusHideTimer) {
      window.clearTimeout(statusHideTimer);
      statusHideTimer = null;
    }
    const safeMessage = shared.safeText(message, 'Review the exact action before continuing.');
    liveRegion.dataset.tone = tone;
    liveRegion.hidden = false;
    setText('status-lead', tone === 'error' ? 'Stopped.' : tone === 'good' ? 'Ready.' : 'Note.');
    setText('status-text', safeMessage);
    statusHideTimer = window.setTimeout(() => {
      statusHideTimer = null;
      setText('status-lead', '');
      setText('status-text', '');
      liveRegion.hidden = true;
    }, STATUS_VISIBLE_MS);
  }

  const confirmationController = globalThis.InstaToolboxActionConfirmation?.createController({
    root: shadow,
    attribute: 'data-insta-toolbox-role',
    status,
    unavailableTone: 'error',
  });
  const confirmAction = (request) => confirmationController?.confirm(request) ?? Promise.resolve(null);

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
    const required = ['contentDigest', 'conversationId', 'itemId', 'jobId', 'messageId'];
    if (!value || required.some((key) => !shared.safeText(value[key]))) return null;
    if (!Number.isFinite(Number(value.timestamp))) return null;
    const expiresAt = shared.safeText(value.expiresAt);
    if (shared.armRemainingMs({ expiresAt }) <= 0) return null;
    return {
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
      dmArm: null,
      exactConfirmationRequired: true,
      extensionVersion: shared.safeText(value.extensionVersion, extensionVersion),
      liveArm: null,
      liveExecutionEnabled: false,
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
    host.dataset.accent = model.preferences.accent;
    host.dataset.blur = model.preferences.blur;
    host.dataset.launcherSize = model.preferences.launcherSize;
    for (const control of queryAll('[data-insta-toolbox-preference]')) {
      const value = model.preferences[control.dataset.instaToolboxPreference];
      if (value !== undefined) control.value = value;
    }
    const opacityControl = query('[data-insta-toolbox-preference="opacity"]');
    if (opacityControl) opacityControl.value = String(Math.round(model.preferences.opacity * 100));
    setText('opacity-output', `${Math.round(model.preferences.opacity * 100)}%`);
    layoutController?.apply(model.preferences);
    themeController?.setPreference(model.preferences.theme);
  }

  async function savePreference(patch) {
    const previous = model.preferences;
    const next = preferences.normalize({ ...previous, ...patch }, previous);
    applyPreferences(next);
    try {
      model.preferences = await preferences.save(storage, previous, patch);
      return true;
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
      return false;
    }
  }

  function setSettingsOpen(open) {
    const dialog = query('[data-insta-toolbox-role="settings-dialog"]');
    const button = query('[data-insta-toolbox-role="settings-button"]');
    if (!dialog || !button) return;
    const shouldOpen = Boolean(open);
    button.setAttribute('aria-expanded', String(shouldOpen));
    if (shouldOpen && !dialog.open) {
      dialog.showModal();
      requestAnimationFrame(() => query('#insta-toolbox-pref-dock')?.focus({ preventScroll: true }));
    } else if (!shouldOpen && dialog.open) {
      dialog.close();
    }
  }

  function onSettingsDialogClick(event) {
    if (event.target === event.currentTarget) setSettingsOpen(false);
  }

  function onSettingsDialogClose() {
    query('[data-insta-toolbox-role="settings-button"]')
      ?.setAttribute('aria-expanded', 'false');
  }

  function setOpen(open, {
    focus = true,
    opener = null,
    persist = true,
    refresh = true,
    restoreFocus = true,
    } = {}) {
    const shouldOpen = Boolean(open);
    if (!shouldOpen) confirmationController?.cancel();
    const opening = shouldOpen && !model.open;
    const focusBeforeOpen = opening
      ? opener || shadow.activeElement || document.activeElement
      : null;
    model.open = shouldOpen;
    const panel = query('.insta-toolbox-panel');
    const launcher = query('.insta-toolbox-launcher');
    panel.hidden = !shouldOpen;
    launcher.hidden = shouldOpen;
    launcher.setAttribute('aria-expanded', String(shouldOpen));
    if (!shouldOpen) setSettingsOpen(false);
    if (persist) void savePreference({ open: shouldOpen });

    if (shouldOpen) {
      if (opening) lastFocusedElement = focusBeforeOpen;
      requestAnimationFrame(() => layoutController?.constrain());
      if (focus && !model.collision.active) {
        requestAnimationFrame(() => query(`[data-insta-toolbox-section="${model.section}"]`)?.focus());
      }
      if (refresh) {
        void Promise.all([
          refreshContext({ announce: false }),
          refreshBridge({ announce: false }),
        ]);
      }
    } else if (restoreFocus && focus) {
      const restoreTarget = (
        lastFocusedElement
        && typeof lastFocusedElement.focus === 'function'
        && lastFocusedElement.isConnected
        && lastFocusedElement !== document.body
        && lastFocusedElement !== document.documentElement
      ) ? lastFocusedElement : launcher;
      window.setTimeout(() => restoreTarget.focus({ preventScroll: true }), 0);
    }
  }

  function renderSection(section = model.section) {
    if (section === 'now') nowView.render(runtime);
    if (section === 'capture') captureView.render(runtime);
    if (section === 'queue') queueView.render(runtime);
    if (section === 'messages') {
      messagesView.render(runtime);
      messagesView.renderSentScan(runtime);
    }
    if (section === 'workspace') workspaceView.render(runtime);
  }

  function setSection(section, { focus = false, persist = true } = {}) {
    if (!shared.SECTIONS.includes(section)) return;
    model.section = section;
    for (const button of queryAll('[data-insta-toolbox-section]')) {
      const selected = button.dataset.instaToolboxSection === section;
      button.setAttribute('aria-selected', String(selected));
      button.tabIndex = selected ? 0 : -1;
    }
    for (const view of queryAll('[data-insta-toolbox-view]')) {
      view.hidden = view.dataset.instaToolboxView !== section;
    }
    renderSection(section);
    if (persist) void savePreference({ section });
    if (focus) requestAnimationFrame(() => query(`[data-insta-toolbox-section="${section}"]`)?.focus());
  }

  function renderSignals() {
    const signal = Boolean(
      model.bridge.pendingLiveIntent
      || model.bridge.pendingDmIntent,
    );
    for (const role of ['launcher-signal', 'queue-signal']) {
      const element = query(`[data-insta-toolbox-role="${role}"]`);
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
    return storage.set({ [shared.STORAGE_KEYS.captureV2]: value });
  }

  function persistManualQueue(value) {
    return storage.set({ [shared.STORAGE_KEYS.manualQueue]: value });
  }

  async function refreshContext({ announce = true } = {}) {
    try {
      model.context = inspector.inspectPageContext();
      nowView.render(runtime);
      queueView.render(runtime);
      if (announce) status('Current Instagram context refreshed without activating a page control.', 'good');
      return true;
    } catch (error) {
      model.context = null;
      nowView.render(runtime);
      queueView.render(runtime);
      status(`Instagram context inspection stopped: ${error.message}`, 'error');
      return false;
    }
  }

  function applyBridgeState(state) {
    model.bridge = sanitizeBridgeState(state);
    model.armNotice = null;
    model.executionGuard = null;
    bridgeLastContactAt = new Date().toISOString();
    model.bridgeLastContactAt = bridgeLastContactAt;
    runtime.bridgeLastContactAt = bridgeLastContactAt;
    renderAll();
    collisionController?.checkNow();
  }

  async function refreshBridge({ announce = false } = {}) {
    const response = await sendBridge({ kind: 'insta-toolbox-overlay-state' });
    if (response.state) {
      applyBridgeState(response.state);
      if (announce) status('Paired workspace state refreshed.', 'good');
      return true;
    }
    model.bridge = shared.createModel(extensionVersion).bridge;
    renderAll();
    collisionController?.checkNow();
    status(`Extension bridge state unavailable: ${response.error || 'unknown error'}.`, 'error');
    return false;
  }

  function applyCollision(next) {
    model.collision = next;
    layoutController?.apply(model.preferences || preferences.defaults());
    host.dataset.dock = model.preferences?.dock || 'right';
    host.dataset.width = model.preferences?.width || 'standard';
    host.removeAttribute('data-adaptive-dock');
    host.removeAttribute('data-adaptive-width');
    host.dataset.collision = next.active ? 'active' : 'inactive';
    const strip = query('[data-insta-toolbox-role="collision-strip"]');
    if (!strip) return;
    strip.hidden = !next.active;
    if (!next.active) {
      strip.style.removeProperty('left');
      strip.style.removeProperty('top');
      host.removeAttribute('data-collision-placement');
      requestAnimationFrame(() => {
        if (!active || model.collision.active || !model.open) return;
        const target = next.reviewedRectangles?.[0];
        const panel = query('.insta-toolbox-panel');
        if (!target || !panel || panel.hidden) return;
        const panelRectangle = panel.getBoundingClientRect();
        if (!collision.intersects(panelRectangle, target)) return;
        host.dataset.layout = 'docked';
        host.dataset.dock = (model.preferences?.dock || 'right') === 'right' ? 'left' : 'right';
        host.dataset.adaptiveDock = 'reviewed-target';
        requestAnimationFrame(() => {
          if (!active || model.collision.active || !model.open) return;
          if (!collision.intersects(panel.getBoundingClientRect(), target)) return;
          host.dataset.width = 'compact';
          host.dataset.adaptiveWidth = 'reviewed-target';
          const preferredDock = model.preferences?.dock || 'right';
          for (const candidateDock of [preferredDock, preferredDock === 'right' ? 'left' : 'right']) {
            host.dataset.dock = candidateDock;
            if (!collision.intersects(panel.getBoundingClientRect(), target)) {
              host.dataset.adaptiveDock = 'reviewed-target';
              return;
            }
          }
        });
      });
      return;
    }

    setText('collision-target', next.target || 'Exact reviewed target');
    setText(
      'collision-state',
      next.kind === 'native-surface'
        ? 'Instagram action surface visible · overlay controls suspended'
        : 'Exact confirmation active · page controls remain untouched',
    );
    requestAnimationFrame(() => {
      if (!active || !model.collision.active) return;
      const rectangle = strip.getBoundingClientRect();
      const position = collision.placement({
        dock: model.preferences?.dock || 'right',
        obstacles: [...next.rectangles, ...(next.reviewedRectangles || [])],
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
    confirmAction,
    confirmationPending: () => confirmationController?.isPending() === true,
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
    sendBridge,
    setText,
    shadow,
    status,
    window,
  };

  const actionHandlers = Object.freeze({
    'batch-stop': () => batchController.abort(runtime),
    'bot-review': () => queueView.botReview(runtime),
    'bot-start': () => queueView.botStart(runtime),
    'capture-visible': () => captureView.captureVisible(runtime),
    'check-account-relationships': () => captureView.checkAccount(runtime, 'graphql'),
    'check-account-dialog': () => captureView.checkAccount(runtime, 'dialog'),
    'confirm-cancel': () => confirmationController?.cancel(),
    close: () => setOpen(false),
    'close-settings': () => setSettingsOpen(false),
    'inspect-messages': () => messagesView.inspect(runtime),
    'layout-preset': (target) => {
      const viewportHeight = Math.max(320, Number(window.innerHeight) || 720);
      const presets = {
        compact: { panelHeight: 520, panelWidth: 380, width: 'compact' },
        tall: { panelHeight: Math.min(820, viewportHeight - 16), panelWidth: 460, width: 'standard' },
        wide: { panelHeight: 680, panelWidth: 560, width: 'wide' },
      };
      const preset = presets[target.dataset.layoutPreset];
      return preset ? savePreference(preset) : undefined;
    },
    'mass-unsend': () => messagesView.massUnsend(runtime),
    'open-settings': () => setSettingsOpen(true),
    'save-limits': () => batchController.saveLimits(runtime),
    'scan-full-list': (target) => captureView.scanFullList(runtime, target.dataset.listType),
    'scan-sent-dms': () => messagesView.scanSent(runtime),
    open: (opener) => setOpen(true, { opener }),
    'queue-complete': () => queueView.updateCurrent(runtime, 'completed'),
    'queue-skip': () => queueView.updateCurrent(runtime, 'skipped'),
    'refresh-context': () => refreshContext(),
    'reset-capture': () => captureView.reset(runtime),
    'reset-layout': () => savePreference({
      opacity: preferences.defaults().opacity,
      panelHeight: null,
      panelWidth: null,
      position: null,
      launcherPosition: null,
    }),
  });

  function onShadowClick(event) {
    const disabledLink = event.target.closest?.('[aria-disabled="true"]');
    if (disabledLink) event.preventDefault();
    const sectionButton = event.target.closest?.('[data-insta-toolbox-section]');
    if (sectionButton) {
      setSection(sectionButton.dataset.instaToolboxSection);
      return;
    }
    const sectionLink = event.target.closest?.('[data-insta-toolbox-go-section]');
    if (sectionLink) {
      setSection(sectionLink.dataset.instaToolboxGoSection, { focus: true });
      return;
    }
    const target = event.target.closest?.('[data-insta-toolbox-action]');
    if (!target || target.disabled) return;
    const handler = actionHandlers[target.dataset.instaToolboxAction];
    if (handler) void execute(() => handler(target));
  }

  function onShadowKeydown(event) {
    if (!event.target.closest?.('[data-insta-toolbox-section]')) return;
    accessibility.handleTabKey(event, queryAll('[data-insta-toolbox-section]'), (section) => {
      setSection(section);
    });
  }

  function onShadowChange(event) {
    if (['bot-source', 'bot-action', 'bot-count'].includes(event.target.dataset?.instaToolboxRole)) {
      queueView.invalidateBotReview(runtime);
    }
    if (['unsend-scope', 'unsend-count'].includes(event.target.dataset?.instaToolboxRole)) {
      messagesView.renderSentScan(runtime);
    }
    const preference = event.target.dataset?.instaToolboxPreference;
    if (preference) {
      const rawValue = preference === 'opacity'
        ? Number(event.target.value) / 100
        : event.target.value;
      if (preference === 'theme') themeController?.setPreference(rawValue);
      if (preference === 'dock') {
        void savePreference({ dock: rawValue, position: null });
      } else if (preference === 'width') {
        void savePreference({ panelWidth: null, width: rawValue });
      } else {
        void savePreference({ [preference]: rawValue });
      }
      return;
    }
    if (event.target.matches?.('[data-insta-toolbox-role="list-type"]')) {
      captureView.render(runtime);
      return;
    }
    if (event.target.matches?.('[data-insta-toolbox-role="checker-category"]')) {
      captureView.render(runtime);
      return;
    }
    if (!event.target.matches?.('[data-insta-toolbox-role="queue-file"]')) return;
    const file = event.target.files?.[0];
    if (file) void execute(() => queueView.importQueue(runtime, file));
    event.target.value = '';
  }

  function onShadowInput(event) {
    if (event.target.matches?.('[data-insta-toolbox-role="checker-search"]')) {
      captureView.render(runtime);
      return;
    }
    if (event.target.dataset?.instaToolboxPreference !== 'opacity') return;
    const opacity = Number(event.target.value) / 100;
    setText('opacity-output', `${Math.round(opacity * 100)}%`);
    layoutController?.previewOpacity(opacity);
  }

  function onShadowToggle(event) {
    const details = event.target.closest?.('[data-insta-toolbox-role="advanced-settings"]');
    if (!details?.open) return;
    const body = query('[data-insta-toolbox-role="advanced-settings-body"]');
    if (!body || body.childElementCount) return;
    const template = query('[data-insta-toolbox-template="advanced-settings"]');
    if (!template) return;
    body.append(template.content.cloneNode(true));
    void batchController.hydrate(runtime);
  }

  function onDocumentKeydown(event) {
    if (event.key === 'Escape' && confirmationController?.isPending()) return;
    if (event.key === 'Escape' && query('[data-insta-toolbox-role="settings-dialog"]')?.open) {
      setSettingsOpen(false);
      event.preventDefault();
      return;
    }
    if (event.altKey && event.shiftKey && event.key.toLowerCase() === 'i') {
      event.preventDefault();
      setOpen(!model.open);
      return;
    }
    if (
      event.key === 'Escape'
      && model.open
      && shadow.activeElement
    ) setOpen(false);
  }

  function onStorageChanged(changes, areaName) {
    if (!active || areaName !== 'local') return;
    const preferenceChange = changes[shared.STORAGE_KEYS.preferencesV3];
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
    if (changes[shared.STORAGE_KEYS.captureV2]) {
      model.capture = shared.normalizeCaptureWorkspace(
        changes[shared.STORAGE_KEYS.captureV2].newValue,
        inspector.normalizeUsername,
      );
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
      shared.STORAGE_KEYS.bridgePairings,
      shared.STORAGE_KEYS.pendingJobs,
      shared.STORAGE_KEYS.pendingLiveIntent,
      shared.STORAGE_KEYS.pendingDmIntent,
      shared.STORAGE_KEYS.accountActionLedger,
      shared.STORAGE_KEYS.dmActionLedger,
      shared.STORAGE_KEYS.threadUnsendLedger,
      shared.STORAGE_KEYS.batchRun,
    ].some((key) => changes[key])) void refreshBridge({ announce: false });
  }

  function onWindowResize() {
    layoutController?.constrain();
    collisionController?.checkNow();
  }

  function onRouteChange() {
    confirmationController?.cancel();
    messagesView.cancelPending?.(runtime);
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
    if (statusHideTimer) {
      window.clearTimeout(statusHideTimer);
      statusHideTimer = null;
    }
    confirmationController?.destroy();
    messagesView.cancelPending?.(runtime);
    collisionController?.teardown();
    layoutController?.teardown();
    routeController?.teardown();
    themeController?.teardown();
    downloadManager.teardown();
    shadow.removeEventListener('click', onShadowClick);
    shadow.removeEventListener('keydown', onShadowKeydown);
    shadow.removeEventListener('change', onShadowChange);
    shadow.removeEventListener('input', onShadowInput);
    shadow.removeEventListener('toggle', onShadowToggle, true);
    query('[data-insta-toolbox-role="settings-dialog"]')
      ?.removeEventListener('click', onSettingsDialogClick);
    query('[data-insta-toolbox-role="settings-dialog"]')
      ?.removeEventListener('close', onSettingsDialogClose);
    document.removeEventListener('keydown', onDocumentKeydown);
    window.removeEventListener('resize', onWindowResize);
    chromeApi.storage.onChanged.removeListener?.(onStorageChanged);
    host.remove();
    globalThis.__instaToolboxOverlayInstalled = false;
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
        shared.STORAGE_KEYS.captureV2,
        shared.STORAGE_KEYS.manualQueue,
      ]);
      const captureMigration = shared.migrateCaptureWorkspace({
        v1: stored[shared.STORAGE_KEYS.capture],
        v2: stored[shared.STORAGE_KEYS.captureV2],
      }, inspector.normalizeUsername);
      model.capture = captureMigration.workspace;
      if (captureMigration.shouldPersist) await persistCapture(model.capture);
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
    layoutController = layout.create({
      host,
      launcher: query('.insta-toolbox-launcher'),
      moveHandle: query('[data-insta-toolbox-role="move-handle"]'),
      onCommit: (patch) => { void savePreference(patch); },
      panel: query('.insta-toolbox-panel'),
      resizeEndHandle: query('[data-insta-toolbox-role="resize-handle-end"]'),
      resizeStartHandle: query('[data-insta-toolbox-role="resize-handle-start"]'),
      window,
    });
    layoutController.apply(model.preferences);
    routeController = routeObserver.create({
      document,
      onRouteChange,
      window,
    });
    collisionController = collision.create({
      actionLabels: globalThis.__instaToolboxActionLabels,
      document,
      getExecutionState: () => ({
        accountArm: null,
        accountIntent: model.bridge.pendingLiveIntent || null,
        dmArm: null,
        dmIntent: model.bridge.pendingDmIntent || null,
      }),
      getReviewedTarget: (state) => inspector.reviewedTargetElement(state),
      onChange: applyCollision,
      window,
    });
    window.addEventListener('resize', onWindowResize);

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
      batchController.hydrate(runtime).catch(() => {}),
    ]);
    if (contextOk && bridgeOk) {
    status('Review the exact target before any change.', 'good');
    }
  }

  shadow.addEventListener('click', onShadowClick);
  shadow.addEventListener('keydown', onShadowKeydown);
  shadow.addEventListener('change', onShadowChange);
  shadow.addEventListener('input', onShadowInput);
  shadow.addEventListener('toggle', onShadowToggle, true);
  query('[data-insta-toolbox-role="settings-dialog"]')
    ?.addEventListener('click', onSettingsDialogClick);
  query('[data-insta-toolbox-role="settings-dialog"]')
    ?.addEventListener('close', onSettingsDialogClose);
  document.addEventListener('keydown', onDocumentKeydown);
  chromeApi.storage.onChanged.addListener(onStorageChanged);
  document.documentElement.append(host);
  globalThis.__instaToolboxOverlayInstalled = true;
  globalThis.__instaToolboxOverlayTeardown = teardown;
  void initialize().catch((error) => status(`Overlay initialization stopped: ${error.message}`, 'error'));
})();

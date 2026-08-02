(() => {
  'use strict';

  const modules = globalThis.__instaAioOverlayModules;
  const shared = modules?.shared;
  const bridge = modules?.bridge;
  if (!shared || !bridge || modules.workspaceView) return;

  function addFact(document, list, label, value) {
    const wrapper = document.createElement('div');
    const term = document.createElement('dt');
    term.textContent = label;
    const description = document.createElement('dd');
    description.textContent = value;
    wrapper.append(term, description);
    list.append(wrapper);
  }

  function render(runtime) {
    const {
      document, model, query, setText,
    } = runtime;
    const pairing = bridge.activePairing(model.bridge);
    const state = query('[data-ia-role="bridge-state"]');
    const facts = query('[data-ia-role="bridge-facts"]');
    const link = query('[data-ia-role="workspace-link"]');
    if (!state || !facts || !link) return;
    facts.replaceChildren();

    if (pairing) {
      state.dataset.tone = 'good';
      setText('bridge-title', 'Workspace paired');
      setText('bridge-detail', 'The overlay receives sanitized intent and run summaries, never Instagram credentials or cookies.');
      link.href = pairing.origin;
      link.target = '_blank';
      link.removeAttribute('aria-disabled');
      addFact(document, facts, 'Exact origin', shared.safeText(pairing.origin, 'unknown'));
      addFact(
        document,
        facts,
        'Permissions',
        Array.isArray(pairing.permissions) ? pairing.permissions.join(' + ') : 'read',
      );
    } else {
      state.dataset.tone = 'warning';
      setText('bridge-title', 'Workspace not paired');
      setText('bridge-detail', 'Create a code in PWA Settings, then pair the exact PWA tab from extension setup.');
      link.removeAttribute('href');
      link.removeAttribute('target');
      link.setAttribute('aria-disabled', 'true');
      addFact(document, facts, 'Exact origin', 'Not paired');
      addFact(document, facts, 'Permissions', 'None');
    }
    addFact(document, facts, 'Extension', shared.safeText(model.bridge.extensionVersion, 'unknown'));
    addFact(
      document,
      facts,
      'Last contact',
      model.bridgeLastContactAt ? shared.shortDate(model.bridgeLastContactAt) : 'Not reached',
    );
    setText(
      'workspace-guidance',
      pairing
        ? 'Use the PWA for imports, comparisons, review policy, backups, and every execution confirmation.'
        : 'Create a read-only code first. Enable action permission only when you intentionally need a signed reviewed workflow.',
    );
  }

  shared.install('workspaceView', { render });
})();

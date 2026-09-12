(() => {
  'use strict';

  const namespace = 'InstaToolboxActionConfirmation';
  if (globalThis[namespace]) return;

  function immutableCopy(value) {
    if (Array.isArray(value)) return Object.freeze(value.map(immutableCopy));
    if (value && typeof value === 'object') {
      return Object.freeze(Object.fromEntries(
        Object.entries(value).map(([key, entry]) => [key, immutableCopy(entry)]),
      ));
    }
    return value;
  }

  function cleanText(value, fallback = '') {
    const text = String(value ?? '').trim();
    return (text || fallback).slice(0, 1_000);
  }

  function createController({ root, attribute, status, unavailableTone = 'error' }) {
    if (!root?.querySelector || !attribute) throw new TypeError('A confirmation root and role attribute are required.');

    const query = (role) => root.querySelector(`[${attribute}="${role}"]`);
    const dialog = query('action-confirmation');
    const cancelButton = query('confirm-cancel');
    const confirmButton = query('confirm-accept');
    let pending = null;

    function renderList(role, values) {
      const list = query(role);
      if (!list) return;
      const items = (Array.isArray(values) ? values : [])
        .map((value) => cleanText(value))
        .filter(Boolean)
        .slice(0, 250);
      list.replaceChildren(...items.map((value) => {
        const item = root.ownerDocument.createElement('li');
        item.textContent = value;
        return item;
      }));
      list.hidden = items.length === 0;
    }

    function renderFacts(values) {
      const list = query('confirm-facts');
      if (!list) return;
      const facts = (Array.isArray(values) ? values : [])
        .map((entry) => ({
          label: cleanText(entry?.label),
          value: cleanText(entry?.value),
        }))
        .filter((entry) => entry.label && entry.value)
        .slice(0, 12);
      const nodes = [];
      for (const fact of facts) {
        const term = root.ownerDocument.createElement('dt');
        const description = root.ownerDocument.createElement('dd');
        term.textContent = fact.label;
        description.textContent = fact.value;
        nodes.push(term, description);
      }
      list.replaceChildren(...nodes);
      list.hidden = facts.length === 0;
    }

    function settle(confirmed) {
      const current = pending;
      if (!current) return false;
      pending = null;
      if (dialog?.open) dialog.close();
      if (current.restoreFocus?.isConnected) current.restoreFocus.focus();
      const expired = Number(current.binding?.expiresAt) > 0
        && Number(current.binding.expiresAt) <= Date.now();
      if (confirmed === true && expired) {
        status?.('This review expired. Review the action again. Nothing was changed.', unavailableTone);
      }
      current.resolve(confirmed === true && !expired ? current.binding : null);
      return true;
    }

    function confirm(request = {}) {
      if (pending) return Promise.resolve(null);
      if (!dialog?.showModal || !cancelButton || !confirmButton) {
        status?.('The confirmation panel is unavailable. Nothing was changed.', unavailableTone);
        return Promise.resolve(null);
      }

      const title = query('confirm-title');
      const message = query('confirm-message');
      const detail = query('confirm-detail');
      if (title) title.textContent = cleanText(request.title, 'Confirm action');
      if (message) message.textContent = cleanText(request.message, 'Review this action.');
      if (detail) detail.textContent = cleanText(request.detail, 'This cannot be undone.');
      confirmButton.textContent = cleanText(request.confirmLabel, 'Confirm');
      renderFacts(request.facts);
      renderList('confirm-items', request.items);

      const binding = immutableCopy(request.binding || {});
      return new Promise((resolve) => {
        pending = {
          binding,
          resolve,
          restoreFocus: root.activeElement || root.ownerDocument.activeElement,
        };
        try {
          dialog.showModal();
          cancelButton.focus();
        } catch {
          pending = null;
          resolve(null);
          status?.('The confirmation panel could not open. Nothing was changed.', unavailableTone);
        }
      });
    }

    function onCancel(event) {
      event.preventDefault();
      settle(false);
    }

    function onAccept(event) {
      if (event?.isTrusted !== true) {
        event?.preventDefault?.();
        event?.stopPropagation?.();
        return;
      }
      settle(true);
    }

    function onClose() {
      // A previous close event can arrive after the dialog has been reopened.
      if (pending && !dialog.open) settle(false);
    }

    dialog?.addEventListener('cancel', onCancel);
    dialog?.addEventListener('close', onClose);
    confirmButton?.addEventListener('click', onAccept);

    return Object.freeze({
      cancel: () => settle(false),
      confirm,
      destroy() {
        settle(false);
        dialog?.removeEventListener('cancel', onCancel);
        dialog?.removeEventListener('close', onClose);
        confirmButton?.removeEventListener('click', onAccept);
      },
      isPending: () => Boolean(pending),
    });
  }

  Object.defineProperty(globalThis, namespace, {
    configurable: false,
    enumerable: false,
    value: Object.freeze({ createController }),
    writable: false,
  });
})();

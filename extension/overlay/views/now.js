(() => {
  'use strict';

  const modules = globalThis.__instaAioOverlayModules;
  const shared = modules?.shared;
  if (!shared || modules.nowView) return;

  function make(document, tag, className, text) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
  }

  function addFact(document, list, label, value) {
    const wrapper = document.createElement('div');
    const term = make(document, 'dt', '', label);
    const description = make(document, 'dd', '', value);
    wrapper.append(term, description);
    list.append(wrapper);
  }

  function routeCopy(context) {
    if (context?.pageKind === 'profile') {
      const relationship = context.profile?.ambiguous
        ? 'Ambiguous — safe stop'
        : shared.safeText(context.profile?.relationship, 'Not resolved');
      return {
        badge: relationship,
        heading: context.username ? `@${context.username}` : 'Profile not resolved',
        nextAction: 'Refresh no-click inspection',
        nextDetail: 'Re-read the exact profile header and relationship control without activating it.',
        nextCommand: 'refresh-context',
        subtitle: 'Profile review',
      };
    }
    if (context?.pageKind === 'messages') {
      return {
        badge: 'read only',
        heading: 'Open conversation',
        nextAction: 'Read visible thread',
        nextDetail: 'Capture rendered text evidence without opening a message menu.',
        nextCommand: 'inspect-messages',
        subtitle: 'Message evidence',
      };
    }
    return {
      badge: shared.safeText(context?.pageKind, 'waiting'),
      heading: 'No exact target on this route',
      nextAction: 'Refresh page context',
      nextDetail: 'Inspection remains available; account and message actions stay unavailable.',
      nextCommand: 'refresh-context',
      subtitle: 'Instagram context',
    };
  }

  function render(runtime) {
    const { document, model, query } = runtime;
    const content = query('[data-ia-role="now-content"]');
    if (!content) return;
    content.replaceChildren();

    const context = model.context || {};
    const [stateTitle, stateDetail, stateTone] = shared.sessionState(context);
    const state = make(document, 'div', 'ia-state-row');
    state.dataset.tone = stateTone;
    const stateDot = make(document, 'span', 'ia-state-dot');
    stateDot.setAttribute('aria-hidden', 'true');
    const stateCopy = document.createElement('div');
    stateCopy.append(
      make(document, 'strong', '', stateTitle),
      make(document, 'span', '', stateDetail),
    );
    state.append(stateDot, stateCopy);

    const copy = routeCopy(context);
    const card = make(document, 'article', 'ia-card');
    const targetTop = make(document, 'div', 'ia-target-top');
    const avatar = make(document, 'div', 'ia-target-avatar', context.username ? '@' : 'IG');
    avatar.setAttribute('aria-hidden', 'true');
    const targetCopy = document.createElement('div');
    targetCopy.append(
      make(document, 'h2', '', copy.heading),
      make(document, 'p', '', copy.subtitle),
    );
    const badge = make(document, 'span', 'ia-badge', copy.badge);
    badge.dataset.tone = context.profile?.ambiguous ? 'danger' : 'good';
    targetTop.append(avatar, targetCopy, badge);

    const facts = make(document, 'dl', 'ia-facts');
    const queueItem = shared.currentQueueItem(model);
    const queueMatch = queueItem && context.username === queueItem.account.username
      ? `Matches ${queueItem.action}`
      : queueItem
        ? `Next: @${queueItem.account.username}`
        : 'No item loaded';
    addFact(document, facts, 'Route', shared.safeText(context.pageKind, 'unknown'));
    addFact(document, facts, 'Queue', queueMatch);
    card.append(targetTop, facts);

    const next = make(document, 'section', 'ia-next');
    const nextCopy = document.createElement('div');
    nextCopy.append(
      make(document, 'p', 'ia-next-label', 'Next safe step'),
      make(document, 'h3', '', copy.nextAction),
      make(document, 'p', '', copy.nextDetail),
    );
    const button = make(document, 'button', 'ia-button', copy.nextAction);
    button.type = 'button';
    button.dataset.iaAction = copy.nextCommand;
    next.append(nextCopy, button);

    const observed = make(
      document,
      'p',
      'ia-note',
      `Observed ${shared.shortDate(context.capturedAt || Date.now())}. Inspection is no-click.`,
    );

    const toolHeading = make(document, 'h2', 'ia-tool-heading', 'Installed Instagram tools');
    const toolGrid = make(document, 'div', 'ia-tool-grid');
    const tools = [
      {
        section: 'capture',
        title: 'Follower checker',
        detail: 'Capture Followers and Following separately, then compare the rendered rows locally.',
        state: 'read only',
      },
      {
        section: 'queue',
        title: 'Follow / Unfollow',
        detail: 'Import a reviewed queue and inspect one exact profile without clicking first.',
        state: model.bridge.pendingLiveIntent ? 'intent ready' : 'live locked',
      },
      {
        section: 'messages',
        title: 'DM Unsend',
        detail: 'Read visible evidence or resolve one exact reviewed sent message without opening its menu.',
        state: model.bridge.pendingDmIntent ? 'intent ready' : 'live locked',
      },
    ];
    for (const tool of tools) {
      const button = make(document, 'button', 'ia-tool-card');
      button.type = 'button';
      button.dataset.iaGoSection = tool.section;
      const copyElement = document.createElement('span');
      copyElement.append(
        make(document, 'strong', '', tool.title),
        make(document, 'span', '', tool.detail),
      );
      button.append(copyElement, make(document, 'em', '', tool.state));
      toolGrid.append(button);
    }
    content.append(state, card, next, observed, toolHeading, toolGrid);
  }

  shared.install('nowView', { render });
})();

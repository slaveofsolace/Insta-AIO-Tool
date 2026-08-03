(() => {
  if (globalThis.__instaAioInspectorInstalled) return;
  const actionLabels = globalThis.__instaAioActionLabels;
  if (
    !actionLabels
    || typeof actionLabels.isDmUnsendLabel !== 'function'
    || typeof actionLabels.normalizeActionLabel !== 'function'
    || typeof actionLabels.relationshipForLabel !== 'function'
  ) return;
  globalThis.__instaAioInspectorInstalled = true;

  const RESERVED = new Set([
    'accounts', 'about', 'api', 'developer', 'direct', 'emails', 'explore',
    'challenge', 'directory', 'graphql', 'legal', 'p', 'privacy', 'reel',
    'reels', 'settings', 'static', 'stories', 'terms', 'tv', 'web',
  ]);
  const PROFILE_RESOLUTION_TTL_MS = 20_000;
  const DM_RESOLUTION_TTL_MS = 20_000;
  const profileResolutions = new Map();
  const dmResolutions = new Map();
  const DM_MESSAGE_ID_ATTRIBUTES = Object.freeze([
    'data-message-id',
    'data-item-id',
  ]);
  const DM_TIMESTAMP_ATTRIBUTES = Object.freeze([
    'data-timestamp-ms',
    'data-timestamp',
  ]);
  const DM_ACTION_LABEL_SELECTORS = Object.freeze([
    "[aria-label^='See more options for message']",
    "[aria-label*='more options']",
    "[aria-label*='More']",
    "[aria-label*='Altre opzioni']",
    "[aria-label*='opzioni']",
    "[aria-label*='opciones']",
    "[aria-label*='options']",
  ]);

  function normalizeUsername(value) {
    const username = String(value || '')
      .replace(/^https?:\/\/www\.instagram\.com\//i, '')
      .replace(/^@/, '')
      .replace(/^\/+/, '')
      .split(/[/?#]/)[0]
      .trim()
      .toLowerCase();
    return /^[a-z0-9._]{1,30}$/i.test(username) && !RESERVED.has(username)
      ? username
      : '';
  }

  function visibleText(element) {
    if (!element || element.getAttribute('aria-hidden') === 'true') return '';
    const style = getComputedStyle(element);
    if (style.display === 'none' || style.visibility === 'hidden') return '';
    return String(element.textContent || element.getAttribute('aria-label') || '').trim();
  }

  function resolutionToken() {
    try {
      const secureCrypto = globalThis.crypto;
      if (typeof secureCrypto?.randomUUID === 'function') {
        const token = secureCrypto.randomUUID();
        if (/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(token)) {
          return token;
        }
      }
      if (typeof secureCrypto?.getRandomValues !== 'function') return null;
      const bytes = new Uint8Array(16);
      secureCrypto.getRandomValues(bytes);
      if (bytes.every((byte) => byte === 0)) return null;
      return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
    } catch {
      return null;
    }
  }

  function dmContentDigest(value) {
    const text = String(value ?? '');
    let hash = 0x811c9dc5;
    for (let index = 0; index < text.length; index += 1) {
      hash ^= text.charCodeAt(index);
      hash = Math.imul(hash, 0x01000193);
    }
    return (hash >>> 0).toString(16).padStart(8, '0');
  }

  function directThreadId(value) {
    const text = String(value || '').replaceAll('\\', '/');
    const directMatch = text.match(/\/direct\/t\/([^/?#]+)/i);
    if (directMatch) return directMatch[1];
    const finalSegment = text.split('/').filter(Boolean).at(-1) || '';
    const exportMatch = finalSegment.match(/_([0-9]+)$/);
    return exportMatch?.[1] || (/^[0-9]+$/.test(finalSegment) ? finalSegment : null);
  }

  function normalizedDmTimestamp(value) {
    if (value == null || value === '') return null;
    const numeric = Number(value);
    if (Number.isFinite(numeric)) {
      if (numeric > 100_000_000_000_000) return Math.floor(numeric / 1000);
      return numeric < 10_000_000_000 ? numeric * 1000 : numeric;
    }
    const parsed = Date.parse(String(value));
    return Number.isFinite(parsed) ? parsed : null;
  }

  function dmMessageId(element) {
    for (const attribute of DM_MESSAGE_ID_ATTRIBUTES) {
      const value = String(element?.getAttribute?.(attribute) || '').trim();
      if (value) return { attribute, value };
    }
    return null;
  }

  function dmMessageTimestamp(identityNode, row) {
    for (const element of [identityNode, row]) {
      for (const attribute of DM_TIMESTAMP_ATTRIBUTES) {
        const timestamp = normalizedDmTimestamp(element?.getAttribute?.(attribute));
        if (timestamp != null) return { basis: attribute, timestamp };
      }
    }
    const time = row?.querySelector?.('time[datetime]');
    const timestamp = normalizedDmTimestamp(time?.getAttribute?.('datetime'));
    return timestamp == null ? null : { basis: 'time[datetime]', timestamp };
  }

  function dmOwnership(row, identityNode) {
    const explicit = String(row?.getAttribute?.('data-sent-by-me') || '').toLowerCase();
    if (explicit === 'true') return { sentByMe: true, basis: 'data-sent-by-me' };
    if (explicit === 'false') return { sentByMe: false, basis: 'data-sent-by-me' };

    // The source script used flex-end as sent-message evidence. Keep that evidence
    // only on the exact identity-to-row ancestor chain; unrelated descendant
    // toolbars must never confer ownership on a received message.
    const ownershipChain = [];
    let element = identityNode;
    while (element && row?.contains?.(element)) {
      ownershipChain.push(element);
      if (element === row) break;
      element = element.parentElement || element.parentNode || element.parent || null;
    }
    if (ownershipChain.at(-1) !== row) return { sentByMe: null, basis: null };
    for (const element of ownershipChain) {
      if (getComputedStyle(element).justifyContent === 'flex-end') {
        return { sentByMe: true, basis: 'identity-ancestor-flex-end-layout' };
      }
    }
    return { sentByMe: null, basis: null };
  }

  function dmContentCandidates(row) {
    const explicitlyMarked = [...(row?.querySelectorAll?.('[data-insta-aio-message-content]') || [])];
    const nodes = explicitlyMarked.length
      ? explicitlyMarked
      : [...(row?.querySelectorAll?.('[dir="auto"]') || [])]
        .filter((element) => !element.querySelector?.('[dir="auto"]'))
        .filter((element) => !element.closest?.('header, nav, button, [role="button"], a, time'));
    return [...new Set(nodes.map(visibleText).filter((text) => text && text.length <= 500))];
  }

  function resolveReviewedDmItem(item) {
    const session = inspectSession();
    if (session.sessionExpired || session.challenge || session.actionBlocked || session.rateLimited) {
      return { observation: session, candidate: null };
    }
    if (pageKind() !== 'messages') {
      return {
        observation: { ...session, unexpectedUi: true, reason: 'open-an-instagram-conversation' },
        candidate: null,
      };
    }

    const expectedThreadId = directThreadId(item?.conversationId);
    const observedThreadId = directThreadId(location.pathname);
    if (!expectedThreadId || !observedThreadId) {
      return {
        observation: { ...session, ambiguous: true, reason: 'conversation-id-unresolved' },
        candidate: null,
      };
    }
    if (expectedThreadId !== observedThreadId) {
      return {
        observation: {
          ...session,
          ambiguous: true,
          reason: 'wrong-conversation',
          evidence: { expectedThreadId, observedThreadId },
        },
        candidate: null,
      };
    }

    const scope = document.querySelector('[data-pagelet="IGDMessagesList"]')
      || document.querySelector('main');
    const identitySelector = DM_MESSAGE_ID_ATTRIBUTES
      .map((attribute) => `[${attribute}]`)
      .join(', ');
    const identityNodes = [...(scope?.querySelectorAll?.(identitySelector) || [])]
      .filter((element) => visibleText(element));
    if (!identityNodes.length) {
      return {
        observation: {
          ...session,
          conversationId: String(item?.conversationId || ''),
          messageId: String(item?.messageId || ''),
          missing: true,
          exactIdentityAvailable: false,
          ownershipAvailable: false,
          reason: 'exact-message-identity-unavailable',
          evidence: { observedThreadId, stableIdentityNodeCount: 0 },
        },
        candidate: null,
      };
    }

    const candidates = identityNodes.map((identityNode) => {
      const row = identityNode.closest?.('[role="row"], [role="listitem"]') || identityNode;
      const identity = dmMessageId(identityNode) || dmMessageId(row);
      const timestamp = dmMessageTimestamp(identityNode, row);
      const ownership = dmOwnership(row, identityNode);
      const contents = dmContentCandidates(row);
      return {
        contentMatches: contents.filter((content) => dmContentDigest(content) === item?.contentDigest),
        identity,
        identityNode,
        ownership,
        row,
        timestamp,
      };
    }).filter((candidate) => (
      candidate.identity?.value === String(item?.messageId || '')
      && candidate.timestamp?.timestamp === Number(item?.timestamp)
      && candidate.contentMatches.length === 1
    ));

    if (!candidates.length) {
      return {
        observation: {
          ...session,
          conversationId: String(item?.conversationId || ''),
          messageId: String(item?.messageId || ''),
          missing: true,
          exactIdentityAvailable: true,
          reason: 'exact-message-not-found',
          evidence: { observedThreadId, stableIdentityNodeCount: identityNodes.length },
        },
        candidate: null,
      };
    }
    if (candidates.length !== 1) {
      return {
        observation: {
          ...session,
          ambiguous: true,
          exactIdentityAvailable: true,
          reason: 'exact-message-ambiguous',
          evidence: { observedThreadId, exactCandidateCount: candidates.length },
        },
        candidate: null,
      };
    }

    const candidate = candidates[0];
    if (candidate.ownership.sentByMe !== true) {
      return {
        observation: {
          ...session,
          sentByMe: candidate.ownership.sentByMe,
          exactIdentityAvailable: true,
          ownershipAvailable: candidate.ownership.sentByMe === false,
          reason: candidate.ownership.sentByMe === false
            ? 'received-message'
            : 'message-ownership-unavailable',
        },
        candidate: null,
      };
    }

    return {
      observation: {
        ...session,
        ambiguous: false,
        unexpectedUi: false,
        conversationId: String(item.conversationId),
        messageId: String(item.messageId),
        timestamp: Number(item.timestamp),
        contentDigest: String(item.contentDigest),
        contentLength: candidate.contentMatches[0].length,
        sentByMe: true,
        exactIdentityAvailable: true,
        ownershipAvailable: true,
        evidence: {
          source: 'extension-stable-visible-message-identity',
          observedThreadId,
          identityAttribute: candidate.identity.attribute,
          timestampBasis: candidate.timestamp.basis,
          ownershipBasis: candidate.ownership.basis,
          capturedAt: new Date().toISOString(),
        },
      },
      candidate,
    };
  }

  function pruneDmResolutions(now = Date.now()) {
    for (const [token, resolution] of dmResolutions) {
      if (now - resolution.createdAt > DM_RESOLUTION_TTL_MS) {
        dmResolutions.delete(token);
      }
    }
  }

  function inspectReviewedDmItem(item) {
    const resolved = resolveReviewedDmItem(item);
    if (!resolved.candidate) return resolved.observation;
    pruneDmResolutions();
    const token = resolutionToken();
    if (!token) {
      return {
        ...resolved.observation,
        unexpectedUi: true,
        reason: 'secure-random-unavailable',
        resolutionToken: null,
      };
    }
    dmResolutions.set(token, {
      contentDigest: String(item.contentDigest),
      conversationId: String(item.conversationId),
      createdAt: Date.now(),
      identityNode: resolved.candidate.identityNode,
      messageId: String(item.messageId),
      pathname: location.pathname,
      row: resolved.candidate.row,
      timestamp: Number(item.timestamp),
    });
    return { ...resolved.observation, resolutionToken: token };
  }

  function reviewedTargetElement({ accountIntent = null, dmIntent = null } = {}) {
    if (dmIntent) {
      const exact = resolveReviewedDmItem(dmIntent).candidate?.row || null;
      if (exact) return exact;
      const scope = document.querySelector('[data-pagelet="IGDMessagesList"]')
        || document.querySelector('main');
      const identitySelector = DM_MESSAGE_ID_ATTRIBUTES
        .map((attribute) => `[${attribute}]`)
        .join(', ');
      const rows = new Set(
        [...(scope?.querySelectorAll?.(identitySelector) || [])]
          .filter((element) => visibleText(element))
          .filter((element) => {
            const row = element.closest?.('[role="row"], [role="listitem"]') || element;
            return (dmMessageId(element) || dmMessageId(row))?.value === String(dmIntent.messageId || '');
          })
          .map((element) => element.closest?.('[role="row"], [role="listitem"]') || element),
      );
      return rows.size === 1 ? [...rows][0] : null;
    }
    if (pageKind() === 'messages') {
      const scope = document.querySelector('[data-pagelet="IGDMessagesList"]')
        || document.querySelector('main');
      const row = [...(scope?.querySelectorAll?.('[role="row"], [role="listitem"]') || [])]
        .find((element) => visibleText(element));
      if (row) return row;
    }
    const usernames = [...new Set([
      normalizeUsername(accountIntent?.username),
      normalizeUsername(location.pathname),
    ].filter(Boolean))];
    for (const username of usernames) {
      const relationship = relationshipFromButtons(username);
      if (!relationship.ambiguous && relationship.control) return relationship.control;
    }
    return null;
  }

  function dmResolutionMatches(resolution, item) {
    if (
      !resolution
      || !resolution.row?.isConnected
      || !resolution.identityNode?.isConnected
      || resolution.pathname !== location.pathname
      || resolution.conversationId !== String(item?.conversationId || '')
      || resolution.messageId !== String(item?.messageId || '')
      || resolution.timestamp !== Number(item?.timestamp)
      || resolution.contentDigest !== String(item?.contentDigest || '')
      || item?.sentByMe !== true
    ) return false;
    const current = resolveReviewedDmItem(item);
    return Boolean(
      current.candidate
      && current.candidate.row === resolution.row
      && current.candidate.identityNode === resolution.identityNode,
    );
  }

  function pruneProfileResolutions(now = Date.now()) {
    for (const [token, resolution] of profileResolutions) {
      if (now - resolution.createdAt > PROFILE_RESOLUTION_TTL_MS) {
        profileResolutions.delete(token);
      }
    }
  }

  function inspectSession() {
    const path = location.pathname.toLowerCase();
    const pageText = String(document.body?.innerText || '').toLowerCase();
    return {
      sessionExpired: path.startsWith('/accounts/login') || Boolean(document.querySelector('input[name="username"]')),
      challenge: path.startsWith('/challenge') || path.startsWith('/accounts/suspended'),
      actionBlocked: pageText.includes('we restrict certain activity'),
      rateLimited: pageText.includes('please wait a few minutes'),
      capturedAt: new Date().toISOString(),
    };
  }

  function verifiedProfileHeader(username) {
    const normalized = normalizeUsername(username);
    if (!normalized) return { root: null, observedProfileCount: 0 };
    const headers = [...document.querySelectorAll('main header')]
      .filter((header) => {
        if (!visibleText(header)) return false;
        return [...header.querySelectorAll('a[href], h1, h2, [role="heading"]')]
          .some((element) => {
            const hrefUsername = normalizeUsername(element.getAttribute?.('href'));
            const textUsername = normalizeUsername(visibleText(element));
            return hrefUsername === normalized || textUsername === normalized;
          });
      });
    return {
      root: headers.length === 1 ? headers[0] : null,
      observedProfileCount: headers.length,
    };
  }

  function relationshipFromButtons(expectedUsername) {
    const profile = verifiedProfileHeader(expectedUsername);
    if (!profile.root) {
      return {
        relationship: null,
        ambiguous: true,
        observedLabels: [],
        observedControlCount: 0,
        observedProfileCount: profile.observedProfileCount,
        profileIdentityVerified: false,
        profileRoot: null,
        control: null,
      };
    }
    const candidates = [...profile.root.querySelectorAll('button, [role="button"]')]
      .map((element) => ({
        element,
        label: actionLabels.normalizeActionLabel(visibleText(element)),
      }))
      .filter(({ label }) => actionLabels.relationshipForLabel(label));
    const uniqueLabels = [...new Set(candidates.map(({ label }) => label))];
    if (candidates.length !== 1 || uniqueLabels.length !== 1) {
      return {
        relationship: null,
        ambiguous: true,
        observedLabels: uniqueLabels,
        observedControlCount: candidates.length,
        observedProfileCount: profile.observedProfileCount,
        profileIdentityVerified: true,
        profileRoot: profile.root,
        control: null,
      };
    }
    const label = uniqueLabels[0];
    return {
      relationship: actionLabels.relationshipForLabel(label),
      ambiguous: false,
      observedLabels: uniqueLabels,
      observedControlCount: 1,
      observedProfileCount: profile.observedProfileCount,
      profileIdentityVerified: true,
      profileRoot: profile.root,
      control: candidates[0].element,
    };
  }

  function inspectProfile(expectedUsername) {
    const session = inspectSession();
    if (session.sessionExpired || session.challenge || session.actionBlocked || session.rateLimited) {
      return session;
    }
    const username = normalizeUsername(location.pathname);
    const relationship = relationshipFromButtons(username);
    pruneProfileResolutions();
    let token = null;
    let secureRandomUnavailable = false;
    if (!relationship.ambiguous && username && relationship.control) {
      token = resolutionToken();
      if (token) {
        profileResolutions.set(token, {
          control: relationship.control,
          createdAt: Date.now(),
          pathname: location.pathname,
          profileRoot: relationship.profileRoot,
          relationship: relationship.relationship,
          username,
        });
      } else {
        secureRandomUnavailable = true;
      }
    }
    return {
      ...session,
      relationship: relationship.relationship,
      ambiguous: relationship.ambiguous,
      observedLabels: relationship.observedLabels,
      observedControlCount: relationship.observedControlCount,
      observedProfileCount: relationship.observedProfileCount,
      profileIdentityVerified: relationship.profileIdentityVerified,
      username,
      unexpectedUi: secureRandomUnavailable
        || !document.querySelector('main')
        || !relationship.profileIdentityVerified,
      reason: secureRandomUnavailable ? 'secure-random-unavailable' : null,
      evidence: {
        url: location.href,
        expectedUsername: normalizeUsername(expectedUsername),
        observedUsername: username,
        observedLabels: relationship.observedLabels,
        observedControlCount: relationship.observedControlCount,
        observedProfileCount: relationship.observedProfileCount,
        profileIdentityVerified: relationship.profileIdentityVerified,
        capturedAt: new Date().toISOString(),
      },
      resolutionToken: token,
    };
  }

  function waitFor(check, timeoutMs) {
    const startedAt = Date.now();
    return new Promise((resolve) => {
      const inspect = () => {
        const value = check();
        if (value || Date.now() - startedAt >= timeoutMs) {
          resolve(value || null);
          return;
        }
        setTimeout(inspect, 100);
      };
      inspect();
    });
  }

  function visibleDialogs() {
    return [...document.querySelectorAll('[role="dialog"]')]
      .filter((dialog) => visibleText(dialog));
  }

  function dialogNamesUsername(dialog, username) {
    const normalized = normalizeUsername(username);
    if (!normalized) return false;
    if ([...dialog.querySelectorAll('a[href]')].some((anchor) => (
      normalizeUsername(anchor.getAttribute('href')) === normalized
    ))) return true;
    const escaped = normalized.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(^|[^a-z0-9._])@?${escaped}(?=$|[^a-z0-9._])`, 'i')
      .test(visibleText(dialog));
  }

  function exactUnfollowConfirmation(username, excludedDialogs = new Set()) {
    const dialogs = visibleDialogs()
      .filter((dialog) => !excludedDialogs.has(dialog))
      .filter((dialog) => dialogNamesUsername(dialog, username));
    if (dialogs.length !== 1) return null;
    const controls = [...dialogs[0].querySelectorAll('button, [role="button"]')]
      .filter((element) => visibleText(element).toLocaleLowerCase() === 'unfollow');
    return controls.length === 1 ? controls[0] : null;
  }

  function activateLiveControl(control) {
    control.click();
  }

  function visibleMenus() {
    return [...document.querySelectorAll('[role="menu"], [role="listbox"]')]
      .filter((menu) => visibleText(menu));
  }

  function liveControlWithin(element, scope) {
    const control = element?.closest?.('button, [role="button"], [role="menuitem"]');
    return control && scope?.contains?.(control) ? control : null;
  }

  function idReferences(element, attribute) {
    return new Set(String(element?.getAttribute?.(attribute) || '').split(/\s+/).filter(Boolean));
  }

  function surfaceBoundToControl(surface, control) {
    const surfaceId = String(surface?.getAttribute?.('id') || '').trim();
    const controlId = String(control?.getAttribute?.('id') || '').trim();
    return Boolean(
      (surfaceId && (
        idReferences(control, 'aria-controls').has(surfaceId)
        || idReferences(control, 'aria-owns').has(surfaceId)
      ))
      || (controlId && idReferences(surface, 'aria-labelledby').has(controlId)),
    );
  }

  function exactBoundSurface(surfaces, control, excluded = new Set()) {
    const matches = surfaces.filter((surface) => (
      !excluded.has(surface)
      && surfaceBoundToControl(surface, control)
    ));
    return matches.length === 1 ? matches[0] : null;
  }

  function exactDmActionControls(row) {
    const matches = [];
    for (const selector of DM_ACTION_LABEL_SELECTORS) {
      for (const element of row?.querySelectorAll?.(selector) || []) {
        const control = liveControlWithin(element, row);
        if (control) matches.push(control);
      }
    }
    for (const control of row?.querySelectorAll?.('[role="button"][aria-haspopup="menu"]') || []) {
      matches.push(control);
    }
    return [...new Set(matches)].filter((control) => visibleText(control));
  }

  function exactDmUnsendControls(scope) {
    const controls = [];
    for (const element of scope?.querySelectorAll?.(
      'button, [role="button"], [role="menuitem"], span, div',
    ) || []) {
      if (!actionLabels.isDmUnsendLabel(visibleText(element))) continue;
      const control = liveControlWithin(element, scope);
      if (control) controls.push(control);
    }
    return [...new Set(controls)];
  }

  function hoverExactDmRow(row) {
    const eventTargets = [];
    const queue = [{ element: row, depth: 0 }];
    while (queue.length) {
      const { element, depth } = queue.shift();
      eventTargets.push(element);
      if (depth < 8) {
        for (const child of element.children || []) {
          queue.push({ element: child, depth: depth + 1 });
        }
      }
    }
    for (const target of eventTargets) {
      const rect = target.getBoundingClientRect?.() || { x: 0, y: 0, width: 0, height: 0 };
      const options = {
        bubbles: true,
        cancelable: true,
        clientX: rect.x + (rect.width / 2),
        clientY: rect.y + (rect.height / 2),
        pointerId: 1,
        pointerType: 'mouse',
      };
      if (typeof PointerEvent === 'function') {
        target.dispatchEvent?.(new PointerEvent('pointerenter', { ...options, bubbles: false }));
        target.dispatchEvent?.(new PointerEvent('pointerover', options));
        target.dispatchEvent?.(new PointerEvent('pointermove', options));
      }
      if (typeof MouseEvent === 'function') {
        target.dispatchEvent?.(new MouseEvent('mouseenter', { ...options, bubbles: false }));
        target.dispatchEvent?.(new MouseEvent('mouseover', options));
        target.dispatchEvent?.(new MouseEvent('mousemove', options));
      }
    }
  }

  async function performReviewedDmUnsend(item) {
    const token = String(item?.resolutionToken || '');
    if (
      !token
      || !String(item?.conversationId || '')
      || !String(item?.messageId || '')
      || !Number.isFinite(Number(item?.timestamp))
      || !String(item?.contentDigest || '')
      || item?.sentByMe !== true
    ) {
      return { unexpectedUi: true, reason: 'invalid-live-dm-request' };
    }

    const session = inspectSession();
    if (session.sessionExpired || session.challenge || session.actionBlocked || session.rateLimited) {
      return session;
    }

    pruneDmResolutions();
    const resolution = dmResolutions.get(token);
    dmResolutions.delete(token);
    if (!dmResolutionMatches(resolution, item)) {
      return { ambiguous: true, reason: 'dm-resolution-expired-or-changed' };
    }
    if (visibleDialogs().length || visibleMenus().length) {
      return { unexpectedUi: true, reason: 'preexisting-surface-before-live-unsend' };
    }

    hoverExactDmRow(resolution.row);
    const actionControl = await waitFor(() => {
      const controls = exactDmActionControls(resolution.row);
      return controls.length === 1 ? controls[0] : null;
    }, 1_500);
    if (!actionControl) {
      return { ambiguous: true, reason: 'dm-action-control-not-exact' };
    }
    if (
      !dmResolutionMatches(resolution, item)
      || visibleDialogs().length
      || visibleMenus().length
    ) {
      return { ambiguous: true, reason: 'dm-message-changed-before-menu' };
    }

    const menusBeforeAction = new Set(visibleMenus());
    activateLiveControl(actionControl);
    const menuResult = await waitFor(() => {
      const newMenus = visibleMenus().filter((menu) => !menusBeforeAction.has(menu));
      if (!newMenus.length) return null;
      const menu = exactBoundSurface(newMenus, actionControl);
      if (!menu) return { invalid: true };
      const controls = exactDmUnsendControls(menu);
      return controls.length === 1
        ? { menu, control: controls[0] }
        : { invalid: true };
    }, 3_000);
    if (!menuResult?.menu) {
      return { unexpectedUi: true, reason: 'dm-unsend-menu-not-exact' };
    }
    if (!dmResolutionMatches(resolution, item) || visibleDialogs().length) {
      return { ambiguous: true, reason: 'dm-message-changed-before-unsend-choice' };
    }

    const dialogsBeforeChoice = new Set(visibleDialogs());
    activateLiveControl(menuResult.control);
    const confirmation = await waitFor(() => {
      const newDialogs = visibleDialogs().filter((dialog) => !dialogsBeforeChoice.has(dialog));
      if (!newDialogs.length) return null;
      const dialog = exactBoundSurface(
        newDialogs,
        menuResult.control,
      );
      if (!dialog) return { invalid: true };
      const controls = exactDmUnsendControls(dialog);
      return controls.length === 1 ? { control: controls[0] } : { invalid: true };
    }, 3_000);
    if (!confirmation?.control) {
      return { unexpectedUi: true, reason: 'dm-unsend-confirmation-not-exact' };
    }
    if (!dmResolutionMatches(resolution, item)) {
      return { ambiguous: true, reason: 'dm-message-changed-before-final-confirmation' };
    }

    activateLiveControl(confirmation.control);
    const completion = await waitFor(() => {
      const currentSession = inspectSession();
      if (
        currentSession.sessionExpired
        || currentSession.challenge
        || currentSession.actionBlocked
        || currentSession.rateLimited
      ) return { sessionStop: currentSession };
      const expectedThreadId = directThreadId(item.conversationId);
      const observedThreadId = directThreadId(location.pathname);
      if (!expectedThreadId || expectedThreadId !== observedThreadId) {
        return {
          uncertain: true,
          observation: {
            ambiguous: true,
            reason: 'wrong-conversation-after-unsend',
            evidence: { expectedThreadId, observedThreadId },
          },
        };
      }
      const retainedRowDisconnected = resolution.row?.isConnected === false;
      const retainedIdentityNodeDisconnected = resolution.identityNode?.isConnected === false;
      const current = resolveReviewedDmItem(item);
      if (current.candidate) return null;
      if (!retainedRowDisconnected || !retainedIdentityNodeDisconnected) {
        return current.observation?.missing || current.observation?.reason
          ? { uncertain: true, observation: current.observation }
          : null;
      }
      if (
        current.observation?.ambiguous
        || current.observation?.unexpectedUi
        || current.observation?.exactIdentityAvailable !== true
        || current.observation?.reason !== 'exact-message-not-found'
      ) {
        return { uncertain: true, observation: current.observation };
      }
      return {
        confirmed: true,
        observation: current.observation,
        postcondition: {
          exactCandidateAbsent: true,
          exactThread: true,
          expectedThreadId,
          observedThreadId,
          observationReason: current.observation.reason,
          retainedIdentityNodeDisconnected: true,
          retainedRowDisconnected: true,
        },
      };
    }, 5_000);
    if (completion?.sessionStop) return completion.sessionStop;
    if (!completion?.confirmed) {
      return {
        unexpectedUi: true,
        reason: 'dm-unsend-not-confirmed',
        observation: completion?.observation || null,
      };
    }
    return {
      result: 'unsent',
      conversationId: String(item.conversationId),
      messageId: String(item.messageId),
      postcondition: completion.postcondition,
    };
  }

  async function waitForRelationship(expectedRelationships, username, timeoutMs = 5_000) {
    return waitFor(() => {
      const session = inspectSession();
      if (session.sessionExpired || session.challenge || session.actionBlocked || session.rateLimited) {
        return { sessionStop: session };
      }
      const observed = relationshipFromButtons(username);
      if (!observed.ambiguous && expectedRelationships.includes(observed.relationship)) {
        return { relationship: observed.relationship };
      }
      return null;
    }, timeoutMs);
  }

  async function performReviewedProfileAction(item) {
    const username = normalizeUsername(item?.username);
    const action = String(item?.action || '');
    const token = String(item?.resolutionToken || '');
    if (!username || !['follow', 'unfollow'].includes(action) || !token) {
      return { unexpectedUi: true, reason: 'invalid-live-action-request' };
    }

    const session = inspectSession();
    if (session.sessionExpired || session.challenge || session.actionBlocked || session.rateLimited) {
      return session;
    }

    pruneProfileResolutions();
    const resolution = profileResolutions.get(token);
    profileResolutions.delete(token);
    if (
      !resolution
      || resolution.username !== username
      || resolution.pathname !== location.pathname
      || resolution.relationship !== item.expectedRelationship
      || !resolution.control?.isConnected
    ) {
      return { ambiguous: true, reason: 'profile-resolution-expired-or-changed' };
    }

    const current = relationshipFromButtons(username);
    const expectedRelationship = action === 'follow' ? 'not-following' : 'following';
    if (
      current.ambiguous
      || current.relationship !== expectedRelationship
      || current.relationship !== resolution.relationship
      || current.profileRoot !== resolution.profileRoot
      || current.control !== resolution.control
      || normalizeUsername(location.pathname) !== username
    ) {
      return { ambiguous: true, reason: 'profile-control-changed-before-action' };
    }

    const dialogsBeforeAction = visibleDialogs();
    if (dialogsBeforeAction.length) {
      return { unexpectedUi: true, reason: 'preexisting-dialog-before-live-action' };
    }

    activateLiveControl(current.control);
    if (action === 'follow') {
      const completion = await waitForRelationship(['following', 'requested'], username);
      if (completion?.sessionStop) return completion.sessionStop;
      if (!completion) return { unexpectedUi: true, reason: 'follow-not-confirmed' };
      return {
        result: completion.relationship === 'requested' ? 'follow-requested' : 'followed',
        relationship: completion.relationship,
      };
    }

    const excludedDialogs = new Set(dialogsBeforeAction);
    const confirmation = await waitFor(
      () => exactUnfollowConfirmation(username, excludedDialogs),
      3_000,
    );
    if (!confirmation) {
      return { unexpectedUi: true, reason: 'unfollow-confirmation-not-exact' };
    }
    activateLiveControl(confirmation);
    const completion = await waitForRelationship(['not-following'], username);
    if (completion?.sessionStop) return completion.sessionStop;
    if (!completion) return { unexpectedUi: true, reason: 'unfollow-not-confirmed' };
    return { result: 'unfollowed', relationship: completion.relationship };
  }

  function captureVisibleAccounts() {
    const roots = [
      ...document.querySelectorAll('[role="dialog"]'),
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
          displayName: visibleText(anchor) === username ? '' : visibleText(anchor),
          source: 'extension-visible-dom',
        });
      }
    }
    return [...accounts.values()].sort((left, right) => left.username.localeCompare(right.username));
  }

  function pageKind() {
    const path = location.pathname.toLowerCase();
    if (path.startsWith('/accounts/login')) return 'login';
    if (path.startsWith('/direct/')) return 'messages';
    if (path.startsWith('/explore')) return 'explore';
    if (path.startsWith('/reel')) return 'reels';
    if (path.startsWith('/stories')) return 'stories';
    if (path.startsWith('/p/')) return 'post';
    return normalizeUsername(location.pathname) ? 'profile' : 'feed';
  }

  function inspectVisibleMessages() {
    const session = inspectSession();
    const kind = pageKind();
    if (kind !== 'messages') {
      return {
        ...session,
        pageKind: kind,
        conversationLabel: '',
        exactIdentityAvailable: false,
        ownershipAvailable: false,
        fragments: [],
        reason: 'open-an-instagram-conversation',
      };
    }

    const main = document.querySelector('main');
    const heading = [...(main?.querySelectorAll('h1, h2, header [dir="auto"]') || [])]
      .map(visibleText)
      .find(Boolean) || '';
    const rowText = [...(main?.querySelectorAll('[role="row"] [dir="auto"]') || [])];
    const candidates = (rowText.length
      ? rowText
      : [...(main?.querySelectorAll('div[dir="auto"]') || [])])
      .filter((element) => !element.querySelector('[dir="auto"]'))
      .filter((element) => !element.closest('header, nav, button, [role="button"], a'))
      .map(visibleText)
      .filter((text) => text && text.length <= 500);
    const fragments = [...new Set(candidates)].slice(-30).map((text, index) => ({
      index,
      text,
      source: 'extension-visible-dom-fragment',
    }));
    return {
      ...session,
      pageKind: kind,
      conversationLabel: heading,
      exactIdentityAvailable: false,
      ownershipAvailable: false,
      fragments,
      reason: fragments.length ? 'visible-fragments-only' : 'no-visible-message-fragments',
      capturedAt: new Date().toISOString(),
    };
  }

  function inspectPageContext() {
    const kind = pageKind();
    const session = inspectSession();
    return {
      ...session,
      pageKind: kind,
      url: location.href,
      username: kind === 'profile' ? normalizeUsername(location.pathname) : '',
      profile: kind === 'profile' ? inspectProfile(location.pathname) : null,
    };
  }

  globalThis.InstaAioInstagramInspector = Object.freeze({
    captureVisibleAccounts,
    inspectPageContext,
    inspectProfile,
    inspectReviewedDmItem,
    inspectSession,
    inspectVisibleMessages,
    normalizeUsername,
    reviewedTargetElement,
  });

  chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
    if (request?.kind === 'insta-aio-inspect-profile') {
      sendResponse(inspectProfile(request.username));
      return;
    }
    if (request?.kind === 'insta-aio-inspect-session') {
      sendResponse(inspectSession());
      return;
    }
    if (request?.kind === 'insta-aio-capture-visible-accounts') {
      sendResponse({
        capturedAt: new Date().toISOString(),
        accounts: captureVisibleAccounts(),
      });
      return;
    }
    if (request?.kind === 'insta-aio-inspect-visible-messages') {
      sendResponse(inspectVisibleMessages());
      return;
    }
    if (request?.kind === 'insta-aio-inspect-reviewed-dm-item') {
      sendResponse(inspectReviewedDmItem(request.item));
      return;
    }
    if (request?.kind === 'insta-aio-perform-reviewed-profile-action') {
      performReviewedProfileAction(request.item)
        .then(sendResponse)
        .catch(() => sendResponse({ unexpectedUi: true, reason: 'live-action-driver-error' }));
      return true;
    }
    if (request?.kind === 'insta-aio-perform-reviewed-dm-unsend') {
      performReviewedDmUnsend(request.item)
        .then(sendResponse)
        .catch(() => sendResponse({ unexpectedUi: true, reason: 'live-dm-driver-error' }));
      return true;
    }
  });
})();

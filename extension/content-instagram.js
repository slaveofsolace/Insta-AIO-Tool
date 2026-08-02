(() => {
  if (globalThis.__instaAioInspectorInstalled) return;
  globalThis.__instaAioInspectorInstalled = true;

  const RESERVED = new Set([
    'accounts', 'about', 'api', 'developer', 'direct', 'emails', 'explore',
    'challenge', 'directory', 'graphql', 'legal', 'p', 'privacy', 'reel',
    'reels', 'settings', 'static', 'stories', 'terms', 'tv', 'web',
  ]);
  const PROFILE_RESOLUTION_TTL_MS = 20_000;
  const profileResolutions = new Map();
  const DM_MESSAGE_ID_ATTRIBUTES = Object.freeze([
    'data-message-id',
    'data-item-id',
  ]);
  const DM_TIMESTAMP_ATTRIBUTES = Object.freeze([
    'data-timestamp-ms',
    'data-timestamp',
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
    if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
    const bytes = new Uint8Array(16);
    globalThis.crypto?.getRandomValues?.(bytes);
    return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
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

  function dmOwnership(row) {
    const explicit = String(row?.getAttribute?.('data-sent-by-me') || '').toLowerCase();
    if (explicit === 'true') return { sentByMe: true, basis: 'data-sent-by-me' };
    if (explicit === 'false') return { sentByMe: false, basis: 'data-sent-by-me' };

    const queue = [{ element: row, depth: 0 }];
    while (queue.length) {
      const { element, depth } = queue.shift();
      if (getComputedStyle(element).justifyContent === 'flex-end') {
        return { sentByMe: true, basis: 'flex-end-layout' };
      }
      if (depth < 8) {
        for (const child of element.children || []) {
          queue.push({ element: child, depth: depth + 1 });
        }
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

  function inspectReviewedDmItem(item) {
    const session = inspectSession();
    if (session.sessionExpired || session.challenge || session.actionBlocked || session.rateLimited) {
      return session;
    }
    if (pageKind() !== 'messages') {
      return { ...session, unexpectedUi: true, reason: 'open-an-instagram-conversation' };
    }

    const expectedThreadId = directThreadId(item?.conversationId);
    const observedThreadId = directThreadId(location.pathname);
    if (!expectedThreadId || !observedThreadId) {
      return { ...session, ambiguous: true, reason: 'conversation-id-unresolved' };
    }
    if (expectedThreadId !== observedThreadId) {
      return {
        ...session,
        ambiguous: true,
        reason: 'wrong-conversation',
        evidence: { expectedThreadId, observedThreadId },
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
        ...session,
        missing: true,
        exactIdentityAvailable: false,
        ownershipAvailable: false,
        reason: 'exact-message-identity-unavailable',
        evidence: { observedThreadId, stableIdentityNodeCount: 0 },
      };
    }

    const candidates = identityNodes.map((identityNode) => {
      const row = identityNode.closest?.('[role="row"], [role="listitem"]') || identityNode;
      const identity = dmMessageId(identityNode) || dmMessageId(row);
      const timestamp = dmMessageTimestamp(identityNode, row);
      const ownership = dmOwnership(row);
      const contents = dmContentCandidates(row);
      return {
        contentMatches: contents.filter((content) => dmContentDigest(content) === item?.contentDigest),
        identity,
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
        ...session,
        missing: true,
        exactIdentityAvailable: true,
        reason: 'exact-message-not-found',
        evidence: { observedThreadId, stableIdentityNodeCount: identityNodes.length },
      };
    }
    if (candidates.length !== 1) {
      return {
        ...session,
        ambiguous: true,
        exactIdentityAvailable: true,
        reason: 'exact-message-ambiguous',
        evidence: { observedThreadId, exactCandidateCount: candidates.length },
      };
    }

    const candidate = candidates[0];
    if (candidate.ownership.sentByMe !== true) {
      return {
        ...session,
        sentByMe: candidate.ownership.sentByMe,
        exactIdentityAvailable: true,
        ownershipAvailable: candidate.ownership.sentByMe === false,
        reason: candidate.ownership.sentByMe === false
          ? 'received-message'
          : 'message-ownership-unavailable',
      };
    }

    return {
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
      resolutionToken: resolutionToken(),
      evidence: {
        source: 'extension-stable-visible-message-identity',
        observedThreadId,
        identityAttribute: candidate.identity.attribute,
        timestampBasis: candidate.timestamp.basis,
        ownershipBasis: candidate.ownership.basis,
        capturedAt: new Date().toISOString(),
      },
    };
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
        label: visibleText(element).toLocaleLowerCase(),
      }))
      .filter(({ label }) => ['follow', 'follow back', 'following', 'requested'].includes(label));
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
      relationship: label === 'following'
        ? 'following'
        : label === 'requested'
          ? 'requested'
          : 'not-following',
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
    if (!relationship.ambiguous && username && relationship.control) {
      token = resolutionToken();
      profileResolutions.set(token, {
        control: relationship.control,
        createdAt: Date.now(),
        pathname: location.pathname,
        profileRoot: relationship.profileRoot,
        relationship: relationship.relationship,
        username,
      });
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
      unexpectedUi: !document.querySelector('main') || !relationship.profileIdentityVerified,
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
  });
})();

(() => {
  if (globalThis.__instaToolboxInspectorInstalled) return;
  const actionLabels = globalThis.__instaToolboxActionLabels;
  if (
    !actionLabels
    || typeof actionLabels.isDmUnsendLabel !== 'function'
    || typeof actionLabels.isDmMessageOptionsLabel !== 'function'
    || typeof actionLabels.normalizeActionLabel !== 'function'
    || typeof actionLabels.relationshipForLabel !== 'function'
  ) return;
  globalThis.__instaToolboxInspectorInstalled = true;

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
    "[role='button']",
  ]);
  const INSTAGRAM_WEB_ORIGIN = 'https://www.instagram.com';
  const INSTAGRAM_WEB_APP_ID = '936619743392459';
  const INSTAGRAM_WEB_ASBD_ID = '129477';
  const RELATIONSHIP_PAGE_SIZE = 50;
  const RELATIONSHIP_MAX_PAGES = 1_000;
  const RELATIONSHIP_MAX_ACCOUNTS = 25_000;
  const RELATIONSHIP_MAX_DURATION_MS = 20 * 60 * 1_000;
  const RELATIONSHIP_REQUEST_TIMEOUT_MS = 20_000;
  const RELATIONSHIP_REQUEST_ATTEMPTS = 3;
  const RELATIONSHIP_RETRY_BASE_MS = 1_000;
  const RELATIONSHIP_RETRY_MAX_MS = 5_000;
  const RELATIONSHIP_TRANSIENT_HTTP_STATUSES = new Set([500, 502, 503, 504]);

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

  function relationshipCount(...values) {
    for (const value of values) {
      if (value === null || value === undefined || typeof value === 'boolean' || String(value).trim() === '') continue;
      const number = Number(value);
      if (Number.isSafeInteger(number) && number >= 0) return number;
    }
    return null;
  }

  function detectAuthenticatedUsername() {
    const candidates = new Set();
    const anchors = [
      ...document.querySelectorAll('a[href]'),
    ];
    for (const anchor of anchors) {
      const labels = [
        anchor.getAttribute?.('aria-label'),
        ...[...anchor.querySelectorAll?.('[aria-label], img[alt]') || []]
          .flatMap((element) => [element.getAttribute?.('aria-label'), element.getAttribute?.('alt')]),
      ]
        .map((value) => String(value || '').normalize('NFKC').toLowerCase())
        .filter(Boolean);
      if (!labels.some((label) => label === 'profile' || label.includes('profile picture'))) continue;
      const username = normalizeUsername(anchor.getAttribute?.('href'));
      if (username) candidates.add(username);
    }
    return candidates.size === 1 ? [...candidates][0] : '';
  }

  function relationshipError(code, message) {
    const error = new Error(message);
    error.code = code;
    return error;
  }

  function assertRelationshipRunActive(signal, startedAt, now, maxDurationMs) {
    if (signal?.aborted) throw relationshipError('stopped', 'Follower check stopped.');
    if (now() - startedAt >= maxDurationMs) {
      throw relationshipError('time-limit', 'The follower check reached its 20-minute read limit.');
    }
    const session = inspectSession();
    if (session.sessionExpired) throw relationshipError('session-expired', 'Instagram requires a fresh login.');
    if (session.challenge) throw relationshipError('challenge', 'Instagram opened a security challenge.');
    if (session.actionBlocked) throw relationshipError('action-blocked', 'Instagram restricted activity.');
    if (session.rateLimited) throw relationshipError('rate-limited', 'Instagram asked this session to wait.');
  }

  function relationshipDelay(ms, signal, setTimer = setTimeout, clearTimer = clearTimeout) {
    if (!ms) return Promise.resolve();
    return new Promise((resolve, reject) => {
      if (signal?.aborted) {
        reject(relationshipError('stopped', 'Follower check stopped.'));
        return;
      }
      let timer = null;
      const stop = () => {
        if (timer !== null) clearTimer(timer);
        signal?.removeEventListener?.('abort', stop);
        reject(relationshipError('stopped', 'Follower check stopped.'));
      };
      timer = setTimer(() => {
        signal?.removeEventListener?.('abort', stop);
        resolve();
      }, ms);
      signal?.addEventListener?.('abort', stop, { once: true });
    });
  }

  function relationshipRunDeadline(sourceSignal, maxDurationMs, setTimer, clearTimer) {
    const controller = new AbortController();
    let timedOut = false;
    const stop = () => controller.abort();
    if (sourceSignal?.aborted) stop();
    else sourceSignal?.addEventListener?.('abort', stop, { once: true });
    const timer = setTimer(() => {
      timedOut = true;
      controller.abort();
    }, maxDurationMs);
    return Object.freeze({
      cleanup() {
        clearTimer(timer);
        sourceSignal?.removeEventListener?.('abort', stop);
      },
      signal: controller.signal,
      timedOut: () => timedOut,
    });
  }

  function relationshipResponseStop(data) {
    if (data?.challenge || data?.challenge_url || data?.checkpoint_url) return 'challenge';
    if (data?.login_required === true) return 'session-expired';
    const message = [data?.message, data?.error_type].filter(Boolean).join(' ').toLowerCase();
    if (message.includes('challenge') || message.includes('checkpoint')) return 'challenge';
    if (message.includes('login') || message.includes('not logged')) return 'session-expired';
    if (message.includes('wait a few minutes') || /rate[ _-]?limit|too many requests/.test(message)) return 'rate-limited';
    if (message.includes('feedback_required') || message.includes('action_blocked') || message.includes('restrict certain activity')) return 'action-blocked';
    return '';
  }

  function relationshipHttpFailure(response, now) {
    const httpStatus = response.status;
    const transient = RELATIONSHIP_TRANSIENT_HTTP_STATUSES.has(httpStatus);
    const error = relationshipError(
      transient ? 'temporary-http-error' : 'request-failed',
      `Instagram could not load this account request (HTTP ${httpStatus || 'error'}).`,
    );
    error.httpStatus = httpStatus;
    if (transient) {
      const header = response.headers?.get?.('Retry-After');
      if (header !== null && header !== undefined) {
        const value = String(header).trim();
        const httpDate = /^(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun), \d{2} [A-Z][a-z]{2} \d{4} \d{2}:\d{2}:\d{2} GMT$/;
        const retryAt = httpDate.test(value) ? Date.parse(value) : NaN;
        const delay = /^\d+$/.test(value)
          ? Number(value) * 1_000
          : Number.isFinite(retryAt) ? Math.max(0, retryAt - now()) : NaN;
        if (Number.isSafeInteger(delay) && delay >= 0) error.retryAfterMs = delay;
        else error.retryAfterInvalid = true;
      }
    }
    return error;
  }

  function relationshipStepWithTimeout(task, {
    clearTimer,
    setTimer,
    signal,
    timeoutMs,
  }) {
    return new Promise((resolve, reject) => {
      if (signal?.aborted) {
        reject(relationshipError('stopped', 'Follower check stopped.'));
        return;
      }
      const controller = new AbortController();
      let settled = false;
      const finish = (callback, value) => {
        if (settled) return;
        settled = true;
        clearTimer(timer);
        signal?.removeEventListener?.('abort', stop);
        callback(value);
      };
      const stop = () => {
        controller.abort();
        finish(reject, relationshipError('stopped', 'Follower check stopped.'));
      };
      const timer = setTimer(() => {
        controller.abort();
        finish(reject, relationshipError(
          'request-timeout',
          'Instagram did not finish this follower page within 20 seconds.',
        ));
      }, timeoutMs);
      signal?.addEventListener?.('abort', stop, { once: true });
      Promise.resolve()
        .then(() => task(controller.signal))
        .then((value) => finish(resolve, value))
        .catch((error) => {
          if (signal?.aborted) {
            finish(reject, relationshipError('stopped', 'Follower check stopped.'));
            return;
          }
          finish(reject, error);
        });
    });
  }

  async function fetchInstagramRelationshipJson(url, {
    clearTimer,
    expectedCount = null,
    fetchImpl,
    found = 0,
    listType = null,
    maxDurationMs,
    now = Date.now,
    onProgress,
    pages = 0,
    random,
    requestAttempts,
    requestTimeoutMs,
    retryBaseMs,
    setTimer,
    signal,
    sleepImpl,
    startedAt,
    username,
  }) {
    for (let attempt = 1; attempt <= requestAttempts; attempt += 1) {
      assertRelationshipRunActive(signal, startedAt, now, maxDurationMs);
      let httpStatus = null;
      let httpFailure = null;
      try {
        return await relationshipStepWithTimeout(async (attemptSignal) => {
          const response = await fetchImpl(url.href, {
            cache: 'no-store',
            credentials: 'include',
            headers: {
              'X-ASBD-ID': INSTAGRAM_WEB_ASBD_ID,
              'X-IG-App-ID': INSTAGRAM_WEB_APP_ID,
              'X-Requested-With': 'XMLHttpRequest',
            },
            method: 'GET',
            referrer: `${INSTAGRAM_WEB_ORIGIN}/${username}/`,
            referrerPolicy: 'strict-origin-when-cross-origin',
            signal: attemptSignal,
          });
          httpStatus = response.status;
          // Preserve server pacing even if decoding this response later times out.
          if (RELATIONSHIP_TRANSIENT_HTTP_STATUSES.has(httpStatus)) {
            httpFailure = relationshipHttpFailure(response, now);
          }
          // Error pages can be HTML. Classify status and redirects before decoding.
          if (response.status === 429) {
            throw relationshipError('rate-limited', 'Instagram is rate limiting this check. Wait before trying again.');
          }
          const responsePath = response.url ? new URL(response.url, url).pathname : '';
          if (/^\/(challenge|checkpoint)(\/|$)/.test(responsePath)) {
            throw relationshipError('challenge', 'Instagram opened a security challenge.');
          }
          if (response.status === 401 || /^\/accounts\/login(\/|$)/.test(responsePath)) {
            throw relationshipError('session-expired', 'Instagram requires a fresh login.');
          }
          if (response.status === 403) {
            throw Object.assign(relationshipError('action-blocked', 'Instagram restricted this account request.'), { httpStatus: 403 });
          }
          let data = null;
          try {
            data = await response.json();
          } catch (error) {
            if (attemptSignal.aborted) throw error;
            if (error?.code === 'request-timeout' || error?.code === 'stopped') throw error;
            if (!response.ok) {
              throw httpFailure || relationshipHttpFailure(response, now);
            }
            throw relationshipError('invalid-response', 'Instagram returned an invalid account response. Reload your profile before trying again.');
          }
          const responseStop = relationshipResponseStop(data);
          if (response.status === 429 || responseStop === 'rate-limited') {
            throw relationshipError('rate-limited', 'Instagram asked this session to wait before loading more accounts.');
          }
          if (response.status === 401 || responseStop === 'session-expired') {
            throw relationshipError('session-expired', 'Instagram requires a fresh login.');
          }
          if (responseStop === 'challenge') {
            throw relationshipError('challenge', 'Instagram opened a security challenge.');
          }
          if (responseStop === 'action-blocked') {
            throw relationshipError('action-blocked', 'Instagram restricted activity.');
          }
          if (!response.ok || data?.status === 'fail') {
            throw httpFailure || relationshipHttpFailure(response, now);
          }
          return data;
        }, { clearTimer, setTimer, signal, timeoutMs: requestTimeoutMs });
      } catch (error) {
        if (error && typeof error === 'object' && httpStatus !== null) {
          error.httpStatus = httpStatus;
          if (httpFailure?.retryAfterMs !== undefined) error.retryAfterMs = httpFailure.retryAfterMs;
          if (httpFailure?.retryAfterInvalid) error.retryAfterInvalid = true;
        }
        let retryable = error?.code === 'request-timeout'
          || error?.code === 'network-error'
          || error?.code === 'temporary-http-error';
        if (signal?.aborted || error?.code === 'stopped') {
          throw relationshipError('stopped', 'Follower check stopped.');
        }
        if (!error?.code && error?.name === 'AbortError') {
          retryable = true;
        } else if (!error?.code) {
          retryable = true;
          error = relationshipError('network-error', 'Instagram follower data could not be reached from this tab.');
        }
        if (!retryable || attempt >= requestAttempts) {
          if (error?.code === 'temporary-http-error') {
            error.attempts = attempt;
            error.message = `Instagram could not finish this ${listType || 'account'} request (HTTP ${error.httpStatus}) after ${attempt} attempts. The previous comparison is unchanged.`;
            throw error;
          }
          if (retryable) {
            throw Object.assign(relationshipError(
              'request-timeout',
              `Instagram did not finish this ${listType || 'account'} request after ${requestAttempts} attempts. The previous comparison is unchanged.`,
            ), {
              ...(error.httpStatus !== undefined ? { httpStatus: error.httpStatus } : {}),
              ...(error.retryAfterMs !== undefined ? { retryAfterMs: error.retryAfterMs } : {}),
              attempts: attempt,
            });
          }
          throw error;
        }
        if (error.retryAfterInvalid) {
          throw Object.assign(relationshipError(
            'retry-after-invalid',
            'Instagram returned an invalid retry delay. The previous comparison is unchanged.',
          ), {
            httpStatus: error.httpStatus,
            retryAfterMs: error.retryAfterMs ?? null,
            retryAfterInvalid: error.retryAfterInvalid === true,
          });
        }
        const retryDelayMs = Math.max(error.retryAfterMs || 0, Math.min(
          RELATIONSHIP_RETRY_MAX_MS,
          (retryBaseMs * attempt) + Math.floor(Math.max(0, Math.min(0.999999, random())) * 250),
        ));
        const remainingMs = Math.max(0, maxDurationMs - (now() - startedAt));
        if (retryDelayMs >= remainingMs) {
          throw Object.assign(relationshipError(
            error.retryAfterMs !== undefined ? 'retry-after-limit' : 'time-limit',
            'There is not enough time left to retry. The previous comparison is unchanged.',
          ), {
            httpStatus: error.httpStatus ?? null,
            retryAfterMs: error.retryAfterMs ?? null,
            remainingMs,
          });
        }
        onProgress?.(Object.freeze({
          attempt: attempt + 1,
          failedAttempt: attempt,
          found,
          httpStatus: error.httpStatus ?? null,
          expectedCount,
          listType,
          maxAttempts: requestAttempts,
          pages,
          phase: 'retrying',
          retryDelayMs,
          retryAfterMs: error.retryAfterMs ?? null,
          username,
        }));
        await sleepImpl(retryDelayMs, signal);
      }
    }
    throw relationshipError('request-timeout', 'Instagram follower data did not finish.');
  }

  function relationshipAccountId(account) {
    const values = [account?.pk_id, account?.id, account?.pk]
      .filter((value) => value !== undefined && value !== null && value !== '');
    const exactIds = new Set();
    const roundedIds = [];
    for (const value of values) {
      if (typeof value === 'string' && /^\d+$/.test(value.trim())) {
        exactIds.add(value.trim().replace(/^0+(?=\d)/, ''));
      } else if (typeof value === 'number' && Number.isInteger(value) && value >= 0) {
        if (Number.isSafeInteger(value)) exactIds.add(String(value));
        else roundedIds.push(value);
      } else {
        throw relationshipError('invalid-response', 'Instagram returned an invalid account ID.');
      }
    }
    if (exactIds.size > 1) {
      throw relationshipError('invalid-response', 'Instagram returned conflicting account IDs.');
    }
    const id = [...exactIds][0] || '';
    // JSON numbers may already be rounded; an exact text ID must corroborate them.
    if (roundedIds.some((value) => !id || Number(id) !== value)) {
      throw relationshipError('invalid-response', 'Instagram did not provide an exact account ID. The previous comparison is unchanged.');
    }
    return id;
  }

  async function resolveRelationshipUserId(username, options) {
    const url = new URL('/api/v1/web/search/topsearch/', INSTAGRAM_WEB_ORIGIN);
    url.searchParams.set('context', 'blended');
    url.searchParams.set('query', username);
    url.searchParams.set('include_reel', 'false');
    const data = await fetchInstagramRelationshipJson(url, options);
    const exact = (Array.isArray(data?.users) ? data.users : [])
      .map((entry) => entry?.user)
      .find((user) => normalizeUsername(user?.username) === username);
    const userId = relationshipAccountId(exact);
    if (!/^\d+$/.test(userId)) {
      throw relationshipError('username-not-found', `Instagram could not resolve @${username}.`);
    }
    return {
      userId,
    };
  }

  async function resolveRelationshipProfileCounts(username, userId, options) {
    const url = new URL('/api/v1/users/web_profile_info/', INSTAGRAM_WEB_ORIGIN);
    url.searchParams.set('username', username);
    const data = await fetchInstagramRelationshipJson(url, options);
    const profile = data?.data?.user;
    const resolvedUsername = normalizeUsername(profile?.username);
    const resolvedUserId = relationshipAccountId(profile);
    if (resolvedUsername !== username || resolvedUserId !== userId) {
      throw relationshipError(
        'profile-mismatch',
        `Instagram did not return the exact profile counters for @${username}. The previous comparison is unchanged.`,
      );
    }
    const followers = relationshipCount(
      profile?.edge_followed_by?.count,
      profile?.follower_count,
      profile?.followers_count,
    );
    const following = relationshipCount(
      profile?.edge_follow?.count,
      profile?.following_count,
      profile?.follows_count,
    );
    if (!Number.isSafeInteger(followers) || !Number.isSafeInteger(following)) {
      throw relationshipError(
        'profile-count-unavailable',
        `Instagram did not provide verified follower and following totals for @${username}. The previous comparison is unchanged.`,
      );
    }
    return Object.freeze({ followers, following });
  }

  function openProfileRelationshipCounts(username) {
    if (normalizeUsername(location.pathname) !== username) return null;
    const followers = exactProfileListCount('followers', { requireScoped: true });
    const following = exactProfileListCount('following', { requireScoped: true });
    if (!Number.isSafeInteger(followers) || !Number.isSafeInteger(following)) return null;
    return Object.freeze({ followers, following });
  }

  function exactProfileCountDisagreement(username, profileCounts) {
    if (normalizeUsername(location.pathname) !== username) {
      return Object.freeze({ followers: false, following: false });
    }
    const followers = exactProfileListCount('followers');
    const following = exactProfileListCount('following');
    return Object.freeze({
      followers: Number.isSafeInteger(followers) && followers !== profileCounts.followers,
      following: Number.isSafeInteger(following) && following !== profileCounts.following,
    });
  }

  function finalizeRelationshipList(list, {
    countChanged,
    countDisagreed,
    expectedCount,
  }) {
    if (countChanged) {
      return Object.freeze({
        ...list,
        complete: false,
        expectedCount,
        reason: 'count-changed',
      });
    }
    if (countDisagreed) {
      return Object.freeze({
        ...list,
        complete: false,
        expectedCount,
        reason: 'profile-count-disagreement',
      });
    }
    return list;
  }

  function relationshipPageUsers(data, listType) {
    if (listType !== 'followers' || data.groups === undefined || data.groups === null) return data.users;
    if (!Array.isArray(data.groups)) {
      throw relationshipError('invalid-response', 'Instagram returned invalid follower groups.');
    }
    const groups = data.groups.filter((group) => group?.group === 'self_deactivated_followers');
    if (groups.length > 1) {
      throw relationshipError('invalid-response', 'Instagram returned conflicting deactivated follower groups.');
    }
    const facepile = groups[0]?.facepile;
    if (facepile === undefined || facepile === null) return data.users;
    if (!Array.isArray(facepile)) {
      throw relationshipError('invalid-response', 'Instagram returned invalid deactivated follower accounts.');
    }
    for (const user of facepile) {
      if (!user || typeof user !== 'object' || Array.isArray(user)
        || typeof user.username !== 'string' || !/^[a-z0-9._]{1,30}$/i.test(user.username)
        || !normalizeUsername(user.username) || !/^[1-9]\d*$/.test(relationshipAccountId(user))) {
        throw relationshipError('invalid-response', 'Instagram returned an invalid deactivated follower identity.');
      }
    }
    // The native Followers reducer includes these supplied rows, not group context counts.
    return data.users.concat(facepile);
  }

  async function fetchRelationshipList(listType, userId, username, {
    clearTimer,
    fetchImpl,
    maxAccounts,
    maxDurationMs,
    maxPages,
    now,
    onProgress,
    random,
    requestAttempts,
    requestTimeoutMs,
    retryBaseMs,
    setTimer,
    signal,
    sleepImpl,
    startedAt,
    expectedCount = null,
  }) {
    const accounts = new Map();
    const accountKeyByUsername = new Map();
    const seenTokens = new Set();
    let nextMaxId = '';
    let pages = 0;
    let stagnantPages = 0;
    let instagramLimited = false;
    while (pages < maxPages && accounts.size < maxAccounts) {
      assertRelationshipRunActive(signal, startedAt, now, maxDurationMs);
      const url = new URL(`/api/v1/friendships/${userId}/${listType}/`, INSTAGRAM_WEB_ORIGIN);
      url.searchParams.set('count', String(RELATIONSHIP_PAGE_SIZE));
      url.searchParams.set('search_surface', 'follow_list_page');
      url.searchParams.set('query', '');
      url.searchParams.set('enable_groups', 'true');
      if (listType === 'following') url.searchParams.set('includes_hashtags', 'false');
      if (nextMaxId) url.searchParams.set('max_id', nextMaxId);
      const data = await fetchInstagramRelationshipJson(url, {
        clearTimer,
        expectedCount,
        fetchImpl,
        found: accounts.size,
        listType,
        maxDurationMs,
        now,
        onProgress,
        pages,
        random,
        requestAttempts,
        requestTimeoutMs,
        retryBaseMs,
        setTimer,
        signal,
        sleepImpl,
        startedAt,
        username,
      });
      if (!Array.isArray(data?.users)) {
        throw relationshipError('invalid-response', `Instagram returned an invalid ${listType} page.`);
      }
      for (const flag of ['has_more', 'should_limit_list_of_followers']) {
        if (Object.prototype.hasOwnProperty.call(data, flag) && typeof data[flag] !== 'boolean') {
          throw relationshipError('invalid-response', `Instagram returned an invalid ${listType} pagination flag.`);
        }
      }
      const pageUsers = relationshipPageUsers(data, listType);
      instagramLimited ||= data.should_limit_list_of_followers === true;
      pages += 1;
      const beforePageCount = accounts.size;
      for (const user of pageUsers) {
        const accountUsername = normalizeUsername(user?.username);
        if (!accountUsername) continue;
        const accountId = relationshipAccountId(user);
        const accountKey = accountId ? `id:${accountId}` : `username:${accountUsername}`;
        const usernameOwner = accountKeyByUsername.get(accountUsername);
        if (usernameOwner && usernameOwner !== accountKey) {
          if (usernameOwner === `username:${accountUsername}` && accountId) {
            accounts.delete(usernameOwner);
          } else {
            throw relationshipError(
              'invalid-response',
              `Instagram returned conflicting ${listType} account identities.`,
            );
          }
        }
        const previous = accounts.get(accountKey);
        if (previous?.username && previous.username !== accountUsername) {
          accountKeyByUsername.delete(previous.username);
        }
        accounts.set(accountKey, {
          id: accountId,
          username: accountUsername,
          profileUrl: `${INSTAGRAM_WEB_ORIGIN}/${accountUsername}/`,
          displayName: String(user?.full_name || '').trim().slice(0, 160),
          source: 'authenticated-instagram-web',
        });
        accountKeyByUsername.set(accountUsername, accountKey);
        if (accounts.size >= maxAccounts) break;
      }
      stagnantPages = accounts.size > beforePageCount ? 0 : stagnantPages + 1;
      onProgress?.(Object.freeze({
        expectedCount,
        found: accounts.size,
        listType,
        pages,
        phase: 'loading',
        username,
      }));
      const sortedAccounts = () => [...accounts.values()]
        .sort((left, right) => left.username.localeCompare(right.username));
      const candidateToken = stagnantPages >= 3 ? null : data.next_max_id;
      if (candidateToken === undefined || candidateToken === null || candidateToken === '') {
        const countReconciled = Number.isSafeInteger(expectedCount)
          && accounts.size === expectedCount && !instagramLimited
          && data.has_more !== true && stagnantPages < 3;
        return {
          accounts: sortedAccounts(),
          complete: countReconciled,
          expectedCount,
          pages,
          reason: countReconciled
            ? 'pagination-complete'
            : instagramLimited
              ? 'instagram-limited-list'
              : data.has_more === true
                ? 'cursor-missing'
                : Number.isSafeInteger(expectedCount) ? 'count-mismatch' : 'count-unverified',
        };
      }
      nextMaxId = String(candidateToken);
      if (!nextMaxId || nextMaxId.length > 500) {
        throw relationshipError('invalid-pagination', `Instagram returned an unsafe ${listType} pagination token.`);
      }
      if (seenTokens.has(nextMaxId)) {
        return {
          accounts: sortedAccounts(),
          complete: false,
          expectedCount,
          pages,
          reason: 'count-mismatch',
        };
      }
      seenTokens.add(nextMaxId);
      const delayMs = Math.floor(800 + (Math.max(0, Math.min(0.999999, random())) * 700));
      await sleepImpl(delayMs, signal);
    }
    return {
      accounts: [...accounts.values()]
        .sort((left, right) => left.username.localeCompare(right.username)),
      complete: false,
      expectedCount,
      pages,
      reason: accounts.size >= maxAccounts ? 'account-limit' : 'page-limit',
    };
  }

  function reconcileRelationshipAccounts(followers, following) {
    const latestById = new Map();
    for (const account of [...followers, ...following]) {
      if (account.id) latestById.set(account.id, account);
    }
    const idByUsername = new Map();
    const project = (accounts) => {
      const seenNames = new Set();
      return accounts.map((account) => {
        const current = account.id ? latestById.get(account.id) : account;
        const { id, ...record } = current;
        const existingId = idByUsername.get(record.username);
        if (seenNames.has(record.username) || (id && existingId && id !== existingId)) {
          throw relationshipError('invalid-response', 'Instagram returned conflicting account identities across the lists. The previous comparison is unchanged.');
        }
        seenNames.add(record.username);
        if (id) idByUsername.set(record.username, id);
        return record;
      }).sort((left, right) => left.username.localeCompare(right.username));
    };
    return { followers: project(followers), following: project(following) };
  }

  async function fetchFollowerComparison({
    clearTimer = clearTimeout,
    fetchImpl = globalThis.fetch?.bind(globalThis),
    maxAccounts = RELATIONSHIP_MAX_ACCOUNTS,
    maxDurationMs = RELATIONSHIP_MAX_DURATION_MS,
    maxPages = RELATIONSHIP_MAX_PAGES,
    now = Date.now,
    onProgress = null,
    random = Math.random,
    requestAttempts = RELATIONSHIP_REQUEST_ATTEMPTS,
    requestTimeoutMs = RELATIONSHIP_REQUEST_TIMEOUT_MS,
    retryBaseMs = RELATIONSHIP_RETRY_BASE_MS,
    signal = null,
    sleepImpl = relationshipDelay,
    setTimer = setTimeout,
    username: requestedUsername,
  } = {}) {
    const username = normalizeUsername(requestedUsername);
    if (!username) throw relationshipError('invalid-username', 'Enter a valid Instagram username.');
    const pageOrigin = String(location?.origin || '');
    if (pageOrigin !== INSTAGRAM_WEB_ORIGIN) {
      throw relationshipError('wrong-origin', 'Open instagram.com before running the follower check.');
    }
    if (typeof fetchImpl !== 'function') {
      throw relationshipError('fetch-unavailable', 'This browser context cannot load Instagram follower data.');
    }
    const boundedPages = Math.max(1, Math.min(RELATIONSHIP_MAX_PAGES, Math.trunc(Number(maxPages) || 0)));
    const boundedAccounts = Math.max(1, Math.min(RELATIONSHIP_MAX_ACCOUNTS, Math.trunc(Number(maxAccounts) || 0)));
    const boundedDuration = Math.max(1_000, Math.min(RELATIONSHIP_MAX_DURATION_MS, Math.trunc(Number(maxDurationMs) || 0)));
    const boundedAttempts = Math.max(1, Math.min(RELATIONSHIP_REQUEST_ATTEMPTS, Math.trunc(Number(requestAttempts) || 0)));
    const boundedRequestTimeout = Math.max(1, Math.min(RELATIONSHIP_REQUEST_TIMEOUT_MS, Math.trunc(Number(requestTimeoutMs) || 0)));
    const boundedRetryBase = Math.max(0, Math.min(5_000, Math.trunc(Number(retryBaseMs) || 0)));
    const deadline = relationshipRunDeadline(signal, boundedDuration, setTimer, clearTimer);
    const runSignal = deadline.signal;
    try {
      const startedAt = now();
      assertRelationshipRunActive(runSignal, startedAt, now, boundedDuration);
      onProgress?.(Object.freeze({ found: 0, listType: null, pages: 0, phase: 'resolving', username }));
      const common = {
        fetchImpl,
        maxAccounts: boundedAccounts,
        maxDurationMs: boundedDuration,
        maxPages: boundedPages,
        now,
        onProgress,
        random,
        requestAttempts: boundedAttempts,
        requestTimeoutMs: boundedRequestTimeout,
        retryBaseMs: boundedRetryBase,
        clearTimer,
        setTimer,
        signal: runSignal,
        sleepImpl,
        startedAt,
      };
      const openProfileCounts = openProfileRelationshipCounts(username);
      const resolution = await resolveRelationshipUserId(username, {
        ...common,
        found: 0,
        listType: null,
        pages: 0,
        username,
      });
      const { userId } = resolution;
      onProgress?.(Object.freeze({ found: 0, listType: null, pages: 0, phase: 'verifying-profile', username }));
      const profileCountsAtStart = openProfileCounts || await resolveRelationshipProfileCounts(username, userId, {
        ...common,
        found: 0,
        listType: null,
        pages: 0,
        username,
      });
      onProgress?.(Object.freeze({
        expectedCounts: profileCountsAtStart,
        found: 0,
        listType: null,
        pages: 0,
        phase: 'counts-ready',
        username,
      }));
      const countDisagreementAtStart = exactProfileCountDisagreement(username, profileCountsAtStart);
      const followersTraversal = await fetchRelationshipList('followers', userId, username, {
        ...common,
        expectedCount: profileCountsAtStart.followers,
      });
      const followingTraversal = await fetchRelationshipList('following', userId, username, {
        ...common,
        expectedCount: profileCountsAtStart.following,
      });
      assertRelationshipRunActive(runSignal, startedAt, now, boundedDuration);
      onProgress?.(Object.freeze({
        found: followersTraversal.accounts.length + followingTraversal.accounts.length,
        listType: null,
        pages: followersTraversal.pages + followingTraversal.pages,
        phase: 'revalidating-profile',
        username,
      }));
      const profileCountsAtEnd = openProfileCounts
        ? openProfileRelationshipCounts(username)
        : await resolveRelationshipProfileCounts(username, userId, {
          ...common,
          found: followersTraversal.accounts.length + followingTraversal.accounts.length,
          listType: null,
          pages: followersTraversal.pages + followingTraversal.pages,
          username,
        });
      if (!profileCountsAtEnd) {
        throw relationshipError('profile-count-unavailable', 'Keep the checked profile open until the comparison finishes. The previous comparison is unchanged.');
      }
      const countDisagreementAtEnd = exactProfileCountDisagreement(username, profileCountsAtEnd);
      const followers = finalizeRelationshipList(followersTraversal, {
        countChanged: profileCountsAtStart.followers !== profileCountsAtEnd.followers,
        countDisagreed: countDisagreementAtStart.followers || countDisagreementAtEnd.followers,
        expectedCount: profileCountsAtEnd.followers,
      });
      const following = finalizeRelationshipList(followingTraversal, {
        countChanged: profileCountsAtStart.following !== profileCountsAtEnd.following,
        countDisagreed: countDisagreementAtStart.following || countDisagreementAtEnd.following,
        expectedCount: profileCountsAtEnd.following,
      });
      const expectedCounts = Object.freeze({
        followers: profileCountsAtEnd.followers,
        following: profileCountsAtEnd.following,
      });
      const capturedAt = new Date(now()).toISOString();
      const reconciledAccounts = reconcileRelationshipAccounts(followers.accounts, following.accounts);
      const result = Object.freeze({
        capturedAt,
        complete: Object.freeze({ followers: followers.complete, following: following.complete }),
        expectedCounts: Object.freeze({ followers: followers.expectedCount, following: following.expectedCount }),
        followers: Object.freeze(reconciledAccounts.followers),
        following: Object.freeze(reconciledAccounts.following),
        pages: Object.freeze({ followers: followers.pages, following: following.pages }),
        reasons: Object.freeze({ followers: followers.reason, following: following.reason }),
        source: 'authenticated-instagram-web',
        userId,
        username,
      });
      onProgress?.(Object.freeze({
        found: result.followers.length + result.following.length,
        listType: null,
        pages: result.pages.followers + result.pages.following,
        phase: 'complete',
        username,
      }));
      return result;
    } catch (error) {
      if (deadline.timedOut() && error?.code === 'stopped') {
        throw relationshipError('time-limit', 'The follower check reached its 20-minute read limit.');
      }
      throw error;
    } finally {
      deadline.cleanup();
    }
  }

  function followerComparisonRecord(workspace, comparison, generatedAt = new Date().toISOString()) {
    if (!['followers', 'following'].every((type) => (
      workspace?.verified?.[type] === true && workspace?.complete?.[type] === true
    ))) {
      throw relationshipError('incomplete-comparison', 'Both lists must be complete before comparing. Partial captures are available separately under Advanced.');
    }
    return {
      schemaVersion: 1,
      kind: 'insta-toolbox-comparison',
      generatedAt,
      subjectUsername: normalizeUsername(workspace?.subjectUsername),
      source: workspace?.source && typeof workspace.source === 'object' ? workspace.source : {},
      complete: workspace?.complete && typeof workspace.complete === 'object' ? workspace.complete : {},
      verified: workspace?.verified && typeof workspace.verified === 'object' ? workspace.verified : {},
      mutuals: Array.isArray(comparison?.mutuals) ? comparison.mutuals : [],
      notFollowingMeBack: Array.isArray(comparison?.notFollowingMeBack)
        ? comparison.notFollowingMeBack
        : [],
      iDoNotFollowBack: Array.isArray(comparison?.iDoNotFollowBack)
        ? comparison.iDoNotFollowBack
        : [],
    };
  }

  function followerComparisonReport(workspace, comparison, generatedAt = new Date().toISOString()) {
    const record = followerComparisonRecord(workspace, comparison, generatedAt);
    const followersCount = Array.isArray(workspace?.followers) ? workspace.followers.length : 0;
    const followingCount = Array.isArray(workspace?.following) ? workspace.following.length : 0;
    const fullyVerified = record.verified.followers === true && record.verified.following === true;
    const fullyComplete = fullyVerified
      && record.complete.followers === true
      && record.complete.following === true;
    const source = record.source.followers === 'authenticated-web'
      && record.source.following === 'authenticated-web'
      ? 'Authenticated Instagram web pagination'
      : record.source.followers === 'list-dialog' && record.source.following === 'list-dialog'
        ? 'Instagram list-dialog capture'
        : 'Mixed local captures';
    const lines = [
      'INSTA TOOLBOX MUTUAL CHECK',
      '================================',
      `Account: ${record.subjectUsername ? `@${record.subjectUsername}` : 'Not recorded'}`,
      `Generated: ${record.generatedAt}`,
      `Source: ${source}`,
      `Completeness: ${fullyComplete ? 'Complete — both lists reached their verified end.' : 'Partial — one or both saved lists may omit accounts.'}`,
      '',
      'SUMMARY',
      '-------',
      `Followers: ${followersCount.toLocaleString('en-US')}`,
      `Following: ${followingCount.toLocaleString('en-US')}`,
      `Mutual followers: ${record.mutuals.length.toLocaleString('en-US')}`,
      `Not following you back: ${record.notFollowingMeBack.length.toLocaleString('en-US')}`,
      `You do not follow back: ${record.iDoNotFollowBack.length.toLocaleString('en-US')}`,
    ];
    const addSection = (title, accounts) => {
      lines.push('', title, '-'.repeat(title.length));
      if (!accounts.length) {
        lines.push('None');
        return;
      }
      accounts.forEach((account, index) => {
        const username = normalizeUsername(account?.username);
        const displayName = String(account?.displayName || '').trim();
        lines.push(`${index + 1}. @${username}${displayName ? ` — ${displayName}` : ''}`);
      });
    };
    addSection('NOT FOLLOWING YOU BACK', record.notFollowingMeBack);
    addSection('YOU DO NOT FOLLOW BACK', record.iDoNotFollowBack);
    addSection('MUTUAL FOLLOWERS', record.mutuals);
    lines.push('', 'Generated locally by Insta Toolbox. No account action was performed.', '');
    return lines.join('\r\n');
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

  function currentDirectThreadId() {
    const pathname = String(location.pathname || '').replaceAll('\\', '/');
    if (/^\/direct\/t\/[^/?#]+\/?$/i.test(pathname)) return directThreadId(pathname);
    const visible = (element) => {
      if (!element) return false;
      const style = getComputedStyle(element);
      if (style.display === 'none' || style.visibility === 'hidden') return false;
      const rectangle = element.getBoundingClientRect?.();
      return !rectangle || (rectangle.width > 0 && rectangle.height > 0);
    };
    const roots = [...document.querySelectorAll("[data-pagelet='IGDMessagesList']")].filter(visible);
    if (roots.length !== 1) return null;
    const links = [...document.querySelectorAll("a[href*='/direct/t/']")].filter(visible);
    if (links.length !== 1) return null;
    return directThreadId(links[0].getAttribute?.('href'));
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
    const explicitlyMarked = [...(row?.querySelectorAll?.('[data-insta-toolbox-message-content]') || [])];
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
    const observedThreadId = currentDirectThreadId();
    if (!observedThreadId) {
      return {
        observation: { ...session, unexpectedUi: true, reason: 'open-an-instagram-conversation' },
        candidate: null,
      };
    }

    const expectedThreadId = directThreadId(item?.conversationId);
    if (!expectedThreadId) {
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
    return [...new Set(matches)].filter((control) => (
      actionLabels.isDmMessageOptionsLabel(visibleText(control))
      || [...control?.querySelectorAll?.('[aria-label]') || []]
        .some((element) => actionLabels.isDmMessageOptionsLabel(visibleText(element)))
    ));
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

  function captureVisibleAccounts(expectedListType = '') {
    const listContext = accountListDialog(expectedListType);
    const roots = listContext ? [listContext.dialog] : [];
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

  function scrollableWithin(root) {
    if (!root) return null;
    const candidates = [root, ...root.querySelectorAll('div, ul, section')];
    let best = null;
    for (const element of candidates) {
      const overflowY = getComputedStyle(element).overflowY;
      if (overflowY !== 'auto' && overflowY !== 'scroll') continue;
      const slack = element.scrollHeight - element.clientHeight;
      if (slack <= 8) continue;
      if (!best || slack > best.slack) best = { element, slack };
    }
    return best?.element || null;
  }

  function accountListTypeFromText(value) {
    const label = String(value || '')
      .normalize('NFKC')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
    if (/^followers(?:\s|$)/.test(label)) return 'followers';
    if (/^following(?:\s|$)/.test(label)) return 'following';
    return '';
  }

  function accountListDialog(expectedListType = '') {
    const expected = expectedListType === 'followers' || expectedListType === 'following'
      ? expectedListType
      : '';
    for (const dialog of visibleDialogs()) {
      const heading = [...dialog.querySelectorAll('[role="heading"], h1, h2')]
        .map((element) => visibleText(element))
        .find(Boolean);
      const firstLine = visibleText(dialog)
        .split(/\r?\n/)
        .map((line) => line.trim())
        .find(Boolean);
      const observedTypes = new Set(
        [dialog.getAttribute('aria-label'), heading, firstLine]
          .map(accountListTypeFromText)
          .filter(Boolean),
      );
      if (observedTypes.size !== 1) continue;
      const [observed] = observedTypes;
      if (observed && (!expected || observed === expected)) {
        return { dialog, listType: observed };
      }
    }
    return null;
  }

  function exactProfileListCount(listType, { requireScoped = false } = {}) {
    if (listType !== 'followers' && listType !== 'following') return null;
    const profileUsername = normalizeUsername(location.pathname);
    const scopedCounts = new Set();
    const fallbackCounts = new Set();
    for (const link of document.querySelectorAll('a[role="link"], a[href="#"]')) {
      const href = link.getAttribute?.('href');
      const header = href === '#' ? link.closest?.('main header') : null;
      const belongsToOpenProfile = Boolean(profileUsername && header
        && [...header.querySelectorAll('h1, h2, [role="heading"]')].some((heading) => (
          visibleText(heading).trim().toLowerCase() === profileUsername
        )));
      const values = [
        link.getAttribute('title'),
        visibleText(link),
      ];
      const exactTitle = link.querySelector?.('[title]')?.getAttribute('title');
      if (exactTitle && new RegExp(`\\b${listType}$`, 'i').test(visibleText(link).trim())) {
        values.push(`${exactTitle} ${listType}`);
      }
      for (const value of values) {
        const label = String(value || '')
          .normalize('NFKC')
          .replace(/[\u00a0\u202f]/g, ' ')
          .replace(/\s+/g, ' ')
          .trim()
          .toLowerCase();
        const match = label.match(/^([0-9][0-9., ]*)\s+(followers|following)$/);
        if (!match || match[2] !== listType) continue;
        const digits = match[1].replace(/\D/g, '');
        if (!digits) continue;
        const count = Number(digits);
        if (!Number.isSafeInteger(count)) continue;
        fallbackCounts.add(count);
        if (belongsToOpenProfile) scopedCounts.add(count);
        if (!href || !profileUsername) continue;
        try {
          const target = new URL(href, INSTAGRAM_WEB_ORIGIN);
          if (target.origin !== INSTAGRAM_WEB_ORIGIN) continue;
          const pathname = target.pathname
            .replace(/\/+$/, '')
            .toLowerCase();
          if (pathname === `/${profileUsername}/${listType}`) scopedCounts.add(count);
        } catch {
          // Ignore malformed, non-navigation values such as JavaScript URLs.
        }
      }
    }
    if (scopedCounts.size === 1) return [...scopedCounts][0];
    if (!requireScoped && !scopedCounts.size && fallbackCounts.size === 1) return [...fallbackCounts][0];
    return null;
  }

  function sleep(ms) {
    return new Promise((resolve) => { setTimeout(resolve, ms); });
  }

  // Scrolls the open followers/following dialog to enumerate the full list.
  // Read-only: it only scrolls an already-open list and reads rendered rows.
  async function collectAccountList({ maxScrolls = 1_200, settleMs = 500, listType = '' } = {}) {
    const session = inspectSession();
    if (session.sessionExpired || session.challenge || session.actionBlocked || session.rateLimited) {
      return { ...session, accounts: [], complete: false, reason: 'session-stop' };
    }
    let expectedListType = listType === 'followers' || listType === 'following' ? listType : '';
    let listContext = accountListDialog(expectedListType);
    let root = listContext?.dialog || null;
    let scroller = scrollableWithin(root);
    if (!root) {
      return { ...session, accounts: [], complete: false, reason: 'open-a-followers-or-following-list' };
    }
    const observedListType = listContext?.listType || expectedListType;
    expectedListType = observedListType;
    const profilePath = location.pathname;
    const expectedCountAtStart = exactProfileListCount(observedListType);

    const accounts = new Map();
    const harvest = () => {
      for (const anchor of root.querySelectorAll('a[href^="/"]')) {
        const username = normalizeUsername(anchor.getAttribute('href'));
        if (!username || accounts.has(username)) continue;
        const label = visibleText(anchor);
        accounts.set(username, {
          username,
          profileUrl: `https://www.instagram.com/${username}/`,
          displayName: label === username ? '' : label,
          source: 'extension-scrolled-dom',
        });
      }
    };

    harvest();
    // Recycled rows cannot all exist in the DOM at once. Start at the top and
    // retain each window before advancing by less than one viewport.
    if (scroller) {
      scroller.scrollTop = 0;
      await sleep(settleMs);
    }
    let complete = !scroller
      && Number.isSafeInteger(expectedCountAtStart)
      && accounts.size === expectedCountAtStart;
    let stagnantRounds = 0;
    for (let round = 0; round < maxScrolls; round += 1) {
      const currentContext = accountListDialog(expectedListType);
      if (!currentContext || location.pathname !== profilePath) {
        complete = false;
        break;
      }
      const currentRoot = currentContext.dialog;
      const currentScroller = scrollableWithin(currentRoot);
      if (currentRoot !== root || currentScroller !== scroller) {
        listContext = currentContext;
        root = currentRoot;
        scroller = currentScroller;
        stagnantRounds = 0;
        if (scroller) {
          scroller.scrollTop = 0;
          await sleep(settleMs);
        }
        harvest();
      }
      harvest();
      if (!scroller) {
        complete = Number.isSafeInteger(expectedCountAtStart)
          && accounts.size === expectedCountAtStart;
        break;
      }
      const beforeCount = accounts.size;
      const beforeHeight = scroller.scrollHeight;
      const beforeTop = scroller.scrollTop;
      // Nudge only at the end to trigger a stalled lazy-loading sentinel.
      if (scroller.scrollTop >= scroller.scrollHeight - scroller.clientHeight - 8) {
        scroller.scrollTop = Math.max(
          0,
          scroller.scrollTop - Math.max(80, Math.floor(scroller.clientHeight / 2)),
        );
        await sleep(settleMs);
        harvest();
      }
      scroller.scrollTop = Math.min(
        Math.max(0, scroller.scrollHeight - scroller.clientHeight),
        beforeTop + Math.max(1, Math.floor(scroller.clientHeight * 0.75)),
      );
      await sleep(settleMs);
      // A long Followers list keeps a spinner up well past the settle delay.
      // Waiting for it to clear is what stops a big list being declared
      // complete while thousands of rows are still unfetched.
      let loading = false;
      for (let wait = 0; wait < 24; wait += 1) {
        loading = Boolean(root.querySelector('[role="progressbar"], svg[aria-label*="Loading" i]'));
        if (!loading) break;
        await sleep(250);
      }
      const settledContext = accountListDialog(expectedListType);
      if (location.pathname !== profilePath || !settledContext) {
        complete = false;
        break;
      }
      if (settledContext.dialog !== root || scrollableWithin(root) !== scroller) continue;
      harvest();

      const atBottom = scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 8;
      const grew = accounts.size > beforeCount || scroller.scrollHeight > beforeHeight;
      stagnantRounds = grew || loading ? 0 : stagnantRounds + 1;
      const check = inspectSession();
      if (check.sessionExpired || check.challenge || check.actionBlocked || check.rateLimited) {
        return {
          ...check,
          accounts: [...accounts.values()],
          complete: false,
          reason: 'session-stop',
        };
      }
      if (atBottom && !loading
        && Number.isSafeInteger(expectedCountAtStart)
        && accounts.size === expectedCountAtStart) {
        complete = true;
        break;
      }
      // Instagram lazy-loads in bursts and can pause between pages, so a couple
      // of quiet rounds does not mean the end. Be patient before concluding.
      if (atBottom && !loading && stagnantRounds >= 10) {
        break;
      }
    }

    const expectedCountAtEnd = exactProfileListCount(observedListType);
    const expectedCount = expectedCountAtEnd ?? expectedCountAtStart;
    const countChanged = Number.isSafeInteger(expectedCountAtStart)
      && Number.isSafeInteger(expectedCountAtEnd)
      && expectedCountAtStart !== expectedCountAtEnd;
    const countMismatch = Number.isSafeInteger(expectedCount)
      && accounts.size !== expectedCount;
    if (countChanged || countMismatch || !Number.isSafeInteger(expectedCount)) complete = false;

    return {
      ...session,
      accounts: [...accounts.values()]
        .sort((left, right) => left.username.localeCompare(right.username)),
      complete,
      listType: listContext?.listType || null,
      expectedCount,
      observedCount: accounts.size,
      capturedAt: new Date().toISOString(),
      reason: countChanged
        ? 'list-count-changed'
        : countMismatch
          ? 'list-count-mismatch'
          : !Number.isSafeInteger(expectedCount)
            ? 'list-count-unverified'
            : complete
              ? 'list-complete'
              : 'list-truncated',
    };
  }

  // Enumerates messages the signed-in account sent in the open conversation.
  // Read-only: no controls are activated here.
  async function enumerateSentDms({ maxScrolls = 300, settleMs = 300, limit = 500 } = {}) {
    const session = inspectSession();
    if (session.sessionExpired || session.challenge || session.actionBlocked || session.rateLimited) {
      return { ...session, messages: [], complete: false, reason: 'session-stop' };
    }
    const conversationId = currentDirectThreadId();
    if (!conversationId) {
      return {
        ...session,
        messages: [],
        complete: false,
        reason: 'open-an-instagram-conversation',
      };
    }

    const scope = document.querySelector('[data-pagelet="IGDMessagesList"]')
      || document.querySelector('main');
    const scroller = scrollableWithin(scope);
    const identitySelector = DM_MESSAGE_ID_ATTRIBUTES
      .map((attribute) => `[${attribute}]`)
      .join(', ');
    const found = new Map();

    const harvest = () => {
      const identityNodes = [...(scope?.querySelectorAll?.(identitySelector) || [])]
        .filter((element) => visibleText(element));
      for (const identityNode of identityNodes) {
        const row = identityNode.closest?.('[role="row"], [role="listitem"]') || identityNode;
        const identity = dmMessageId(identityNode) || dmMessageId(row);
        if (!identity?.value) continue;
        const ownership = dmOwnership(row, identityNode);
        if (ownership.sentByMe !== true) continue;
        const timestamp = dmMessageTimestamp(identityNode, row);
        if (timestamp?.timestamp == null) continue;
        const contents = dmContentCandidates(row);
        // Only exactly-identifiable single-content rows are eligible for unsend.
        if (contents.length !== 1) continue;
        const key = identity.value;
        if (found.has(key)) continue;
        found.set(key, {
          conversationId,
          messageId: identity.value,
          identityBasis: identity.attribute,
          timestamp: timestamp.timestamp,
          timestampBasis: timestamp.basis,
          contentDigest: dmContentDigest(contents[0]),
          preview: contents[0].slice(0, 120),
          ownershipBasis: ownership.basis,
          sentByMe: true,
        });
      }
    };

    harvest();
    let complete = !scroller;
    let stagnantRounds = 0;
    // Instagram renders the thread with `flex-direction: column-reverse`, so
    // scrollTop 0 is the NEWEST message and older ones live at NEGATIVE
    // scrollTop. Scrolling to 0 to "go up" would sit on the newest message
    // forever and never page in history.
    const reversed = getComputedStyle(scroller || scope).flexDirection === 'column-reverse'
      || scroller?.scrollTop < 0;
    const oldestOffset = () => (reversed
      ? -(scroller.scrollHeight - scroller.clientHeight)
      : 0);

    for (let round = 0; scroller && round < maxScrolls && found.size < limit; round += 1) {
      const beforeCount = found.size;
      const beforeHeight = scroller.scrollHeight;
      const target = oldestOffset();
      // Nudge off the edge first so the jump is a real scroll change even when
      // we are already pinned at the oldest end.
      if (Math.abs(scroller.scrollTop - target) <= 8) {
        scroller.scrollTop = target + (reversed ? 1 : -1)
          * Math.max(80, Math.floor(scroller.clientHeight / 2));
        await sleep(60);
      }
      scroller.scrollTop = target;
      await sleep(settleMs);
      // Instagram shows a spinner while a page loads; wait it out rather than
      // guessing with a fixed delay.
      for (let wait = 0; wait < 20; wait += 1) {
        if (!scope?.querySelector?.('[role="progressbar"], svg[aria-label*="Loading" i]')) break;
        await sleep(250);
      }
      harvest();

      const atTop = Math.abs(scroller.scrollTop - oldestOffset()) <= 8;
      const grew = found.size > beforeCount || scroller.scrollHeight > beforeHeight;
      stagnantRounds = grew ? 0 : stagnantRounds + 1;
      if (atTop && stagnantRounds >= 3) {
        complete = true;
        break;
      }
      const check = inspectSession();
      if (check.sessionExpired || check.challenge || check.actionBlocked || check.rateLimited) {
        return {
          ...check,
          messages: [...found.values()],
          complete: false,
          reason: 'session-stop',
        };
      }
    }

    const messages = [...found.values()]
      .sort((left, right) => right.timestamp - left.timestamp)
      .slice(0, limit);
    return {
      ...session,
      conversationId,
      messages,
      complete,
      exactIdentityAvailable: messages.length > 0,
      capturedAt: new Date().toISOString(),
      reason: messages.length
        ? (complete ? 'thread-complete' : 'thread-truncated')
        : 'exact-message-identity-unavailable',
    };
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
    const conversationId = currentDirectThreadId();
    if (!conversationId) {
      return {
        ...session,
        pageKind: kind,
        conversationId: '',
        conversationLabel: '',
        exactIdentityAvailable: false,
        ownershipAvailable: false,
        fragments: [],
        reason: 'open-an-instagram-conversation',
        capturedAt: new Date().toISOString(),
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
      conversationId,
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

  globalThis.InstaToolboxInstagramInspector = Object.freeze({
    captureVisibleAccounts,
    collectAccountList,
    detectAuthenticatedUsername,
    enumerateSentDms,
    fetchFollowerComparison,
    followerComparisonRecord,
    followerComparisonReport,
    inspectPageContext,
    inspectProfile,
    inspectReviewedDmItem,
    inspectSession,
    inspectVisibleMessages,
    normalizeUsername,
    // The executors are exported so the userscript build runs this same audited
    // engine instead of carrying a second copy of the DOM logic. Both callers
    // still have to supply a resolution token minted by the matching inspect
    // call, so exporting them does not widen what an action can do.
    performReviewedDmUnsend,
    performReviewedProfileAction,
    reviewedTargetElement,
  });

  // Only the extension build has a runtime to talk to. Under Tampermonkey this
  // file provides the engine and the message router is simply not installed.
  if (!globalThis.chrome?.runtime?.onMessage?.addListener) return;

  chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
    if (request?.kind === 'insta-toolbox-inspect-profile') {
      sendResponse(inspectProfile(request.username));
      return;
    }
    if (request?.kind === 'insta-toolbox-inspect-session') {
      sendResponse(inspectSession());
      return;
    }
    if (request?.kind === 'insta-toolbox-capture-visible-accounts') {
      sendResponse({
        capturedAt: new Date().toISOString(),
        accounts: captureVisibleAccounts(),
      });
      return;
    }
    if (request?.kind === 'insta-toolbox-collect-account-list') {
      collectAccountList(request.options || {})
        .then(sendResponse)
        .catch(() => sendResponse({ unexpectedUi: true, reason: 'account-list-collection-failed' }));
      return true;
    }
    if (request?.kind === 'insta-toolbox-enumerate-sent-dms') {
      enumerateSentDms(request.options || {})
        .then(sendResponse)
        .catch(() => sendResponse({ unexpectedUi: true, reason: 'sent-dm-enumeration-failed' }));
      return true;
    }
    if (request?.kind === 'insta-toolbox-inspect-visible-messages') {
      sendResponse(inspectVisibleMessages());
      return;
    }
    if (request?.kind === 'insta-toolbox-inspect-reviewed-dm-item') {
      sendResponse(inspectReviewedDmItem(request.item));
      return;
    }
    if (request?.kind === 'insta-toolbox-perform-reviewed-profile-action') {
      performReviewedProfileAction(request.item)
        .then(sendResponse)
        .catch(() => sendResponse({ unexpectedUi: true, reason: 'live-action-driver-error' }));
      return true;
    }
    if (request?.kind === 'insta-toolbox-perform-reviewed-dm-unsend') {
      performReviewedDmUnsend(request.item)
        .then(sendResponse)
        .catch(() => sendResponse({ unexpectedUi: true, reason: 'live-dm-driver-error' }));
      return true;
    }
  });
})();

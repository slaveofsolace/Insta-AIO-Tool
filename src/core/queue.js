import {
  accountMatchesSet,
  normalizeAccount,
  normalizeUsername,
  stableAccountKey,
} from './accounts.js';
import { classifyRelationships } from './snapshots.js';

export const QUEUE_STATUSES = [
  'pending', 'waiting', 'ready', 'processing', 'completed',
  'paused', 'skipped', 'failed', 'protected', 'removed',
];

function queueId(action, account, createdAt) {
  return `${action}:${stableAccountKey(account)}:${createdAt}`;
}

export function createQueueItem(rawAccount, action, {
  reason = 'manual',
  createdAt = Date.now(),
  scheduledFor = createdAt,
  status = action === 'follow' ? 'pending' : 'ready',
  sourceActionId = null,
  preexisting = false,
} = {}) {
  const account = normalizeAccount(rawAccount, rawAccount?.source || 'queue');
  if (!account) throw new Error('Queue entries require a valid Instagram username.');
  if (!['follow', 'unfollow'].includes(action)) throw new Error(`Unsupported action: ${action}`);

  return {
    id: queueId(action, account, createdAt),
    account,
    action,
    reason,
    createdAt: new Date(createdAt).toISOString(),
    scheduledFor: new Date(scheduledFor).toISOString(),
    status,
    sourceActionId,
    preexisting,
    attemptCount: 0,
    completedAt: null,
    lastAttemptAt: null,
    error: null,
    notes: '',
  };
}

export function addFollowTargets(queue, usernames, options = {}) {
  const next = [...(queue || [])];
  const activeKeys = new Set(next
    .filter((item) => !['removed', 'skipped'].includes(item.status))
    .map((item) => `${item.action}:${stableAccountKey(item.account)}`));

  for (const username of usernames || []) {
    const account = normalizeAccount(username, 'manual-target');
    if (!account) continue;
    const key = `follow:${stableAccountKey(account)}`;
    if (activeKeys.has(key)) continue;
    next.push(createQueueItem(account, 'follow', options));
    activeKeys.add(key);
  }
  return next;
}

export function markQueueItem(queue, itemId, status, now = Date.now(), extra = {}) {
  if (!QUEUE_STATUSES.includes(status)) throw new Error(`Unknown queue status: ${status}`);
  return (queue || []).map((item) => {
    if (item.id !== itemId) return item;
    const completedAt = status === 'completed'
      ? new Date(now).toISOString()
      : item.completedAt;
    return {
      ...item,
      ...extra,
      status,
      completedAt,
      lastAttemptAt: ['processing', 'failed', 'completed'].includes(status)
        ? new Date(now).toISOString()
        : item.lastAttemptAt,
      attemptCount: status === 'processing' ? item.attemptCount + 1 : item.attemptCount,
    };
  });
}

export function refreshQueue(queue, snapshot, settings = {}, now = Date.now()) {
  const waitingDays = Math.max(1, Number(settings.waitingDays || 7));
  const waitingMs = waitingDays * 24 * 60 * 60 * 1000;
  const whitelist = settings.whitelist || [];
  const preexistingFollowing = settings.preexistingFollowing || [];
  const protectMutuals = settings.protectMutuals !== false;
  const relationships = classifyRelationships(snapshot || { followers: [], following: [] });
  const mutualNames = new Set(relationships.mutuals.map((a) => normalizeUsername(a.username)));
  const followerNames = new Set((snapshot?.followers || []).map((a) => normalizeUsername(a.username)));

  const next = (queue || []).map((item) => ({ ...item }));
  const existingUnfollowKeys = new Set(next
    .filter((item) => item.action === 'unfollow' && !['removed', 'skipped'].includes(item.status))
    .map((item) => stableAccountKey(item.account)));

  for (const item of next) {
    const username = normalizeUsername(item.account.username);
    const protectedByWhitelist = accountMatchesSet(item.account, whitelist);
    const protectedPreexisting = item.preexisting || preexistingFollowing.includes(username);
    const protectedMutual = protectMutuals && mutualNames.has(username);

    if (item.action === 'unfollow' && (protectedByWhitelist || protectedPreexisting || protectedMutual)) {
      item.status = 'protected';
      item.reason = protectedByWhitelist
        ? 'whitelist'
        : protectedPreexisting
          ? 'preexisting-follow'
          : 'mutual-follow';
      continue;
    }

    if (item.action !== 'follow' || !['completed', 'waiting'].includes(item.status) || !item.completedAt) continue;

    if (followerNames.has(username)) {
      item.status = 'protected';
      item.reason = 'followed-back';
      continue;
    }

    const dueAt = new Date(item.completedAt).getTime() + waitingMs;
    if (now < dueAt) {
      item.status = 'waiting';
      item.scheduledFor = new Date(dueAt).toISOString();
      continue;
    }

    if (protectedByWhitelist || protectedPreexisting) {
      item.status = 'protected';
      item.reason = protectedByWhitelist ? 'whitelist' : 'preexisting-follow';
      continue;
    }

    const key = stableAccountKey(item.account);
    if (!existingUnfollowKeys.has(key)) {
      next.push(createQueueItem(item.account, 'unfollow', {
        reason: 'waiting-period-expired-no-follow-back',
        createdAt: now,
        scheduledFor: now,
        status: 'ready',
        sourceActionId: item.id,
      }));
      existingUnfollowKeys.add(key);
    }
  }

  return next;
}

export function getQueueSummary(queue) {
  const summary = Object.fromEntries(QUEUE_STATUSES.map((status) => [status, 0]));
  for (const item of queue || []) summary[item.status] = (summary[item.status] || 0) + 1;
  summary.total = (queue || []).length;
  return summary;
}

import { dedupeAccounts, normalizeAccount } from './accounts.js';
import { createSnapshot } from './snapshots.js';
import {
  dedupeMessages,
  parseInstagramHelperData,
  parseMetaConversation,
} from './messages.js';

function safeJson(text, name, warnings) {
  try {
    return JSON.parse(text);
  } catch (error) {
    warnings.push(`${name}: invalid JSON (${error.message}).`);
    return null;
  }
}

function valuesFromRelationshipPayload(data, kind) {
  if (Array.isArray(data)) return data;
  if (!data || typeof data !== 'object') return [];
  if (Array.isArray(data[kind])) return data[kind];
  if (Array.isArray(data[`relationships_${kind}`])) return data[`relationships_${kind}`];
  if (data.snapshot && Array.isArray(data.snapshot[kind])) return data.snapshot[kind];
  return [];
}

export function parseRelationshipPayload(data, kind, source = 'import') {
  return dedupeAccounts(valuesFromRelationshipPayload(data, kind)
    .map((entry) => normalizeAccount(entry, source))
    .filter(Boolean));
}

function classifyName(name) {
  const lower = name.toLowerCase();
  if (/followers(_\d+)?\.json$/.test(lower)) return 'followers';
  if (/following(_\d+)?\.json$/.test(lower)) return 'following';
  if (/message_\d+\.json$/.test(lower)) return 'messages';
  if (/followed\.json$/.test(lower) && !/unfollowed/.test(lower)) return 'simple-followed';
  if (/unfollowed\.json$/.test(lower)) return 'simple-unfollowed';
  return 'unknown';
}

export function importFileRecords(records, { ownerNames = [] } = {}) {
  const followers = [];
  const following = [];
  const messages = [];
  const legacyActions = [];
  const warnings = [];
  let latestTimestamp = 0;

  for (const record of records || []) {
    const name = record.name || 'unknown.json';
    const data = typeof record.data === 'object' && record.data !== null
      ? record.data
      : safeJson(record.text, name, warnings);
    if (!data) continue;
    latestTimestamp = Math.max(latestTimestamp, Number(record.lastModified || 0));

    if (Array.isArray(data.allMessagesItemsArray)) {
      messages.push(...parseInstagramHelperData(data, name));
      continue;
    }

    const kind = classifyName(name);
    if (kind === 'followers') {
      followers.push(...parseRelationshipPayload(data, 'followers', name));
      continue;
    }
    if (kind === 'following') {
      following.push(...parseRelationshipPayload(data, 'following', name));
      continue;
    }
    if (kind === 'messages' || Array.isArray(data.messages)) {
      messages.push(...parseMetaConversation(data, { sourceName: name, ownerNames }));
      continue;
    }
    if (kind === 'simple-followed' || kind === 'simple-unfollowed') {
      if (!Array.isArray(data)) {
        warnings.push(`${name}: expected a SimpleInstaBot history array.`);
        continue;
      }
      for (const entry of data) {
        const account = normalizeAccount(entry, 'simpleinstabot');
        if (!account) continue;
        legacyActions.push({
          account,
          action: kind === 'simple-followed' ? 'follow' : 'unfollow',
          timestamp: Number(entry.time || Date.now()),
          status: entry.failed ? 'failed' : entry.noActionTaken ? 'skipped' : 'completed',
          source: name,
        });
      }
      continue;
    }

    const embeddedFollowers = parseRelationshipPayload(data, 'followers', name);
    const embeddedFollowing = parseRelationshipPayload(data, 'following', name);
    if (embeddedFollowers.length || embeddedFollowing.length) {
      followers.push(...embeddedFollowers);
      following.push(...embeddedFollowing);
      continue;
    }

    warnings.push(`${name}: recognized as JSON, but no supported Instagram data was found.`);
  }

  const uniqueFollowers = dedupeAccounts(followers);
  const uniqueFollowing = dedupeAccounts(following);
  const snapshot = uniqueFollowers.length || uniqueFollowing.length
    ? createSnapshot({
      followers: uniqueFollowers,
      following: uniqueFollowing,
      capturedAt: latestTimestamp || Date.now(),
      source: 'instagram-data-export',
      metadata: { importedFiles: (records || []).map((record) => record.name) },
    })
    : null;

  return {
    snapshot,
    messages: dedupeMessages(messages),
    legacyActions,
    warnings,
  };
}

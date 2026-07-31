import {
  dedupeAccounts,
  normalizeAccount,
  stableAccountKey,
} from './accounts.js';
import { createSnapshot } from './snapshots.js';
import {
  dedupeMessages,
  parseMetaConversation,
} from './messages.js';
import { inspectLegacyComponentRecord } from '../adapters/legacy-components.js';
import {
  createMigrationReport,
  validateMigrationReport,
} from '../migrations/migration-report.js';
import { classifyImportPath } from './import-classification.js';

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

function dedupeLegacyActions(actions) {
  const map = new Map();
  for (const action of actions || []) {
    const key = `${action.action}:${stableAccountKey(action.account)}:${Number(action.timestamp)}`;
    if (!map.has(key)) map.set(key, action);
  }
  return [...map.values()];
}

function addAggregateDuplicateReport({
  count,
  kind,
  records,
  migrationReports,
  warnings,
}) {
  if (!count) return;
  const report = createMigrationReport({
    source: 'import-pipeline',
    sourceFiles: (records || []).map((record) => record.name || 'unknown.json'),
  });
  report.inputCount = count;
  report.duplicateCount = count;
  report.warnings.push(
    `${count} duplicate ${kind} ${count === 1 ? 'record was' : 'records were'} `
    + 'reported across imported files.',
  );
  validateMigrationReport(report);
  migrationReports.push(report);
  warnings.push(...report.warnings);
}

export function importFileRecords(records, { ownerNames = [] } = {}) {
  const followers = [];
  const following = [];
  const messages = [];
  const legacyActions = [];
  const relationshipReports = [];
  const migrationReports = [];
  const warnings = [];
  let latestTimestamp = 0;

  for (const record of records || []) {
    const name = record.name || 'unknown.json';
    const data = typeof record.data === 'object' && record.data !== null
      ? record.data
      : safeJson(record.text, name, warnings);
    if (!data) continue;
    latestTimestamp = Math.max(latestTimestamp, Number(record.lastModified || 0));

    const legacy = inspectLegacyComponentRecord({
      name,
      data,
      lastModified: record.lastModified,
    });
    if (legacy?.handled) {
      messages.push(...legacy.messages);
      legacyActions.push(...legacy.legacyActions);
      relationshipReports.push(...legacy.relationshipReports);
      migrationReports.push(legacy.migrationReport);
      warnings.push(
        ...legacy.migrationReport.warnings,
        ...legacy.migrationReport.manualCorrections,
      );
      continue;
    }

    const kind = classifyImportPath(name);
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
  const uniqueMessages = dedupeMessages(messages);
  const uniqueLegacyActions = dedupeLegacyActions(legacyActions);
  addAggregateDuplicateReport({
    count: messages.length - uniqueMessages.length,
    kind: 'message',
    records,
    migrationReports,
    warnings,
  });
  addAggregateDuplicateReport({
    count: legacyActions.length - uniqueLegacyActions.length,
    kind: 'legacy action',
    records,
    migrationReports,
    warnings,
  });
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
    messages: uniqueMessages,
    legacyActions: uniqueLegacyActions,
    relationshipReports,
    migrationReports,
    warnings,
  };
}

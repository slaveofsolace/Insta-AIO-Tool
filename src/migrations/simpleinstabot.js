import {
  normalizeAccount,
  stableAccountKey,
} from '../core/accounts.js';
import {
  createMigrationReport,
  validateMigrationReport,
} from './migration-report.js';

export const SIMPLEINSTABOT_REVISION = '5eed7e4ac7ac7db6922eb9e5ed6db36ad9f18fca';

function isObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validTimestamp(value) {
  const timestamp = Number(value);
  return Number.isFinite(timestamp) && timestamp > 0;
}

export function migrateSimpleInstaBotHistory(
  data,
  { action, sourceName = 'history.json' } = {},
) {
  if (!['follow', 'unfollow'].includes(action)) {
    throw new Error(`Unsupported SimpleInstaBot history action: ${action}`);
  }

  const report = createMigrationReport({
    source: 'simpleinstabot',
    sourceRevision: SIMPLEINSTABOT_REVISION,
    sourceFiles: [sourceName],
  });

  if (!Array.isArray(data)) {
    report.warnings.push(`${sourceName}: expected a SimpleInstaBot history array.`);
    return { legacyActions: [], report };
  }

  report.inputCount = data.length;
  const legacyActions = [];
  const seen = new Set();

  data.forEach((entry, index) => {
    if (!isObject(entry)) {
      report.skippedCount += 1;
      report.warnings.push(`${sourceName}: record ${index} is not an object.`);
      return;
    }

    const account = normalizeAccount(entry, 'simpleinstabot');
    if (!account) {
      report.skippedCount += 1;
      report.warnings.push(`${sourceName}: record ${index} has no valid username.`);
      return;
    }

    if (!validTimestamp(entry.time)) {
      report.skippedCount += 1;
      report.warnings.push(`${sourceName}: record ${index} has no valid time.`);
      return;
    }

    const timestamp = Number(entry.time);
    const key = `${action}:${stableAccountKey(account)}:${timestamp}`;
    if (seen.has(key)) {
      report.duplicateCount += 1;
      report.warnings.push(`${sourceName}: record ${index} duplicates an earlier history record.`);
      return;
    }
    seen.add(key);

    if (entry.failed && entry.noActionTaken) {
      report.manualCorrections.push(
        `${sourceName}: record ${index} has both failed and noActionTaken; failed was preserved.`,
      );
    }

    const status = entry.failed ? 'failed' : entry.noActionTaken ? 'skipped' : 'completed';
    legacyActions.push({
      account,
      action,
      timestamp,
      status,
      source: sourceName,
      sourceEvidence: {
        failed: Boolean(entry.failed),
        noActionTaken: Boolean(entry.noActionTaken),
      },
    });
    report.importedCount += 1;
  });

  validateMigrationReport(report);
  return { legacyActions, report };
}

export function inspectSimpleInstaBotLikedPhotos(
  data,
  { sourceName = 'liked-photos.json' } = {},
) {
  const report = createMigrationReport({
    source: 'simpleinstabot-liked-photos',
    sourceRevision: SIMPLEINSTABOT_REVISION,
    sourceFiles: [sourceName],
  });
  if (!Array.isArray(data)) {
    report.warnings.push(`${sourceName}: expected a SimpleInstaBot liked-photo array.`);
    return { report };
  }

  report.inputCount = data.length;
  report.skippedCount = data.length;
  if (data.length) {
    report.warnings.push(
      `${sourceName}: ${data.length} liked-photo `
      + `${data.length === 1 ? 'record is' : 'records are'} outside the Insta AIO data contract.`,
    );
  }
  validateMigrationReport(report);
  return { report };
}

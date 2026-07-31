import {
  dedupeMessages,
  parseInstagramHelperData,
} from '../core/messages.js';
import {
  createMigrationReport,
  validateMigrationReport,
} from './migration-report.js';

export const INSTAGRAM_HELPER_REVISION = '5853d856a18a395aab7c8b8c7e3633175e23ddaf';

function isObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validTimestamp(value) {
  return value != null && Number.isFinite(Number(value)) && Number(value) > 0;
}

export function migrateInstagramHelperData(
  data,
  { sourceName = 'InstagramHelperData.json' } = {},
) {
  const report = createMigrationReport({
    source: 'instagram-helper',
    sourceRevision: INSTAGRAM_HELPER_REVISION,
    sourceFiles: [sourceName],
  });

  if (!isObject(data) || !Array.isArray(data.allMessagesItemsArray)) {
    report.warnings.push(`${sourceName}: expected allMessagesItemsArray.`);
    return { messages: [], report };
  }

  report.inputCount = data.allMessagesItemsArray.length;
  const validItems = [];

  data.allMessagesItemsArray.forEach((item, index) => {
    if (!isObject(item)) {
      report.skippedCount += 1;
      report.warnings.push(`${sourceName}: message ${index} is not an object.`);
      return;
    }
    if (!validTimestamp(item.timestamp)) {
      report.skippedCount += 1;
      report.warnings.push(`${sourceName}: message ${index} has no valid timestamp.`);
      return;
    }
    validItems.push(item);
  });

  const participants = Array.isArray(data.usersChatParticipants)
    ? data.usersChatParticipants.filter(isObject)
    : [];
  if (!Array.isArray(data.usersChatParticipants)) {
    report.manualCorrections.push(`${sourceName}: participant mapping is missing.`);
  }
  if (data.myUserId == null || String(data.myUserId).trim() === '') {
    report.manualCorrections.push(
      `${sourceName}: myUserId is missing; sender ownership must be corrected before unsend review.`,
    );
  }
  if (
    data.threadId == null
    && data.thread_id == null
    && data.threadTitle == null
    && data.thread_title == null
  ) {
    report.manualCorrections.push(
      `${sourceName}: the source export has no durable conversation identity.`,
    );
  }

  const parsed = parseInstagramHelperData({
    ...data,
    allMessagesItemsArray: validItems,
    usersChatParticipants: participants,
  }, sourceName);
  const messages = dedupeMessages(parsed);
  report.duplicateCount = parsed.length - messages.length;
  report.importedCount = messages.length;

  if (report.duplicateCount) {
    report.warnings.push(
      `${sourceName}: ${report.duplicateCount} duplicate message `
      + `${report.duplicateCount === 1 ? 'record was' : 'records were'} not reimported.`,
    );
  }

  validateMigrationReport(report);
  return { messages, report };
}

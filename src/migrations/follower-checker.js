import { normalizeAccount } from '../core/accounts.js';
import {
  createMigrationReport,
  validateMigrationReport,
} from './migration-report.js';

export const FOLLOWER_CHECKER_REVISION = '3876d9a67bc8255a79990a1616c20cae296d7194';

function migrateList(values, {
  label,
  sourceName,
  report,
}) {
  const accounts = [];
  const seen = new Set();
  values.forEach((value, index) => {
    const account = normalizeAccount(value, 'follower-checker-partial-report');
    if (!account) {
      report.skippedCount += 1;
      report.warnings.push(`${sourceName}: ${label} record ${index} has no valid username.`);
      return;
    }
    if (seen.has(account.username)) {
      report.duplicateCount += 1;
      report.warnings.push(`${sourceName}: ${label} record ${index} is a duplicate.`);
      return;
    }
    seen.add(account.username);
    accounts.push(account);
    report.importedCount += 1;
  });
  return accounts;
}

export function migrateFollowerCheckerResult(
  data,
  {
    sourceName = 'follower-checker-result.json',
    capturedAt = null,
    sourceUsername = null,
  } = {},
) {
  const report = createMigrationReport({
    source: 'abir-taheer-follower-checker',
    sourceRevision: FOLLOWER_CHECKER_REVISION,
    sourceFiles: [sourceName],
  });

  const iDoNotFollowBack = Array.isArray(data?.PeopleIDontFollowBack)
    ? data.PeopleIDontFollowBack
    : [];
  const notFollowingBack = Array.isArray(data?.PeopleNotFollowingMeBack)
    ? data.PeopleNotFollowingMeBack
    : [];
  const capturedAtTime = capturedAt == null ? Number.NaN : new Date(capturedAt).getTime();
  report.inputCount = iDoNotFollowBack.length + notFollowingBack.length;

  if (!Array.isArray(data?.PeopleIDontFollowBack)) {
    report.warnings.push(`${sourceName}: PeopleIDontFollowBack is missing.`);
  }
  if (!Array.isArray(data?.PeopleNotFollowingMeBack)) {
    report.warnings.push(`${sourceName}: PeopleNotFollowingMeBack is missing.`);
  }

  const relationshipReport = {
    schemaVersion: 1,
    kind: 'insta-aio-partial-relationship-report',
    source: 'abir-taheer-follower-checker',
    sourceFile: sourceName,
    sourceUsername: sourceUsername || null,
    capturedAt: Number.isNaN(capturedAtTime) ? null : new Date(capturedAtTime).toISOString(),
    complete: false,
    actionable: false,
    iDoNotFollowBack: migrateList(iDoNotFollowBack, {
      label: 'PeopleIDontFollowBack',
      sourceName,
      report,
    }),
    notFollowingBack: migrateList(notFollowingBack, {
      label: 'PeopleNotFollowingMeBack',
      sourceName,
      report,
    }),
  };

  if (!sourceUsername) {
    report.manualCorrections.push(`${sourceName}: source username is missing.`);
  }
  if (Number.isNaN(capturedAtTime)) {
    report.manualCorrections.push(`${sourceName}: capture time is missing or invalid.`);
  }
  report.manualCorrections.push(
    `${sourceName}: mutual accounts and stable IDs are absent; this partial report is not actionable.`,
  );

  validateMigrationReport(report);
  return { relationshipReport, report };
}

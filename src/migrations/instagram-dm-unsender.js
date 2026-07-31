import {
  createMigrationReport,
  validateMigrationReport,
} from './migration-report.js';
import { INSTAGRAM_DM_UNSENDER_SOURCE } from '../adapters/instagram-dm-unsender.js';

export function reportInstagramDmUnsenderMigration({
  sourceName = 'instagram-dm-unsender-0.7.2.txt',
} = {}) {
  const report = createMigrationReport({
    source: 'instagram-dm-unsender',
    sourceFiles: [sourceName],
  });
  report.inputCount = 0;
  report.importedCount = 0;
  report.duplicateCount = 0;
  report.skippedCount = 0;
  report.warnings.push(
    'Version 0.7.2 stores no durable queue, checkpoint, or message-identity records to migrate.',
  );
  report.manualCorrections.push(
    'Create reviewed DM jobs from imported sent-message data before using the adapted browser boundary.',
  );
  report.sourceRevision = INSTAGRAM_DM_UNSENDER_SOURCE.sha256;
  validateMigrationReport(report);
  return report;
}

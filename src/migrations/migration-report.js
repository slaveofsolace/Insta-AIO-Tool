export function createMigrationReport({
  source,
  sourceRevision,
  sourceFiles = [],
} = {}) {
  if (!source) throw new Error('Migration reports require a source.');
  return {
    schemaVersion: 1,
    source,
    sourceRevision: sourceRevision || null,
    sourceFiles: [...sourceFiles],
    inputCount: 0,
    importedCount: 0,
    duplicateCount: 0,
    skippedCount: 0,
    warnings: [],
    manualCorrections: [],
  };
}

export function migrationDispositionCount(report) {
  return Number(report?.importedCount || 0)
    + Number(report?.duplicateCount || 0)
    + Number(report?.skippedCount || 0);
}

export function validateMigrationReport(report) {
  if (!report || report.schemaVersion !== 1) {
    throw new Error('Unsupported migration report.');
  }
  if (migrationDispositionCount(report) !== report.inputCount) {
    throw new Error(
      `Migration disposition mismatch for ${report.source}: `
      + `${migrationDispositionCount(report)} of ${report.inputCount}.`,
    );
  }
  return report;
}

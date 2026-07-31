import { performance } from 'node:perf_hooks';

import { importFileRecords } from '../src/core/imports.js';
import { inspectZipArchive, readZipJsonRecords } from '../src/core/zip.js';
import { createZip } from '../tests/support/zip-fixture.js';

const fileCount = 100;
const messagesPerFile = 100;
const entries = [];

for (let fileIndex = 0; fileIndex < fileCount; fileIndex += 1) {
  const messages = [];
  for (let messageIndex = 0; messageIndex < messagesPerFile; messageIndex += 1) {
    messages.push({
      sender_name: messageIndex % 2 ? 'Friend Example' : 'Owner Example',
      timestamp_ms: 1_700_000_000_000 + (fileIndex * messagesPerFile) + messageIndex,
      content: `Benchmark message ${fileIndex}-${messageIndex}`,
      message_id: `benchmark-${fileIndex}-${messageIndex}`,
    });
  }
  entries.push({
    path: `your_instagram_activity/messages/inbox/benchmark/message_${fileIndex + 1}.json`,
    content: JSON.stringify({
      participants: [{ name: 'Owner Example' }, { name: 'Friend Example' }],
      messages,
      thread_path: 'inbox/benchmark',
    }),
  });
}

const archiveStartedAt = performance.now();
const archive = createZip(entries);
const archiveCreatedAt = performance.now();
const manifest = inspectZipArchive(archive);
const inspectedAt = performance.now();
const extracted = await readZipJsonRecords(archive, { manifest, batchSize: 8 });
const extractedAt = performance.now();
const imported = importFileRecords(extracted.records, {
  ownerNames: ['Owner Example'],
});
const importedAt = performance.now();

console.log(JSON.stringify({
  schemaVersion: 1,
  fixture: {
    files: fileCount,
    messages: fileCount * messagesPerFile,
    archiveBytes: archive.byteLength,
    uncompressedBytes: manifest.totalUncompressedBytes,
  },
  elapsedMilliseconds: {
    fixtureCreation: Math.round(archiveCreatedAt - archiveStartedAt),
    manifestInspection: Math.round(inspectedAt - archiveCreatedAt),
    extraction: Math.round(extractedAt - inspectedAt),
    normalization: Math.round(importedAt - extractedAt),
    totalImport: Math.round(importedAt - inspectedAt),
  },
  result: {
    importedMessages: imported.messages.length,
    warnings: imported.warnings.length,
  },
}, null, 2));

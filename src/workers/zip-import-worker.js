import { importFileRecords } from '../core/imports.js';
import { readZipJsonRecords } from '../core/zip.js';

self.addEventListener('message', async (event) => {
  if (event.data?.type !== 'import') return;

  try {
    const extracted = await readZipJsonRecords(event.data.buffer, {
      onProgress(progress) {
        self.postMessage({ type: 'progress', progress });
      },
    });
    const result = importFileRecords(extracted.records, {
      ownerNames: event.data.ownerNames || [],
    });
    self.postMessage({
      type: 'complete',
      payload: {
        manifest: extracted.manifest,
        recordCount: extracted.records.length,
        result,
      },
    });
  } catch (error) {
    self.postMessage({
      type: 'error',
      error: {
        name: error?.name || 'Error',
        code: error?.code || null,
        message: error?.message || String(error),
      },
    });
  }
});

import { importFileRecords } from '../core/imports.js';
import { readZipJsonRecords } from '../core/zip.js';

function abortError() {
  if (typeof DOMException === 'function') {
    return new DOMException('ZIP import canceled.', 'AbortError');
  }
  const error = new Error('ZIP import canceled.');
  error.name = 'AbortError';
  return error;
}

async function importOnMainThread(input, options) {
  const extracted = await readZipJsonRecords(input, {
    signal: options.signal,
    onProgress: options.onProgress,
  });
  return {
    manifest: extracted.manifest,
    recordCount: extracted.records.length,
    result: importFileRecords(extracted.records, {
      ownerNames: options.ownerNames,
    }),
    execution: 'main-thread-fallback',
  };
}

export async function importZipArchive(input, {
  ownerNames = [],
  signal,
  onProgress,
  workerFactory,
} = {}) {
  if (signal?.aborted) throw abortError();

  const bytes = input instanceof ArrayBuffer ? input : await input.arrayBuffer();
  if (signal?.aborted) throw abortError();

  if (typeof Worker !== 'function' && !workerFactory) {
    return importOnMainThread(bytes, { ownerNames, signal, onProgress });
  }

  const createWorker = workerFactory || (() => new Worker(
    new URL('../workers/zip-import-worker.js', import.meta.url),
    { type: 'module', name: 'insta-aio-zip-import' },
  ));
  const worker = createWorker();

  return new Promise((resolve, reject) => {
    let settled = false;

    const cleanup = () => {
      signal?.removeEventListener('abort', handleAbort);
      worker.terminate();
    };
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      cleanup();
      callback(value);
    };
    const handleAbort = () => finish(reject, abortError());

    signal?.addEventListener('abort', handleAbort, { once: true });
    worker.addEventListener('error', (event) => {
      finish(reject, new Error(event.message || 'ZIP import worker failed.'));
    });
    worker.addEventListener('message', (event) => {
      const message = event.data || {};
      if (message.type === 'progress') {
        onProgress?.(message.progress);
        return;
      }
      if (message.type === 'complete') {
        finish(resolve, {
          ...message.payload,
          execution: 'worker',
        });
        return;
      }
      if (message.type === 'error') {
        const error = new Error(message.error?.message || 'ZIP import failed.');
        error.name = message.error?.name || 'Error';
        error.code = message.error?.code;
        finish(reject, error);
      }
    });

    worker.postMessage({
      type: 'import',
      buffer: bytes,
      ownerNames,
    }, [bytes]);
  });
}

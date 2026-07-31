import {
  classifyImportPath,
  normalizeImportPath,
} from './import-classification.js';

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;
const UTF8_FLAG = 0x0800;
const ENCRYPTED_FLAGS = 0x0041;
const DATA_DESCRIPTOR_FLAG = 0x0008;

const DEFAULT_LIMITS = Object.freeze({
  maxEntries: 20_000,
  maxEntryBytes: 512 * 1024 * 1024,
  maxTotalUncompressedBytes: 2 * 1024 * 1024 * 1024,
});

export class ZipImportError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'ZipImportError';
    this.code = code;
  }
}

function toBytes(input) {
  if (input instanceof Uint8Array) return input;
  if (input instanceof ArrayBuffer) return new Uint8Array(input);
  if (ArrayBuffer.isView(input)) {
    return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
  }
  throw new ZipImportError('INVALID_INPUT', 'ZIP input must be binary data.');
}

function ensureRange(bytes, offset, length, label) {
  if (
    !Number.isSafeInteger(offset)
    || !Number.isSafeInteger(length)
    || offset < 0
    || length < 0
    || offset + length > bytes.byteLength
  ) {
    throw new ZipImportError('TRUNCATED_ARCHIVE', `${label} extends outside the ZIP archive.`);
  }
}

function readUint16(view, offset) {
  return view.getUint16(offset, true);
}

function readUint32(view, offset) {
  return view.getUint32(offset, true);
}

function findEndOfCentralDirectory(bytes, view) {
  const minimum = Math.max(0, bytes.byteLength - 22 - 0xffff);
  for (let offset = bytes.byteLength - 22; offset >= minimum; offset -= 1) {
    if (readUint32(view, offset) !== EOCD_SIGNATURE) continue;
    const commentLength = readUint16(view, offset + 20);
    if (offset + 22 + commentLength === bytes.byteLength) return offset;
  }
  throw new ZipImportError(
    'MISSING_CENTRAL_DIRECTORY',
    'The file is not a complete ZIP archive or its central directory is missing.',
  );
}

function decodePath(bytes, utf8) {
  if (utf8) return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  if (bytes.some((byte) => byte > 0x7f)) {
    throw new ZipImportError(
      'INVALID_PATH_ENCODING',
      'Non-ASCII ZIP paths must declare UTF-8 encoding.',
    );
  }
  return new TextDecoder('ascii', { fatal: true }).decode(bytes);
}

function safeArchivePath(rawPath) {
  const path = normalizeImportPath(rawPath);
  const segments = path.split('/');
  if (
    !path
    || path.includes('\0')
    || path.startsWith('/')
    || /^[a-z]:/i.test(path)
    || segments.some((segment) => segment === '..')
  ) {
    throw new ZipImportError('UNSAFE_PATH', `ZIP entry has an unsafe path: ${rawPath}`);
  }
  return path;
}

function dosDateTime(date, time) {
  if (!date) return null;
  const year = 1980 + ((date >> 9) & 0x7f);
  const month = (date >> 5) & 0x0f;
  const day = date & 0x1f;
  const hour = (time >> 11) & 0x1f;
  const minute = (time >> 5) & 0x3f;
  const second = (time & 0x1f) * 2;
  const value = Date.UTC(year, Math.max(0, month - 1), day, hour, minute, second);
  return Number.isNaN(value) ? null : new Date(value).toISOString();
}

let crcTable;

function getCrcTable() {
  if (crcTable) return crcTable;
  crcTable = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value & 1) ? (0xedb88320 ^ (value >>> 1)) : (value >>> 1);
    }
    crcTable[index] = value >>> 0;
  }
  return crcTable;
}

export function crc32(input) {
  const bytes = toBytes(input);
  const table = getCrcTable();
  let crc = 0xffffffff;
  for (const byte of bytes) crc = table[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function resolveLimits(overrides = {}) {
  const limits = { ...DEFAULT_LIMITS, ...overrides };
  for (const [name, value] of Object.entries(limits)) {
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new ZipImportError('INVALID_LIMIT', `ZIP limit ${name} must be a positive integer.`);
    }
  }
  return limits;
}

export function inspectZipArchive(input, { limits: limitOverrides } = {}) {
  const bytes = toBytes(input);
  if (bytes.byteLength < 22) {
    throw new ZipImportError('TRUNCATED_ARCHIVE', 'The ZIP archive is too small.');
  }
  const limits = resolveLimits(limitOverrides);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const eocdOffset = findEndOfCentralDirectory(bytes, view);
  const diskNumber = readUint16(view, eocdOffset + 4);
  const centralDisk = readUint16(view, eocdOffset + 6);
  const entriesOnDisk = readUint16(view, eocdOffset + 8);
  const entryCount = readUint16(view, eocdOffset + 10);
  const centralSize = readUint32(view, eocdOffset + 12);
  const centralOffset = readUint32(view, eocdOffset + 16);

  if (diskNumber !== 0 || centralDisk !== 0 || entriesOnDisk !== entryCount) {
    throw new ZipImportError('MULTI_DISK_UNSUPPORTED', 'Multi-disk ZIP archives are not supported.');
  }
  if (
    entryCount === 0xffff
    || centralSize === 0xffffffff
    || centralOffset === 0xffffffff
  ) {
    throw new ZipImportError('ZIP64_UNSUPPORTED', 'ZIP64 archives are not supported.');
  }
  if (entryCount > limits.maxEntries) {
    throw new ZipImportError(
      'TOO_MANY_ENTRIES',
      `ZIP contains ${entryCount} entries; the limit is ${limits.maxEntries}.`,
    );
  }

  ensureRange(bytes, centralOffset, centralSize, 'Central directory');
  const centralEnd = centralOffset + centralSize;
  if (centralEnd > eocdOffset) {
    throw new ZipImportError(
      'INVALID_CENTRAL_DIRECTORY',
      'The ZIP central directory overlaps its end record.',
    );
  }
  let cursor = centralOffset;
  let totalUncompressedBytes = 0;
  const entries = [];
  const seenPaths = new Set();

  for (let index = 0; index < entryCount; index += 1) {
    ensureRange(bytes, cursor, 46, `Central directory entry ${index}`);
    if (readUint32(view, cursor) !== CENTRAL_SIGNATURE) {
      throw new ZipImportError(
        'INVALID_CENTRAL_DIRECTORY',
        `Central directory entry ${index} has an invalid signature.`,
      );
    }

    const flags = readUint16(view, cursor + 8);
    const compressionMethod = readUint16(view, cursor + 10);
    const modifiedTime = readUint16(view, cursor + 12);
    const modifiedDate = readUint16(view, cursor + 14);
    const expectedCrc32 = readUint32(view, cursor + 16);
    const compressedSize = readUint32(view, cursor + 20);
    const uncompressedSize = readUint32(view, cursor + 24);
    const fileNameLength = readUint16(view, cursor + 28);
    const extraLength = readUint16(view, cursor + 30);
    const commentLength = readUint16(view, cursor + 32);
    const diskStart = readUint16(view, cursor + 34);
    const localHeaderOffset = readUint32(view, cursor + 42);
    const recordLength = 46 + fileNameLength + extraLength + commentLength;
    ensureRange(bytes, cursor, recordLength, `Central directory entry ${index}`);

    if (diskStart !== 0) {
      throw new ZipImportError('MULTI_DISK_UNSUPPORTED', 'Multi-disk ZIP entries are not supported.');
    }
    if (
      compressedSize === 0xffffffff
      || uncompressedSize === 0xffffffff
      || localHeaderOffset === 0xffffffff
    ) {
      throw new ZipImportError('ZIP64_UNSUPPORTED', 'ZIP64 entries are not supported.');
    }
    if (flags & ENCRYPTED_FLAGS) {
      throw new ZipImportError('ENCRYPTED_ARCHIVE', 'Encrypted ZIP archives are not supported.');
    }
    if (![0, 8].includes(compressionMethod)) {
      throw new ZipImportError(
        'UNSUPPORTED_COMPRESSION',
        `ZIP compression method ${compressionMethod} is not supported.`,
      );
    }
    if (uncompressedSize > limits.maxEntryBytes) {
      throw new ZipImportError(
        'ENTRY_TOO_LARGE',
        `ZIP entry ${index} exceeds the ${limits.maxEntryBytes}-byte entry limit.`,
      );
    }

    const fileNameBytes = bytes.subarray(cursor + 46, cursor + 46 + fileNameLength);
    let rawPath;
    try {
      rawPath = decodePath(fileNameBytes, Boolean(flags & UTF8_FLAG));
    } catch {
      throw new ZipImportError('INVALID_PATH_ENCODING', `ZIP entry ${index} has an invalid path.`);
    }
    const path = safeArchivePath(rawPath);
    const directory = path.endsWith('/');
    if (!directory) {
      if (seenPaths.has(path)) {
        throw new ZipImportError('DUPLICATE_PATH', `ZIP contains duplicate path: ${path}`);
      }
      seenPaths.add(path);
      totalUncompressedBytes += uncompressedSize;
      if (totalUncompressedBytes > limits.maxTotalUncompressedBytes) {
        throw new ZipImportError(
          'ARCHIVE_TOO_LARGE',
          `ZIP exceeds the ${limits.maxTotalUncompressedBytes}-byte uncompressed limit.`,
        );
      }
    }

    ensureRange(bytes, localHeaderOffset, 30, `Local header for ${path}`);
    if (readUint32(view, localHeaderOffset) !== LOCAL_SIGNATURE) {
      throw new ZipImportError('INVALID_LOCAL_HEADER', `ZIP entry has no valid local header: ${path}`);
    }
    const localFlags = readUint16(view, localHeaderOffset + 6);
    const localMethod = readUint16(view, localHeaderOffset + 8);
    const localNameLength = readUint16(view, localHeaderOffset + 26);
    const localExtraLength = readUint16(view, localHeaderOffset + 28);
    if (
      (localFlags & ENCRYPTED_FLAGS)
      || localMethod !== compressionMethod
      || Boolean(localFlags & UTF8_FLAG) !== Boolean(flags & UTF8_FLAG)
      || Boolean(localFlags & DATA_DESCRIPTOR_FLAG) !== Boolean(flags & DATA_DESCRIPTOR_FLAG)
    ) {
      throw new ZipImportError('LOCAL_HEADER_MISMATCH', `ZIP headers disagree for: ${path}`);
    }
    ensureRange(
      bytes,
      localHeaderOffset + 30,
      localNameLength + localExtraLength,
      `Local header fields for ${path}`,
    );
    const localNameBytes = bytes.subarray(
      localHeaderOffset + 30,
      localHeaderOffset + 30 + localNameLength,
    );
    if (
      localNameBytes.byteLength !== fileNameBytes.byteLength
      || localNameBytes.some((byte, byteIndex) => byte !== fileNameBytes[byteIndex])
    ) {
      throw new ZipImportError(
        'LOCAL_HEADER_MISMATCH',
        `ZIP headers disagree about the entry path: ${path}`,
      );
    }
    const dataOffset = localHeaderOffset + 30 + localNameLength + localExtraLength;
    ensureRange(bytes, dataOffset, compressedSize, `Compressed data for ${path}`);
    if (dataOffset + compressedSize > centralOffset) {
      throw new ZipImportError('OVERLAPPING_ENTRY', `ZIP entry overlaps its central directory: ${path}`);
    }

    if (!directory) {
      entries.push({
        path,
        kind: classifyImportPath(path),
        json: path.toLowerCase().endsWith('.json'),
        compressionMethod,
        compressedSize,
        uncompressedSize,
        crc32: expectedCrc32,
        dataOffset,
        lastModified: dosDateTime(modifiedDate, modifiedTime),
      });
    }
    cursor += recordLength;
  }

  if (cursor !== centralEnd) {
    throw new ZipImportError(
      'INVALID_CENTRAL_DIRECTORY',
      'The ZIP central directory size does not match its entries.',
    );
  }

  const counts = {
    totalFiles: entries.length,
    jsonFiles: 0,
    followers: 0,
    following: 0,
    messages: 0,
    legacy: 0,
    unknownJson: 0,
  };
  for (const entry of entries) {
    if (entry.json) counts.jsonFiles += 1;
    if (entry.kind === 'followers') counts.followers += 1;
    else if (entry.kind === 'following') counts.following += 1;
    else if (entry.kind === 'messages') counts.messages += 1;
    else if (entry.kind.startsWith('simple-')) counts.legacy += 1;
    else if (entry.kind === 'unknown-json') counts.unknownJson += 1;
  }

  return {
    schemaVersion: 1,
    kind: 'insta-aio-zip-manifest',
    entryCount,
    entries,
    counts,
    totalCompressedBytes: entries.reduce((sum, entry) => sum + entry.compressedSize, 0),
    totalUncompressedBytes,
  };
}

function abortIfNeeded(signal) {
  if (!signal?.aborted) return;
  if (typeof DOMException === 'function') throw new DOMException('ZIP import canceled.', 'AbortError');
  throw new ZipImportError('ABORTED', 'ZIP import canceled.');
}

function yieldToEventLoop() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

async function inflateRaw(compressed, expectedSize, { signal, maxEntryBytes }) {
  if (typeof DecompressionStream !== 'function') {
    throw new ZipImportError(
      'DEFLATE_UNAVAILABLE',
      'This browser cannot decompress standard ZIP entries offline.',
    );
  }
  const stream = new Blob([compressed])
    .stream()
    .pipeThrough(new DecompressionStream('deflate-raw'));
  const reader = stream.getReader();
  const chunks = [];
  let total = 0;
  let chunkCount = 0;
  try {
    for (;;) {
      abortIfNeeded(signal);
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxEntryBytes || total > expectedSize) {
        throw new ZipImportError('ENTRY_TOO_LARGE', 'ZIP entry expanded beyond its declared size.');
      }
      chunks.push(value);
      chunkCount += 1;
      if (chunkCount % 8 === 0) await yieldToEventLoop();
    }
  } finally {
    reader.releaseLock();
  }

  if (total !== expectedSize) {
    throw new ZipImportError(
      'SIZE_MISMATCH',
      `ZIP entry expanded to ${total} bytes; expected ${expectedSize}.`,
    );
  }
  const output = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}

async function readEntry(bytes, entry, options) {
  abortIfNeeded(options.signal);
  const compressed = bytes.subarray(
    entry.dataOffset,
    entry.dataOffset + entry.compressedSize,
  );
  const output = entry.compressionMethod === 0
    ? compressed.slice()
    : await inflateRaw(compressed, entry.uncompressedSize, options);

  if (output.byteLength !== entry.uncompressedSize) {
    throw new ZipImportError('SIZE_MISMATCH', `ZIP entry has the wrong size: ${entry.path}`);
  }
  if (crc32(output) !== entry.crc32) {
    throw new ZipImportError('CRC_MISMATCH', `ZIP entry failed its integrity check: ${entry.path}`);
  }
  return output;
}

export async function readZipJsonRecords(input, {
  manifest = null,
  limits: limitOverrides,
  signal,
  onProgress,
  batchSize = 4,
} = {}) {
  const bytes = toBytes(input);
  const limits = resolveLimits(limitOverrides);
  const inspected = manifest || inspectZipArchive(bytes, { limits });
  const entries = inspected.entries.filter((entry) => entry.json);
  const records = [];

  for (let index = 0; index < entries.length; index += 1) {
    abortIfNeeded(signal);
    const entry = entries[index];
    const content = await readEntry(bytes, entry, {
      signal,
      maxEntryBytes: limits.maxEntryBytes,
    });
    let text;
    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(content);
    } catch {
      throw new ZipImportError('INVALID_JSON_ENCODING', `JSON is not UTF-8: ${entry.path}`);
    }
    records.push({
      name: entry.path,
      text: text.replace(/^\ufeff/, ''),
      lastModified: entry.lastModified == null ? 0 : new Date(entry.lastModified).getTime(),
      archive: true,
    });
    onProgress?.({
      phase: 'extract',
      processed: index + 1,
      total: entries.length,
      path: entry.path,
    });
    if ((index + 1) % Math.max(1, batchSize) === 0) await yieldToEventLoop();
  }

  return { manifest: inspected, records };
}

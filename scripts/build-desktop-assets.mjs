import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { deflateSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outputRoot = path.join(repositoryRoot, 'dist', 'branding');
const assetsRoot = path.join(repositoryRoot, 'assets');

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const typeBuffer = Buffer.from(type, 'ascii');
  const result = Buffer.alloc(12 + data.length);
  result.writeUInt32BE(data.length, 0);
  typeBuffer.copy(result, 4);
  data.copy(result, 8);
  result.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 8 + data.length);
  return result;
}

function insideRoundedSquare(x, y, left, top, right, bottom, radius) {
  const nearestX = Math.max(left + radius, Math.min(x, right - radius));
  const nearestY = Math.max(top + radius, Math.min(y, bottom - radius));
  return (
    x >= left
    && x <= right
    && y >= top
    && y <= bottom
    && Math.hypot(x - nearestX, y - nearestY) <= radius
  );
}

function iconPixels(size) {
  const scale = size / 512;
  const scanlines = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y += 1) {
    const row = y * (size * 4 + 1);
    scanlines[row] = 0;
    for (let x = 0; x < size; x += 1) {
      const index = row + 1 + x * 4;
      let color = [16, 17, 20, 255];
      if (insideRoundedSquare(x, y, 34 * scale, 34 * scale, 477 * scale, 477 * scale, 92 * scale)) {
        color = [25, 28, 34, 255];
      }
      const radius = Math.hypot(x - 256 * scale, y - 256 * scale);
      if (radius >= 156 * scale && radius <= 184 * scale) color = [190, 241, 82, 255];
      if (x >= 151 * scale && x <= 191 * scale && y >= 145 * scale && y <= 367 * scale) {
        color = [243, 244, 246, 255];
      }
      const leftDiagonal = Math.abs((x - 252 * scale) - (367 * scale - y) * .56) <= 21 * scale;
      const rightDiagonal = Math.abs((x - 252 * scale) + (367 * scale - y) * .56) <= 21 * scale;
      if (y >= 145 * scale && y <= 367 * scale && (leftDiagonal || rightDiagonal)) {
        color = [243, 244, 246, 255];
      }
      if (y >= 267 * scale && y <= 301 * scale && x >= 260 * scale && x <= 363 * scale) {
        color = [243, 244, 246, 255];
      }
      scanlines.set(color, index);
    }
  }
  return scanlines;
}

function png(size) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8;
  header[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(iconPixels(size), { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function ico(pngBuffer) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(1, 4);
  const entry = Buffer.alloc(16);
  entry[0] = 0;
  entry[1] = 0;
  entry[2] = 0;
  entry[3] = 0;
  entry.writeUInt16LE(1, 4);
  entry.writeUInt16LE(32, 6);
  entry.writeUInt32LE(pngBuffer.length, 8);
  entry.writeUInt32LE(22, 12);
  return Buffer.concat([header, entry, pngBuffer]);
}

const resolvedOutput = path.resolve(outputRoot);
const resolvedDist = path.resolve(repositoryRoot, 'dist');
if (!resolvedOutput.startsWith(`${resolvedDist}${path.sep}`)) {
  throw new Error('Desktop branding output must remain inside the repository dist directory.');
}
await mkdir(resolvedOutput, { recursive: true });
await mkdir(assetsRoot, { recursive: true });
const pngBuffer = png(512);
await writeFile(path.join(outputRoot, 'icon.png'), pngBuffer);
await writeFile(path.join(outputRoot, 'icon.ico'), ico(pngBuffer));
await writeFile(path.join(assetsRoot, 'icon-512.png'), pngBuffer);
await writeFile(path.join(assetsRoot, 'icon-192.png'), png(192));
console.log(`Built desktop icons in ${path.relative(repositoryRoot, outputRoot)}.`);

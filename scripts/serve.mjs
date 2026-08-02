import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import {
  isAllowedAssetPath,
  isAllowedLoopbackHost,
} from './static-asset-policy.mjs';

const modulePath = fileURLToPath(import.meta.url);
const repositoryRoot = path.resolve(path.dirname(modulePath), '..');

function contentType(filePath) {
  return {
    '.css': 'text/css; charset=utf-8',
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.jsfrag': 'text/plain; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.svg': 'image/svg+xml',
    '.webmanifest': 'application/manifest+json; charset=utf-8',
  }[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
}

export function createAppServer({ rootDirectory = repositoryRoot } = {}) {
  const root = path.resolve(rootDirectory);
  return createServer(async (request, response) => {
    if (!isAllowedLoopbackHost(request.headers.host)) {
      response.writeHead(421).end('Misdirected request');
      return;
    }
    const url = new URL(request.url || '/', 'http://127.0.0.1');
    let pathname;
    try {
      pathname = decodeURIComponent(url.pathname);
    } catch {
      response.writeHead(400).end('Bad request');
      return;
    }
    const relative = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
    if (!isAllowedAssetPath(relative)) {
      response.writeHead(404).end('Not found');
      return;
    }
    const filePath = path.resolve(root, relative);
    if (filePath !== root && !filePath.startsWith(`${root}${path.sep}`)) {
      response.writeHead(404).end('Not found');
      return;
    }
    try {
      const info = await stat(filePath);
      if (!info.isFile()) throw new Error('Not a file');
      const body = await readFile(filePath);
      response.writeHead(200, {
        'Content-Type': contentType(filePath),
        'Cache-Control': 'no-cache',
        'Content-Security-Policy': "frame-ancestors 'none'",
        'X-Frame-Options': 'DENY',
        'X-Content-Type-Options': 'nosniff',
      });
      response.end(body);
    } catch {
      response.writeHead(404).end('Not found');
    }
  });
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (invokedPath && invokedPath.toLowerCase() === modulePath.toLowerCase()) {
  const port = Math.max(1, Math.min(65535, Number(process.env.PORT || 4173)));
  const server = createAppServer();
  server.listen(port, '127.0.0.1', () => {
    console.log(`Insta AIO Tool is available at http://127.0.0.1:${port}`);
  });
}

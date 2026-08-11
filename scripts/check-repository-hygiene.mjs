import { execFile } from 'node:child_process';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, '..');
const execFileAsync = promisify(execFile);
const imageExtensions = new Set(['.jpeg', '.jpg', '.png']);
const textExtensions = new Set([
  '', '.css', '.html', '.ini', '.js', '.json', '.md', '.mjs', '.svg',
  '.toml', '.txt', '.webmanifest', '.yaml', '.yml',
]);
const allowedEmails = new Set([
  'i@izs.me', // Package-maintainer metadata in pnpm-lock.yaml.
]);
const internalArtifactTerms = [
  `human-${'cortex'}`,
  `human-${'eye'}`,
  `${'Codex'}-Handoff`,
  `current ${'Codex'} task`,
  `${'ChatGPT'} Pro`,
  `cross-${'task'} coordination steer`,
];

const problems = [];

function lineNumber(source, index) {
  return source.slice(0, index).split('\n').length;
}

function recordMatches(relativePath, source, label, expression, allow = () => false) {
  expression.lastIndex = 0;
  for (const match of source.matchAll(expression)) {
    if (allow(match[0])) continue;
    problems.push(`${relativePath}:${lineNumber(source, match.index)} ${label}`);
  }
}

function inspectText(relativePath, source) {
  recordMatches(
    relativePath,
    source,
    'contains a local Windows user path',
    /[A-Za-z]:[\\/]Users[\\/][^\\/\s"'<>]+/g,
  );
  recordMatches(
    relativePath,
    source,
    'contains a local Unix user path',
    /\/(?:Users|home)\/[^/\s"'<>]+/g,
  );
  recordMatches(
    relativePath,
    source,
    'contains an unexpected email address',
    /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi,
    (value) => allowedEmails.has(value.toLowerCase())
      || value.toLowerCase().endsWith('@users.noreply.github.com'),
  );
  recordMatches(relativePath, source, 'contains a private key', /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/g);
  recordMatches(relativePath, source, 'contains a GitHub token', /\bgh[pousr]_[A-Za-z0-9_]{20,}\b/g);
  recordMatches(relativePath, source, 'contains an AWS access key', /\bAKIA[0-9A-Z]{16}\b/g);
  recordMatches(relativePath, source, 'contains a JWT-like credential', /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g);
  recordMatches(
    relativePath,
    source,
    'contains an assigned credential-like value',
    /\b(?:api[_-]?key|client[_-]?secret|access[_-]?token|refresh[_-]?token|password)\s*[:=]\s*["'][^"'\r\n]{8,}["']/gi,
    (value) => value.includes('not-allowed'),
  );

  const lowerSource = source.toLowerCase();
  for (const term of internalArtifactTerms) {
    if (lowerSource.includes(term.toLowerCase())) {
      problems.push(`${relativePath} contains internal work-log language: ${term}`);
    }
  }
}

function inspectPng(relativePath, buffer) {
  const signature = buffer.subarray(1, 4).toString('ascii');
  if (signature !== 'PNG') {
    problems.push(`${relativePath} has an invalid PNG signature`);
    return;
  }

  for (let offset = 8; offset + 12 <= buffer.length;) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.subarray(offset + 4, offset + 8).toString('ascii');
    if (['eXIf', 'iTXt', 'tEXt', 'zTXt'].includes(type)) {
      problems.push(`${relativePath} contains a ${type} metadata chunk`);
    }
    offset += length + 12;
  }
}

function inspectJpeg(relativePath, buffer) {
  if (buffer[0] !== 0xff || buffer[1] !== 0xd8) {
    problems.push(`${relativePath} has an invalid JPEG signature`);
    return;
  }
  if (buffer.includes(Buffer.from('Exif\0\0'))
      || buffer.includes(Buffer.from('<x:xmpmeta'))
      || buffer.includes(Buffer.from('Photoshop 3.0'))) {
    problems.push(`${relativePath} contains EXIF, XMP, or Photoshop metadata`);
  }
}

const { stdout: trackedOutput } = await execFileAsync(
  process.env.GIT || 'git',
  ['ls-files', '-z'],
  { cwd: repositoryRoot, encoding: 'utf8', maxBuffer: 5 * 1024 * 1024 },
);
const trackedFiles = trackedOutput.split('\0').filter(Boolean).map((relativePath) => ({
  absolutePath: path.join(repositoryRoot, ...relativePath.split('/')),
  relativePath,
}));

for (const file of trackedFiles) {
  const extension = path.extname(file.relativePath).toLowerCase();
  if (imageExtensions.has(extension)) {
    const buffer = await readFile(file.absolutePath);
    if (extension === '.png') inspectPng(file.relativePath, buffer);
    else inspectJpeg(file.relativePath, buffer);
    continue;
  }
  if (!textExtensions.has(extension)) continue;
  if ((await stat(file.absolutePath)).size > 5 * 1024 * 1024) continue;
  inspectText(file.relativePath, await readFile(file.absolutePath, 'utf8'));
}

if (problems.length) {
  console.error('Repository hygiene check failed:');
  for (const problem of problems) console.error(`- ${problem}`);
  process.exitCode = 1;
} else {
  console.log('Repository hygiene check passed.');
}

import {
  app,
  BrowserWindow,
  protocol,
  shell,
} from 'electron';
import {
  cp,
  mkdir,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';

const SCHEME = 'insta-aio';
const HOST = 'app';
const PRODUCT_DATA_DIRECTORY = 'Insta AIO Tool';
const BACKUP_DIRECTORY = 'Insta AIO Tool Backups';
const BACKUP_RETENTION = 5;
const BACKUP_PATHS = [
  'IndexedDB',
  'Local Storage',
  'Session Storage',
  'databases',
];

protocol.registerSchemesAsPrivileged([{
  scheme: SCHEME,
  privileges: {
    standard: true,
    secure: true,
    supportFetchAPI: true,
    corsEnabled: true,
    stream: true,
    serviceWorkers: true,
  },
}]);

const appDataRoot = app.getPath('appData');
const userDataRoot = path.join(appDataRoot, PRODUCT_DATA_DIRECTORY);
const backupRoot = path.join(appDataRoot, BACKUP_DIRECTORY);
app.setPath('userData', userDataRoot);

const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) app.quit();

function contentType(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  return {
    '.css': 'text/css; charset=utf-8',
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.jsfrag': 'text/plain; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.webmanifest': 'application/manifest+json; charset=utf-8',
  }[extension] || 'application/octet-stream';
}

function contentSecurityPolicy() {
  return [
    "default-src 'self'",
    "script-src 'self' blob:",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "connect-src 'self'",
    "worker-src 'self' blob:",
    "manifest-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "frame-ancestors 'none'",
    "form-action 'none'",
  ].join('; ');
}

async function assetResponse(request) {
  const url = new URL(request.url);
  if (url.hostname !== HOST || !['GET', 'HEAD'].includes(request.method)) {
    return new Response('Not found', { status: 404 });
  }
  let pathname;
  try {
    pathname = decodeURIComponent(url.pathname);
  } catch {
    return new Response('Bad request', { status: 400 });
  }
  const relativePath = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  const appRoot = path.resolve(app.getAppPath());
  const filePath = path.resolve(appRoot, relativePath);
  if (filePath !== appRoot && !filePath.startsWith(`${appRoot}${path.sep}`)) {
    return new Response('Not found', { status: 404 });
  }
  try {
    const info = await stat(filePath);
    if (!info.isFile()) return new Response('Not found', { status: 404 });
    const body = request.method === 'HEAD' ? null : await readFile(filePath);
    return new Response(body, {
      status: 200,
      headers: {
        'Content-Type': contentType(filePath),
        'Content-Security-Policy': contentSecurityPolicy(),
        'Cross-Origin-Resource-Policy': 'same-origin',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch {
    return new Response('Not found', { status: 404 });
  }
}

function timestampName(now = new Date()) {
  return `backup-${now.toISOString().replace(/[:.]/g, '-')}`;
}

async function exists(target) {
  try {
    await stat(target);
    return true;
  } catch {
    return false;
  }
}

async function createStartupBackup() {
  const available = [];
  for (const relativePath of BACKUP_PATHS) {
    if (await exists(path.join(userDataRoot, relativePath))) available.push(relativePath);
  }
  if (!available.length) return null;

  await mkdir(backupRoot, { recursive: true });
  const destination = path.join(backupRoot, timestampName());
  await mkdir(destination, { recursive: false });
  for (const relativePath of available) {
    await cp(
      path.join(userDataRoot, relativePath),
      path.join(destination, relativePath),
      { recursive: true, errorOnExist: true },
    );
  }
  await writeFile(path.join(destination, 'backup.json'), JSON.stringify({
    schemaVersion: 1,
    kind: 'insta-aio-desktop-startup-backup',
    createdAt: new Date().toISOString(),
    appVersion: app.getVersion(),
    paths: available,
  }, null, 2));

  const entries = (await readdir(backupRoot, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory() && entry.name.startsWith('backup-'))
    .map((entry) => entry.name)
    .sort()
    .reverse();
  for (const stale of entries.slice(BACKUP_RETENTION)) {
    const target = path.resolve(backupRoot, stale);
    if (target.startsWith(`${path.resolve(backupRoot)}${path.sep}`)) {
      await rm(target, { recursive: true, force: true });
    }
  }
  return destination;
}

function allowExternalUrl(rawUrl) {
  try {
    const url = new URL(rawUrl);
    return url.protocol === 'https:' && url.hostname === 'www.instagram.com';
  } catch {
    return false;
  }
}

function createWindow() {
  const window = new BrowserWindow({
    width: 1320,
    height: 860,
    minWidth: 820,
    minHeight: 620,
    show: false,
    backgroundColor: '#101114',
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      spellcheck: false,
    },
  });

  window.webContents.setWindowOpenHandler(({ url }) => {
    if (allowExternalUrl(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  window.webContents.on('will-navigate', (event, url) => {
    if (new URL(url).protocol !== `${SCHEME}:`) event.preventDefault();
  });
  window.once('ready-to-show', () => window.show());
  void window.loadURL(`${SCHEME}://${HOST}/`);
  return window;
}

if (hasSingleInstanceLock) {
  app.on('second-instance', () => {
    const window = BrowserWindow.getAllWindows()[0];
    if (!window) return;
    if (window.isMinimized()) window.restore();
    window.focus();
  });

  app.whenReady().then(async () => {
    protocol.handle(SCHEME, assetResponse);
    const session = (await import('electron')).session.defaultSession;
    session.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
    session.setPermissionCheckHandler(() => false);
    try {
      await createStartupBackup();
    } catch (error) {
      console.error('Unable to create startup backup:', error.message);
    }
    createWindow();
    app.on('activate', () => {
      if (!BrowserWindow.getAllWindows().length) createWindow();
    });
  });
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

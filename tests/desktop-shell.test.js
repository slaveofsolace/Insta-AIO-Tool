import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const main = await readFile(new URL('../desktop/main.mjs', import.meta.url), 'utf8');
const packageJson = JSON.parse(await readFile(
  new URL('../package.json', import.meta.url),
  'utf8',
));

test('desktop shell isolates the renderer and denies browser permissions', () => {
  assert.match(main, /contextIsolation: true/);
  assert.match(main, /nodeIntegration: false/);
  assert.match(main, /sandbox: true/);
  assert.match(main, /webSecurity: true/);
  assert.match(main, /setPermissionRequestHandler/);
  assert.match(main, /callback\(false\)/);
  assert.doesNotMatch(main, /executeJavaScript/);
});

test('desktop protocol confines assets and applies a restrictive content policy', () => {
  assert.match(main, /filePath\.startsWith/);
  assert.match(main, /Content-Security-Policy/);
  assert.match(main, /object-src 'none'/);
  assert.match(main, /frame-ancestors 'none'/);
  assert.match(main, /hostname === 'www\.instagram\.com'/);
});

test('desktop package retains local data and creates bounded startup backups', () => {
  assert.match(main, /BACKUP_RETENTION = 5/);
  assert.match(main, /createStartupBackup/);
  assert.equal(packageJson.build.nsis.deleteAppDataOnUninstall, false);
  assert.equal(packageJson.build.asar, true);
  assert.deepEqual(packageJson.build.win.target[0].arch, ['x64']);
  assert.deepEqual(packageJson.build.mac.target, ['dmg', 'zip']);
});

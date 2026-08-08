import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
const runner = await readFile(
  new URL('../scripts/run-extension-acceptance.mjs', import.meta.url),
  'utf8',
);
const acceptance = await readFile(
  new URL('../scripts/extension-acceptance.mjs', import.meta.url),
  'utf8',
);
const chromeAcceptance = await readFile(
  new URL('../scripts/chrome-pairing-acceptance.mjs', import.meta.url),
  'utf8',
);
const overlayQa = await readFile(new URL('../scripts/overlay-qa.mjs', import.meta.url), 'utf8');
const overlayQaRunner = await readFile(
  new URL('../scripts/run-overlay-qa.mjs', import.meta.url),
  'utf8',
);
const fixture = await readFile(
  new URL('./fixtures/overlay-preview.html', import.meta.url),
  'utf8',
);
const desktop = await readFile(new URL('../desktop/main.mjs', import.meta.url), 'utf8');
const macVerifier = await readFile(
  new URL('../scripts/verify-macos-package.mjs', import.meta.url),
  'utf8',
);
const macEntitlements = await readFile(
  new URL('../build/entitlements.mac.plist', import.meta.url),
  'utf8',
);
const macQaEntitlements = await readFile(
  new URL('../build/entitlements.mac.qa.plist', import.meta.url),
  'utf8',
);
const workflow = await readFile(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8');

test('isolated Chromium acceptance executes production account and DM DOM chains', () => {
  assert.equal(packageJson.scripts['qa:extension'], 'node scripts/run-extension-acceptance.mjs');
  assert.match(runner, /spawn\(\s*electronPath/);
  assert.match(runner, /INSTA_AIO_ACCEPTANCE_NO_SANDBOX === '1'/);
  assert.match(runner, /hostedLinuxNoSandbox \? \['--no-sandbox'\]/);
  assert.match(runner, /INSTA_AIO_EXTENSION_ACCEPTANCE_USER_DATA/);
  assert.match(runner, /await rm\(userDataRoot/);
  assert.match(acceptance, /acceptProfileAction/);
  assert.match(acceptance, /action: 'follow'/);
  assert.match(acceptance, /action: 'unfollow'/);
  assert.match(acceptance, /acceptDmUnsend/);
  assert.match(acceptance, /insta-aio-perform-reviewed-profile-action/);
  assert.match(acceptance, /insta-aio-perform-reviewed-dm-unsend/);
  assert.match(acceptance, /dm-resolution-expired-or-changed/);
  assert.match(fixture, /fixtureMode === 'messages-live'/);
  assert.match(fixture, /aria-controls="fixture-dm-menu"/);
  assert.match(fixture, /aria-labelledby', choice\.id/);
  assert.doesNotMatch(acceptance, /https:\/\/www\.instagram\.com/);
});

test('browser acceptance covers accessibility, installability, and read-only pairing defaults', () => {
  assert.match(acceptance, /Accessibility\.getFullAXTree/);
  assert.match(acceptance, /Insta AIO Instagram sidecar/);
  assert.match(acceptance, /sidecar collapse and focus restoration/);
  assert.match(acceptance, /navigator\.serviceWorker\.ready/);
  assert.match(acceptance, /manifest\.display/);
  assert.match(acceptance, /actionPermission: false, liveAccount: false, liveDm: false/);
  assert.match(acceptance, /permissions, 'read'/);
  assert.match(acceptance, /setPermissionCheckHandler\(\(\) => false\)/);
  assert.match(acceptance, /setPermissionRequestHandler/);
});

test('Chrome acceptance loads and pairs the real extension through the restricted DevTools pipe', () => {
  assert.equal(
    packageJson.scripts['qa:chrome'],
    'node scripts/build-extension.mjs && node scripts/chrome-pairing-acceptance.mjs',
  );
  assert.match(chromeAcceptance, /process\.env\.CHROME_BIN/);
  assert.match(chromeAcceptance, /'chrome-acceptance'/);
  assert.match(chromeAcceptance, /--enable-unsafe-extension-debugging/);
  assert.match(chromeAcceptance, /--remote-debugging-pipe/);
  assert.match(chromeAcceptance, /Extensions\.loadUnpacked/);
  assert.match(chromeAcceptance, /Target\.attachToTarget/);
  assert.doesNotMatch(chromeAcceptance, /--disable-extensions-except=/);
  assert.doesNotMatch(chromeAcceptance, /--load-extension=/);
  assert.match(chromeAcceptance, /INSTA_AIO_CHROME_ACCEPTANCE_NO_SANDBOX === '1'/);
  assert.match(chromeAcceptance, /chromeArguments\.unshift\('--no-sandbox'\)/);
  assert.match(chromeAcceptance, /Page\.getAppManifest/);
  assert.match(chromeAcceptance, /Page\.getInstallabilityErrors/);
  assert.match(chromeAcceptance, /complete-extension-pairing/);
  assert.match(chromeAcceptance, /Extension 0.10.4 connected/);
  assert.match(chromeAcceptance, /permissions, \['read'\]/);
  assert.match(chromeAcceptance, /await rm\(resolvedResultsRoot/);
  assert.match(
    workflow,
    /browser-actions\/setup-chrome@2e1d749697dd1612b833dba4a722266286fbefcd/,
  );
  assert.match(workflow, /CHROME_BIN: \$\{\{ steps\.setup-chrome\.outputs\.chrome-path \}\}/);
  assert.match(workflow, /xvfb-run --auto-servernum pnpm run qa:chrome/);
  assert.match(workflow, /INSTA_AIO_ACCEPTANCE_NO_SANDBOX: "1"/);
  assert.match(workflow, /INSTA_AIO_CHROME_ACCEPTANCE_NO_SANDBOX: "1"/);
  assert.match(workflow, /Upload tested browser companions/);
  assert.match(
    workflow,
    /insta-aio-browser-companions-\$\{\{ github\.event\.pull_request\.head\.sha \|\| github\.sha \}\}/,
  );
  assert.match(workflow, /dist\/insta-aio-companion-\*\.zip/);
  assert.match(workflow, /userscripts\/insta-aio-companion\.user\.js/);
});

test('CI checks reviewed overlay baselines on their native Windows platform', () => {
  assert.equal(
    packageJson.scripts['qa:overlay:check'],
    'pnpm run build:extension && node scripts/run-overlay-qa.mjs --check',
  );
  assert.match(workflow, /overlay-windows:/);
  assert.match(workflow, /runs-on: windows-latest/);
  assert.match(workflow, /pnpm run qa:overlay:check/);
  assert.match(workflow, /INSTA_AIO_OVERLAY_QA_CI_WINDOWS_RASTER_TOLERANCE: "1"/);
  assert.match(workflow, /Upload failed overlay comparison evidence/);
  assert.match(workflow, /if: failure\(\)/);
  assert.doesNotMatch(workflow, /qa:overlay:update/);
});

test('overlay QA is loopback-confined and has bounded child-process cleanup', () => {
  assert.match(overlayQa, /server\.listen\(0, '127\.0\.0\.1'/);
  assert.match(overlayQa, /"connect-src 'none'"/);
  assert.match(overlayQa, /setPermissionCheckHandler\(\(\) => false\)/);
  assert.match(overlayQa, /setPermissionRequestHandler/);
  assert.match(overlayQa, /nodeIntegration: false/);
  assert.match(overlayQa, /sandbox: true/);
  assert.match(overlayQa, /webSecurity: true/);
  assert.match(overlayQa, /setWindowOpenHandler/);
  assert.match(overlayQa, /will-navigate/);
  assert.match(overlayQa, /assert\.equal\(queueResult\.renderedItems, 1/);
  assert.match(overlayQa, /difference\.changedPixels <= 1_500/);
  assert.match(overlayQa, /difference\.changedPixelRatio <= 0\.004/);
  assert.match(overlayQa, /difference\.changedPixels <= 4/);
  assert.match(overlayQa, /rasterProblems\.push/);
  assert.match(overlayQa, /assert\.deepEqual\(rasterProblems, \[\]/);
  assert.match(overlayQaRunner, /const childWatchdogMs = 5 \* 60 \* 1000/);
  assert.match(overlayQaRunner, /child\.kill\('SIGTERM'\)/);
  assert.match(overlayQaRunner, /child\.kill\('SIGKILL'\)/);
  assert.doesNotMatch(overlayQaRunner, /taskkill|killall|Stop-Process/i);
});

test('macOS CI builds and exercises the packaged lifecycle without release credentials', () => {
  assert.equal(packageJson.scripts['qa:mac-package'], 'node scripts/verify-macos-package.mjs');
  assert.match(desktop, /DESKTOP_SMOKE_TEST/);
  assert.match(desktop, /process\.env\.INSTA_AIO_DESKTOP_SMOKE_PARENT/);
  assert.match(desktop, /path\.basename\(configuredParent\) !== 'insta-aio-desktop-smoke-parent'/);
  assert.match(desktop, /mkdtempSync\(path\.join\(configuredParent, 'insta-aio-desktop-smoke-'\)\)/);
  assert.doesNotMatch(desktop, /insta-aio-desktop-smoke-\$\{process\.pid\}/);
  assert.match(desktop, /if \(!DESKTOP_SMOKE_TEST && process\.platform !== 'darwin'\) app\.quit\(\)/);
  assert.match(desktop, /Insta AIO desktop smoke test passed/);
  assert.doesNotMatch(desktop, /executeJavaScript/);
  assert.match(macVerifier, /process\.platform !== 'darwin'/);
  assert.match(macVerifier, /hdiutil/);
  assert.match(macVerifier, /codesign/);
  assert.match(macVerifier, /--entitlements', qaEntitlements/);
  assert.match(macVerifier, /--smoke-test/);
  assert.match(macVerifier, /INSTA_AIO_DESKTOP_SMOKE_PARENT: smokeParent/);
  assert.match(macVerifier, /await rm\(installedApp/);
  assert.match(macVerifier, /insta-aio-macos-package-/);
  assert.match(workflow, /package-macos:/);
  assert.match(workflow, /runs-on: macos-14/);
  assert.match(workflow, /CSC_IDENTITY_AUTO_DISCOVERY: "false"/);
  assert.match(workflow, /pnpm run qa:mac-package/);
  assert.equal(packageJson.build.mac.entitlements, 'build/entitlements.mac.plist');
  assert.equal(
    packageJson.build.mac.entitlementsInherit,
    'build/entitlements.mac.inherit.plist',
  );
  assert.match(macEntitlements, /com\.apple\.security\.cs\.allow-jit/);
  assert.doesNotMatch(macEntitlements, /disable-library-validation/);
  assert.match(macQaEntitlements, /com\.apple\.security\.cs\.allow-jit/);
  assert.match(macQaEntitlements, /com\.apple\.security\.cs\.disable-library-validation/);
  assert.match(
    workflow,
    /actions\/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02/,
  );
});

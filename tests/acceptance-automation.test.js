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
const macInheritedEntitlements = await readFile(
  new URL('../build/entitlements.mac.inherit.plist', import.meta.url),
  'utf8',
);
const workflow = await readFile(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8');
const pagesWorkflow = await readFile(
  new URL('../.github/workflows/pages.yml', import.meta.url),
  'utf8',
);
const releaseWorkflow = await readFile(
  new URL('../.github/workflows/release.yml', import.meta.url),
  'utf8',
);

test('isolated Chromium acceptance executes production account and DM DOM chains', () => {
  assert.equal(packageJson.scripts['qa:extension'], 'node scripts/run-extension-acceptance.mjs');
  assert.match(runner, /spawn\(\s*electronPath/);
  assert.match(runner, /INSTA_TOOLBOX_ACCEPTANCE_NO_SANDBOX === '1'/);
  assert.match(runner, /hostedLinuxNoSandbox \? \['--no-sandbox'\]/);
  assert.match(runner, /INSTA_TOOLBOX_EXTENSION_ACCEPTANCE_USER_DATA/);
  assert.match(runner, /await rm\(userDataRoot/);
  assert.match(acceptance, /const readinessTimeoutMs = 60_000/);
  assert.match(acceptance, /acceptProfileAction/);
  assert.match(acceptance, /action: 'follow'/);
  assert.match(acceptance, /action: 'unfollow'/);
  assert.match(acceptance, /acceptDmUnsend/);
  assert.match(acceptance, /insta-toolbox-perform-reviewed-profile-action/);
  assert.match(acceptance, /insta-toolbox-perform-reviewed-dm-unsend/);
  assert.match(acceptance, /dm-resolution-expired-or-changed/);
  assert.match(fixture, /fixtureMode === 'messages-live'/);
  assert.match(fixture, /aria-controls="fixture-dm-menu"/);
  assert.match(fixture, /aria-labelledby', choice\.id/);
  assert.match(acceptance, /isolatedSession\.protocol\.handle\('https'/);
  assert.match(acceptance, /url\.origin !== 'https:\/\/www\.instagram\.com'/);
  assert.match(acceptance, /return new Response\('Unexpected endpoint', \{ status: 500 \}\)/);
  assert.match(acceptance, /assert\.equal\(before\.dialogs, 0\)/);
  assert.match(acceptance, /assert\.equal\(before\.clicks, 0\)/);
  assert.doesNotMatch(acceptance, /net\.fetch|net\.request/);
});

test('browser acceptance covers accessibility, installability, and read-only pairing defaults', () => {
  assert.match(acceptance, /Accessibility\.getFullAXTree/);
  assert.match(acceptance, /Insta Toolbox/);
  assert.match(acceptance, /sidecar collapse and focus restoration/);
  assert.match(acceptance, /navigator\.serviceWorker\.ready/);
  assert.match(acceptance, /manifest\.display/);
  assert.match(acceptance, /actionPermission: false, globalLiveUnlocks: false/);
  assert.match(acceptance, /permissions, 'read'/);
  assert.match(acceptance, /setPermissionCheckHandler\(\(\) => false\)/);
  assert.match(acceptance, /setPermissionRequestHandler/);
  assert.match(acceptance, /async function resizeViewport/);
  assert.match(acceptance, /innerWidth === \$\{viewport\.width\} && innerHeight === \$\{viewport\.height\}/);
  assert.match(acceptance, /dispatchEvent\(new Event\('resize'\)\)/);
  assert.match(acceptance, /requestAnimationFrame\(\(\) => requestAnimationFrame/);
  assert.match(
    acceptance,
    /querySelector\('\[data-action="open-settings"\]'\)\.click\(\);[\s\S]*?requestAnimationFrame/,
  );
  assert.match(acceptance, /settingsBounds\.settings\.bottom <= settingsBounds\.cssViewport\.height/);
  assert.match(acceptance, /closedAfterOutsideClick, true/);
  assert.match(acceptance, /--ig-primary-text'[\s\S]*?waitForPageValue[\s\S]*?settled userscript dark-theme tokens/);
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
  assert.match(chromeAcceptance, /INSTA_TOOLBOX_CHROME_ACCEPTANCE_NO_SANDBOX === '1'/);
  assert.match(chromeAcceptance, /chromeArguments\.unshift\('--no-sandbox'\)/);
  assert.match(chromeAcceptance, /Page\.getAppManifest/);
  assert.match(chromeAcceptance, /Page\.getInstallabilityErrors/);
  assert.match(chromeAcceptance, /complete-extension-pairing/);
  assert.match(chromeAcceptance, /const extensionVersion = await prepareExtension\(\)/);
  assert.match(chromeAcceptance, /Extension \$\{extensionVersion\} connected/);
  assert.match(chromeAcceptance, /permissions, \['read'\]/);
  assert.match(chromeAcceptance, /await rm\(resolvedResultsRoot/);
  assert.match(
    workflow,
    /browser-actions\/setup-chrome@e574b4b3a21156ab45dd6b5f67e884fd26eed829/,
  );
  assert.match(workflow, /CHROME_BIN: \$\{\{ steps\.setup-chrome\.outputs\.chrome-path \}\}/);
  assert.match(workflow, /xvfb-run --auto-servernum pnpm run qa:chrome/);
  assert.match(workflow, /INSTA_TOOLBOX_ACCEPTANCE_NO_SANDBOX: "1"/);
  assert.match(workflow, /INSTA_TOOLBOX_CHROME_ACCEPTANCE_NO_SANDBOX: "1"/);
  assert.match(workflow, /Upload tested browser companions/);
  assert.match(
    workflow,
    /insta-toolbox-browser-companions-\$\{\{ github\.event\.pull_request\.head\.sha \|\| github\.sha \}\}/,
  );
  assert.match(workflow, /dist\/Insta-Toolbox-Extension-\*\.zip/);
  assert.match(workflow, /userscripts\/insta-toolbox\.user\.js/);
});

test('CI checks reviewed overlay baselines on their native Windows platform', () => {
  assert.equal(
    packageJson.scripts['qa:overlay:check'],
    'pnpm run build:extension && node scripts/run-overlay-qa.mjs --check',
  );
  assert.match(workflow, /overlay-windows:/);
  assert.match(workflow, /runs-on: windows-latest/);
  assert.match(workflow, /pnpm run qa:overlay:check/);
  assert.match(workflow, /INSTA_TOOLBOX_OVERLAY_QA_CI_WINDOWS_RASTER_TOLERANCE: "1"/);
  assert.match(workflow, /Upload failed Windows rendering evidence/);
  assert.match(workflow, /pnpm run qa:browser:check/);
  assert.match(workflow, /release-checksums:/);
  assert.match(workflow, /node scripts\/generate-release-checksums\.mjs/);
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
  assert.match(overlayQa, /prefers-color-scheme/);
  assert.match(overlayQaRunner, /const childWatchdogMs = 5 \* 60 \* 1000/);
  assert.match(overlayQaRunner, /TZ: 'UTC'/);
  assert.match(overlayQaRunner, /child\.kill\('SIGTERM'\)/);
  assert.match(overlayQaRunner, /child\.kill\('SIGKILL'\)/);
  assert.doesNotMatch(overlayQaRunner, /taskkill|killall|Stop-Process/i);
});

test('desktop CI builds and exercises confined packaged lifecycles without release credentials', () => {
  assert.equal(packageJson.scripts['qa:mac-package'], 'node scripts/verify-macos-package.mjs');
  assert.match(desktop, /DESKTOP_SMOKE_TEST/);
  assert.match(desktop, /process\.argv\.includes\('--smoke-test'\)/);
  assert.match(desktop, /process\.env\.INSTA_TOOLBOX_DESKTOP_SMOKE_TEST === '1'/);
  assert.match(desktop, /process\.env\.INSTA_TOOLBOX_DESKTOP_SMOKE_PARENT/);
  assert.match(desktop, /realpathSync\.native\(path\.resolve\(app\.getPath\('temp'\)\)\)/);
  assert.match(desktop, /path\.relative\(temporaryRoot, configuredParent\)/);
  assert.match(desktop, /!relativeParent/);
  assert.match(desktop, /relativeParent === '\.\.'/);
  assert.match(desktop, /relativeParent\.startsWith\(`\.\.\$\{path\.sep\}`\)/);
  assert.match(desktop, /path\.isAbsolute\(relativeParent\)/);
  assert.match(desktop, /path\.basename\(configuredParent\) !== 'insta-toolbox-desktop-smoke-parent'/);
  assert.match(desktop, /desktop smoke setup failed/);
  assert.match(desktop, /process\.exit\(1\)/);
  assert.match(desktop, /mkdtempSync\(path\.join\(configuredParent, 'insta-toolbox-desktop-smoke-'\)\)/);
  assert.doesNotMatch(desktop, /insta-toolbox-desktop-smoke-\$\{process\.pid\}/);
  assert.match(desktop, /if \(!DESKTOP_SMOKE_TEST && process\.platform !== 'darwin'\) app\.quit\(\)/);
  assert.match(desktop, /MAX_DESKTOP_LOAD_ATTEMPTS = 3/);
  assert.match(desktop, /dialog\.showMessageBox/);
  assert.match(desktop, /Accessibility\.getFullAXTree/);
  assert.match(desktop, /window\.webContents\.getTitle\(\)/);
  assert.match(desktop, /node\.name\?\.value === 'Overview'/);
  assert.match(desktop, /console-message/);
  assert.match(desktop, /Runtime\.exceptionThrown/);
  assert.match(desktop, /desktop startup failed/);
  assert.match(desktop, /Insta Toolbox desktop smoke test passed/);
  assert.doesNotMatch(desktop, /executeJavaScript/);
  assert.match(macVerifier, /process\.platform !== 'darwin'/);
  assert.match(macVerifier, /hdiutil/);
  assert.match(macVerifier, /codesign/);
  assert.match(macVerifier, /Signature=adhoc/);
  assert.match(macVerifier, /lipo/);
  assert.match(macVerifier, /\['arm64', 'x86_64'\]/);
  assert.match(macVerifier, /machOBinaries/);
  assert.match(macVerifier, /CFBundleIconFile/);
  assert.doesNotMatch(macVerifier, /--force|--sign|qaEntitlements/);
  assert.match(macVerifier, /--smoke-test/);
  assert.match(macVerifier, /INSTA_TOOLBOX_DESKTOP_SMOKE_PARENT: smokeParent/);
  assert.match(macVerifier, /await rm\(installedApp/);
  assert.match(macVerifier, /insta-toolbox-macos-package-/);
  assert.match(workflow, /package-macos:/);
  assert.match(workflow, /runs-on: macos-14/);
  assert.match(workflow, /CSC_IDENTITY_AUTO_DISCOVERY: "false"/);
  assert.match(workflow, /CSC_FOR_PULL_REQUEST: "true"/);
  assert.match(workflow, /ExtractAssociatedIcon\(\$installedExecutable\)/);
  assert.match(workflow, /accentPixels -lt 8/);
  assert.match(workflow, /\$env:INSTA_TOOLBOX_DESKTOP_SMOKE_TEST = '1'/);
  assert.match(workflow, /Remove-Item Env:INSTA_TOOLBOX_DESKTOP_SMOKE_TEST/);
  assert.match(workflow, /pnpm run qa:mac-package/);
  assert.equal(packageJson.build.mac.entitlements, 'build/entitlements.mac.plist');
  assert.equal(
    packageJson.build.mac.entitlementsInherit,
    'build/entitlements.mac.inherit.plist',
  );
  assert.equal(packageJson.build.mac.identity, '-');
  assert.equal(packageJson.build.mac.notarize, false);
  assert.deepEqual(packageJson.build.mac.target, [
    { target: 'dmg', arch: ['universal'] },
    { target: 'zip', arch: ['universal'] },
  ]);
  assert.equal(packageJson.build.win.artifactName, 'Insta-Toolbox-Setup-${version}.${ext}');
  assert.equal(packageJson.build.mac.artifactName, 'Insta-Toolbox-${version}-${arch}.${ext}');
  assert.equal(packageJson.build.nsis.differentialPackage, false);
  assert.match(workflow, /Updater blockmaps are not supported/);
  assert.doesNotMatch(workflow, /dist\/desktop\/\*\.blockmap/);
  assert.match(macEntitlements, /com\.apple\.security\.cs\.allow-jit/);
  assert.match(macEntitlements, /com\.apple\.security\.cs\.disable-library-validation/);
  assert.match(macInheritedEntitlements, /com\.apple\.security\.cs\.allow-jit/);
  assert.match(macInheritedEntitlements, /com\.apple\.security\.cs\.disable-library-validation/);
  assert.match(
    workflow,
    /actions\/upload-artifact@b7c566a772e6b6bfb58ed0dc250532a479d7789f/,
  );
});

test('Pages deploys only the tested artifact for the current main commit', () => {
  const freshnessGate = pagesWorkflow.indexOf('Verify the CI run is still current main');
  const firstDownload = pagesWorkflow.indexOf('Download tested web archive');
  assert.ok(freshnessGate >= 0 && freshnessGate < firstDownload);
  assert.match(pagesWorkflow, /github\.event\.workflow_run\.head_sha/);
  assert.match(pagesWorkflow, /git\/ref\/heads\/main/);
  assert.match(pagesWorkflow, /test "\$RUN_SHA" = "\$main_sha"/);
  assert.match(pagesWorkflow, /run-id: \$\{\{ github\.event\.workflow_run\.id \}\}/);
});

test('release promotion checksums the SBOM and promotes no updater blockmap', () => {
  assert.match(releaseWorkflow, /CI run is not for the current main commit/);
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(releaseWorkflow, /"\$event" = "push" \|\| "\$event" = "workflow_dispatch"/);
  assert.match(releaseWorkflow, /Generate SBOM for promoted files/);
  assert.match(releaseWorkflow, /sha256sum "Insta-Toolbox-\$\{\{ steps\.assets\.outputs\.version \}\}\.spdx\.json" >> SHA256SUMS\.txt/);
  assert.match(releaseWorkflow, /test "\$\(wc -l < SHA256SUMS\.txt\)" -eq 7/);
  assert.match(releaseWorkflow, /subject-checksums: release\/SHA256SUMS\.txt/);
  assert.doesNotMatch(releaseWorkflow, /\.blockmap/);
});

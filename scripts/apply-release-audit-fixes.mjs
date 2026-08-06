import { execFileSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';

const RELEASE_VERSION = '0.9.2';
const SELF = 'scripts/apply-release-audit-fixes.mjs';

function replaceOnce(source, before, after, label) {
  const first = source.indexOf(before);
  if (first < 0) throw new Error(`Unable to locate ${label}.`);
  const second = source.indexOf(before, first + before.length);
  if (second >= 0) throw new Error(`${label} is not unique.`);
  return `${source.slice(0, first)}${after}${source.slice(first + before.length)}`;
}

async function edit(path, transform) {
  const source = await readFile(path, 'utf8');
  const next = transform(source);
  if (next === source) throw new Error(`${path} was not changed.`);
  await writeFile(path, next.replaceAll('\r\n', '\n'));
}

await edit('extension/action-labels.js', (source) => replaceOnce(
  source,
  `  async function confirmUnsend(menuControl, row, signal, expectedThreadId, authorizationExpiresAt) {
    // Selecting Unsend must raise one new confirmation control. Pre-existing
    // dialogs and stale portalled buttons can never satisfy this step.
    const existing = new Set(
      [...document.querySelectorAll('[role="dialog"] button')].filter(isVisible),
    );
    const pending = waitForElement(
      document.body,
      () => {
        const candidates = [...document.querySelectorAll('[role="dialog"] button')]
          .filter(isVisible)
          .filter((candidate) => !existing.has(candidate));
        if (candidates.length > 1) return { ambiguous: true };
        return candidates.length === 1 ? { control: candidates[0] } : null;
      },
      signal,
      3_000,
    );`,
  `  function dialogControlHasUnsendLabel(control) {
    if (actionLabels.isDmUnsendLabel(visibleText(control))) return true;
    return [...control.querySelectorAll?.('span, div') || []].some((element) => (
      element.firstChild?.nodeType === 3
      && actionLabels.isDmUnsendLabel(visibleText(element))
    ));
  }

  function dialogUnsendCandidates(existing = new Set()) {
    return [...document.querySelectorAll(
      '[role="dialog"] button, [role="dialog"] [role="button"]',
    )]
      .filter(isVisible)
      .filter((candidate) => !existing.has(candidate))
      .filter(dialogControlHasUnsendLabel);
  }

  async function confirmUnsend(menuControl, row, signal, expectedThreadId, authorizationExpiresAt) {
    // A normal confirmation dialog may contain both Cancel and Unsend. Accept
    // exactly one newly surfaced, localized Unsend control while ignoring
    // unrelated dialog buttons and every control that pre-dated this step.
    const existing = new Set(
      [...document.querySelectorAll(
        '[role="dialog"] button, [role="dialog"] [role="button"]',
      )].filter(isVisible),
    );
    const pending = waitForElement(
      document.body,
      () => {
        const candidates = dialogUnsendCandidates(existing);
        if (candidates.length > 1) return { ambiguous: true };
        return candidates.length === 1 ? { control: candidates[0] } : null;
      },
      signal,
      3_000,
    );`,
  'thread-wide confirmation resolver',
));

await edit('tests/fixtures/dm-thread-fixture.html', (source) => {
  let next = replaceOnce(
    source,
    `    globalThis.fixtureUnsentCount = 0;
    globalThis.fixtureDecoyUnsendClicks = 0;`,
    `    globalThis.fixtureUnsentCount = 0;
    globalThis.fixtureCancelClicks = 0;
    globalThis.fixtureDecoyUnsendClicks = 0;`,
    'fixture counters',
  );
  next = replaceOnce(
    next,
    `      const confirm = document.createElement('button');
      confirm.textContent = 'Unsend';`,
    `      const cancel = document.createElement('button');
      cancel.textContent = 'Cancel';
      cancel.addEventListener('click', () => {
        globalThis.fixtureCancelClicks += 1;
        dialog.remove();
      });
      const confirm = document.createElement('button');
      confirm.textContent = 'Unsend';`,
    'two-button confirmation fixture',
  );
  return replaceOnce(
    next,
    `      dialog.append(confirm);
      document.body.append(dialog);`,
    `      dialog.append(cancel, confirm);
      document.body.append(dialog);`,
    'confirmation fixture controls',
  );
});

await edit('scripts/extension-acceptance.mjs', (source) => {
  let next = replaceOnce(
    source,
    `      rejected,
      fixtureDecoyUnsendClicks: globalThis.fixtureDecoyUnsendClicks,
      fixtureUnsentCount: globalThis.fixtureUnsentCount,`,
    `      rejected,
      fixtureCancelClicks: globalThis.fixtureCancelClicks,
      fixtureDecoyUnsendClicks: globalThis.fixtureDecoyUnsendClicks,
      fixtureUnsentCount: globalThis.fixtureUnsentCount,`,
    'thread fixture result fields',
  );
  next = replaceOnce(
    next,
    `  assert.match(outcome.rejected?.message || '', /Thread-specific live authorization is required/);
  assert.equal(outcome.fixtureDecoyUnsendClicks, 0, 'a stale document-global Unsend decoy is never activated');`,
    `  assert.match(outcome.rejected?.message || '', /Thread-specific live authorization is required/);
  assert.equal(outcome.fixtureCancelClicks, 0, 'the unrelated Cancel control is never activated');
  assert.equal(outcome.fixtureDecoyUnsendClicks, 0, 'a stale document-global Unsend decoy is never activated');`,
    'thread fixture assertions',
  );
  next = replaceOnce(
    next,
    `      labels: [...shadow.querySelectorAll('[data-view]')].map((element) => element.textContent.trim()),
      resizeCorners: [`,
    `      labels: [...shadow.querySelectorAll('[data-view]')].map((element) => element.textContent.trim()),
      tabs: [...shadow.querySelectorAll('[role="tab"]')].map((element) => ({
        controls: element.getAttribute('aria-controls'),
        selected: element.getAttribute('aria-selected'),
        tabIndex: element.tabIndex,
      })),
      panels: [...shadow.querySelectorAll('[role="tabpanel"]')].map((element) => ({
        id: element.id,
        labelledBy: element.getAttribute('aria-labelledby'),
      })),
      resizeCorners: [`,
    'userscript accessibility metrics',
  );
  return replaceOnce(
    next,
    `  assert.deepEqual(initial.labels, ['Checker', 'Follow', 'Unsend']);
  assert.deepEqual(initial.resizeCorners, [true, true], 'both resize corners exist');`,
    `  assert.deepEqual(initial.labels, ['Checker', 'Follow', 'Unsend']);
  assert.deepEqual(initial.tabs, [
    { controls: 'aio-panel-checker', selected: 'true', tabIndex: 0 },
    { controls: 'aio-panel-account', selected: 'false', tabIndex: -1 },
    { controls: 'aio-panel-messages', selected: 'false', tabIndex: -1 },
  ]);
  assert.deepEqual(initial.panels, [
    { id: 'aio-panel-checker', labelledBy: 'aio-tab-checker' },
    { id: 'aio-panel-account', labelledBy: 'aio-tab-account' },
    { id: 'aio-panel-messages', labelledBy: 'aio-tab-messages' },
  ]);
  assert.deepEqual(initial.resizeCorners, [true, true], 'both resize corners exist');`,
    'userscript accessibility assertions',
  );
});

await edit('userscripts/src/toolbox-shell.js', (source) => {
  let next = replaceOnce(
    source,
    `      <nav class="tabs" role="tablist" aria-label="Insta AIO userscript tools">
        <button class="tab" type="button" role="tab" data-view="checker" aria-selected="true" aria-selected="false" tabindex="-1">Checker</button>
        <button class="tab" type="button" role="tab" data-view="account" aria-selected="false" tabindex="-1">Follow</button>
        <button class="tab" type="button" role="tab" data-view="messages" aria-selected="false" tabindex="-1">Unsend</button>
      </nav>`,
    `      <nav class="tabs" role="tablist" aria-label="Insta AIO userscript tools">
        <button id="aio-tab-checker" class="tab" type="button" role="tab" data-view="checker" aria-controls="aio-panel-checker" aria-selected="true" tabindex="0">Checker</button>
        <button id="aio-tab-account" class="tab" type="button" role="tab" data-view="account" aria-controls="aio-panel-account" aria-selected="false" tabindex="-1">Follow</button>
        <button id="aio-tab-messages" class="tab" type="button" role="tab" data-view="messages" aria-controls="aio-panel-messages" aria-selected="false" tabindex="-1">Unsend</button>
      </nav>`,
    'userscript tablist markup',
  );
  next = replaceOnce(
    next,
    `<section class="view" role="tabpanel" data-panel="checker" hidden>`,
    `<section id="aio-panel-checker" class="view" role="tabpanel" aria-labelledby="aio-tab-checker" data-panel="checker" hidden>`,
    'checker panel relationship',
  );
  next = replaceOnce(
    next,
    `<section class="view" role="tabpanel" data-panel="account" hidden>`,
    `<section id="aio-panel-account" class="view" role="tabpanel" aria-labelledby="aio-tab-account" data-panel="account" hidden>`,
    'account panel relationship',
  );
  return replaceOnce(
    next,
    `<section class="view" role="tabpanel" data-panel="messages" hidden>`,
    `<section id="aio-panel-messages" class="view" role="tabpanel" aria-labelledby="aio-tab-messages" data-panel="messages" hidden>`,
    'messages panel relationship',
  );
});

await edit('tests/dm-thread-unsender.test.js', (source) => replaceOnce(
  source,
  `  assert.match(labelsSource, /function confirmUnsend\\(menuControl, row, signal, expectedThreadId, authorizationExpiresAt\\)/);
  assert.match(labelsSource, /function loadAllHistory\\(context, signal\\)/);`,
  `  assert.match(labelsSource, /function confirmUnsend\\(menuControl, row, signal, expectedThreadId, authorizationExpiresAt\\)/);
  assert.match(labelsSource, /function dialogUnsendCandidates\\(existing = new Set\\(\\)\\)/);
  assert.match(labelsSource, /filter\\(dialogControlHasUnsendLabel\\)/);
  assert.match(labelsSource, /function loadAllHistory\\(context, signal\\)/);`,
  'thread runner confirmation assertions',
));

await edit('tests/userscript-companion.test.js', (source) => replaceOnce(
  source,
  `test('the movable panel and local follower comparison are preserved', () => {`,
  `test('the userscript tablist exposes one selected tab and explicit panel relationships', () => {
  assert.doesNotMatch(shell, /aria-selected="true"\\s+aria-selected="false"/);
  assert.match(shell, /id="aio-tab-checker"[^>]*aria-controls="aio-panel-checker"[^>]*aria-selected="true"[^>]*tabindex="0"/);
  assert.match(shell, /id="aio-tab-account"[^>]*aria-controls="aio-panel-account"[^>]*aria-selected="false"[^>]*tabindex="-1"/);
  assert.match(shell, /id="aio-tab-messages"[^>]*aria-controls="aio-panel-messages"[^>]*aria-selected="false"[^>]*tabindex="-1"/);
  assert.match(shell, /id="aio-panel-checker"[^>]*aria-labelledby="aio-tab-checker"/);
  assert.match(shell, /id="aio-panel-account"[^>]*aria-labelledby="aio-tab-account"/);
  assert.match(shell, /id="aio-panel-messages"[^>]*aria-labelledby="aio-tab-messages"/);
});

test('the movable panel and local follower comparison are preserved', () => {`,
  'userscript tab relationship regression',
));

await edit('tests/extension-package.test.js', (source) => {
  let next = replaceOnce(
    source,
    `const manifest = JSON.parse(await readFile(
  new URL('../extension/manifest.json', import.meta.url),
  'utf8',
));`,
    `const manifest = JSON.parse(await readFile(
  new URL('../extension/manifest.json', import.meta.url),
  'utf8',
));
const packageMetadata = JSON.parse(await readFile(
  new URL('../package.json', import.meta.url),
  'utf8',
));
const userscriptMetadata = await readFile(
  new URL('../userscripts/src/metadata.txt', import.meta.url),
  'utf8',
);`,
    'release metadata fixtures',
  );
  return replaceOnce(
    next,
    `test('extension uses Manifest V3 without cookie or request interception permissions', () => {`,
    `test('desktop, extension, and userscript release versions stay aligned', () => {
  const userscriptVersion = userscriptMetadata.match(/@version\\s+(\\d+\\.\\d+\\.\\d+)/)?.[1];
  assert.equal(packageMetadata.version, manifest.version);
  assert.equal(userscriptVersion, manifest.version);
});

test('extension uses Manifest V3 without cookie or request interception permissions', () => {`,
    'release version regression',
  );
});

await edit('.github/workflows/ci.yml', (source) => replaceOnce(
  source,
  `  package-macos:
`,
  `  package-windows:
    runs-on: windows-latest
    env:
      CSC_IDENTITY_AUTO_DISCOVERY: "false"
    steps:
      - uses: actions/checkout@11d5960a326750d5838078e36cf38b85af677262 # v4
      - uses: actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020 # v4
        with:
          node-version: 22
      - name: Enable pnpm
        run: corepack enable
      - name: Install locked dependencies
        run: pnpm install --frozen-lockfile
      - name: Build Windows NSIS installer
        run: pnpm run dist:win -- --publish never
      - name: Verify Windows installer artifact
        shell: pwsh
        run: |
          $installers = @(Get-ChildItem -Path dist/desktop -Filter *.exe -File)
          if ($installers.Count -lt 1) {
            throw "No Windows installer was produced."
          }
          $installers | ForEach-Object { Write-Host $_.FullName }
      - name: Upload Windows installer
        uses: actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02 # v4.6.2
        with:
          name: insta-aio-windows-\${{ github.sha }}
          path: dist/desktop/*.exe
          if-no-files-found: error
          retention-days: 7

  package-macos:
`,
  'Windows package job',
));

const packagePath = 'package.json';
const packageMetadata = JSON.parse(await readFile(packagePath, 'utf8'));
packageMetadata.version = RELEASE_VERSION;
await writeFile(packagePath, `${JSON.stringify(packageMetadata, null, 2)}\n`);

const tracked = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' })
  .split('\0')
  .filter(Boolean);
const textExtensions = /\.(?:html|js|json|md|mjs|txt|yml|yaml)$/i;
for (const path of tracked) {
  if (
    path === SELF
    || path === 'package.json'
    || path === 'userscripts/insta-aio-companion.user.js'
    || path.startsWith('docs/evidence/')
    || !textExtensions.test(path)
  ) continue;
  const source = await readFile(path, 'utf8');
  const next = source
    .replaceAll('0.9.1', RELEASE_VERSION)
    .replaceAll('191/191', '193/193')
    .replaceAll('191-test', '193-test');
  if (next !== source) await writeFile(path, next.replaceAll('\r\n', '\n'));
}

console.log(`Applied release audit fixes for ${RELEASE_VERSION}.`);

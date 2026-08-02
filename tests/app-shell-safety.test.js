import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('assembled application does not split closing tags across source fragments', async () => {
  const parts = await Promise.all([
    readFile('src/app.parts/part-01.jsfrag', 'utf8'),
    readFile('src/app.parts/part-02.jsfrag', 'utf8'),
    readFile('src/app.parts/part-03.jsfrag', 'utf8'),
    readFile('src/app.parts/part-04.jsfrag', 'utf8'),
  ]);
  const source = parts.join('');
  assert.doesNotMatch(source, /<\s+\/section>/i);
  assert.match(source, /<\/section>\s+\$\{state\.importWarnings\.length/);
});

test('restored snapshot identifiers are escaped before option markup insertion', async () => {
  const source = await readFile('src/app.parts/part-02.jsfrag', 'utf8');
  assert.match(source, /value="\$\{escapeHtml\(item\.id\)\}"/);
  assert.doesNotMatch(source, /value="\$\{item\.id\}"/);
});

test('empty message lists use a truthful zero-state range label', async () => {
  const source = await readFile('src/app.parts/part-02.jsfrag', 'utf8');
  assert.match(source, /\$\{filtered\.length\s+\? `Rendering rows/);
  assert.match(source, /: 'No messages to render\.'/);
});

test('view navigation moves focus to the rendered page heading', async () => {
  const [shell, renderer, handlers] = await Promise.all([
    readFile('src/app.parts/part-01.jsfrag', 'utf8'),
    readFile('src/app.parts/part-03.jsfrag', 'utf8'),
    readFile('src/app.parts/part-04.jsfrag', 'utf8'),
  ]);
  assert.match(shell, /<h1 data-page-heading tabindex="-1">/);
  assert.match(renderer, /focusTarget\?\.focus\(\{ preventScroll: true \}\)/);
  assert.match(handlers, /render\(\{ focusHeading: true \}\)/);
  assert.match(handlers, /focusSelector: `\[data-action="relationship-tab"\]/);
});

test('controlled live account UI prepares and arms one item before durable execution', async () => {
  const [imports, queueView, settingsView, handlers] = await Promise.all([
    readFile('src/app.parts/part-01.jsfrag', 'utf8'),
    readFile('src/app.parts/part-02.jsfrag', 'utf8'),
    readFile('src/app.parts/part-03.jsfrag', 'utf8'),
    readFile('src/app.parts/part-04.jsfrag', 'utf8'),
  ]);
  assert.match(imports, /createExtensionAccountActionDriver/);
  assert.match(imports, /createIndexedDbActionLedger/);
  assert.match(imports, /saveActionJobCheckpoint/);
  assert.match(queueView, /latestActionJob\.items\.length === 1/);
  assert.match(queueView, /confirm-action-live/);
  assert.match(settingsView, /Fixed at one account/);
  assert.match(queueView, /data-action="run-action-extension-live"/);
  assert.match(handlers, /'action\.account-live-intent'/);
  assert.match(handlers, /prepared\.payload\?\.armed !== true/);
  assert.match(handlers, /state = await saveActionJobCheckpoint\(checkpointJob\)/);
  assert.match(handlers, /markQueueItem\(state\.queue, item\.queueItemId, 'completed'\)/);
  assert.match(handlers, /state\.settings\.liveActionBatchLimit = 1/);
  assert.equal(
    handlers.indexOf("'action.account-live-intent'")
      < handlers.indexOf('executeReviewedActionJob(job'),
    true,
  );
});

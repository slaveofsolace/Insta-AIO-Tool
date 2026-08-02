import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(
  new URL('../extension/action-labels.js', import.meta.url),
  'utf8',
);

function loadLabels() {
  const context = vm.createContext({});
  vm.runInContext(source, context);
  return context.__instaAioActionLabels;
}

test('reviewed action labels normalize exact Unicode without broad text guessing', () => {
  const labels = loadLabels();
  assert.equal(Object.isFrozen(labels), true);
  assert.equal(Object.isFrozen(labels.dmUnsendLabels), true);
  assert.equal(labels.normalizeActionLabel('  FOLLOW\nBACK  '), 'follow back');
  assert.equal(labels.relationshipForLabel('Following'), 'following');
  assert.equal(labels.relationshipForLabel('Requested'), 'requested');
  assert.equal(labels.relationshipForLabel('Following now'), null);
  assert.equal(labels.isDmUnsendLabel('ZURU\u0308CKNEHMEN'), true);
  assert.equal(labels.isDmUnsendLabel('Unsend this message'), false);
});

test('localized Unsend allowlist contains the reviewed UTF-8 labels only', () => {
  const labels = loadLabels();
  assert.deepEqual(Array.from(labels.dmUnsendLabels), [
    'annulla invio',
    'deshacer',
    'retirar',
    'retirer',
    'unsend',
    'zurücknehmen',
  ]);
  assert.equal(source.includes('zurücknehmen'), true);
  assert.equal(/\u00c3[\u0080-\u00bf]/u.test(source), false);
  assert.equal(source.includes('\ufffd'), false);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('restored snapshot identifiers are escaped before option markup insertion', async () => {
  const source = await readFile('src/app.parts/part-02.jsfrag', 'utf8');
  assert.match(source, /value="\$\{escapeHtml\(item\.id\)\}"/);
  assert.doesNotMatch(source, /value="\$\{item\.id\}"/);
});

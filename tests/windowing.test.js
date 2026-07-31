import test from 'node:test';
import assert from 'node:assert/strict';
import { virtualWindow } from '../src/core/windowing.js';

test('virtual window keeps DOM work bounded for large collections', () => {
  const records = Array.from({ length: 100_000 }, (_, index) => index);
  const window = virtualWindow(records, {
    scrollTop: 72 * 50_000,
    rowHeight: 72,
    viewportHeight: 720,
    overscan: 5,
  });
  assert.equal(window.total, 100_000);
  assert.equal(window.items.length, 20);
  assert.equal(window.start, 49_995);
  assert.equal(window.items[0], 49_995);
  assert.equal(window.topPadding, 49_995 * 72);
  assert.equal(window.bottomPadding, (100_000 - 50_015) * 72);
});

test('virtual window clamps invalid positions and short collections', () => {
  const records = ['a', 'b', 'c'];
  const window = virtualWindow(records, {
    scrollTop: -500,
    rowHeight: 0,
    viewportHeight: 0,
    overscan: -1,
  });
  assert.deepEqual(window.items, ['a']);
  assert.equal(window.start, 0);
  assert.equal(window.topPadding, 0);
  assert.equal(window.bottomPadding, 2);
});

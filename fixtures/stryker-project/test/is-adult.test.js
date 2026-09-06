import assert from 'node:assert/strict';
import test from 'node:test';
import { isAdult } from '../src/is-adult.js';

test('adult boundary is accepted', () => {
  assert.equal(isAdult(18), true);
});

test('below adult boundary is rejected', () => {
  assert.equal(isAdult(17), false);
});

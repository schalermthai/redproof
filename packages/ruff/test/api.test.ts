import assert from 'node:assert/strict';
import test from 'node:test';
import * as api from '../src/index.ts';

test('the public surface is the adapter factory alone; internals are not part of the semver contract', () => {
  assert.deepEqual(Object.keys(api), ['ruff']);
});

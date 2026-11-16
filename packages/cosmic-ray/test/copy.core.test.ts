import assert from 'node:assert/strict';
import test from 'node:test';
import { copyDisposition, escapesCopy } from '../src/core/copy.ts';

test('history and caches are skipped, environments are linked, sources are copied', () => {
  assert.deepEqual(['.git', '__pycache__', '.pytest_cache', 'pkg.egg-info'].map(copyDisposition), ['skip', 'skip', 'skip', 'skip']);
  assert.deepEqual(['.venv', 'venv', 'node_modules', '.tox'].map(copyDisposition), ['link', 'link', 'link', 'link']);
  assert.deepEqual(['mod.py', 'src', 'tests'].map(copyDisposition), ['copy', 'copy', 'copy']);
});

test('module paths that would leave the sandbox are recognised', () => {
  assert.equal(escapesCopy('/abs/mod.py'), true);
  assert.equal(escapesCopy('../other/mod.py'), true);
  assert.equal(escapesCopy('a/../../mod.py'), true);
  assert.equal(escapesCopy('C:\\mod.py'), true);
  assert.equal(escapesCopy('pkg/mod.py'), false);
  assert.equal(escapesCopy('./mod.py'), false);
});

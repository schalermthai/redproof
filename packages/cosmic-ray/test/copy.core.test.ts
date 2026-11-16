import assert from 'node:assert/strict';
import test from 'node:test';
import { copyDisposition, escapesCopy, firstEscapingModule, isInsideDirectory } from '../src/core/copy.ts';

test('history and caches are skipped, environments are linked, sources are copied', () => {
  assert.deepEqual(['.git', '__pycache__', '.pytest_cache', 'pkg.egg-info'].map(copyDisposition), ['skip', 'skip', 'skip', 'skip']);
  assert.deepEqual(['.venv', 'venv', 'node_modules', '.tox'].map(copyDisposition), ['link', 'link', 'link', 'link']);
  // `env` is a common name for a real source package, so it is copied like any directory.
  assert.equal(copyDisposition('env'), 'copy');
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

test('directory containment compares whole path segments', () => {
  assert.equal(isInsideDirectory('/a/b', '/a/b'), true);
  assert.equal(isInsideDirectory('/a/b', '/a/b/c.py'), true);
  assert.equal(isInsideDirectory('/a/b', '/a/bc/c.py'), false);
  assert.equal(isInsideDirectory('/a/b', '/a'), false);
  assert.equal(isInsideDirectory('/', '/x'), true);
});

test('the first mutant whose module path escapes is found', () => {
  const mutant = (modulePath: string) => ({ id: modulePath, status: 'killed' as const, modulePath, operator: 'o', line: 1, column: 0 });
  assert.equal(firstEscapingModule([mutant('a.py'), mutant('/x.py'), mutant('../y.py')])?.modulePath, '/x.py');
  assert.equal(firstEscapingModule([mutant('a.py'), mutant('pkg/b.py')]), undefined);
});

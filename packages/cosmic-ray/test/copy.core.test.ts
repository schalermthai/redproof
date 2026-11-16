import assert from 'node:assert/strict';
import test from 'node:test';
import { copyDisposition, escapesCopy, firstEscapingModule, isInsideDirectory } from '../src/core/copy.ts';

const disposition = (name: string) => copyDisposition(name);

test('history and caches are skipped, tool caches linked, sources and unknown names copied', () => {
  assert.deepEqual(['.git', '__pycache__', '.pytest_cache', 'pkg.egg-info'].map(disposition), ['skip', 'skip', 'skip', 'skip']);
  assert.deepEqual(['node_modules', '.tox', '.nox'].map(disposition), ['link', 'link', 'link']);
  // `env` and `venv` are common names for real source packages, so a name alone never links them.
  assert.deepEqual(['env', 'venv', '.venv', 'mod.py', 'src'].map(disposition), ['copy', 'copy', 'copy', 'copy', 'copy']);
});

test('venv and .venv are linked only when they hold a pyvenv.cfg, i.e. really are environments', () => {
  assert.equal(copyDisposition('venv', true), 'link');
  assert.equal(copyDisposition('.venv', true), 'link');
  assert.equal(copyDisposition('venv', false), 'copy');
  assert.equal(copyDisposition('env', true), 'copy');
});

test('only an absolute module path is refused by its spelling; climbing paths are left to the realpath check', () => {
  assert.equal(escapesCopy('/abs/mod.py'), true);
  assert.equal(escapesCopy('C:\\mod.py'), true);
  assert.equal(escapesCopy('../mod.py'), false);
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
  assert.equal(firstEscapingModule([mutant('a.py'), mutant('../y.py'), mutant('/x.py')])?.modulePath, '/x.py');
  assert.equal(firstEscapingModule([mutant('a.py'), mutant('pkg/b.py')]), undefined);
});

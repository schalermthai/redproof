import assert from 'node:assert/strict';
import { join, resolve } from 'node:path';
import test from 'node:test';
import {
  confineCanonicalTestingPath,
  resolveTestingPath,
  validateRelativeTestingPath,
} from '../../packages/testing/src/core/paths.ts';

const root = resolve('/gate/app');

test('a relative path option must be present and must not be absolute', () => {
  assert.throws(() => validateRelativeTestingPath('reportFile', ''), /^Error: reportFile must not be empty\.$/);
  assert.throws(() => validateRelativeTestingPath('reportFile', '   '), /reportFile must not be empty\./);
  assert.throws(() => validateRelativeTestingPath('cwd', resolve('/tmp/results.json')), /^Error: cwd must be relative\.$/);
  assert.doesNotThrow(() => validateRelativeTestingPath('reportFile', 'reports/results.json'));
  assert.doesNotThrow(() => validateRelativeTestingPath('reportFile', '.'));
});

test('a path is inside the Gate root when it is the root itself or a descendant', () => {
  assert.deepEqual(resolveTestingPath(root, '.'), { kind: 'inside', path: root });
  assert.deepEqual(resolveTestingPath(root, ''), { kind: 'inside', path: root });
  assert.deepEqual(resolveTestingPath(root, 'packages/app'), { kind: 'inside', path: join(root, 'packages', 'app') });
  assert.deepEqual(resolveTestingPath(root, 'a/../b/./c'), { kind: 'inside', path: join(root, 'b', 'c') });
  assert.deepEqual(resolveTestingPath(root, 'a/../.'), { kind: 'inside', path: root });
  assert.deepEqual(resolveTestingPath(root, '../app'), { kind: 'inside', path: root });
  assert.deepEqual(resolveTestingPath(root, join(root, 'reports')), { kind: 'inside', path: join(root, 'reports') });
});

test('a path is outside the Gate root when it climbs above it, even after returning to a sibling', () => {
  assert.deepEqual(resolveTestingPath(root, '..'), { kind: 'outside', path: resolve('/gate') });
  assert.equal(resolveTestingPath(root, 'a/../../b').kind, 'outside');
  assert.equal(resolveTestingPath(root, '../app2').kind, 'outside');
  assert.equal(resolveTestingPath(root, '../../').kind, 'outside');
  assert.equal(resolveTestingPath(root, resolve('/tmp/elsewhere')).kind, 'outside');
});

test('a sibling directory whose name starts with the root name is outside the root', () => {
  assert.equal(resolveTestingPath(root, '../app-legacy').kind, 'outside');
  assert.equal(resolveTestingPath(root, '../app2/src').kind, 'outside');
  assert.equal(confineCanonicalTestingPath(root, resolve('/gate/app-legacy')).kind, 'outside');
  assert.equal(confineCanonicalTestingPath(root, resolve('/gate/app2/src')).kind, 'outside');
});

test('a relative root is resolved to an absolute path before confinement', () => {
  const resolved = resolveTestingPath('relative/root', 'sub');
  assert.equal(resolved.kind, 'inside');
  assert.equal(resolved.path, resolve('relative/root', 'sub'));
});

test('canonical confinement keeps the root and its descendants and rejects ancestors and strangers', () => {
  const child = join(root, 'packages', 'app');
  assert.deepEqual(confineCanonicalTestingPath(root, root), { kind: 'inside', path: root });
  assert.deepEqual(confineCanonicalTestingPath(root, child), { kind: 'inside', path: child });
  assert.deepEqual(confineCanonicalTestingPath(root, resolve('/gate')), { kind: 'outside', path: resolve('/gate') });
  assert.deepEqual(confineCanonicalTestingPath(root, resolve('/')), { kind: 'outside', path: resolve('/') });
  assert.deepEqual(
    confineCanonicalTestingPath(root, resolve('/private/tmp/x')),
    { kind: 'outside', path: resolve('/private/tmp/x') },
  );
});

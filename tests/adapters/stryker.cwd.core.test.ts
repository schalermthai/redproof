import assert from 'node:assert/strict';
import { join } from 'node:path';
import test from 'node:test';
import {
  confineCanonicalStrykerCwd,
  resolveStrykerCwd,
} from '../../packages/stryker/src/cwd.ts';

const root = join('/', 'gate');

test('a working directory below the Gate root resolves to an absolute path inside it', () => {
  assert.deepEqual(resolveStrykerCwd(root, 'packages/parser'), {
    kind: 'inside',
    path: join(root, 'packages', 'parser'),
  });
  assert.deepEqual(resolveStrykerCwd(root, '.'), {
    kind: 'inside',
    path: root,
  });
  assert.deepEqual(resolveStrykerCwd(root, 'packages/../packages/parser'), {
    kind: 'inside',
    path: join(root, 'packages', 'parser'),
  });
});

test('a working directory that climbs out of the Gate root is outside it', () => {
  for (const cwd of ['..', '../elsewhere', 'packages/../../elsewhere', join('/', 'elsewhere')]) {
    assert.equal(resolveStrykerCwd(root, cwd).kind, 'outside', cwd);
  }
});

test('a sibling directory whose name starts with the root name is outside the root', () => {
  assert.equal(resolveStrykerCwd(root, join('/', 'gate-copy')).kind, 'outside');
  assert.equal(
    confineCanonicalStrykerCwd(root, join('/', 'gate-copy', 'project')).kind,
    'outside',
  );
});

test('canonical confinement judges a resolved path the same way, and keeps it', () => {
  const inside = join(root, 'project');
  assert.deepEqual(confineCanonicalStrykerCwd(root, inside), {
    kind: 'inside',
    path: inside,
  });
  assert.deepEqual(confineCanonicalStrykerCwd(root, root), {
    kind: 'inside',
    path: root,
  });

  const outside = join('/', 'elsewhere', 'project');
  assert.deepEqual(confineCanonicalStrykerCwd(root, outside), {
    kind: 'outside',
    path: outside,
  });
});

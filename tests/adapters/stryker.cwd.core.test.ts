import assert from 'node:assert/strict';
import { join } from 'node:path';
import test from 'node:test';
import {
  confineCanonicalStrykerCwd,
  resolveStrykerCwd,
} from '../../packages/stryker/src/core/paths.ts';

const root = join('/', 'gate');

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


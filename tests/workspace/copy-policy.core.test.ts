import assert from 'node:assert/strict';
import test from 'node:test';

import {
  copiesEntry,
  copyName,
  pathInsideCopy,
  stampsEntry,
} from '../../packages/redproof/src/workspace/core/copy-policy.ts';

test('version control and Redproof output are never copied, at the root or deeper', () => {
  for (const name of ['.git', '.redproof']) {
    assert.equal(copiesEntry(name, true), false, `${name} at the root`);
    assert.equal(copiesEntry(name, false), false, `${name} nested`);
  }
});

test('the root node_modules is linked instead of copied, but a nested node_modules is a fixture and is copied', () => {
  assert.equal(copiesEntry('node_modules', true), false);
  assert.equal(copiesEntry('node_modules', false), true);
});

test('ordinary entries are copied everywhere, including other dotfiles', () => {
  for (const name of ['src', 'package.json', '.gitignore', '.github', 'dist']) {
    assert.equal(copiesEntry(name, true), true, `${name} at the root`);
    assert.equal(copiesEntry(name, false), true, `${name} nested`);
  }
});

test('a baseline stamp skips reporter output at the root only', () => {
  assert.equal(stampsEntry('.redproof', true), false);
  assert.equal(stampsEntry('.redproof', false), true);
  assert.equal(stampsEntry('node_modules', true), true);
  assert.equal(stampsEntry('src', true), true);
});

test('a copy directory name keeps only safe characters of the Gate id and trims the edges', () => {
  assert.equal(copyName('architecture'), 'architecture');
  assert.equal(copyName('gates/no todo!'), 'gates-no-todo');
  assert.equal(copyName('/lint//rules/'), 'lint-rules');
  assert.equal(copyName('v1.2_beta-3'), 'v1.2_beta-3');
});

test('a Gate id with no safe characters still gets a copy name', () => {
  assert.equal(copyName('!!!'), 'gate');
  assert.equal(copyName(''), 'gate');
});

test('a project file maps to the same relative path inside the copy', () => {
  assert.equal(pathInsideCopy('/home/p', '/tmp/copy', '/home/p/src/a.ts'), '/tmp/copy/src/a.ts');
  assert.equal(pathInsideCopy('/home/p', '/tmp/copy', '/home/p/deep/er/file'), '/tmp/copy/deep/er/file');
  assert.equal(pathInsideCopy('/home/p', '/tmp/copy', '/home/p'), '/tmp/copy');
});

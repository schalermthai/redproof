import assert from 'node:assert/strict';
import test from 'node:test';
import { locate, selectOccurrence } from '../../packages/redproof/src/inspect/core/locate.ts';

test('a text locator defaults to the only occurrence and keeps its files and pattern', () => {
  const pattern = /answer/;
  const locator = locate.text({ files: ['src/a.ts', 'src/b.ts'], find: pattern });

  assert.deepEqual(locator, { kind: 'text', files: ['src/a.ts', 'src/b.ts'], find: pattern, occurrence: 'only' });
});

test('a json locator defaults to the only occurrence and keeps its files and path', () => {
  const locator = locate.json({ files: 'package.json', path: '$.scripts.test' });

  assert.deepEqual(locator, { kind: 'json', files: 'package.json', path: '$.scripts.test', occurrence: 'only' });
});

test('an explicit occurrence is kept, including index zero', () => {
  assert.equal(locate.text({ files: 'a', find: 'x', occurrence: 'last' }).occurrence, 'last');
  assert.equal(locate.text({ files: 'a', find: 'x', occurrence: 0 }).occurrence, 0);
  assert.equal(locate.json({ files: 'a', path: '$', occurrence: 'first' }).occurrence, 'first');
  assert.equal(locate.json({ files: 'a', path: '$', occurrence: 0 }).occurrence, 0);
});

test('occurrence selection demands exactly one by default and indexes from zero', () => {
  assert.equal(selectOccurrence(['x'], 'only', 'Text locator'), 'x');
  assert.equal(selectOccurrence(['x', 'y', 'z'], 'first', 'Text locator'), 'x');
  assert.equal(selectOccurrence(['x', 'y', 'z'], 'last', 'Text locator'), 'z');
  assert.equal(selectOccurrence(['x', 'y', 'z'], 0, 'Text locator'), 'x');
  assert.equal(selectOccurrence(['x', 'y', 'z'], 1, 'Text locator'), 'y');
  assert.equal(selectOccurrence(['x', 'y', 'z'], 2, 'Text locator'), 'z');
});

test('occurrence selection names the locator and the reason when it cannot choose', () => {
  assert.throws(() => selectOccurrence([], 'first', 'Text locator'), /^Error: Text locator did not match anything\.$/);
  assert.throws(() => selectOccurrence([], 'only', 'JSON locator'), /^Error: JSON locator did not match anything\.$/);
  assert.throws(() => selectOccurrence(['x', 'y'], 'only', 'JSON locator'), /^Error: JSON locator expected exactly one match but found 2\.$/);
  assert.throws(() => selectOccurrence(['x'], -1, 'Text locator'), /^Error: Text locator occurrence must be a non-negative zero-based index\.$/);
  assert.throws(() => selectOccurrence(['x'], 1.5, 'Text locator'), /^Error: Text locator occurrence must be a non-negative zero-based index\.$/);
  assert.throws(() => selectOccurrence(['x'], 3, 'Text locator'), /^Error: Text locator occurrence 3 is out of range for 1 matches\.$/);
});

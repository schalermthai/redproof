import assert from 'node:assert/strict';
import test from 'node:test';
import { selectOccurrence } from '../packages/redproof/src/inspect/core/locate.ts';
import { matchText } from '../packages/redproof/src/inspect/core/text.ts';

test('text matching reports every occurrence with a 1-based line and column', () => {
  const matches = matchText('a.ts', 'todo\nx todo y\n', 'todo');

  assert.deepEqual(matches.map(match => [match.range.start, match.location.line, match.location.column]), [
    [0, 1, 1],
    [7, 2, 3],
  ]);
});

test('a string pattern is literal, and a regex keeps its flags', () => {
  assert.equal(matchText('a.ts', 'a.b axb', 'a.b').length, 1);
  assert.equal(matchText('a.ts', 'a.b axb', /a.b/).length, 2);
  assert.equal(matchText('a.ts', 'Ab ab', /ab/i).length, 2);
});

test('a zero-width regex matches at every position and terminates', () => {
  const matches = matchText('a.ts', 'abc', /(?=b|c)/);
  assert.deepEqual(matches.map(match => match.range), [{ start: 1, end: 1 }, { start: 2, end: 2 }]);
});

test('occurrence selection demands exactly one by default and indexes from zero', () => {
  assert.equal(selectOccurrence(['x'], 'only', 'Text locator'), 'x');
  assert.equal(selectOccurrence(['x', 'y', 'z'], 'first', 'Text locator'), 'x');
  assert.equal(selectOccurrence(['x', 'y', 'z'], 'last', 'Text locator'), 'z');
  assert.equal(selectOccurrence(['x', 'y', 'z'], 1, 'Text locator'), 'y');

  assert.throws(() => selectOccurrence([], 'first', 'Text locator'), /^Error: Text locator did not match anything\.$/);
  assert.throws(() => selectOccurrence(['x', 'y'], 'only', 'JSON locator'), /JSON locator expected exactly one match but found 2\./);
  assert.throws(() => selectOccurrence(['x'], -1, 'Text locator'), /must be a non-negative zero-based index/);
  assert.throws(() => selectOccurrence(['x'], 1.5, 'Text locator'), /must be a non-negative zero-based index/);
  assert.throws(() => selectOccurrence(['x'], 3, 'Text locator'), /occurrence 3 is out of range for 1 matches/);
});

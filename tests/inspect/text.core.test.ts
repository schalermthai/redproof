import assert from 'node:assert/strict';
import test from 'node:test';
import { matchText } from '../../packages/redproof/src/inspect/core/text.ts';

test('text matching reports every occurrence in document order with a 1-based line and column', () => {
  const matches = matchText('a.ts', 'todo\nx todo y\n\ntodo', 'todo');

  assert.deepEqual(
    matches.map(match => [match.range.start, match.range.end, match.location.line, match.location.column]),
    [
      [0, 4, 1, 1],
      [7, 11, 2, 3],
      [15, 19, 4, 1],
    ],
  );
  assert.deepEqual(new Set(matches.map(match => match.location.file)), new Set(['a.ts']));
  assert.deepEqual(new Set(matches.map(match => match.text)), new Set(['todo']));
});

test('a match reports the text it matched, and no match reports nothing', () => {
  assert.deepEqual(matchText('a.ts', 'ab12cd', /\d+/).map(match => [match.text, match.range]), [
    ['12', { start: 2, end: 4 }],
  ]);
  assert.deepEqual(matchText('a.ts', 'abc', 'zzz'), []);
});

test('a string pattern is literal, and a regex keeps its flags', () => {
  assert.equal(matchText('a.ts', 'a.b axb', 'a.b').length, 1);
  assert.equal(matchText('a.ts', 'a.b axb', /a.b/).length, 2);
  assert.equal(matchText('a.ts', 'Ab ab', /ab/i).length, 2);
  assert.deepEqual(matchText('a.ts', 'x\nx', /^x$/m).map(match => match.location.line), [1, 2]);
});

test('a regex without the global flag still reports every occurrence', () => {
  assert.equal(matchText('a.ts', 'a a a', /a/).length, 3);
});

test('a global regex with a stale lastIndex is searched from the start', () => {
  const pattern = /a/g;
  pattern.lastIndex = 4;

  assert.deepEqual(matchText('a.ts', 'a a a', pattern).map(match => match.range.start), [0, 2, 4]);
});

test('a zero-width regex matches at every position and terminates', () => {
  const matches = matchText('a.ts', 'abc', /(?=b|c)/);
  assert.deepEqual(matches.map(match => match.range), [{ start: 1, end: 1 }, { start: 2, end: 2 }]);
});

test('a match that spans lines is located where it starts', () => {
  const matches = matchText('a.ts', 'one\ntwo\nthree', /two\nthree/);
  assert.deepEqual(matches.map(match => match.location), [{ file: 'a.ts', line: 2, column: 1 }]);
});

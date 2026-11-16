import assert from 'node:assert/strict';
import test from 'node:test';
import { vulture } from '../src/index.ts';

const build = (exclude: string[]) => (): unknown => vulture({ rules: { a: 'unused-import' }, exclude });

test('a pattern with a lone surrogate is rejected: Node would hand vulture U+FFFD while the census kept the surrogate', () => {
  assert.throws(build(['\ud800']), /well-formed|surrogate/u);
  assert.throws(build(['*\udfff*']), /well-formed|surrogate/u);
  assert.doesNotThrow(build(['*\u{1F600}*']));
});

test('an over-long pattern is a clear constructor error, not an internal adapter error at run time', () => {
  assert.throws(build(['a'.repeat(5000)]), /at most 4096/u);
  assert.doesNotThrow(build(['a'.repeat(4096)]));
});

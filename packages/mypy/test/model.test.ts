import assert from 'node:assert/strict';
import test from 'node:test';
import {
  coversCode, mypyVersionSupported, parseMypyReport, parseMypyVersion, relatedCodes, unselectableCodes, verifiedCodes,
} from '../src/core/model.ts';
import { mypy } from '../src/index.ts';

test('a code covers itself and its sub-codes, never a neighbour', () => {
  assert.ok(coversCode('import', 'import-not-found'));
  assert.ok(coversCode('assignment', 'method-assign'));
  assert.ok(coversCode('misc', 'overload-overlap'));
  assert.ok(!coversCode('import-not-found', 'import'), 'a child does not cover its parent');
  assert.ok(!coversCode('import-not-found', 'import-untyped'));
  assert.ok(relatedCodes('import-not-found', 'import'), 'an ignore of either hides the other');
});

test('versions: --output json starts at 1.11.0', () => {
  assert.deepEqual(parseMypyVersion('mypy 1.11.0 (compiled: yes)'), [1, 11, 0]);
  assert.deepEqual(parseMypyVersion('2.5.0+dev.d1bad9f73f82d3a81fd5226a5c8f3d643885f184'), [2, 5, 0]);
  assert.equal(parseMypyVersion('ruff 0.17.5'), null);
  assert.ok(mypyVersionSupported([1, 11, 0]));
  assert.ok(!mypyVersionSupported([1, 10, 1]));
  assert.ok(mypyVersionSupported([2, 4, 1]));
});

const row = (extra: Record<string, unknown> = {}): string => JSON.stringify({
  file: 'a.py', line: 1, column: 0, message: 'm', hint: null, code: 'assignment', severity: 'error', ...extra,
});

test('the report parser keeps what a verdict needs and converts columns to 1-based', () => {
  const [one, two] = parseMypyReport(`${row({ column: 9, end_line: 1 })}\n\n${row({ column: -1, code: 'unused-ignore', hint: 'h' })}\n`);
  assert.equal(one?.column, 10);
  assert.equal(two?.column, null, 'mypy reports -1 for a comment-level finding');
  assert.equal(two?.hint, 'h');
  assert.deepEqual(parseMypyReport(''), []);
});

const bad: ReadonlyArray<readonly [string, string]> = [
  ['a truncated line', row().slice(0, 40)],
  ['plain text (a "Found 1 error" banner)', 'Found 1 error in 1 file (checked 1 source file)'],
  ['an array', '[]'],
  ['no file', row({ file: '' })],
  ['no message', row({ message: 7 })],
  ['a severity it does not know', row({ severity: 'warning' })],
  ['a numeric code', row({ code: 7 })],
  ['no line', row({ line: 'x' })],
  ['a good line then garbage', `${row()}\n{"file":`],
];
for (const [name, text] of bad) {
  test(`a report with ${name} is not evidence`, () => assert.throws(() => parseMypyReport(text)));
}

test('a file named like a finding is just a file name, and the message never decides the code', () => {
  const hostile = 'a.py:1: error: Found 1 error [assignment]';
  const [finding] = parseMypyReport(row({ file: hostile, message: 'error: Success: no issues found in 1 source file', code: 'arg-type' }));
  assert.equal(finding?.file, hostile);
  assert.equal(finding?.code, 'arg-type');
});

test('construction: vocabulary, overlap and option checks throw', () => {
  assert.throws(() => mypy({ rules: {} }), /at least one/u);
  assert.throws(() => mypy({ rules: { a: 'arg-type' }, mystery: true } as never), /Unknown/u);
  assert.throws(() => mypy({ rules: { a: 'not-a-code' } }), /Unknown mypy rule/u);
  assert.throws(() => mypy({ rules: { a: 'syntax' } }), /cannot be selected/u);
  assert.throws(() => mypy({ rules: { a: 'annotation-unchecked' } }), /cannot be selected/u);
  assert.throws(() => mypy({ rules: { a: 'import', b: 'import-not-found' } }), /must not overlap/u);
  assert.throws(() => mypy({ rules: { a: 'arg-type', b: 'arg-type' } }), /more than once/u);
  assert.throws(() => mypy({ rules: { a: 'arg-type' }, paths: ['/etc'] }), /relative path/u);
  assert.throws(() => mypy({ rules: { a: 'arg-type' }, paths: ['--config-file=x'] }), /relative path/u);
  assert.throws(() => mypy({ rules: { a: 'arg-type' }, paths: ['../x'] }), /relative path/u);
  assert.throws(() => mypy({ rules: { a: 'arg-type' }, paths: [] }), /non-empty list/u);
  assert.throws(() => mypy({ rules: { a: 'arg-type' }, isolated: true, configFile: 'mypy.ini' }), /cannot be combined/u);
  assert.throws(() => mypy({ rules: { a: 'arg-type' }, pythonVersion: '3' }), /pythonVersion/u);
  assert.throws(() => mypy({ rules: { a: 'arg-type' }, platform: '--x' }), /platform/u);
  assert.throws(() => mypy({ rules: { a: 'arg-type' }, allow: ['everything'] as never }), /Unknown mypy allowance/u);
  assert.throws(() => mypy({ rules: { a: 'arg-type' }, allow: ['plugins', 'plugins'] }), /repeat/u);
  assert.throws(() => mypy({ rules: { a: 'arg-type' }, python: '-m' }), /python must not be empty/u);
  assert.throws(() => mypy({ rules: { a: 'arg-type' }, timeoutMs: 0 }), /positive integer/u);
});

test('every unselectable code has a reason and is not in the vocabulary', () => {
  for (const code of Object.keys(unselectableCodes)) assert.ok(!(code in verifiedCodes));
});

test('the adapter names one rule per selected code', () => {
  const adapter = mypy({ rules: { args: 'arg-type', imports: 'import' } });
  assert.deepEqual(Object.values(adapter.rules).map(rule => rule.id), ['mypy/arg-type', 'mypy/import']);
});

test('law: covering is reflexive, transitive and antisymmetric over every selectable code and sub-code', () => {
  const all = [...Object.keys(verifiedCodes), 'prop-decorator'];
  for (const a of all) {
    assert.ok(coversCode(a, a));
    for (const b of all) {
      if (a !== b && coversCode(a, b)) assert.ok(!coversCode(b, a), `${a} and ${b} cover each other`);
      for (const c of all) if (coversCode(a, b) && coversCode(b, c)) assert.ok(coversCode(a, c), `${a} > ${b} > ${c}`);
    }
  }
});

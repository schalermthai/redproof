import assert from 'node:assert/strict';
import test from 'node:test';
import { formatCompactRun } from '../../packages/redproof/src/reporter/core/compact.ts';
import { at, breach, fail, gate, pass, refuse, rule, run } from './runs.ts';

const R1 = rule('parser/rejects-malformed-input');
const R2 = rule('parser/preserves-whitespace');

function lines(...gates: Parameters<typeof run>[0]): string[] {
  const output = formatCompactRun(run(gates));
  return output === '' ? [] : output.split('\n');
}

test('a Breach becomes one problem-matcher line naming its file, position, and Rule', () => {
  const result = fail(breach(R1, 'Malformed input was accepted.', at('src/parser.ts', 2, 30), { code: 'unexpected-status' }));

  assert.deepEqual(lines(gate({ id: 'parser', rules: [R1], result })), [
    'src/parser.ts:2:30: error redproof[parser/rejects-malformed-input]: Malformed input was accepted.',
  ]);
});

test('a Breach reports the position it has and never invents the rest', () => {
  const result = fail(
    breach(R1, 'no column', at('src/a.ts', 7)),
    breach(R1, 'no line', at('src/a.ts')),
    breach(R1, 'no file at all', null),
  );

  assert.deepEqual(lines(gate({ id: 'parser', rules: [R1], result })), [
    'src/a.ts:7: error redproof[parser/rejects-malformed-input]: no column',
    'src/a.ts: error redproof[parser/rejects-malformed-input]: no line',
    'redproof: error redproof[parser/rejects-malformed-input]: no file at all',
  ]);
});

test('a REFUSE is labelled as a refusal of its Gate, not as a Rule breach', () => {
  const why = { code: 'eslint-config', message: 'ESLint configuration could not be loaded.', location: at('.eslintrc.json', 3) };

  assert.deepEqual(lines(gate({ id: 'eslint', rules: [R1, R2], result: refuse(why) })), [
    '.eslintrc.json:3: error redproof[REFUSE:eslint]: ESLint configuration could not be loaded.',
  ]);
});

test('every Breach of every failing Gate is emitted, Gate by Gate, Rule by Rule', () => {
  const first = gate({ id: 'a', rules: [R1, R2], result: fail(
    breach(R2, 'whitespace lost'),
    breach(R1, 'first malformed'),
    breach(R1, 'second malformed'),
  ) });
  const second = gate({ id: 'b', rules: [R1], result: fail(breach(R1, 'other Gate')) });

  assert.deepEqual(lines(first, second).map(line => line.split(': ').at(-1)), [
    'first malformed',
    'second malformed',
    'whitespace lost',
    'other Gate',
  ]);
});

test('a passing Gate contributes nothing, so an all-pass run is silent', () => {
  assert.equal(formatCompactRun(run([gate({ id: 'a', rules: [R1], result: pass() })])), '');
  assert.deepEqual(
    lines(
      gate({ id: 'a', rules: [R1], result: pass() }),
      gate({ id: 'b', rules: [R1], result: fail(breach(R1, 'only this')) }),
    ),
    ['redproof: error redproof[parser/rejects-malformed-input]: only this'],
  );
});

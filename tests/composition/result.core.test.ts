import assert from 'node:assert/strict';
import test from 'node:test';
import { breach, counting, fail, pass, result } from '../../packages/redproof/src/composition/core/check.ts';
import type { Diagnostic, Scan } from '../../packages/redproof/src/domain/index.ts';

const scan: Scan = { source: 'result-core', startedAt: '', finishedAt: '', inspected: 3 };
const rule = { id: 'source/no-todo', description: 'No TODO comments.' } as const;

const diagnostic: Diagnostic = {
  code: 'todo-found',
  message: 'TODO comment found.',
  location: { file: 'src/a.ts', line: 2, column: 4 },
};

test('counting is a standing capability, and an unsupported one carries its reason', () => {
  assert.deepEqual(counting.supported, { kind: 'supported' });
  assert.deepEqual(
    counting.unsupported('The external command only exposes a process status.'),
    { kind: 'unsupported', reason: 'The external command only exposes a process status.' },
  );
});

test('pass, fail, and refuse build the verdict around the Scan they were given', () => {
  const one = breach(rule, diagnostic);
  const why: Diagnostic = { code: 'unavailable', message: 'Config missing.', location: null };

  assert.deepEqual(result.pass(scan), { verdict: 'pass', scan });
  assert.deepEqual(result.fail(scan, [one]), { verdict: 'fail', scan, breaches: [one] });
  assert.deepEqual(result.refuse(scan, why), { verdict: 'refuse', scan, why });
});

test('fromBreaches maps zero breaches to PASS and keeps every breach, in order, for FAIL', () => {
  const first = breach(rule, { ...diagnostic, code: 'first' });
  const second = breach(rule, { ...diagnostic, code: 'second' });
  const third = breach(rule, { ...diagnostic, code: 'third' });

  assert.deepEqual(result.fromBreaches(scan, []), pass(scan));
  assert.deepEqual(result.fromBreaches(scan, [first]), fail(scan, [first]));
  assert.deepEqual(result.fromBreaches(scan, [first, second, third]), fail(scan, [first, second, third]));
});

test('a breach names its Rule by id, whether given the Rule or the id, and keeps every diagnostic field', () => {
  const full: Diagnostic = {
    ...diagnostic,
    comparison: { expected: '<= 238s', actual: '251.4s' },
    hint: 'Remove the TODO.',
  };

  assert.deepEqual(breach(rule, full), { rule: 'source/no-todo', ...full });
  assert.deepEqual(breach('source/no-todo', full), { rule: 'source/no-todo', ...full });
});

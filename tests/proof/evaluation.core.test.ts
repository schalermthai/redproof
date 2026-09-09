import assert from 'node:assert/strict';
import test from 'node:test';
import type { GreenProof, RedProof, RefuseProof } from '../../packages/redproof/src/domain/index.ts';
import {
  evaluateProof,
  proofSucceeded,
  type ProofEvaluation,
} from '../../packages/redproof/src/proof/core/evaluation.ts';
import { failResult, passResult, refuseResult } from './results.ts';

const noop = { description: 'noop', async apply() { return async () => {}; } };
const red: RedProof = { expected: 'red', name: 'prove r1', target: 'r1', mutate: noop };
const green: GreenProof = { expected: 'green', name: 'stays green' };
const refuse: RefuseProof = { expected: 'refuse', name: 'refuses', mutate: noop };

test('a RED proof is proved when its target Rule is among the breaches', () => {
  assert.deepEqual(evaluateProof(red, failResult(['r1'])), { kind: 'proved', target: 'r1' });
  assert.deepEqual(evaluateProof(red, failResult(['r2', 'r1', 'r3'])), { kind: 'proved', target: 'r1' });
});

test('a RED proof requires its target Rule breached, not merely a failed Gate', () => {
  assert.deepEqual(evaluateProof(red, failResult(['r2', 'r3'])), {
    kind: 'target-rule-not-breached',
    target: 'r1',
    breached: ['r2', 'r3'],
  });
});

test('a RED proof reports a verdict mismatch when the Gate did not fail at all', () => {
  assert.deepEqual(evaluateProof(red, passResult()), { kind: 'verdict-mismatch', expected: 'fail', actual: 'pass' });
  assert.deepEqual(evaluateProof(red, refuseResult()), { kind: 'verdict-mismatch', expected: 'fail', actual: 'refuse' });
});

test('a GREEN proof is proved only by PASS', () => {
  assert.deepEqual(evaluateProof(green, passResult()), { kind: 'proved' });
  assert.deepEqual(evaluateProof(green, failResult(['r1'])), { kind: 'verdict-mismatch', expected: 'pass', actual: 'fail' });
  assert.deepEqual(evaluateProof(green, refuseResult()), { kind: 'verdict-mismatch', expected: 'pass', actual: 'refuse' });
});

test('a REFUSE proof is proved by any REFUSE, whatever the diagnostic says', () => {
  assert.deepEqual(evaluateProof(refuse, refuseResult('unavailable')), { kind: 'proved' });
  assert.deepEqual(evaluateProof(refuse, refuseResult('nothing-inspected')), { kind: 'proved' });
});

test('a REFUSE proof is not proved by PASS or FAIL', () => {
  assert.deepEqual(evaluateProof(refuse, passResult()), { kind: 'verdict-mismatch', expected: 'refuse', actual: 'pass' });
  assert.deepEqual(evaluateProof(refuse, failResult(['r1'])), { kind: 'verdict-mismatch', expected: 'refuse', actual: 'fail' });
});

test('only a proved evaluation counts as success', () => {
  const judged: readonly (readonly [ProofEvaluation, boolean])[] = [
    [{ kind: 'proved' }, true],
    [{ kind: 'proved', target: 'r1' }, true],
    [{ kind: 'verdict-mismatch', expected: 'fail', actual: 'pass' }, false],
    [{ kind: 'target-rule-not-breached', target: 'r1', breached: ['r2'] }, false],
    [{ kind: 'target-already-breached', target: 'r1', breached: ['r1'] }, false],
  ];

  for (const [evaluation, expected] of judged) {
    assert.equal(proofSucceeded(evaluation), expected, `${evaluation.kind} should be ${expected}`);
  }
});

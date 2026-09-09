import assert from 'node:assert/strict';
import test from 'node:test';
import type { Gate, GreenProof, RedProof, RefuseProof } from '../../packages/redproof/src/domain/index.ts';
import {
  baselineBlocksProof,
  baselineOutcome,
  completedOutcome,
  failedOutcome,
  type ProofFailure,
} from '../../packages/redproof/src/proof/core/lifecycle.ts';
import { proofEstablished, type ProofOutcome } from '../../packages/redproof/src/proof/core/outcome.ts';
import { failResult, passResult, refuseResult } from './results.ts';

const noop = { description: 'noop', async apply() { return async () => {}; } };
const gate: Gate = {
  id: 'gate-under-test',
  adapter: { kind: 'unit', rules: {}, check: { description: 'unit', counting: { kind: 'supported' }, async run() { return passResult(); } } },
};
const red: RedProof = { expected: 'red', name: 'prove r1', target: 'r1', mutate: noop };
const green: GreenProof = { expected: 'green', name: 'stays green' };
const refuse: RefuseProof = { expected: 'refuse', name: 'refuses', mutate: noop };
const pid = 4242;

test('a baseline blocks a RED proof only when its target Rule is already breached', () => {
  assert.equal(baselineBlocksProof(red, failResult(['r2', 'r1'])), true);
  assert.equal(baselineBlocksProof(red, failResult(['r2'])), false);
  assert.equal(baselineBlocksProof(red, passResult()), false);
  assert.equal(baselineBlocksProof(red, refuseResult()), false);
});

test('a blocked baseline completes the proof as target-already-breached with the baseline as its result', () => {
  const baseline = failResult(['r2', 'r1']);
  const outcome = baselineOutcome(gate, red, baseline, pid);

  assert.deepEqual(outcome, {
    status: 'completed',
    gate: 'gate-under-test',
    proof: 'prove r1',
    expected: 'red',
    reason: { kind: 'target-already-breached', target: 'r1', breached: ['r2', 'r1'] },
    result: baseline,
    workerPid: pid,
  });
  assert.equal(proofEstablished(outcome), false);
});

test('a completed outcome carries the judgement for its own proof kind', () => {
  const redOutcome = completedOutcome(gate, red, failResult(['r1']), pid);
  assert.equal(redOutcome.expected, 'red');
  assert.deepEqual(redOutcome.reason, { kind: 'proved', target: 'r1' });
  assert.equal(proofEstablished(redOutcome), true);

  const greenOutcome = completedOutcome(gate, green, passResult(), pid);
  assert.equal(greenOutcome.expected, 'green');
  assert.deepEqual(greenOutcome.reason, { kind: 'proved' });
  assert.equal(proofEstablished(greenOutcome), true);

  const refuseOutcome = completedOutcome(gate, refuse, refuseResult(), pid);
  assert.equal(refuseOutcome.expected, 'refuse');
  assert.deepEqual(refuseOutcome.reason, { kind: 'proved' });
  assert.equal(proofEstablished(refuseOutcome), true);
});

test('a completed outcome that was not proved keeps the Check result and says why', () => {
  const result = refuseResult();
  const outcome = completedOutcome(gate, green, result, pid);

  assert.equal(outcome.status, 'completed');
  assert.equal(outcome.gate, 'gate-under-test');
  assert.equal(outcome.proof, 'stays green');
  assert.equal(outcome.workerPid, pid);
  assert.equal(outcome.result, result);
  assert.deepEqual(outcome.reason, { kind: 'verdict-mismatch', expected: 'pass', actual: 'refuse' });
  assert.equal(proofEstablished(outcome), false);
});

test('an infrastructure failure before a Check result aborts the proof under the code of its step', () => {
  const error = new Error('boom');
  const steps: readonly (readonly [ProofFailure, string, RegExp])[] = [
    [{ step: 'baseline', error }, 'check-threw', /baseline Check threw/],
    [{ step: 'apply', error }, 'mutation-apply-failed', /could not be applied/],
    [{ step: 'check', error }, 'check-threw', /^The Check threw/],
    [{ step: 'restore-after-check-threw', error }, 'mutation-restore-failed', /Check threw and .* could not be restored/],
  ];

  for (const [failure, code, message] of steps) {
    const outcome = failedOutcome(gate, green, failure, pid);
    assert.equal(outcome.status, 'aborted', failure.step);
    assert.equal(outcome.error.code, code, failure.step);
    assert.match(outcome.error.message, message, failure.step);
    assert.match(outcome.error.detail ?? '', /boom/, failure.step);
    assert.equal(outcome.expected, 'green');
    assert.equal(proofEstablished(outcome), false);
  }
});

test('a restore failure after a Check result leaves the proof unrestored and keeps that result', () => {
  const result = passResult();
  const outcome = failedOutcome(gate, refuse, { step: 'restore', error: 'undo exploded', result }, pid);

  assert.equal(outcome.status, 'unrestored');
  if (outcome.status !== 'unrestored') throw new Error('expected an unrestored proof');
  assert.equal(outcome.error.code, 'mutation-restore-failed');
  assert.equal(outcome.error.detail, 'undo exploded');
  assert.equal(outcome.result, result);
  assert.equal(outcome.expected, 'refuse');
  assert.equal(proofEstablished(outcome), false);
});

test('only a completed and proved outcome establishes a proof', () => {
  const established: ProofOutcome = {
    status: 'completed', gate: 'g', proof: 'p', expected: 'green', reason: { kind: 'proved' }, result: passResult(), workerPid: pid,
  };
  const mismatched: ProofOutcome = {
    ...established, reason: { kind: 'verdict-mismatch', expected: 'pass', actual: 'fail' },
  };
  const aborted: ProofOutcome = {
    status: 'aborted', gate: 'g', proof: 'p', expected: 'green', error: { code: 'check-threw', message: 'threw' }, workerPid: pid,
  };
  const unrestored: ProofOutcome = {
    status: 'unrestored', gate: 'g', proof: 'p', expected: 'green',
    error: { code: 'workspace-not-restored', message: 'stale' }, result: passResult(), workerPid: pid,
  };

  assert.equal(proofEstablished(established), true);
  assert.equal(proofEstablished(mismatched), false);
  assert.equal(proofEstablished(aborted), false);
  assert.equal(proofEstablished(unrestored), false);
});

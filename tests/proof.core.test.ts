import assert from 'node:assert/strict';
import test from 'node:test';
import { breach, fail, pass, proof, proofEstablished, refuse, type Scan } from 'redproof';
import { evaluateProof } from '../packages/redproof/src/proof/core/evaluation.ts';
import { applyInspectionPolicy } from '../packages/redproof/src/proof/core/inspection.ts';
import type { ProofOutcome } from '../packages/redproof/src/proof/core/outcome.ts';
import { canReuseWorkspace, verifyProofRestoration } from '../packages/redproof/src/proof/core/restoration.ts';

const scan: Scan = {
  source: 'unit',
  startedAt: '',
  finishedAt: '',
  inspected: 1,
};

const R1 = { id: 'r1', description: 'R1' } as const;
const R2 = { id: 'r2', description: 'R2' } as const;
const noop = { description: 'noop', async apply() { return async () => {}; } };

test('a zero-inspected PASS becomes REFUSE unless the Gate explicitly allows it', () => {
  const emptyScan: Scan = { ...scan, inspected: 0 };
  const emptyPass = pass(emptyScan);

  assert.deepEqual(applyInspectionPolicy(emptyPass, false), refuse(emptyScan, {
    code: 'nothing-inspected',
    message: 'The Check inspected no targets, so the Gate cannot establish its Rules.',
    location: null,
    hint: 'Set allowEmptyInspection: true on the Gate only when an empty target set is intentional.',
  }));
  assert.equal(applyInspectionPolicy(emptyPass, true), emptyPass);
});

test('inspection policy preserves unknown counts and non-PASS evidence', () => {
  const unknownPass = pass({ ...scan, inspected: null });
  const emptyFailure = fail({ ...scan, inspected: 0 }, [
    breach(R1.id, { code: 'r1', message: 'R1 failed', location: null }),
  ]);
  const emptyRefusal = refuse({ ...scan, inspected: 0 }, {
    code: 'unavailable', message: 'Unavailable', location: null,
  });

  assert.equal(applyInspectionPolicy(unknownPass, false), unknownPass);
  assert.equal(applyInspectionPolicy(emptyFailure, false), emptyFailure);
  assert.equal(applyInspectionPolicy(emptyRefusal, false), emptyRefusal);
});

test('RED proof requires its target Rule, not merely a failed Gate', () => {
  const result = fail(scan, [
    breach(R2.id, { code: 'r2', message: 'R2 failed', location: null }),
  ]);

  assert.deepEqual(evaluateProof(proof.red(R1, 'prove R1', noop), result), {
    kind: 'target-rule-not-breached',
    target: 'r1',
    breached: ['r2'],
  });
});

test('proof evaluation distinguishes verdict mismatch from success', () => {
  assert.deepEqual(evaluateProof(proof.green('green'), pass(scan)), { kind: 'proved' });
  assert.deepEqual(evaluateProof(proof.green('green'), refuse(scan, {
    code: 'no-input', message: 'No input', location: null,
  })), {
    kind: 'verdict-mismatch',
    expected: 'pass',
    actual: 'refuse',
  });
});

test('restoration failure replaces proof success and prevents copy reuse', () => {
  const result = pass(scan);
  const completed: ProofOutcome = {
    status: 'completed',
    gate: 'g',
    proof: 'p',
    expected: 'green',
    reason: { kind: 'proved' },
    result,
    workerPid: 10,
  };

  const outcome = verifyProofRestoration(
    completed,
    { kind: 'stale', why: 'workspace changed' },
    10,
  );

  assert.equal(outcome.status, 'unrestored');
  assert.equal(proofEstablished(outcome), false);
  if (outcome.status !== 'unrestored') throw new Error('expected an unrestored proof');
  assert.equal(outcome.error.code, 'workspace-not-restored');
  assert.equal(outcome.result, result);
  assert.equal(canReuseWorkspace(outcome), false);
  assert.equal(canReuseWorkspace(completed), true);
});

test('a stale workspace after an aborted proof stays aborted, because no Check result exists', () => {
  const aborted: ProofOutcome = {
    status: 'aborted',
    gate: 'g',
    proof: 'p',
    expected: 'green',
    error: { code: 'mutation-apply-failed', message: 'cannot apply' },
    workerPid: 10,
  };

  const outcome = verifyProofRestoration(aborted, { kind: 'stale', why: 'workspace changed' }, 10);

  assert.equal(outcome.status, 'aborted');
  if (outcome.status !== 'aborted') throw new Error('expected an aborted proof');
  assert.equal(outcome.error.code, 'workspace-not-restored');
  assert.equal(canReuseWorkspace(outcome), false);
  assert.equal(canReuseWorkspace(aborted), true);
});

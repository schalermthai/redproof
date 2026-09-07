import assert from 'node:assert/strict';
import test from 'node:test';
import { breach, fail, pass, proof, refuse, type Scan } from 'redproof';
import { evaluateProof } from '../packages/redproof/src/proof/core/evaluation.ts';
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
    ok: true,
    reason: { kind: 'proved' },
    result,
    workerPid: 10,
  };

  const outcome = verifyProofRestoration(
    completed,
    { kind: 'stale', why: 'workspace changed' },
    10,
  );

  assert.equal(outcome.status, 'error');
  assert.equal(outcome.ok, false);
  if (outcome.status !== 'error') throw new Error('expected error');
  assert.equal(outcome.error.code, 'workspace-not-restored');
  assert.equal(outcome.result, result);
  assert.equal(canReuseWorkspace(outcome), false);
  assert.equal(canReuseWorkspace(completed), true);
});

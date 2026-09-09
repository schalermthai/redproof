import assert from 'node:assert/strict';
import test from 'node:test';
import {
  proofEstablished,
  type AbortedProofOutcome,
  type CompletedProofOutcome,
  type ProofInfrastructureErrorCode,
  type UnrestoredProofOutcome,
} from '../../packages/redproof/src/proof/core/outcome.ts';
import { canReuseWorkspace, verifyProofRestoration } from '../../packages/redproof/src/proof/core/restoration.ts';
import { passResult } from './results.ts';

const identity = { gate: 'g', proof: 'p', expected: 'green', workerPid: 10 } as const;
const stale = { kind: 'stale', why: 'src/example.ts changed' } as const;
const fresh = { kind: 'fresh' } as const;

const proved: CompletedProofOutcome = { status: 'completed', ...identity, reason: { kind: 'proved' }, result: passResult() };

function aborted(code: ProofInfrastructureErrorCode): AbortedProofOutcome {
  return { status: 'aborted', ...identity, error: { code, message: code } };
}

const unrestored: UnrestoredProofOutcome = {
  status: 'unrestored', ...identity, error: { code: 'mutation-restore-failed', message: 'undo failed' }, result: passResult(),
};

test('a fresh workspace leaves every outcome exactly as the proof reported it', () => {
  assert.equal(verifyProofRestoration(proved, fresh, 99), proved);
  assert.equal(verifyProofRestoration(aborted('check-threw'), fresh, 99).status, 'aborted');
  assert.equal(verifyProofRestoration(unrestored, fresh, 99), unrestored);
});

test('a stale workspace turns a proved proof into an unrestored one that keeps the Check result', () => {
  const outcome = verifyProofRestoration(proved, stale, 77);

  assert.equal(outcome.status, 'unrestored');
  if (outcome.status !== 'unrestored') throw new Error('expected an unrestored proof');
  assert.equal(outcome.error.code, 'workspace-not-restored');
  assert.equal(outcome.error.detail, 'src/example.ts changed');
  assert.equal(outcome.result, proved.result);
  assert.equal(outcome.gate, 'g');
  assert.equal(outcome.proof, 'p');
  assert.equal(outcome.workerPid, 77, 'the verifying worker signs the outcome');
  assert.equal(proofEstablished(outcome), false);
});

test('a stale workspace after an aborted proof stays aborted, because no Check result exists', () => {
  const outcome = verifyProofRestoration(aborted('mutation-apply-failed'), stale, 10);

  assert.equal(outcome.status, 'aborted');
  if (outcome.status !== 'aborted') throw new Error('expected an aborted proof');
  assert.equal(outcome.error.code, 'workspace-not-restored');
  assert.equal(outcome.error.detail, 'src/example.ts changed');
});

test('a Gate copy may be reused only when the proof left it trustworthy', () => {
  assert.equal(canReuseWorkspace(proved), true);
  assert.equal(canReuseWorkspace({ ...proved, reason: { kind: 'verdict-mismatch', expected: 'pass', actual: 'fail' } }), true);
  assert.equal(canReuseWorkspace(aborted('check-threw')), true);
  assert.equal(canReuseWorkspace(aborted('mutation-apply-failed')), true);

  assert.equal(canReuseWorkspace(aborted('mutation-restore-failed')), false);
  assert.equal(canReuseWorkspace(aborted('workspace-not-restored')), false);
  assert.equal(canReuseWorkspace(unrestored), false);
  assert.equal(canReuseWorkspace(verifyProofRestoration(proved, stale, 10)), false);
});

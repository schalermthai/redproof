import type { CheckResult, Gate, Proof } from '../../domain/index.ts';
import { evaluateProof, proofSucceeded } from './evaluation.ts';
import type {
  CompletedProofOutcome,
  InfrastructureProofOutcome,
  ProofInfrastructureError,
} from './outcome.ts';

export type ProofFailure =
  | { readonly step: 'baseline'; readonly error: unknown }
  | { readonly step: 'apply'; readonly error: unknown }
  | { readonly step: 'check'; readonly error: unknown }
  | { readonly step: 'restore-after-check-threw'; readonly error: unknown }
  | { readonly step: 'restore'; readonly error: unknown; readonly result: CheckResult };

const FAILURE_CODES: Record<ProofFailure['step'], ProofInfrastructureError['code']> = {
  baseline: 'check-threw',
  apply: 'mutation-apply-failed',
  check: 'check-threw',
  'restore-after-check-threw': 'mutation-restore-failed',
  restore: 'mutation-restore-failed',
};

const FAILURE_MESSAGES: Record<ProofFailure['step'], string> = {
  baseline: 'The baseline Check threw instead of returning a CheckResult.',
  apply: 'Proof mutation could not be applied.',
  check: 'The Check threw instead of returning a CheckResult.',
  'restore-after-check-threw': 'The Check threw and the proof mutation could not be restored.',
  restore: 'The proof mutation could not restore the workspace.',
};

function errorDetail(error: unknown): string {
  return error instanceof Error ? error.stack ?? error.message : String(error);
}

/** A RED proof needs a mutation to cause the breach. A target already breached before mutation proves nothing. */
export function baselineBlocksProof(proof: Proof, baseline: CheckResult): boolean {
  return proof.expected === 'red'
    && baseline.verdict === 'fail'
    && baseline.breaches.some(item => item.rule === proof.target);
}

export function baselineOutcome(
  gate: Gate<any>,
  proof: Proof,
  baseline: CheckResult,
  workerPid: number,
): CompletedProofOutcome {
  const breached = baseline.verdict === 'fail' ? baseline.breaches.map(item => item.rule) : [];
  return {
    status: 'completed',
    gate: gate.id,
    proof: proof.name,
    expected: proof.expected,
    ok: false,
    reason: { kind: 'target-already-breached', target: proof.expected === 'red' ? proof.target : '', breached },
    result: baseline,
    workerPid,
  };
}

export function completedOutcome(
  gate: Gate<any>,
  proof: Proof,
  result: CheckResult,
  workerPid: number,
): CompletedProofOutcome {
  const reason = evaluateProof(proof, result);
  return {
    status: 'completed',
    gate: gate.id,
    proof: proof.name,
    expected: proof.expected,
    ok: proofSucceeded(reason),
    reason,
    result,
    workerPid,
  };
}

export function failedOutcome(
  gate: Gate<any>,
  proof: Proof,
  failure: ProofFailure,
  workerPid: number,
): InfrastructureProofOutcome {
  return {
    status: 'error',
    gate: gate.id,
    proof: proof.name,
    expected: proof.expected,
    ok: false,
    error: {
      code: FAILURE_CODES[failure.step],
      message: FAILURE_MESSAGES[failure.step],
      detail: errorDetail(failure.error),
    },
    ...(failure.step === 'restore' ? { result: failure.result } : {}),
    workerPid,
  };
}

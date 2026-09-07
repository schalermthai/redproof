import type { CheckResult, Gate, Proof, RedProof } from '../../domain/index.ts';
import { evaluateProof } from './evaluation.ts';
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

const FAILURE_CODES = {
  baseline: 'check-threw',
  apply: 'mutation-apply-failed',
  check: 'check-threw',
  'restore-after-check-threw': 'mutation-restore-failed',
  restore: 'mutation-restore-failed',
} as const satisfies Record<ProofFailure['step'], ProofInfrastructureError['code']>;

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
export function baselineBlocksProof(proof: RedProof, baseline: CheckResult): boolean {
  return baseline.verdict === 'fail' && baseline.breaches.some(item => item.rule === proof.target);
}

export function baselineOutcome(
  gate: Gate<any>,
  proof: RedProof,
  baseline: CheckResult,
  workerPid: number,
): CompletedProofOutcome {
  const breached = baseline.verdict === 'fail' ? baseline.breaches.map(item => item.rule) : [];
  return {
    status: 'completed',
    gate: gate.id,
    proof: proof.name,
    expected: proof.expected,
    reason: { kind: 'target-already-breached', target: proof.target, breached },
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
  return {
    status: 'completed',
    gate: gate.id,
    proof: proof.name,
    expected: proof.expected,
    reason: evaluateProof(proof, result),
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
  if (failure.step === 'restore') {
    return {
      status: 'unrestored',
      gate: gate.id,
      proof: proof.name,
      expected: proof.expected,
      error: {
        code: FAILURE_CODES.restore,
        message: FAILURE_MESSAGES.restore,
        detail: errorDetail(failure.error),
      },
      result: failure.result,
      workerPid,
    };
  }

  return {
    status: 'aborted',
    gate: gate.id,
    proof: proof.name,
    expected: proof.expected,
    error: {
      code: FAILURE_CODES[failure.step],
      message: FAILURE_MESSAGES[failure.step],
      detail: errorDetail(failure.error),
    },
    workerPid,
  };
}

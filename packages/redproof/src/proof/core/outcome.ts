import type { CheckResult, Proof } from '../../domain/index.ts';
import {
  proofSucceeded,
  type GreenProofEvaluation,
  type RedProofEvaluation,
  type RefuseProofEvaluation,
} from './evaluation.ts';

export type RestorationErrorCode = 'mutation-restore-failed' | 'workspace-not-restored';

export type ProofInfrastructureErrorCode =
  | 'mutation-apply-failed'
  | 'check-threw'
  | RestorationErrorCode;

export type ProofInfrastructureError<
  Code extends ProofInfrastructureErrorCode = ProofInfrastructureErrorCode,
> = {
  readonly code: Code;
  readonly message: string;
  readonly detail?: string;
};

type Completed<Expected extends Proof['expected'], Reason> = {
  readonly status: 'completed';
  readonly gate: string;
  readonly proof: string;
  readonly expected: Expected;
  /** How the proof was judged. */
  readonly reason: Reason;
  readonly result: CheckResult;
  readonly workerPid: number;
};

export type CompletedProofOutcome =
  | Completed<'red', RedProofEvaluation>
  | Completed<'green', GreenProofEvaluation>
  | Completed<'refuse', RefuseProofEvaluation>;

/** Infrastructure failed before the Check returned a result. */
export type AbortedProofOutcome = {
  readonly status: 'aborted';
  readonly gate: string;
  readonly proof: string;
  readonly expected: Proof['expected'];
  readonly error: ProofInfrastructureError;
  readonly workerPid: number;
};

/** The Check returned a result, then the workspace did not return to its baseline. */
export type UnrestoredProofOutcome = {
  readonly status: 'unrestored';
  readonly gate: string;
  readonly proof: string;
  readonly expected: Proof['expected'];
  readonly error: ProofInfrastructureError<RestorationErrorCode>;
  readonly result: CheckResult;
  readonly workerPid: number;
};

export type InfrastructureProofOutcome = AbortedProofOutcome | UnrestoredProofOutcome;

export type ProofOutcome = CompletedProofOutcome | InfrastructureProofOutcome;

export function proofEstablished(outcome: ProofOutcome): boolean {
  return outcome.status === 'completed' && proofSucceeded(outcome.reason);
}

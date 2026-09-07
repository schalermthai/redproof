import type { CheckResult, Proof } from '../../domain/index.ts';
import type { ProofEvaluation } from './evaluation.ts';

export type ProofInfrastructureError = {
  readonly code:
    | 'mutation-apply-failed'
    | 'check-threw'
    | 'mutation-restore-failed'
    | 'workspace-not-restored';
  readonly message: string;
  readonly detail?: string;
};

export type CompletedProofOutcome = {
  readonly status: 'completed';
  readonly gate: string;
  readonly proof: string;
  readonly expected: Proof['expected'];
  readonly ok: boolean;
  /** How the proof was judged. `ok` is `reason.kind === 'proved'`. */
  readonly reason: ProofEvaluation;
  readonly result: CheckResult;
  readonly workerPid: number;
};

export type InfrastructureProofOutcome = {
  readonly status: 'error';
  readonly gate: string;
  readonly proof: string;
  readonly expected: Proof['expected'];
  readonly ok: false;
  readonly error: ProofInfrastructureError;
  readonly result?: CheckResult;
  readonly workerPid: number;
};

export type ProofOutcome = CompletedProofOutcome | InfrastructureProofOutcome;

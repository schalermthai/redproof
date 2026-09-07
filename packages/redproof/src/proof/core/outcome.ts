import type { CheckResult } from '../../domain/check.ts';
import type { Proof } from '../../domain/proof.ts';

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

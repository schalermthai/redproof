import type { InfrastructureProofOutcome, ProofOutcome } from './proof-outcome.ts';
import type { Freshness } from './restoration.ts';

/** Pure interpretation of workspace verification after a proof has run and its UndoMutation completed. */
export function verifyProofRestoration(
  outcome: ProofOutcome,
  freshness: Freshness,
  workerPid: number,
): ProofOutcome {
  if (freshness.kind === 'fresh') return outcome;

  const error: InfrastructureProofOutcome = {
    status: 'error',
    gate: outcome.gate,
    proof: outcome.proof,
    expected: outcome.expected,
    ok: false,
    error: {
      code: 'workspace-not-restored',
      message: 'The Gate workspace did not return to its baseline after the proof.',
      detail: freshness.why,
    },
    ...(outcome.status === 'completed' ? { result: outcome.result } : outcome.result ? { result: outcome.result } : {}),
    workerPid,
  };

  return error;
}

/** A Gate copy may only be reused when proof infrastructure left it trustworthy. */
export function canReuseWorkspace(outcome: ProofOutcome): boolean {
  return outcome.status !== 'error'
    || (outcome.error.code !== 'mutation-restore-failed' && outcome.error.code !== 'workspace-not-restored');
}

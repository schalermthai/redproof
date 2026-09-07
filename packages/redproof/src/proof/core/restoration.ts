import type { ProofInfrastructureError, ProofOutcome, RestorationErrorCode } from './outcome.ts';
import type { Freshness } from '../../workspace/core/index.ts';

/** Pure interpretation of workspace verification after a proof has run and its UndoMutation completed. */
export function verifyProofRestoration(
  outcome: ProofOutcome,
  freshness: Freshness,
  workerPid: number,
): ProofOutcome {
  if (freshness.kind === 'fresh') return outcome;

  const error: ProofInfrastructureError<RestorationErrorCode> = {
    code: 'workspace-not-restored',
    message: 'The Gate workspace did not return to its baseline after the proof.',
    detail: freshness.why,
  };
  const identity = { gate: outcome.gate, proof: outcome.proof, expected: outcome.expected, workerPid };

  if (outcome.status === 'aborted') return { status: 'aborted', ...identity, error };
  return { status: 'unrestored', ...identity, error, result: outcome.result };
}

/** A Gate copy may only be reused when proof infrastructure left it trustworthy. */
export function canReuseWorkspace(outcome: ProofOutcome): boolean {
  if (outcome.status === 'completed') return true;
  if (outcome.status === 'unrestored') return false;
  return outcome.error.code !== 'mutation-restore-failed' && outcome.error.code !== 'workspace-not-restored';
}

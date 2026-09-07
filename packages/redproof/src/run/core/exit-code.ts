import type { CheckResult } from '../../domain/index.ts';
import { proofEstablished, type ProofOutcome } from '../../proof/core/index.ts';

/** Pure process-status policy for a project Check run. REFUSE takes precedence over FAIL. */
export function checkExitCode(results: readonly CheckResult[], refusalExit: number): number {
  if (results.some(result => result.verdict === 'refuse')) return refusalExit;
  if (results.some(result => result.verdict === 'fail')) return 1;
  return 0;
}

/** Pure process-status policy for proof runs. */
export function proofExitCode(outcomes: readonly ProofOutcome[]): number {
  return outcomes.every(proofEstablished) ? 0 : 1;
}

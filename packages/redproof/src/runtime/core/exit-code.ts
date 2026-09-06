import type { CheckResult } from '../../domain/check.ts';

/** Pure process-status policy for a project Check run. REFUSE takes precedence over FAIL. */
export function checkExitCode(results: readonly CheckResult[], refusalExit: number): number {
  if (results.some(result => result.verdict === 'refuse')) return refusalExit;
  if (results.some(result => result.verdict === 'fail')) return 1;
  return 0;
}

/** Pure process-status policy for proof runs. */
export function proofExitCode(outcomes: readonly { readonly ok: boolean }[]): number {
  return outcomes.every(outcome => outcome.ok) ? 0 : 1;
}

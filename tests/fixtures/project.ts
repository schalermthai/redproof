import { resolve } from 'node:path';
import { proofEstablished, type ProveProjectRun } from 'redproof';

/** The fixture projects are run through the same entrypoints a user calls. */
export const configOf = (name: string): string =>
  resolve(`fixtures/${name}/redproof.config.ts`);

export type ProofSummary = readonly [expected: string, established: boolean, verdict: string];

/** What each proof expected, whether it was established, and what the Check said. */
export function proofSummary(run: ProveProjectRun): readonly ProofSummary[] {
  return run.outcomes.map(outcome => [
    outcome.expected,
    proofEstablished(outcome),
    outcome.status === 'completed' ? outcome.result.verdict : outcome.error.code,
  ]);
}

export function refusalCodes(run: ProveProjectRun): readonly string[] {
  return run.outcomes.flatMap(outcome =>
    outcome.status === 'completed' && outcome.result.verdict === 'refuse'
      ? [outcome.result.why.code]
      : []);
}

export function breachedRules(run: ProveProjectRun, index: number): readonly string[] {
  const outcome = run.outcomes[index];
  if (!outcome || outcome.status !== 'completed' || outcome.result.verdict !== 'fail') {
    throw new Error(`proof ${index} did not complete with a FAIL verdict`);
  }
  return outcome.result.breaches.map(item => item.rule);
}

import type { CheckProjectRun, ProveProjectRun } from '../run/shell/project-runner.ts';
import { buildJsonCheckReport } from './check-report.ts';

export type JsonReporterOptions = {
  readonly pretty?: boolean;
};

export function formatJsonRun(run: CheckProjectRun, options: JsonReporterOptions = {}): string {
  return JSON.stringify(buildJsonCheckReport(run), null, options.pretty === false ? undefined : 2);
}

export type JsonProofOutcomeV1 = {
  readonly gate: string;
  readonly proof: string;
  readonly expected: 'red' | 'green' | 'refuse';
  readonly status: 'proved' | 'not-proved' | 'infrastructure-error';
  readonly workerPid: number;
  readonly check?: {
    readonly verdict: 'pass' | 'fail' | 'refuse';
  };
  readonly error?: {
    readonly code: string;
    readonly message: string;
    readonly detail?: string;
  };
};

export type JsonProveReportV1 = {
  readonly version: 1;
  readonly command: 'prove';
  readonly status: 'passed' | 'failed';
  readonly proofs: readonly JsonProofOutcomeV1[];
};

export function buildJsonProveReport(run: ProveProjectRun): JsonProveReportV1 {
  return {
    version: 1,
    command: 'prove',
    status: run.exitCode === 0 ? 'passed' : 'failed',
    proofs: run.outcomes.map(outcome => ({
      gate: outcome.gate,
      proof: outcome.proof,
      expected: outcome.expected,
      status: outcome.status === 'error'
        ? 'infrastructure-error'
        : outcome.ok ? 'proved' : 'not-proved',
      workerPid: outcome.workerPid,
      ...(outcome.result ? { check: { verdict: outcome.result.verdict } } : {}),
      ...(outcome.status === 'error'
        ? {
            error: {
              code: outcome.error.code,
              message: outcome.error.message,
              ...(outcome.error.detail ? { detail: outcome.error.detail } : {}),
            },
          }
        : {}),
    })),
  };
}

export function formatJsonProofs(run: ProveProjectRun, options: JsonReporterOptions = {}): string {
  return JSON.stringify(buildJsonProveReport(run), null, options.pretty === false ? undefined : 2);
}

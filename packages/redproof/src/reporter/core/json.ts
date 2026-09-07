import type { CheckResult } from '../../domain/index.ts';
import type { ProofEvaluation } from '../../proof/core/index.ts';
import type { CheckProjectRun, ProveProjectRun } from '../../run/core/index.ts';
import { buildJsonCheckReport, type JsonBreachV1, type JsonDiagnosticV1 } from './check-report.ts';

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
  /** How the proof was judged. Absent on an infrastructure error. */
  readonly reason?: ProofEvaluation;
  readonly check?: {
    readonly verdict: 'pass' | 'fail' | 'refuse';
    readonly breaches?: readonly JsonBreachV1[];
    readonly refusal?: JsonDiagnosticV1;
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

function jsonCheck(result: CheckResult): NonNullable<JsonProofOutcomeV1['check']> {
  if (result.verdict === 'fail') {
    return {
      verdict: 'fail',
      breaches: result.breaches.map(item => ({
        rule: item.rule,
        code: item.code,
        message: item.message,
        location: item.location,
        ...(item.comparison ? { comparison: item.comparison } : {}),
        ...(item.detail ? { detail: item.detail } : {}),
        ...(item.hint ? { hint: item.hint } : {}),
      })),
    };
  }
  if (result.verdict === 'refuse') {
    const why = result.why;
    return {
      verdict: 'refuse',
      refusal: {
        code: why.code,
        message: why.message,
        location: why.location,
        ...(why.comparison ? { comparison: why.comparison } : {}),
        ...(why.detail ? { detail: why.detail } : {}),
        ...(why.hint ? { hint: why.hint } : {}),
      },
    };
  }
  return { verdict: 'pass' };
}

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
      ...(outcome.status === 'completed' ? { reason: outcome.reason } : {}),
      ...(outcome.result ? { check: jsonCheck(outcome.result) } : {}),
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

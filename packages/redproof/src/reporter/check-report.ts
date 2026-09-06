import { relative } from 'node:path';
import type { Breach, CountingCapability, Scan } from '../domain/check.ts';
import type { Diagnostic } from '../domain/diagnostic.ts';
import type { CheckProjectRun, GateRun } from '../runtime/shell/project-runner.ts';
import { buildGateReportModel, summarizeGateReports } from './model.ts';

export type ReportVersion = 1;

export type JsonDiagnosticV1 = {
  readonly code: string;
  readonly message: string;
  readonly location: Diagnostic['location'];
  readonly comparison?: Diagnostic['comparison'];
  readonly detail?: string;
  readonly hint?: string;
};

export type JsonBreachV1 = JsonDiagnosticV1 & {
  readonly rule: string;
};

export type JsonRuleV1 = {
  readonly id: string;
  readonly description: string;
  readonly status: 'held' | 'breached' | 'undecided' | 'unknown';
  readonly breachCount: number | null;
  readonly breaches: readonly JsonBreachV1[];
};

export type JsonGateV1 = {
  readonly id: string;
  readonly file: string;
  readonly adapter: string;
  readonly check: string;
  readonly verdict: 'pass' | 'fail' | 'refuse';
  readonly durationMs: number;
  readonly counting: CountingCapability;
  readonly scan: Scan;
  readonly rules: readonly JsonRuleV1[];
  readonly refusal?: JsonDiagnosticV1;
};

export type JsonRunSummaryV1 = {
  readonly gates: {
    readonly passed: number;
    readonly failed: number;
    readonly refused: number;
    readonly total: number;
  };
  readonly rules: {
    readonly held: number;
    readonly breached: number;
    readonly undecided: number;
    readonly unknown: number;
    readonly total: number;
  };
  readonly breaches:
    | { readonly kind: 'exact'; readonly count: number }
    | { readonly kind: 'not-countable' };
};

export type JsonCheckReportV1 = {
  readonly version: ReportVersion;
  readonly command: 'check';
  readonly status: 'passed' | 'failed' | 'refused';
  readonly startedAt: string;
  readonly durationMs: number;
  readonly gates: readonly JsonGateV1[];
  readonly summary: JsonRunSummaryV1;
};

function diagnosticToJson(diagnostic: Diagnostic): JsonDiagnosticV1 {
  return {
    code: diagnostic.code,
    message: diagnostic.message,
    location: diagnostic.location,
    ...(diagnostic.comparison ? { comparison: diagnostic.comparison } : {}),
    ...(diagnostic.detail ? { detail: diagnostic.detail } : {}),
    ...(diagnostic.hint ? { hint: diagnostic.hint } : {}),
  };
}

function breachToJson(breach: Breach): JsonBreachV1 {
  return {
    rule: breach.rule,
    ...diagnosticToJson(breach),
  };
}

function gateToJson(run: GateRun, root: string): JsonGateV1 {
  const gate = run.module.gate;
  const model = buildGateReportModel(gate.adapter, run.result);

  return {
    id: gate.id,
    file: relative(root, run.module.file).replaceAll('\\', '/'),
    adapter: gate.adapter.kind,
    check: gate.adapter.check.description,
    verdict: run.result.verdict,
    durationMs: run.durationMs,
    counting: gate.adapter.check.counting,
    scan: run.result.scan,
    rules: model.rules.map(item => ({
      id: item.rule.id,
      description: item.rule.description,
      status: item.state.kind,
      breachCount: item.state.kind === 'breached' ? item.state.count : item.state.kind === 'held' ? 0 : null,
      breaches: item.breaches.map(breachToJson),
    })),
    ...(run.result.verdict === 'refuse' ? { refusal: diagnosticToJson(run.result.why) } : {}),
  };
}

export function buildJsonCheckReport(run: CheckProjectRun): JsonCheckReportV1 {
  const gateModels = run.results.map(item => buildGateReportModel(item.module.gate.adapter, item.result));
  const summary = summarizeGateReports(gateModels);
  const status = summary.failedGates > 0
    ? 'failed'
    : summary.refusedGates > 0
      ? 'refused'
      : 'passed';

  return {
    version: 1,
    command: 'check',
    status,
    startedAt: run.startedAt.toISOString(),
    durationMs: run.durationMs,
    gates: run.results.map(item => gateToJson(item, run.project.root)),
    summary: {
      gates: {
        passed: summary.passedGates,
        failed: summary.failedGates,
        refused: summary.refusedGates,
        total: run.results.length,
      },
      rules: {
        held: summary.heldRules,
        breached: summary.breachedRules,
        undecided: summary.undecidedRules,
        unknown: summary.unknownRules,
        total: summary.totalRules,
      },
      breaches: summary.exactBreachCount
        ? { kind: 'exact', count: summary.breaches }
        : { kind: 'not-countable' },
    },
  };
}

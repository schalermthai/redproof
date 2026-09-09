import type {
  Adapter,
  Breach,
  CheckProjectRun,
  CheckResult,
  CountingCapability,
  Diagnostic,
  GateRun,
  Location,
  ProofOutcome,
  ProveProjectRun,
  Rule,
  Scan,
} from 'redproof';

export const ROOT = '/p';

export const scan: Scan = { source: 'unit', startedAt: '', finishedAt: '', inspected: 1 };

export const supported: CountingCapability = { kind: 'supported' };
export const UNSUPPORTED_REASON = 'only the first finding is observable';
export const unsupported: CountingCapability = { kind: 'unsupported', reason: UNSUPPORTED_REASON };

export function rule(id: string, description = id): Rule {
  return { id, description };
}

export function pass(inspected: number | null = 1): CheckResult {
  return { verdict: 'pass', scan: { ...scan, inspected } };
}

export function fail(first: Breach, ...rest: readonly Breach[]): CheckResult {
  return { verdict: 'fail', scan, breaches: [first, ...rest] };
}

export function refuse(why: Diagnostic): CheckResult {
  return { verdict: 'refuse', scan, why };
}

export function at(file: string, line: number | null = null, column: number | null = null): Location {
  return { file, line, column };
}

export function breach(
  rule: Rule | string,
  message: string,
  location: Location | null = null,
  extra: Partial<Pick<Diagnostic, 'code' | 'comparison' | 'detail' | 'hint'>> = {},
): Breach {
  const { code, ...optional } = extra;
  return {
    rule: typeof rule === 'string' ? rule : rule.id,
    code: code ?? 'code',
    message,
    location,
    ...optional,
  };
}

export type GateSpec = {
  readonly id: string;
  readonly rules: readonly Rule[];
  readonly result: CheckResult;
  readonly counting?: CountingCapability;
  readonly file?: string;
  readonly durationMs?: number;
};

export function adapter(rules: readonly Rule[], counting: CountingCapability = supported, kind = 'unit'): Adapter {
  return {
    kind,
    rules: Object.fromEntries(rules.map(item => [item.id, item])),
    check: { description: `${kind} check`, counting, async run() { return pass(); } },
  };
}

export function gate(spec: GateSpec): GateRun {
  return {
    module: {
      file: spec.file ?? `${ROOT}/gates/${spec.id}.ts`,
      gate: { id: spec.id, adapter: adapter(spec.rules, spec.counting ?? supported) },
    },
    result: spec.result,
    durationMs: spec.durationMs ?? 3,
    workerPid: 1,
  };
}

export function proveRun(outcomes: readonly ProofOutcome[], exitCode: number): ProveProjectRun {
  return {
    project: { root: ROOT, refusalExit: 2, execution: { mode: 'in-place' }, modules: [] },
    outcomes,
    exitCode,
  };
}

export function run(
  gates: readonly GateRun[],
  overrides: Partial<Pick<CheckProjectRun, 'exitCode' | 'durationMs' | 'startedAt'>> = {},
): CheckProjectRun {
  const failed = gates.some(item => item.result.verdict === 'fail');
  const refused = gates.some(item => item.result.verdict === 'refuse');
  return {
    project: { root: ROOT, refusalExit: 2, execution: { mode: 'in-place' }, modules: gates.map(item => item.module) },
    results: gates,
    exitCode: overrides.exitCode ?? (failed ? 1 : refused ? 2 : 0),
    startedAt: overrides.startedAt ?? new Date(0),
    durationMs: overrides.durationMs ?? 3,
  };
}

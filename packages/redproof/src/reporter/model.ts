import type { Adapter } from '../domain/adapter.ts';
import type { Breach, CheckResult, CountingCapability } from '../domain/check.ts';
import type { Rule, RuleRef } from '../domain/rule.ts';

export type RuleReportState =
  | { readonly kind: 'held' }
  | { readonly kind: 'undecided' }
  | { readonly kind: 'unknown' }
  | { readonly kind: 'breached'; readonly count: number | null };

export type RuleReport = {
  readonly rule: Rule;
  readonly state: RuleReportState;
  readonly breaches: readonly Breach[];
};

export type GateReportModel = {
  readonly verdict: CheckResult['verdict'];
  readonly counting: CountingCapability;
  readonly rules: readonly RuleReport[];
  readonly breachedRules: number;
  readonly breachCount: number;
};

export type RunSummary = {
  readonly passedGates: number;
  readonly failedGates: number;
  readonly refusedGates: number;
  readonly heldRules: number;
  readonly breachedRules: number;
  readonly undecidedRules: number;
  readonly unknownRules: number;
  readonly totalRules: number;
  readonly breaches: number;
  readonly exactBreachCount: boolean;
};

function rulesOf(adapter: Adapter<any>): readonly Rule[] {
  return Object.values(adapter.rules as Readonly<Record<string, Rule>>);
}

function groupBreaches(result: Extract<CheckResult, { verdict: 'fail' }>): Map<RuleRef, Breach[]> {
  const groups = new Map<RuleRef, Breach[]>();
  for (const breach of result.breaches) {
    const group = groups.get(breach.rule) ?? [];
    group.push(breach);
    groups.set(breach.rule, group);
  }
  return groups;
}

/** Pure projection from Adapter + CheckResult to the Rule states a reporter may claim. */
export function buildGateReportModel(adapter: Adapter<any>, result: CheckResult): GateReportModel {
  const rules = rulesOf(adapter);
  const counting = adapter.check.counting;

  if (result.verdict === 'pass') {
    return {
      verdict: 'pass',
      counting,
      rules: rules.map(rule => ({ rule, state: { kind: 'held' }, breaches: [] })),
      breachedRules: 0,
      breachCount: 0,
    };
  }

  if (result.verdict === 'refuse') {
    return {
      verdict: 'refuse',
      counting,
      rules: rules.map(rule => ({ rule, state: { kind: 'undecided' }, breaches: [] })),
      breachedRules: 0,
      breachCount: 0,
    };
  }

  const groups = groupBreaches(result);
  const ruleReports = rules.map(rule => {
    const breaches = groups.get(rule.id) ?? [];
    if (breaches.length > 0) {
      return {
        rule,
        state: { kind: 'breached', count: counting.kind === 'supported' ? breaches.length : null } as const,
        breaches,
      };
    }

    return {
      rule,
      state: counting.kind === 'supported' ? { kind: 'held' as const } : { kind: 'unknown' as const },
      breaches,
    };
  });

  return {
    verdict: 'fail',
    counting,
    rules: ruleReports,
    breachedRules: new Set(result.breaches.map(breach => breach.rule)).size,
    breachCount: result.breaches.length,
  };
}

/** Pure aggregation used by terminal and future reporters. */
export function summarizeGateReports(gates: readonly GateReportModel[]): RunSummary {
  let passedGates = 0;
  let failedGates = 0;
  let refusedGates = 0;
  let heldRules = 0;
  let breachedRules = 0;
  let undecidedRules = 0;
  let unknownRules = 0;
  let totalRules = 0;
  let breaches = 0;
  let exactBreachCount = true;

  for (const gate of gates) {
    if (gate.verdict === 'pass') passedGates++;
    else if (gate.verdict === 'fail') failedGates++;
    else refusedGates++;

    totalRules += gate.rules.length;
    breaches += gate.breachCount;
    if (gate.verdict === 'fail' && gate.counting.kind === 'unsupported') exactBreachCount = false;

    for (const rule of gate.rules) {
      if (rule.state.kind === 'held') heldRules++;
      else if (rule.state.kind === 'breached') breachedRules++;
      else if (rule.state.kind === 'undecided') undecidedRules++;
      else unknownRules++;
    }
  }

  return {
    passedGates,
    failedGates,
    refusedGates,
    heldRules,
    breachedRules,
    undecidedRules,
    unknownRules,
    totalRules,
    breaches,
    exactBreachCount,
  };
}

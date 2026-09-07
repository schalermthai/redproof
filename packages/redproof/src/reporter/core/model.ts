import type {
  Adapter,
  Breach,
  CheckResult,
  CountingCapability,
  NonEmptyList,
  Rule,
  RuleRef,
} from '../../domain/index.ts';

export type RuleReportState =
  | { readonly kind: 'held' }
  | { readonly kind: 'undecided' }
  | { readonly kind: 'unknown' }
  | { readonly kind: 'breached'; readonly breaches: NonEmptyList<Breach> };

export type RuleReport = {
  readonly rule: Rule;
  readonly state: RuleReportState;
};

export type GateReportModel = {
  readonly verdict: CheckResult['verdict'];
  readonly counting: CountingCapability;
  readonly rules: readonly RuleReport[];
};

export type BreachTotal =
  | { readonly kind: 'exact'; readonly count: number }
  | { readonly kind: 'not-countable' };

export type RunSummary = {
  readonly passedGates: number;
  readonly failedGates: number;
  readonly refusedGates: number;
  readonly heldRules: number;
  readonly breachedRules: number;
  readonly undecidedRules: number;
  readonly unknownRules: number;
  readonly totalRules: number;
  readonly breaches: BreachTotal;
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
      rules: rules.map(rule => ({ rule, state: { kind: 'held' } })),
    };
  }

  if (result.verdict === 'refuse') {
    return {
      verdict: 'refuse',
      counting,
      rules: rules.map(rule => ({ rule, state: { kind: 'undecided' } })),
    };
  }

  const groups = groupBreaches(result);
  return {
    verdict: 'fail',
    counting,
    rules: rules.map(rule => {
      const breaches = groups.get(rule.id) ?? [];
      if (breaches.length > 0) {
        return { rule, state: { kind: 'breached', breaches: [breaches[0]!, ...breaches.slice(1)] } };
      }
      return { rule, state: { kind: counting.kind === 'supported' ? 'held' : 'unknown' } };
    }),
  };
}

export function countBreachedRules(model: GateReportModel): number {
  return model.rules.filter(item => item.state.kind === 'breached').length;
}

export function countBreaches(model: GateReportModel): number {
  let total = 0;
  for (const item of model.rules) {
    if (item.state.kind === 'breached') total += item.state.breaches.length;
  }
  return total;
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
  let countable = true;

  for (const gate of gates) {
    if (gate.verdict === 'pass') passedGates++;
    else if (gate.verdict === 'fail') failedGates++;
    else refusedGates++;

    totalRules += gate.rules.length;
    breaches += countBreaches(gate);
    if (gate.verdict === 'fail' && gate.counting.kind === 'unsupported') countable = false;

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
    breaches: countable ? { kind: 'exact', count: breaches } : { kind: 'not-countable' },
  };
}

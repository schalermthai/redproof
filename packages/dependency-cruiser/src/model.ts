import {
  breach,
  type Breach,
  type Diagnostic,
  type Rule,
  type RuleRef,
} from 'redproof';

export type DependencyCruiserViolation = {
  readonly from: string;
  readonly to: string;
  readonly rule: {
    readonly name: string;
    readonly severity?: string;
  };
  readonly cycle?: readonly string[];
  readonly via?: readonly string[];
};

export function violationDiagnostic(violation: DependencyCruiserViolation): Diagnostic {
  const route = violation.cycle?.length
    ? `Cycle: ${violation.cycle.join(' -> ')}`
    : violation.via?.length
      ? `Via: ${violation.via.join(' -> ')}`
      : undefined;

  return {
    code: violation.rule.name,
    message: `Dependency ${violation.from} -> ${violation.to} violates dependency-cruiser rule ${violation.rule.name}.`,
    location: {
      file: violation.from,
      line: null,
      column: null,
    },
    ...(route ? { detail: route } : {}),
  };
}

export function violationsToBreaches<R extends RuleRef>(
  violations: readonly DependencyCruiserViolation[],
  byForeignRule: ReadonlyMap<string, Rule<R>>,
): readonly Breach<R>[] {
  const breaches: Breach<R>[] = [];

  for (const violation of violations) {
    const rule = byForeignRule.get(violation.rule.name);
    if (!rule) continue;
    breaches.push(breach(rule, violationDiagnostic(violation)));
  }

  return breaches;
}

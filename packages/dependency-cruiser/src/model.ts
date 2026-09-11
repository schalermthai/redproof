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
  readonly cycle?: readonly DependencyCruiserRouteEntry[];
  readonly via?: readonly DependencyCruiserRouteEntry[];
};

export type DependencyCruiserRouteEntry = string | {
  readonly name: string;
  readonly dependencyTypes?: readonly string[];
};

export type DependencyCruiserConfig = {
  readonly forbidden?: readonly DependencyCruiserRuleDefinition[];
  readonly required?: readonly DependencyCruiserRuleDefinition[];
  readonly allowed?: readonly unknown[];
};

type DependencyCruiserRuleDefinition = {
  readonly name?: string;
  readonly severity?: string;
};

export function dependencyCruiserRuleAvailability(
  config: DependencyCruiserConfig,
  selected: readonly string[],
): { readonly missing: readonly string[]; readonly inactive: readonly string[] } {
  const configured = new Map<string, string | undefined>();
  for (const rule of [...(config.forbidden ?? []), ...(config.required ?? [])]) {
    if (rule.name) configured.set(rule.name, rule.severity);
  }
  if ((config.allowed?.length ?? 0) > 0) configured.set('not-in-allowed', undefined);

  return {
    missing: selected.filter(name => !configured.has(name)),
    inactive: selected.filter(name => configured.get(name) === 'ignore'),
  };
}

function routeName(entry: DependencyCruiserRouteEntry): string {
  return typeof entry === 'string' ? entry : entry.name;
}

export function violationDiagnostic(violation: DependencyCruiserViolation): Diagnostic {
  const route = violation.cycle?.length
    ? `Cycle: ${violation.cycle.map(routeName).join(' -> ')}`
    : violation.via?.length
      ? `Via: ${violation.via.map(routeName).join(' -> ')}`
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
    if (violation.rule.severity === 'ignore') continue;
    const rule = byForeignRule.get(violation.rule.name);
    if (!rule) continue;
    breaches.push(breach(rule, violationDiagnostic(violation)));
  }

  return breaches;
}

import type {
  Breach,
  Check,
  CheckResult,
  FailResult,
  NonEmptyList,
  PassResult,
  RefuseResult,
  Scan,
} from '../domain/check.ts';
import type { Diagnostic } from '../domain/diagnostic.ts';
import type { Rule, RuleCatalog, RuleRef, RuleRefOfCatalog } from '../domain/rule.ts';

export const counting = {
  supported: { kind: 'supported' } as const,
  unsupported(reason: string) {
    return { kind: 'unsupported', reason } as const;
  },
};

export function defineCheck<const C extends RuleCatalog>(
  rules: C,
  check: Check<RuleRefOfCatalog<C>>,
): Check<RuleRefOfCatalog<C>> {
  return check;
}

export function pass(scan: Scan): PassResult {
  return { verdict: 'pass', scan };
}

export function fail<R extends RuleRef>(
  scan: Scan,
  breaches: NonEmptyList<Breach<R>>,
): FailResult<R> {
  return { verdict: 'fail', scan, breaches };
}

export function refuse(scan: Scan, why: Diagnostic): RefuseResult {
  return { verdict: 'refuse', scan, why };
}

export function fromBreaches<R extends RuleRef>(
  scan: Scan,
  breaches: readonly Breach<R>[],
): CheckResult<R> {
  if (breaches.length === 0) return pass(scan);
  return fail(scan, [breaches[0]!, ...breaches.slice(1)]);
}

export function breach<R extends RuleRef>(rule: Rule<R> | R, diagnostic: Diagnostic): Breach<R> {
  return {
    rule: typeof rule === 'string' ? rule : rule.id,
    ...diagnostic,
  };
}

/** Namespaced constructors are convenient for adapter/check authors without hiding verdict semantics. */
export const result = {
  pass,
  fail,
  refuse,
  fromBreaches,
};

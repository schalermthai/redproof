import type { Rule, RuleCatalog, RuleRef } from '../domain/rule.ts';

export function defineRule<const R extends RuleRef>(rule: Rule<R>): Rule<R> {
  return rule;
}

/** Group related Rules while preserving literal RuleRefs and friendly aliases. */
export function defineRules<const C extends RuleCatalog>(rules: C): C {
  return rules;
}

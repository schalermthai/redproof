import type { Check } from './check.ts';
import type { RuleCatalog, RuleRefOfCatalog } from './rule.ts';

export type Adapter<C extends RuleCatalog = RuleCatalog> = {
  readonly kind: string;
  readonly rules: C;
  readonly check: Check<RuleRefOfCatalog<C>>;
};

export type RuleRefOfAdapter<A extends Adapter<any>> = RuleRefOfCatalog<A['rules']>;

import { defineAdapter, defineRules, type Adapter, type NoUnknownKeys, type Rule } from 'redproof';
import { ruleDefinition } from './core/model.ts';
import { validateRuffOptions, type RuffOptions, type Selection } from './core/options.ts';
import { ruffCheck } from './shell/check.ts';

type Catalog<M extends Selection> = { readonly [K in keyof M]: Rule<`ruff/${M[K]}`> };

export type { RuffOptions } from './core/options.ts';

/**
 * Each selected Ruff rule code or family becomes one Redproof Rule `ruff/<selector>`.
 * Any finding of a selected rule fails; Ruff itself being unavailable or misconfigured refuses.
 */
export function ruff<const O extends RuffOptions>(options: O & NoUnknownKeys<O, RuffOptions>): Adapter<Catalog<O['rules']>> {
  validateRuffOptions(options);
  const entries = Object.entries(options.rules);
  const rules = defineRules(Object.fromEntries(
    entries.map(([alias, selector]) => [alias, ruleDefinition(selector)]),
  ) as Catalog<O['rules']>);
  const selected = new Map(entries.map(([alias, selector]) => [selector, rules[alias as keyof O['rules']]!]));
  return defineAdapter({ kind: 'ruff', rules, check: ruffCheck(options, selected) });
}

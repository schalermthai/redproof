import { defineAdapter, defineRules, type Adapter, type NoUnknownKeys, type Rule } from 'redproof';
import { ruleDefinition, type VultureKind } from './core/model.ts';
import { validateVultureOptions, type Selection, type VultureOptions } from './core/options.ts';
import { vultureCheck } from './shell/check.ts';

type Catalog<M extends Selection> = { readonly [K in keyof M]: Rule<`vulture/${M[K]}`> };

export type { VultureOptions } from './core/options.ts';

/**
 * Each selected finding kind (`unused-import`, `unreachable-code`, ...) becomes one Redproof Rule
 * `vulture/<kind>`. Any finding of a selected kind at or above `minConfidence` fails; vulture being
 * unavailable, reading less than the whole project, or not finishing refuses.
 */
export function vulture<const O extends VultureOptions>(options: O & NoUnknownKeys<O, VultureOptions>): Adapter<Catalog<O['rules']>> {
  validateVultureOptions(options);
  const entries = Object.entries(options.rules);
  const rules = defineRules(Object.fromEntries(
    entries.map(([alias, kind]) => [alias, ruleDefinition(kind as VultureKind)]),
  ) as Catalog<O['rules']>);
  const selected = new Map(entries.map(([alias, kind]) => [kind as VultureKind, rules[alias as keyof O['rules']]!]));
  return defineAdapter({ kind: 'vulture', rules, check: vultureCheck(options, selected) });
}

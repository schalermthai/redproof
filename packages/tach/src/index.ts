import { defineAdapter, defineRules, type Adapter, type NoUnknownKeys, type Rule } from 'redproof';
import { ruleDefinitions } from './core/model.ts';
import { validateTachOptions, type Selection, type TachOptions } from './core/options.ts';
import { tachCheck } from './shell/check.ts';

type Catalog<M extends Selection> = { readonly [K in keyof M]: Rule<typeof ruleDefinitions[M[K]]['id']> };

export type { TachOptions } from './core/options.ts';
export type { TachRuleKind } from './core/model.ts';
import type { TachRuleKind } from './core/model.ts';

/**
 * Each selected kind of tach finding becomes one Redproof Rule `tach/<kind>`. Any diagnostic of a selected
 * kind fails; tach being unavailable, misconfigured, or silent about what it checked refuses.
 */
export function tach<const O extends TachOptions>(options: O & NoUnknownKeys<O, TachOptions>): Adapter<Catalog<O['rules']>> {
  validateTachOptions(options);
  const entries = Object.entries(options.rules) as [string, TachRuleKind][];
  const rules = defineRules(Object.fromEntries(entries.map(([alias, kind]) => [alias, ruleDefinitions[kind]])) as Catalog<O['rules']>);
  const selected = new Map(entries.map(([alias, kind]) => [kind, rules[alias as keyof O['rules']]!]));
  return defineAdapter({ kind: 'tach', rules, check: tachCheck(options, selected) });
}

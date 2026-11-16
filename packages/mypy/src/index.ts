import { defineAdapter, defineRules, type Adapter, type NoUnknownKeys, type Rule } from 'redproof';
import { ruleDefinition } from './core/model.ts';
import { validateMypyOptions, type MypyOptions, type Selection } from './core/options.ts';
import { mypyCheck } from './shell/check.ts';

type Catalog<M extends Selection> = { readonly [K in keyof M]: Rule<`mypy/${M[K]}`> };

export type { Allowance, MypyOptions } from './core/options.ts';

/**
 * Each selected mypy error code becomes one Redproof Rule `mypy/<code>`. Any error of a selected code fails;
 * mypy not finishing, a setting that can hide findings, or a project with nothing to check refuses.
 */
export function mypy<const O extends MypyOptions>(options: O & NoUnknownKeys<O, MypyOptions>): Adapter<Catalog<O['rules']>> {
  validateMypyOptions(options);
  const entries = Object.entries(options.rules);
  const rules = defineRules(Object.fromEntries(
    entries.map(([alias, code]) => [alias, ruleDefinition(code)]),
  ) as Catalog<O['rules']>);
  const selected = new Map(entries.map(([alias, code]) => [code, rules[alias as keyof O['rules']]!]));
  return defineAdapter({ kind: 'mypy', rules, check: mypyCheck(options, selected) });
}

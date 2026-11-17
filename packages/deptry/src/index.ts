import { defineAdapter, defineRules, type Adapter, type NoUnknownKeys, type Rule } from 'redproof';
import { ruleDefinition, type DeptryCode } from './core/model.ts';
import { validateDeptryOptions, type DeptryOptions, type Selection } from './core/options.ts';
import { deptryCheck } from './shell/check.ts';

type Catalog<M extends Selection> = { readonly [K in keyof M]: Rule<`deptry/${M[K]}`> };

export type { DeptryOptions } from './core/options.ts';

/**
 * Each selected deptry code (`DEP001` to `DEP005`) becomes one Redproof Rule `deptry/<code>`. Any
 * finding of a selected code fails; deptry being unavailable, crashing, or skipping part of the
 * project refuses.
 */
export function deptry<const O extends DeptryOptions>(options: O & NoUnknownKeys<O, DeptryOptions>): Adapter<Catalog<O['rules']>> {
  validateDeptryOptions(options);
  const entries = Object.entries(options.rules);
  const rules = defineRules(Object.fromEntries(
    entries.map(([alias, code]) => [alias, ruleDefinition(code as DeptryCode)]),
  ) as Catalog<O['rules']>);
  const selected = new Map(entries.map(([alias, code]) => [code as DeptryCode, rules[alias as keyof O['rules']]!]));
  return defineAdapter({ kind: 'deptry', rules, check: deptryCheck(options, selected) });
}

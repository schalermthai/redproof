import type { Adapter } from '../domain/adapter.ts';
import type { Check } from '../domain/check.ts';
import type { Gate } from '../domain/gate.ts';
import type { RuleCatalog, RuleRefOfCatalog } from '../domain/rule.ts';

export type NativeGateDefinition<C extends RuleCatalog> = {
  readonly id: string;
  readonly rules: C;
  readonly check: Check<RuleRefOfCatalog<C>>;
};

export function defineGate<const A extends Adapter<any>>(gate: Gate<A>): Gate<A>;
export function defineGate<const C extends RuleCatalog>(gate: NativeGateDefinition<C>): Gate<Adapter<C>>;
export function defineGate(
  gate: Gate<Adapter<any>> | NativeGateDefinition<RuleCatalog>,
): Gate<Adapter<any>> {
  if ('adapter' in gate) return gate;

  return {
    id: gate.id,
    adapter: {
      kind: 'native',
      rules: gate.rules,
      check: gate.check,
    },
  };
}

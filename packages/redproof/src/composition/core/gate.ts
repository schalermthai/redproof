import type { Adapter, Check, Gate, RuleCatalog, RuleRefOfCatalog } from '../../domain/index.ts';

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

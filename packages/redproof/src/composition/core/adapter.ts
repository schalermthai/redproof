import type { Adapter, RuleCatalog } from '../../domain/index.ts';

export function defineAdapter<const C extends RuleCatalog>(adapter: Adapter<C>): Adapter<C> {
  return adapter;
}

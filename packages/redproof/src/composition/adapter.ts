import type { Adapter } from '../domain/adapter.ts';
import type { RuleCatalog } from '../domain/rule.ts';

export function defineAdapter<const C extends RuleCatalog>(adapter: Adapter<C>): Adapter<C> {
  return adapter;
}

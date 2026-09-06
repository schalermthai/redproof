import type { Adapter, RuleRefOfAdapter } from './adapter.ts';

export type Gate<A extends Adapter<any> = Adapter<any>> = {
  readonly id: string;
  readonly adapter: A;
};

export type RuleRefOfGate<G extends Gate<any>> = RuleRefOfAdapter<G['adapter']>;

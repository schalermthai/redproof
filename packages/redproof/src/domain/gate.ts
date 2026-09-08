import type { Adapter, RuleRefOfAdapter } from './adapter.ts';

export type Gate<A extends Adapter<any> = Adapter<any>> = {
  readonly id: string;
  readonly adapter: A;
  /** Permit PASS when the Check reports that it inspected zero targets. Defaults to false. */
  readonly allowEmptyInspection?: boolean;
};

export type RuleRefOfGate<G extends Gate<any>> = RuleRefOfAdapter<G['adapter']>;

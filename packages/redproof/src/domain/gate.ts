import type { Adapter, RuleRefOfAdapter } from './adapter.ts';

export type EmptyEvidencePolicy = 'refuse' | 'allow';

export type GatePolicies = {
  /** Decide whether PASS may establish the Gate when the Check inspected zero targets. */
  readonly emptyEvidence?: EmptyEvidencePolicy;
};

export type Gate<A extends Adapter<any> = Adapter<any>> = {
  readonly id: string;
  readonly adapter: A;
  readonly policies?: GatePolicies;
};

export type RuleRefOfGate<G extends Gate<any>> = RuleRefOfAdapter<G['adapter']>;

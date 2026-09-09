import type { Adapter, RuleRefOfAdapter } from './adapter.ts';

/** What a PASS over zero inspected targets means: refuse it, or allow it. Defaults to 'refuse'. */
export type EmptyEvidencePolicy = 'refuse' | 'allow';

/** Gate-wide policies that decide how a Check result is read. */
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

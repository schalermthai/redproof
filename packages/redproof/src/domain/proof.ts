import type { Gate, RuleRefOfGate } from './gate.ts';
import type { MutationPlan } from './mutation.ts';
import type { RuleRef } from './rule.ts';

export type RedProof<R extends RuleRef = RuleRef> = {
  readonly expected: 'red';
  readonly name: string;
  readonly target: R;
  readonly mutate: MutationPlan;
};

export type GreenProof = {
  readonly expected: 'green';
  readonly name: string;
  readonly mutate?: MutationPlan;
};

export type RefuseProof = {
  readonly expected: 'refuse';
  readonly name: string;
  readonly mutate: MutationPlan;
};

export type Proof<R extends RuleRef = RuleRef> = RedProof<R> | GreenProof | RefuseProof;

export type ProofSuite<G extends Gate<any> = Gate<any>> = {
  readonly gate: G;
  readonly proofs: readonly Proof<RuleRefOfGate<G>>[];
};

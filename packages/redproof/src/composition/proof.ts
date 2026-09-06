import type { Gate, RuleRefOfGate } from '../domain/gate.ts';
import type { MutationPlan } from '../domain/mutation.ts';
import type { GreenProof, Proof, ProofSuite, RedProof, RefuseProof } from '../domain/proof.ts';
import type { Rule, RuleRef } from '../domain/rule.ts';

export const proof = {
  red<const R extends RuleRef>(target: Rule<R>, name: string, mutate: MutationPlan): RedProof<R> {
    return { expected: 'red', target: target.id, name, mutate };
  },

  green(name: string, mutate?: MutationPlan): GreenProof {
    return mutate
      ? { expected: 'green', name, mutate }
      : { expected: 'green', name };
  },

  refuse(name: string, mutate: MutationPlan): RefuseProof {
    return { expected: 'refuse', name, mutate };
  },
};

export function defineProofs<const G extends Gate<any>>(
  gate: G,
  proofs: readonly Proof<RuleRefOfGate<NoInfer<G>>>[],
): ProofSuite<G> {
  return { gate, proofs } as ProofSuite<G>;
}

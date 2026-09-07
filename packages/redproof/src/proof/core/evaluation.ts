import type { CheckResult, Proof, RedProof, RuleRef } from '../../domain/index.ts';

type Verdict = CheckResult['verdict'];

type VerdictMismatch<Expected extends Verdict> = {
  readonly kind: 'verdict-mismatch';
  readonly expected: Expected;
  readonly actual: Exclude<Verdict, Expected>;
};

export type RedProofEvaluation =
  | { readonly kind: 'proved'; readonly target: RuleRef }
  | VerdictMismatch<'fail'>
  | {
      readonly kind: 'target-rule-not-breached';
      readonly target: RuleRef;
      readonly breached: readonly RuleRef[];
    }
  | {
      readonly kind: 'target-already-breached';
      readonly target: RuleRef;
      readonly breached: readonly RuleRef[];
    };

export type GreenProofEvaluation = { readonly kind: 'proved' } | VerdictMismatch<'pass'>;

export type RefuseProofEvaluation = { readonly kind: 'proved' } | VerdictMismatch<'refuse'>;

export type ProofEvaluation = RedProofEvaluation | GreenProofEvaluation | RefuseProofEvaluation;

export function evaluateRedProof(proof: RedProof, result: CheckResult): RedProofEvaluation {
  if (result.verdict !== 'fail') return { kind: 'verdict-mismatch', expected: 'fail', actual: result.verdict };

  const breached = result.breaches.map(item => item.rule);
  if (!breached.includes(proof.target)) return { kind: 'target-rule-not-breached', target: proof.target, breached };
  return { kind: 'proved', target: proof.target };
}

export function evaluateGreenProof(result: CheckResult): GreenProofEvaluation {
  if (result.verdict !== 'pass') return { kind: 'verdict-mismatch', expected: 'pass', actual: result.verdict };
  return { kind: 'proved' };
}

export function evaluateRefuseProof(result: CheckResult): RefuseProofEvaluation {
  if (result.verdict !== 'refuse') return { kind: 'verdict-mismatch', expected: 'refuse', actual: result.verdict };
  return { kind: 'proved' };
}

/** Pure proof semantics: given a Proof claim and a CheckResult, decide whether it was established. */
export function evaluateProof(proof: Proof, result: CheckResult): ProofEvaluation {
  if (proof.expected === 'red') return evaluateRedProof(proof, result);
  if (proof.expected === 'green') return evaluateGreenProof(result);
  return evaluateRefuseProof(result);
}

export function proofSucceeded(evaluation: ProofEvaluation): boolean {
  return evaluation.kind === 'proved';
}

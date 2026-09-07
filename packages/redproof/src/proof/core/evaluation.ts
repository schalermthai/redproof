import type { CheckResult, Proof, RuleRef } from '../../domain/index.ts';

export type ProofEvaluation =
  | { readonly kind: 'proved' }
  | {
      readonly kind: 'verdict-mismatch';
      readonly expected: 'fail' | 'pass' | 'refuse';
      readonly actual: CheckResult['verdict'];
    }
  | {
      readonly kind: 'target-rule-not-breached';
      readonly target: RuleRef;
      readonly breached: readonly RuleRef[];
    };

function expectedVerdict(proof: Proof): CheckResult['verdict'] {
  if (proof.expected === 'red') return 'fail';
  if (proof.expected === 'green') return 'pass';
  return 'refuse';
}

/** Pure proof semantics: given a Proof claim and a CheckResult, decide whether it was established. */
export function evaluateProof(proof: Proof, result: CheckResult): ProofEvaluation {
  const expected = expectedVerdict(proof);

  if (result.verdict !== expected) {
    return {
      kind: 'verdict-mismatch',
      expected,
      actual: result.verdict,
    };
  }

  if (proof.expected === 'red') {
    // The verdict narrowing above establishes result.verdict === 'fail' at runtime,
    // but TypeScript cannot correlate it through expectedVerdict().
    if (result.verdict !== 'fail') {
      return { kind: 'verdict-mismatch', expected: 'fail', actual: result.verdict };
    }

    const breached = result.breaches.map(item => item.rule);
    if (!breached.includes(proof.target)) {
      return {
        kind: 'target-rule-not-breached',
        target: proof.target,
        breached,
      };
    }
  }

  return { kind: 'proved' };
}

export function proofSucceeded(evaluation: ProofEvaluation): boolean {
  return evaluation.kind === 'proved';
}

import type { CheckResult, EmptyEvidencePolicy } from '../../domain/index.ts';

/**
 * A PASS proves nothing when a Check inspected no targets. Keep the
 * Check's scan as evidence and turn only that vacuous success into REFUSE.
 */
export function applyInspectionPolicy(
  result: CheckResult,
  emptyEvidence: EmptyEvidencePolicy,
): CheckResult {
  if (result.verdict !== 'pass' || result.scan.inspected !== 0 || emptyEvidence === 'allow') {
    return result;
  }

  return {
    verdict: 'refuse',
    scan: result.scan,
    why: {
      code: 'nothing-inspected',
      message: 'The Check inspected no targets, so the Gate cannot establish its Rules.',
      location: null,
      hint: "Set policies.emptyEvidence to 'allow' on the Gate only when an empty target set is intentional.",
    },
  };
}

import type { CheckResult } from '../../domain/index.ts';

/**
 * A PASS proves nothing when a Check inspected no targets. Keep the
 * Check's scan as evidence and turn only that vacuous success into REFUSE.
 */
export function applyInspectionPolicy(
  result: CheckResult,
  allowEmptyInspection: boolean,
): CheckResult {
  if (result.verdict !== 'pass' || result.scan.inspected !== 0 || allowEmptyInspection) {
    return result;
  }

  return {
    verdict: 'refuse',
    scan: result.scan,
    why: {
      code: 'nothing-inspected',
      message: 'The Check inspected no targets, so the Gate cannot establish its Rules.',
      location: null,
      hint: 'Set allowEmptyInspection: true on the Gate only when an empty target set is intentional.',
    },
  };
}

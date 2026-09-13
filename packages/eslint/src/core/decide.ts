import type { CheckResult, Diagnostic, Rule, RuleRef, Scan } from 'redproof';
import {
  eslintBreaches,
  fatalEslintDiagnostic,
  incompleteEslintDiagnostic,
  type EslintResult,
} from './model.ts';

export function decideEslintRun<R extends RuleRef>(
  root: string,
  results: readonly EslintResult[],
  byForeignId: ReadonlyMap<string, Rule<R>>,
  scan: Scan,
): CheckResult<R> {
  const fatal = fatalEslintDiagnostic(root, results);
  if (fatal) return { verdict: 'refuse', scan, why: fatal };

  const incomplete = incompleteEslintDiagnostic(root, results);
  if (incomplete) return { verdict: 'refuse', scan, why: incomplete };

  const [first, ...rest] = eslintBreaches(root, results, byForeignId);
  if (!first) return { verdict: 'pass', scan };
  return { verdict: 'fail', scan, breaches: [first, ...rest] };
}

export function eslintUnavailable(scan: Scan, error: unknown): CheckResult<never> {
  const why: Diagnostic = {
    code: 'eslint-unavailable',
    message: 'ESLint could not complete the check.',
    location: null,
    detail: error instanceof Error ? error.message : String(error),
  };
  return { verdict: 'refuse', scan, why };
}

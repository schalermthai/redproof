import type { Breach, RuleRef } from 'redproof';
import type { CoverageEvidence } from './evidence.ts';
import type { Refusal } from './refusals.ts';
import { unavailable } from './refusals.ts';
import { configsOf, coveragePyBreaches, needsBranches, type Selection } from './rules.ts';

export type Decision<R extends RuleRef> =
  | { readonly kind: 'refused'; readonly refusal: Refusal }
  | { readonly kind: 'decided'; readonly breaches: readonly Breach<R>[] };

/** The whole verdict decision, pure: evidence + expectations + selected rules in, refusal or breaches out. Precedence: no branch data, then missing inventory, then nothing measured, then breaches. */
export function decide<R extends RuleRef>(evidence: CoverageEvidence, required: readonly string[], selected: Selection<R>): Decision<R> {
  if (needsBranches(configsOf(selected)) && !evidence.branch) {
    return { kind: 'refused', refusal: unavailable('Report has no branch data (meta.branch_coverage is false) but a branch rule is selected.') };
  }
  const reported = new Set(evidence.files.map(file => file.file));
  const missing = required.filter(file => !reported.has(file));
  if (missing.length) {
    return { kind: 'refused', refusal: { kind: 'refused', code: 'coverage-py-incomplete-inventory', message: 'Expected source files are absent from coverage.', detail: missing.join('\n') } };
  }
  // Zero statements is 100 % by coverage.py's convention, so a wrong `source` that lists one empty file would pass every rule.
  if (evidence.lines.total === 0) {
    return { kind: 'refused', refusal: unavailable('The report measures zero statements; check `source`, or list real files in expectedFiles.') };
  }
  return { kind: 'decided', breaches: coveragePyBreaches(evidence, selected) };
}

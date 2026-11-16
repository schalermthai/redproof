import { breach, type Breach, type Rule, type RuleRef } from 'redproof';
import type { CoverageEvidence } from './evidence.ts';
import { below, percent } from './thresholds.ts';

export type Threshold = { readonly minimum: number };
export type FileMetric = 'lines' | 'branches';
export type FileThreshold = Threshold & { readonly metric?: FileMetric };
export type CoveragePyRules = {
  readonly lineCoverage?: Threshold;
  readonly branchCoverage?: Threshold;
  readonly perFileMinimum?: FileThreshold;
  readonly noUncoveredFiles?: Readonly<Record<never, never>>;
};
export type RuleName = keyof CoveragePyRules;
export const ruleNames = ['lineCoverage', 'branchCoverage', 'perFileMinimum', 'noUncoveredFiles'] as const satisfies readonly RuleName[];
export const ruleIds = { lineCoverage: 'coverage-py/line-coverage', branchCoverage: 'coverage-py/branch-coverage',
  perFileMinimum: 'coverage-py/per-file-minimum', noUncoveredFiles: 'coverage-py/no-uncovered-files' } as const;
/** Allowed option keys per rule: the one table construction-time validation reads. */
export const ruleKeys: { readonly [K in RuleName]: readonly string[] } = {
  lineCoverage: ['minimum'], branchCoverage: ['minimum'], perFileMinimum: ['minimum', 'metric'], noUncoveredFiles: [],
};
export type CoveragePyCatalog<R extends CoveragePyRules> = { readonly [K in keyof R]: K extends RuleName ? Rule<typeof ruleIds[K]> : never };
/** A chosen rule paired with its typed configuration. */
export type Selection<R extends RuleRef> = { readonly [K in RuleName]?: { readonly rule: Rule<R>; readonly config: NonNullable<CoveragePyRules[K]> } };

/** The per-file metric default is decided here, once. */
export const metricOf = (config: FileThreshold): FileMetric => config.metric ?? 'lines';

/** Branch rules need a report that measured branches. One definition for construction and for the check. */
export function needsBranches(rules: CoveragePyRules): boolean {
  return rules.branchCoverage !== undefined || (rules.perFileMinimum !== undefined && metricOf(rules.perFileMinimum) === 'branches');
}
export function configsOf<R extends RuleRef>(selected: Selection<R>): CoveragePyRules {
  return {
    ...(selected.lineCoverage && { lineCoverage: selected.lineCoverage.config }),
    ...(selected.branchCoverage && { branchCoverage: selected.branchCoverage.config }),
    ...(selected.perFileMinimum && { perFileMinimum: selected.perFileMinimum.config }),
    ...(selected.noUncoveredFiles && { noUncoveredFiles: selected.noUncoveredFiles.config }),
  };
}
/** The human sentence for a chosen rule. */
export function describeRule<K extends RuleName>(name: K, config: NonNullable<CoveragePyRules[K]>): string {
  switch (name) {
    case 'lineCoverage': return `Statement coverage must be at least ${(config as Threshold).minimum}% overall.`;
    case 'branchCoverage': return `Branch coverage must be at least ${(config as Threshold).minimum}% overall.`;
    case 'perFileMinimum': return `Each reported file must have at least ${(config as FileThreshold).minimum}% ${metricOf(config as FileThreshold)} coverage.`;
    default: return 'No reported file with statements may be entirely unexecuted.';
  }
}

export function coveragePyBreaches<R extends RuleRef>(evidence: CoverageEvidence, selected: Selection<R>): readonly Breach<R>[] {
  const out: Breach<R>[] = [];
  const { lineCoverage, branchCoverage, perFileMinimum, noUncoveredFiles } = selected;
  if (lineCoverage && below(evidence.lines, lineCoverage.config.minimum)) {
    out.push(breach(lineCoverage.rule, { code: 'line-coverage-below-minimum',
      message: `Line coverage ${percent(evidence.lines)}% is below ${lineCoverage.config.minimum}% overall.`, location: null,
      detail: `${evidence.lines.covered}/${evidence.lines.total} statements covered; ${evidence.lines.total - evidence.lines.covered} missing.` }));
  }
  if (branchCoverage && below(evidence.branches, branchCoverage.config.minimum)) {
    out.push(breach(branchCoverage.rule, { code: 'branch-coverage-below-minimum',
      message: `Branch coverage ${percent(evidence.branches)}% is below ${branchCoverage.config.minimum}% overall.`, location: null,
      detail: `${evidence.branches.covered}/${evidence.branches.total} branches covered; ${evidence.branches.total - evidence.branches.covered} missing.` }));
  }
  if (perFileMinimum) {
    const metric = metricOf(perFileMinimum.config), { minimum } = perFileMinimum.config;
    for (const file of evidence.files.filter(f => below(f[metric], minimum))) {
      out.push(breach(perFileMinimum.rule, { code: 'file-below-minimum',
        message: `${metric === 'lines' ? 'Line' : 'Branch'} coverage ${percent(file[metric])}% is below ${minimum}% for ${file.file}.`,
        location: { file: file.file, line: null, column: null },
        detail: `${file[metric].covered}/${file[metric].total} covered.` }));
    }
  }
  if (noUncoveredFiles) {
    for (const file of evidence.files.filter(f => f.lines.total > 0 && f.lines.covered === 0)) {
      out.push(breach(noUncoveredFiles.rule, { code: 'file-never-executed', message: `${file.file} has ${file.lines.total} statements and none were executed.`,
        location: { file: file.file, line: null, column: null }, detail: `0/${file.lines.total} statements covered.` }));
    }
  }
  return out;
}

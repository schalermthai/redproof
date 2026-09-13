import { isAbsolute } from 'node:path';
import { defineRules, rejectUnknownKeys, type NoUnknownKeys, type Rule, type RuleRef, type RuleRefOfCatalog } from 'redproof';
import { metrics, type CoverageCatalog, type CoverageRules, type Metric, type Threshold } from './model.ts';

export type CoverageContext = { readonly root: string; readonly cwd: string; readonly reportFile: string; readonly reportDirectory: string; readonly tempDirectory: string };
export type CommonOptions<R extends CoverageRules> = {
  readonly rules: R;
  readonly cwd?: string;
  /** Gate-root-relative files which must be present in the report, even if unexecuted. */
  readonly expectedFiles?: readonly string[];
  readonly timeoutMs?: number;
  readonly maxOutputBytes?: number;
  readonly maxReportBytes?: number;
};
export type IstanbulOptions<R extends CoverageRules = CoverageRules> = CommonOptions<R> & {
  readonly command: string;
  /** Producer must write full Istanbul JSON to this run's private reportFile. */
  readonly args: (context: CoverageContext) => readonly string[];
};
export type NycOptions<R extends CoverageRules = CoverageRules> = CommonOptions<R> & {
  /** Test executable, not another nyc invocation. */
  readonly command: string;
  readonly args?: readonly string[];
  readonly configFile?: string;
  readonly include?: readonly string[];
  readonly exclude?: readonly string[];
  /** Include unexecuted files. Defaults to true. Native exclusions still apply. */
  readonly all?: boolean;
};
export type ExactRules<R> = { readonly [K in keyof R]: NoUnknownKeys<R[K], Threshold> };
export type Selection<R extends RuleRef> = ReadonlyMap<Metric, { readonly rule: Rule<R>; readonly threshold: Threshold }>;
export type Catalog<R extends CoverageRules> = { readonly rules: CoverageCatalog<R>; readonly selected: Selection<RuleRefOfCatalog<CoverageCatalog<R>>> };
export type CoverageConfig = {
  readonly cwd: string;
  readonly expectedFiles: readonly string[];
  readonly timeoutMs: number;
  readonly maxOutputBytes: number;
  readonly maxReportBytes: number;
};

export const commonKeys = ['rules', 'cwd', 'expectedFiles', 'timeoutMs', 'maxOutputBytes', 'maxReportBytes'] as const;
export const ruleIds = { statements: 'istanbul/statements-coverage', branches: 'istanbul/branches-coverage',
  functions: 'istanbul/functions-coverage', lines: 'istanbul/lines-coverage' } as const;

export function pathOption(name: string, path: unknown): asserts path is string {
  if (typeof path !== 'string' || !path.trim() || path.includes('\0') || isAbsolute(path)
    || /^[A-Za-z]:/u.test(path) || path.split(/[\\/]/u).includes('..')) throw new Error(`${name} must be a confined relative path.`);
}
export function validate<R extends CoverageRules>(options: CommonOptions<R> & { command: string }): void {
  if (typeof options.command !== 'string' || !options.command.trim() || options.command.includes('\0')) throw new Error('Istanbul command must not be empty.');
  rejectUnknownKeys(options.rules, metrics, 'Istanbul rule');
  if (!Object.keys(options.rules).length) throw new Error('Istanbul requires at least one Redproof rule.');
  for (const threshold of Object.values(options.rules)) {
    if (!threshold || typeof threshold !== 'object' || Array.isArray(threshold)) throw new Error('Istanbul threshold must be an object.');
    rejectUnknownKeys(threshold, ['minimum', 'perFile'], 'Istanbul threshold');
    if (!Number.isFinite(threshold.minimum) || threshold.minimum < 0 || threshold.minimum > 100) throw new Error('minimum must be between 0 and 100.');
    if (threshold.perFile !== undefined && typeof threshold.perFile !== 'boolean') throw new Error('perFile must be boolean.');
  }
  if (options.cwd !== undefined) pathOption('cwd', options.cwd);
  if (options.expectedFiles !== undefined) {
    if (!Array.isArray(options.expectedFiles) || !options.expectedFiles.length) throw new Error('expectedFiles must be a non-empty array.');
    for (const file of options.expectedFiles) pathOption('expectedFiles', file);
    if (new Set(options.expectedFiles).size !== options.expectedFiles.length) throw new Error('expectedFiles must be unique.');
  }
  for (const key of ['timeoutMs', 'maxOutputBytes', 'maxReportBytes'] as const) {
    if (options[key] !== undefined && (!Number.isSafeInteger(options[key]) || options[key]! <= 0)) throw new Error(`${key} must be a positive integer.`);
  }
}
export function validateNycOptions<R extends CoverageRules>(options: NycOptions<R>): void {
  if (options.configFile !== undefined) pathOption('configFile', options.configFile);
  if (options.all !== undefined && typeof options.all !== 'boolean') throw new Error('all must be boolean.');
  for (const key of ['args', 'include', 'exclude'] as const) {
    const values = options[key];
    if (values !== undefined && (!Array.isArray(values) || values.some(value => typeof value !== 'string' || value.includes('\0') || (key !== 'args' && !value.trim())))) throw new Error(`${key} must contain strings.`);
  }
}

export function catalog<R extends CoverageRules>(selectedRules: R): Catalog<R> {
  const thresholds = Object.entries(selectedRules).map(([name, threshold]) => [name as Metric, { ...threshold }] as const);
  const rules = defineRules(Object.fromEntries(thresholds.map(([metric, threshold]) => [metric, {
    id: ruleIds[metric], description: `${metric} coverage must be at least ${threshold.minimum}% ${threshold.perFile ? 'in each reported file' : 'overall'}.`,
  }])) as CoverageCatalog<R>);
  const selected = new Map(thresholds.map(([metric, threshold]) => [metric, {
    rule: (rules as Record<Metric, Rule<RuleRefOfCatalog<CoverageCatalog<R>>>>)[metric], threshold,
  }]));
  return { rules, selected };
}
export function resolveConfig<R extends CoverageRules>(options: CommonOptions<R>): CoverageConfig {
  return { cwd: options.cwd ?? '.', expectedFiles: [...(options.expectedFiles ?? [])],
    timeoutMs: options.timeoutMs ?? 60_000, maxOutputBytes: options.maxOutputBytes ?? 10 * 1024 * 1024,
    maxReportBytes: options.maxReportBytes ?? 20 * 1024 * 1024 };
}

import { isAbsolute, normalize } from 'node:path';
import { defineRules, rejectUnknownKeys, type NoUnknownKeys, type RuleRef, type RuleRefOfCatalog } from 'redproof';
import { MINIMUM_DECIMALS } from './thresholds.ts';
import { describeRule, needsBranches, ruleIds, ruleKeys, ruleNames, type CoveragePyCatalog, type CoveragePyRules, type RuleName, type Selection } from './rules.ts';

export type CoveragePyOptions<R extends CoveragePyRules = CoveragePyRules> = {
  readonly rules: R;
  /** Arguments after `coverage run`, e.g. `['-m', 'pytest']`. */
  readonly args: readonly string[];
  /** Python interpreter that has coverage.py installed. Default `python3`. */
  readonly python?: string;
  readonly cwd?: string;
  /** Passed as `--source`. Without it, files that were never imported are absent from the report. */
  readonly source?: readonly string[];
  readonly rcfile?: string;
  /** Measure branches (`--branch`). Default true. Branch rules cannot be selected when false. */
  readonly branch?: boolean;
  /** Gate-root-relative files which must be present in the report, even if unexecuted. */
  readonly expectedFiles?: readonly string[];
  readonly timeoutMs?: number;
  readonly maxOutputBytes?: number;
  readonly maxReportBytes?: number;
};
export type ExactRules<R> = { readonly [K in keyof R]: NoUnknownKeys<R[K], K extends 'perFileMinimum' ? { minimum: number; metric?: string } : K extends 'noUncoveredFiles' ? object : { minimum: number }> };
export type Catalog<R extends CoveragePyRules> = { readonly rules: CoveragePyCatalog<R>; readonly selected: Selection<RuleRefOfCatalog<CoveragePyCatalog<R>>> };
export type CoveragePyConfig = {
  readonly python: string; readonly args: readonly string[]; readonly cwd: string; readonly source: readonly string[];
  readonly rcfile: string | undefined; readonly branch: boolean; readonly expectedFiles: readonly string[];
  readonly timeoutMs: number; readonly maxOutputBytes: number; readonly maxReportBytes: number;
};
export const optionKeys = ['rules', 'args', 'python', 'cwd', 'source', 'rcfile', 'branch', 'expectedFiles', 'timeoutMs', 'maxOutputBytes', 'maxReportBytes'] as const;

function pathOption(name: string, path: unknown): asserts path is string {
  if (typeof path !== 'string' || !path.trim() || path.includes('\0') || isAbsolute(path)
    || /^[A-Za-z]:/u.test(path) || path.split(/[\\/]/u).includes('..')) throw new Error(`${name} must be a confined relative path.`);
}
/** A plain data object: no inherited keys (they vanish when the config is copied) and no getters (they can answer differently each read). */
function plain(name: string, value: unknown): asserts value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${name} must be an object.`);
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) throw new Error(`${name} must be a plain object.`);
  for (const descriptor of Object.values(Object.getOwnPropertyDescriptors(value))) {
    if (!('value' in descriptor)) throw new Error(`${name} must not use getters or setters.`);
  }
}
/** `new Array(2)` has holes that `.some` and `.every` skip. */
function dense(name: string, values: readonly unknown[]): void {
  if (Object.keys(values).length !== values.length) throw new Error(`${name} must not have empty slots.`);
}
function strings(name: string, values: unknown): void {
  if (Array.isArray(values)) dense(name, values);
  if (!Array.isArray(values) || values.some(value => typeof value !== 'string' || value.includes('\0'))) throw new Error(`${name} must contain strings.`);
}
function minimum(config: { minimum?: unknown }): void {
  if (typeof config.minimum !== 'number' || !Number.isFinite(config.minimum) || config.minimum < 0 || config.minimum > 100) throw new Error('minimum must be between 0 and 100.');
  if (Number(config.minimum.toFixed(MINIMUM_DECIMALS)) !== config.minimum) throw new Error(`minimum must have at most ${MINIMUM_DECIMALS} decimal places.`);
}
export function validate<R extends CoveragePyRules>(options: CoveragePyOptions<R>): void {
  plain('coverage.py rules', options.rules);
  rejectUnknownKeys(options.rules, ruleNames, 'coverage.py rule');
  const rules: CoveragePyRules = options.rules;
  if (!Object.keys(rules).length) throw new Error('coverage.py requires at least one Redproof rule.');
  for (const name of Object.keys(rules) as RuleName[]) {
    const config = rules[name];
    plain(`coverage.py ${name}`, config);
    rejectUnknownKeys(config, ruleKeys[name], `coverage.py ${name} option`);
    if (ruleKeys[name].includes('minimum')) minimum(config as { minimum?: unknown });
  }
  const metric = rules.perFileMinimum?.metric;
  if (metric !== undefined && metric !== 'lines' && metric !== 'branches') throw new Error('perFileMinimum.metric must be "lines" or "branches".');
  if (needsBranches(rules) && options.branch === false) {
    throw new Error('Branch rules need branch data; coverage.py was configured with branch: false.');
  }
  if (!Array.isArray(options.args) || !options.args.length) throw new Error('args must be a non-empty array.');
  strings('args', options.args);
  if (options.python !== undefined && (typeof options.python !== 'string' || !options.python.trim() || options.python.includes('\0'))) throw new Error('python must not be empty.');
  if (options.branch !== undefined && typeof options.branch !== 'boolean') throw new Error('branch must be boolean.');
  if (options.source !== undefined) strings('source', options.source);
  if (options.cwd !== undefined) pathOption('cwd', options.cwd);
  if (options.rcfile !== undefined) pathOption('rcfile', options.rcfile);
  if (options.expectedFiles !== undefined) {
    if (!Array.isArray(options.expectedFiles) || !options.expectedFiles.length) throw new Error('expectedFiles must be a non-empty array.');
    dense('expectedFiles', options.expectedFiles);
    for (const file of options.expectedFiles) pathOption('expectedFiles', file);
    if (new Set(options.expectedFiles.map(file => normalize(file))).size !== options.expectedFiles.length) throw new Error('expectedFiles must be unique.');
  }
  for (const key of ['timeoutMs', 'maxOutputBytes', 'maxReportBytes'] as const) {
    if (options[key] !== undefined && (!Number.isSafeInteger(options[key]) || options[key]! <= 0)) throw new Error(`${key} must be a positive integer.`);
  }
}
/** Build the Redproof rules and the typed selection from the chosen configs. */
export function catalog<R extends CoveragePyRules>(chosen: R): Catalog<R> {
  const names = Object.keys(chosen) as RuleName[];
  const rules = defineRules(Object.fromEntries(names.map(name => [name, { id: ruleIds[name], description: describeRule(name, chosen[name] as never) }])) as CoveragePyCatalog<R>);
  const selected = Object.fromEntries(names.map(name => [name, { rule: (rules as Record<RuleName, never>)[name], config: { ...chosen[name] } }])) as Selection<RuleRefOfCatalog<CoveragePyCatalog<R>>>;
  return { rules, selected };
}
export function resolveConfig<R extends CoveragePyRules>(options: CoveragePyOptions<R>): CoveragePyConfig {
  return { python: options.python ?? 'python3', args: [...options.args], cwd: options.cwd ?? '.', source: [...(options.source ?? [])],
    rcfile: options.rcfile, branch: options.branch ?? true, expectedFiles: [...(options.expectedFiles ?? [])],
    timeoutMs: options.timeoutMs ?? 120_000, maxOutputBytes: options.maxOutputBytes ?? 10 * 1024 * 1024, maxReportBytes: options.maxReportBytes ?? 50 * 1024 * 1024 };
}

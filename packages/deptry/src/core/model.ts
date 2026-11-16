import { breach, type Breach, type Rule, type RuleRef } from 'redproof';

/** The five checks deptry makes, by the code it reports them under. */
export const DEPTRY_CODES = ['DEP001', 'DEP002', 'DEP003', 'DEP004', 'DEP005'] as const;
export type DeptryCode = (typeof DEPTRY_CODES)[number];

export const isDeptryCode = (value: unknown): value is DeptryCode =>
  typeof value === 'string' && (DEPTRY_CODES as readonly string[]).includes(value);

const SUMMARY: Readonly<Record<DeptryCode, string>> = {
  DEP001: 'every imported module must be declared as a dependency',
  DEP002: 'every declared dependency must be used',
  DEP003: 'no import may rely on a transitive dependency',
  DEP004: 'no development dependency may be imported by production code',
  DEP005: 'no standard library module may be declared as a dependency',
};

export function ruleDefinition(code: DeptryCode): { readonly id: `deptry/${string}`; readonly description: string } {
  return { id: `deptry/${code}`, description: `deptry ${code}: ${SUMMARY[code]}.` };
}

/** One entry of `deptry --json-output`, reduced to what a verdict needs. */
export type DeptryFinding = {
  readonly code: string;
  readonly message: string;
  readonly module: string;
  /** Relative to the directory deptry ran in. */
  readonly file: string;
  /** Null for findings about a dependency declaration (DEP002, DEP005): they point at the file, not a line. */
  readonly line: number | null;
  readonly column: number | null;
};

function record(value: unknown, what: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`Expected ${what} to be an object.`);
  return value as Record<string, unknown>;
}

const position = (value: unknown): number | null =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;

export function parseDeptryReport(text: string): readonly DeptryFinding[] {
  const data: unknown = JSON.parse(text);
  if (!Array.isArray(data)) throw new Error('Expected a deptry JSON array.');
  return data.map((item): DeptryFinding => {
    const entry = record(item, 'a deptry finding');
    const error = record(entry.error, 'the finding error');
    const location = record(entry.location, 'the finding location');
    if (typeof error.code !== 'string' || !error.code) throw new Error('deptry finding has no code.');
    if (typeof error.message !== 'string') throw new Error('deptry finding has no message.');
    if (typeof entry.module !== 'string') throw new Error('deptry finding has no module.');
    if (typeof location.file !== 'string' || !location.file) throw new Error('deptry finding has no file.');
    return {
      code: error.code, message: error.message, module: entry.module, file: location.file,
      line: position(location.line), column: position(location.column),
    };
  });
}

export type Attribution<R extends RuleRef> = {
  readonly breaches: readonly Breach<R>[];
};

const HINT: Readonly<Record<DeptryCode, string>> = {
  DEP001: 'Add the package to the project dependencies, or fix the import.',
  DEP002: 'Remove the unused dependency, or import it where it is used.',
  DEP003: 'Declare the package as a direct dependency.',
  DEP004: 'Move the package to the regular dependencies, or stop importing it from production code.',
  DEP005: 'Remove the standard library module from the dependencies.',
};

/**
 * The one policy for where a finding belongs. deptry always runs every check, so a finding for a
 * code the Gate did not select is simply not this Gate's concern. Selected codes become breaches.
 */
export function attribute<R extends RuleRef>(
  findings: readonly DeptryFinding[],
  selected: ReadonlyMap<DeptryCode, Rule<R>>,
  displayPath: (file: string) => string,
): Attribution<R> {
  const breaches: Breach<R>[] = [];
  for (const finding of findings) {
    if (!isDeptryCode(finding.code)) continue;
    const rule = selected.get(finding.code);
    if (!rule) continue;
    breaches.push(breach(rule, {
      code: finding.code,
      message: finding.message,
      location: { file: displayPath(finding.file), line: finding.line, column: finding.column },
      hint: HINT[finding.code],
    }));
  }
  return { breaches };
}

/** The oldest deptry the evidence covers: 0.16.2 is the oldest release the fixture sweep ran on. */
export const MINIMUM_DEPTRY_VERSION = '0.16.2';

export function parseDeptryVersion(output: string): readonly [number, number, number] | null {
  const match = /^deptry,? (\d+)\.(\d+)\.(\d+)/mu.exec(output.trim());
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null;
}

export function deptryVersionSupported(version: readonly [number, number, number]): boolean {
  const minimum = parseDeptryVersion(`deptry ${MINIMUM_DEPTRY_VERSION}`)!;
  for (const [i, part] of version.entries()) {
    if (part !== minimum[i]) return part > minimum[i]!;
  }
  return true;
}

const ANSI_ESCAPE = /\u001b\[[0-9;]*m/gu;
const clean = (text: string): string => text.replace(ANSI_ESCAPE, '');

/** How many files deptry says it scanned (`Scanning 3 files...`); null when the line is absent. */
export function parseScannedFiles(output: string): number | null {
  const match = /^Scanning (\d+) files?\.\.\.$/mu.exec(clean(output));
  return match ? Number(match[1]) : null;
}

/**
 * Lines where deptry says it set part of the input aside and still exits 0: a file it could not
 * parse (so its imports were never read) or a requirement line it could not read as a package.
 */
const SKIPPED_INPUT = /^(?:Warning: Skipping processing of .*|Could not parse dependency name from url .*)$/gmu;

export function skippedInput(output: string): readonly string[] {
  return [...clean(output).matchAll(SKIPPED_INPUT)].map(match => match[0]);
}

/** What the verbose header says deptry resolved from the command line and the project configuration. */
export type ResolvedConfig = {
  /** The raw `ignore:` value, e.g. `('',)`. */
  readonly ignore: string;
  /** The raw `per_rule_ignores:` value, e.g. `{}` or `{'DEP001': ('zzz',)}`. */
  readonly perRuleIgnores: string;
};

export function parseResolvedConfig(output: string): ResolvedConfig | null {
  const text = clean(output);
  const ignore = /^ignore: (.*)$/mu.exec(text);
  const perRule = /^per_rule_ignores: (.*)$/mu.exec(text);
  return ignore && perRule ? { ignore: ignore[1]!.trim(), perRuleIgnores: perRule[1]!.trim() } : null;
}

/** `ignore: ('',)` is what `--ignore ''` leaves behind: no code is ignored. */
export const ignoreIsCleared = (config: ResolvedConfig): boolean => config.ignore === "('',)";
export const hasPerRuleIgnores = (config: ResolvedConfig): boolean => config.perRuleIgnores !== '{}';

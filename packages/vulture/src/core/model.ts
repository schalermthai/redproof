import { breach, type Breach, type Rule, type RuleRef } from 'redproof';

/** What vulture can call dead. `unreachable-code` covers every reachability message. */
export const VULTURE_KINDS = [
  'unused-import', 'unused-function', 'unused-class', 'unused-method', 'unused-variable',
  'unused-attribute', 'unused-property', 'unreachable-code',
] as const;
export type VultureKind = (typeof VULTURE_KINDS)[number];

export const isVultureKind = (value: unknown): value is VultureKind =>
  typeof value === 'string' && (VULTURE_KINDS as readonly string[]).includes(value);

export function ruleDefinition(kind: VultureKind): { readonly id: `vulture/${string}`; readonly description: string } {
  const what = kind === 'unreachable-code' ? 'unreachable code or an unsatisfiable condition' : kind.replace('-', ' ');
  return { id: `vulture/${kind}`, description: `vulture must report no ${what} at or above the confidence threshold.` };
}

/** One line of vulture's text report. */
export type VultureFinding = {
  readonly kind: VultureKind;
  readonly file: string;
  readonly line: number;
  /** The unused name; null for reachability findings, which have no name. */
  readonly name: string | null;
  readonly message: string;
  readonly confidence: number;
};

// `<file>:<line>: <message> (<n>% confidence[, <m> lines])`. The file may contain colons, so the line number is the last `:<digits>: `.
const LINE = /^(.+?):(\d+): (.+) \((\d{1,3})% confidence(?:, \d+ lines?)?\)$/u;
const UNUSED = /^unused (import|function|class|method|variable|attribute|property) '(.*)'$/u;
const REACHABILITY = /^(?:unreachable code after '[^']*'|unsatisfiable '[^']*' condition|unreachable '[^']*' block)$/u;

function parseLine(line: string): VultureFinding | null {
  const match = LINE.exec(line);
  if (!match) return null;
  const [, file, lineNo, message, confidence] = match;
  const unused = UNUSED.exec(message!);
  const row = Number(lineNo);
  const percent = Number(confidence);
  if (!Number.isSafeInteger(row) || row < 1 || percent > 100) return null;
  if (unused) {
    return { kind: `unused-${unused[1]}` as VultureKind, file: file!, line: row, name: unused[2]!, message: message!, confidence: percent };
  }
  return REACHABILITY.test(message!)
    ? { kind: 'unreachable-code', file: file!, line: row, name: null, message: message!, confidence: percent }
    : null;
}

export type VultureReport = {
  readonly findings: readonly VultureFinding[];
  /** Non-empty stdout lines that are not a finding: the format drifted, or something else printed. */
  readonly unrecognised: readonly string[];
};

export function parseVultureOutput(stdout: string): VultureReport {
  const findings: VultureFinding[] = [];
  const unrecognised: string[] = [];
  for (const raw of stdout.split('\n')) {
    const line = raw.replace(/\r$/u, '');
    if (!line.trim()) continue;
    const finding = parseLine(line);
    if (finding) findings.push(finding);
    else unrecognised.push(line);
  }
  return { findings, unrecognised };
}

const HINT: Readonly<Record<VultureKind, string>> = {
  'unused-import': 'Remove the import, or use it.',
  'unused-function': 'Remove the function, or call it. A name used only dynamically can go in a whitelist module passed in `paths`.',
  'unused-class': 'Remove the class, or use it.',
  'unused-method': 'Remove the method, or call it.',
  'unused-variable': 'Remove the variable, or use it.',
  'unused-attribute': 'Remove the attribute, or read it.',
  'unused-property': 'Remove the property, or read it.',
  'unreachable-code': 'Remove the dead branch, or fix the condition that makes it dead.',
};

/**
 * Findings below the threshold are not this Gate's concern; the rest become breaches of the rule for
 * their kind, when that rule was selected. vulture already filters by `--min-confidence`, so the
 * filter here only protects against a vulture that ignores it.
 */
export function attribute<R extends RuleRef>(
  findings: readonly VultureFinding[],
  selected: ReadonlyMap<VultureKind, Rule<R>>,
  minConfidence: number,
  displayPath: (file: string) => string,
): readonly Breach<R>[] {
  const breaches: Breach<R>[] = [];
  for (const finding of findings) {
    const rule = selected.get(finding.kind);
    if (!rule || finding.confidence < minConfidence) continue;
    breaches.push(breach(rule, {
      code: finding.kind,
      message: `${finding.message} (${finding.confidence}% confidence)`,
      location: { file: displayPath(finding.file), line: finding.line, column: null },
      hint: HINT[finding.kind],
    }));
  }
  return breaches;
}

/** The oldest vulture the evidence covers: `--config` (used to ignore project configuration) arrived in 2.12. */
export const MINIMUM_VULTURE_VERSION = '2.12';

export function parseVultureVersion(output: string): readonly [number, number] | null {
  const match = /^vulture (\d+)\.(\d+)/mu.exec(output.trim());
  return match ? [Number(match[1]), Number(match[2])] : null;
}

export function vultureVersionSupported(version: readonly [number, number]): boolean {
  const minimum = parseVultureVersion(`vulture ${MINIMUM_VULTURE_VERSION}`)!;
  return version[0] !== minimum[0] ? version[0] > minimum[0]! : version[1] >= minimum[1]!;
}

const WARNING_HEADER = /^\S.*:\d+: [A-Za-z]*Warning: /u;

/**
 * What vulture said on stderr that means part of the input was not read: a syntax error, an
 * unreadable file, a missing path. Python warnings (a header line and the source line under it) are
 * not: vulture still read that file. Anything else fails closed.
 */
export function unreadInput(stderr: string): readonly string[] {
  const kept: string[] = [];
  let underWarning = false;
  for (const raw of stderr.split('\n')) {
    const line = raw.replace(/\r$/u, '');
    if (!line.trim()) { underWarning = false; continue; }
    if (WARNING_HEADER.test(line)) { underWarning = true; continue; }
    if (underWarning && /^\s/u.test(line)) continue;
    underWarning = false;
    kept.push(line);
  }
  return kept;
}

/** vulture's `--exclude` is `fnmatch` on the absolute path, case-insensitive, and a pattern without wildcards means `*pattern*`. */
export function excludeMatcher(patterns: readonly string[]): (absolutePath: string) => boolean {
  const regexes = patterns.filter(pattern => pattern).map(pattern => {
    const full = /[*?[]/u.test(pattern) ? pattern : `*${pattern}*`;
    let source = '';
    for (let i = 0; i < full.length; i += 1) {
      const c = full[i]!;
      if (c === '*') source += '[\\s\\S]*';
      else if (c === '?') source += '[\\s\\S]';
      else if (c === '[') {
        const end = full.indexOf(']', i + (full[i + 1] === '!' || full[i + 1] === ']' ? 2 : 1));
        if (end === -1) source += '\\[';
        else {
          let body = full.slice(i + 1, end).replace(/\\/gu, '\\\\');
          if (body.startsWith('!')) body = `^${body.slice(1)}`;
          source += `[${body}]`;
          i = end;
        }
      } else source += c.replace(/[.*+?^${}()|[\]\\/]/gu, '\\$&');
    }
    return new RegExp(`^${source}$`, 'iu');
  });
  return path => regexes.some(regex => regex.test(path));
}

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

// `<file>:<line>: <message> (<n>% confidence[, <m> lines])`, read from the right. The message must be exactly one of the
// shapes vulture prints, and the name in it cannot hold a space or a quote, so a file name that imitates a finding can
// neither swallow the real one nor change its kind: the greedy file part always ends at the last `:<digits>: <message>`.
const NAME = `[^\\s'"]+`;
const WORD = `[A-Za-z_]+`;
const MESSAGE = `(?:unused (import|function|class|method|variable|attribute|property) '(${NAME})'`
  + `|(unreachable code after '${WORD}'|unsatisfiable '${WORD}' condition|unreachable '${WORD}' block`
  + `|redundant if-condition|unreachable 'else' expression))`;
const LINE = new RegExp(`^(.+):(\\d+): ${MESSAGE} \\((\\d{1,3})% confidence(?:, \\d+ lines?)?\\)$`, 'u');

function parseLine(line: string): VultureFinding | null {
  const match = LINE.exec(line);
  if (!match) return null;
  const [, file, lineNo, unusedKind, name, reachability, confidence] = match;
  const row = Number(lineNo);
  const percent = Number(confidence);
  if (!Number.isSafeInteger(row) || row < 1 || percent > 100) return null;
  const message = unusedKind ? `unused ${unusedKind} '${name}'` : reachability!;
  return unusedKind
    ? { kind: `unused-${unusedKind}` as VultureKind, file: file!, line: row, name: name!, message, confidence: percent }
    : { kind: 'unreachable-code', file: file!, line: row, name: null, message, confidence: percent };
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

/**
 * What vulture said on stderr. The run goes out with `PYTHONWARNINGS=ignore`, so no Python warning reaches
 * stderr, and everything that does is a syntax error, an unreadable file, a missing path or a crash: input that
 * was not read. Nothing is classified by its shape, because a file name or source text can imitate any shape.
 */
export function unreadInput(stderr: string): readonly string[] {
  return stderr.split('\n').map(line => line.replace(/\r$/u, '')).filter(line => line.trim());
}

/** CPython's `fnmatch.translate` (3.12), line for line, so a pattern means here what it means to vulture. */
function fnmatchSource(pattern: string): string {
  // Python indexes by code point, JavaScript by UTF-16 unit: walk code points, or an emoji is two characters.
  const pat = Array.from(pattern);
  const text = (from: number, to: number): string => pat.slice(from, to).join('');
  let res = '';
  let i = 0;
  const n = pat.length;
  while (i < n) {
    const c = pat[i++]!;
    if (c === '*') res += '[\\s\\S]*';
    else if (c === '?') res += '[\\s\\S]';
    else if (c === '[') {
      let j = i;
      if (j < n && pat[j] === '!') j += 1;
      if (j < n && pat[j] === ']') j += 1;
      while (j < n && pat[j] !== ']') j += 1;
      if (j >= n) { res += '\\['; continue; }
      let stuff: string;
      if (!pat.slice(i, j).includes('-')) stuff = text(i, j).replaceAll('\\', '\\\\');
      else {
        const chunks: string[] = [];
        let start = i;
        let k = pat[i] === '!' ? i + 2 : i + 1;
        for (;;) {
          k = pat.indexOf('-', k);
          if (k < 0 || k >= j) break;
          chunks.push(text(start, k));
          start = k + 1;
          k += 3;
        }
        const chunk = text(start, j);
        if (chunk) chunks.push(chunk); else chunks[chunks.length - 1] += '-';
        for (let m = chunks.length - 1; m > 0; m -= 1) {
          const before = Array.from(chunks[m - 1]!);
          const after = Array.from(chunks[m]!);
          // Python compares and cuts code points; `>` on strings compares code points only when each side is one.
          if ((before.at(-1)?.codePointAt(0) ?? 0) > (after[0]?.codePointAt(0) ?? 0)) {
            chunks[m - 1] = before.slice(0, -1).join('') + after.slice(1).join('');
            chunks.splice(m, 1);
          }
        }
        stuff = chunks.map(part => part.replaceAll('\\', '\\\\').replaceAll('-', '\\-')).join('-');
      }
      stuff = stuff.replace(/([\]])/gu, '\\$1');
      i = j + 1;
      if (!stuff) res += '(?!)';
      else if (stuff === '!') res += '[\\s\\S]';
      else {
        if (stuff[0] === '!') stuff = `^${stuff.slice(1)}`;
        else if (stuff[0] === '^' || stuff[0] === '[') stuff = `\\${stuff}`;
        res += `[${stuff}]`;
      }
    } else res += c.replace(/[.*+?^${}()|[\]\\/]/gu, '\\$&');
  }
  return `^(?:${res})$`;
}

/**
 * vulture's `--exclude` is `fnmatch` on the absolute path, and a pattern without wildcards means `*pattern*`.
 * `fnmatch` folds case and separators on Windows only (untested here); on POSIX it is case-sensitive.
 */
export function excludeMatcher(patterns: readonly string[], windows: boolean): (absolutePath: string) => boolean {
  const fold = (text: string): string => (windows ? text.toLowerCase().replaceAll('/', '\\') : text);
  const regexes = patterns.filter(pattern => pattern)
    .map(pattern => new RegExp(fnmatchSource(fold(/[*?[]/u.test(pattern) ? pattern : `*${pattern}*`)), 'u'));
  return path => regexes.some(regex => regex.test(fold(path)));
}

/**
 * Whether a directory entry is one `Path.rglob('*.py')` yields: a name ending in `.py` that is a file, or a
 * symbolic link that leads to a file. (A symbolic link to a directory is not entered; the shell never asks.)
 */
export function isPythonSourceEntry(name: string, kind: { readonly file: boolean; readonly symlinkToFile: boolean }): boolean {
  return name.endsWith('.py') && (kind.file || kind.symlinkToFile);
}

/**
 * vulture reads `test_*` functions and `*Test*` classes as used in a "test file", and it decides that from the
 * absolute path: its rules are four fnmatch patterns (a `test` or `tests` directory, a `test*.py` file, a `*_test.py` file), `*` crosses the slash, so any ancestor
 * directory whose name STARTS with `test` (`test`, `tests`, `testing`, `testbed`, `test-runner`, ...) makes every
 * file below it one (`fnmatch`: case-sensitive on POSIX, folded on Windows). So the same commit gets a different verdict in a checkout under
 * `/ci/tests/work/`. Returns the offending segment of `root`, or undefined.
 */
export function testDirectoryAncestor(root: string, windows: boolean): string | undefined {
  return root.split(/[\\/]/u).map(segment => (windows ? segment.toLowerCase() : segment)).find(segment => segment.startsWith('test'));
}

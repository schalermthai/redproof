import { breach, type Breach, type Rule, type RuleRef } from 'redproof';

/** One finding from `ruff check --output-format json`, reduced to what a verdict needs. */
export type RuffFinding = {
  /** Null, or the word `invalid-syntax`, for syntax errors: Ruff could not analyse that file. */
  readonly code: string | null;
  readonly message: string;
  readonly filename: string;
  readonly line: number | null;
  readonly column: number | null;
  readonly name: string | null;
  readonly url: string | null;
  readonly fix: string | null;
  /** Notebook cell number (as Ruff reports it); lines are relative to that cell. Null for plain files. */
  readonly cell: number | null;
};

/** A selector is a Ruff rule code (`F401`) or a rule family (`F`, `S1`, `PLR`). */
const SELECTOR = /^([A-Z]+)([0-9]*)$/u;

export function parseSelector(value: string): { readonly letters: string; readonly digits: string } | null {
  if (value === 'ALL') return null;
  const match = SELECTOR.exec(value);
  return match ? { letters: match[1]!, digits: match[2]! } : null;
}

/** `PL` is Ruff's umbrella for PLC, PLE, PLR and PLW; every other linter prefix is exact. */
function lettersCover(selector: string, code: string): boolean {
  return selector === code || (selector === 'PL' && code.startsWith('PL'));
}

/** Whether every code the narrower selector can name is also named by the wider one. */
export function selectorCovers(wide: string, narrow: string): boolean {
  const w = parseSelector(wide);
  const n = parseSelector(narrow);
  return !!w && !!n && lettersCover(w.letters, n.letters) && n.digits.startsWith(w.digits);
}

/** A real rule code. Syntax errors carry `null` or `invalid-syntax` instead, depending on the Ruff version and flags. */
function isRuleCode(code: string | null): code is string {
  return code !== null && /^[A-Z]+[0-9]+$/u.test(code);
}

function ruleId(selector: string): `ruff/${string}` {
  return `ruff/${selector}`;
}

export function ruleDefinition(selector: string): { readonly id: `ruff/${string}`; readonly description: string } {
  const family = /[0-9]/u.test(selector) ? 'rule' : 'rule family';
  return { id: ruleId(selector), description: `Ruff ${family} ${selector} must report no findings.` };
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected a Ruff finding object.');
  return value as Record<string, unknown>;
}

function position(value: unknown): { readonly row: number | null; readonly column: number | null } {
  if (value === null || value === undefined) return { row: null, column: null };
  const at = record(value);
  const ok = (n: unknown): n is number => typeof n === 'number' && Number.isSafeInteger(n) && n >= 1;
  return { row: ok(at.row) ? at.row : null, column: ok(at.column) ? at.column : null };
}

export function parseRuffReport(text: string): readonly RuffFinding[] {
  const data: unknown = JSON.parse(text);
  if (!Array.isArray(data)) throw new Error('Expected a Ruff JSON array.');
  return data.map((item): RuffFinding => {
    const entry = record(item);
    if (entry.code !== null && (typeof entry.code !== 'string' || !entry.code)) throw new Error('Ruff finding has an invalid code.');
    if (typeof entry.message !== 'string') throw new Error('Ruff finding has no message.');
    if (typeof entry.filename !== 'string' || !entry.filename) throw new Error('Ruff finding has no filename.');
    const at = position(entry.location);
    const fix = entry.fix === null || entry.fix === undefined ? null : record(entry.fix).applicability;
    return {
      code: entry.code as string | null,
      message: entry.message,
      filename: entry.filename,
      line: at.row,
      column: at.column,
      name: typeof entry.name === 'string' ? entry.name : null,
      url: typeof entry.url === 'string' ? entry.url : null,
      fix: typeof fix === 'string' ? fix : null,
      cell: typeof entry.cell === 'number' && Number.isSafeInteger(entry.cell) ? entry.cell : null,
    };
  });
}

export type Attribution<R extends RuleRef> = {
  readonly breaches: readonly Breach<R>[];
  /** Findings Ruff could not analyse (syntax errors): their rules were never evaluated. */
  readonly unanalysed: readonly RuffFinding[];
  /** Codes no selected selector covers: Ruff answered for a rule other than the ones asked (an alias or remap). */
  readonly strangers: readonly string[];
};

/**
 * The one policy for where a finding belongs. Every finding lands in exactly one place: a breach of
 * the selected rule that covers it, the unanalysed list, or the strangers list. The caller decides
 * what the last two mean; nothing is dropped.
 */
export function attribute<R extends RuleRef>(
  findings: readonly RuffFinding[],
  selected: ReadonlyMap<string, Rule<R>>,
  displayPath: (filename: string) => string,
): Attribution<R> {
  const breaches: Breach<R>[] = [];
  const unanalysed: RuffFinding[] = [];
  const strangers = new Set<string>();
  for (const finding of findings) {
    const code = finding.code;
    if (!isRuleCode(code)) {
      unanalysed.push(finding);
      continue;
    }
    const owner = [...selected].find(([selector]) => selectorCovers(selector, code));
    if (!owner) {
      strangers.add(code);
      continue;
    }
    breaches.push(breach(owner[1], {
      code,
      message: finding.name ? `${finding.message} (${finding.name})` : finding.message,
      location: { file: displayPath(finding.filename), line: finding.line, column: finding.column },
      ...(finding.url ? { hint: finding.url } : {}),
      ...(finding.cell !== null || finding.fix
        ? { detail: [
          finding.cell === null ? '' : `Notebook cell ${finding.cell}; line and column are relative to the cell.`,
          finding.fix ? `Ruff offers a ${finding.fix} fix.` : '',
        ].filter(Boolean).join(' ') }
        : {}),
    }));
  }
  return { breaches, unanalysed, strangers: [...strangers] };
}

/** The oldest Ruff release the evidence below covers: the fixture sweep agreed with raw Ruff on it. */
export const MINIMUM_RUFF_VERSION = '0.4.10';

export function parseRuffVersion(output: string): readonly [number, number, number] | null {
  const match = /^ruff (\d+)\.(\d+)\.(\d+)/u.exec(output.trim());
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null;
}

export function ruffVersionSupported(version: readonly [number, number, number]): boolean {
  const minimum = parseRuffVersion(`ruff ${MINIMUM_RUFF_VERSION}`)!;
  for (const [i, part] of version.entries()) {
    if (part !== minimum[i]) return part > minimum[i]!;
  }
  return true;
}

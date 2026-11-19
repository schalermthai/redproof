import { breach, type Breach, type Rule, type RuleRef } from 'redproof';

/**
 * Every code a Gate may select, with what it takes to make mypy produce it. A code is here only because a
 * minimal program went red at the Gate with that code alone and an empty configuration, and turned green when
 * fixed (`test/rules.native.test.ts`). Many codes stay silent unless a flag asks for them, and enabling the
 * code alone would pass for the wrong reason. The value is the flags that activate the code; every selected code
 * is also enabled with `--enable-error-code`, which optional codes need.
 */
export const verifiedCodes: Readonly<Record<string, readonly string[]>> = {
  'abstract': [],
  'arg-type': [],
  'assert-type': [],
  'assignment': [],
  'attr-defined': [],
  'await-not-async': [],
  'call-arg': [],
  'call-overload': [],
  'comparison-overlap': ['--strict-equality'],
  'deprecated': [],
  'dict-item': [],
  'empty-body': [],
  'exhaustive-match': [],
  'exit-return': [],
  'explicit-any': ['--disallow-any-explicit'],
  'explicit-override': [],
  'func-returns-value': [],
  'ignore-without-code': [],
  'import': [],
  'import-not-found': [],
  'import-untyped': [],
  'index': [],
  'list-item': [],
  'method-assign': [],
  'misc': [],
  'mutable-override': [],
  'name-defined': [],
  'name-match': [],
  'no-any-return': ['--warn-return-any'],
  'no-overload-impl': [],
  'no-redef': [],
  'no-untyped-call': ['--disallow-untyped-calls'],
  'no-untyped-def': ['--disallow-untyped-defs'],
  'operator': [],
  'overload-cannot-match': [],
  'overload-overlap': [],
  'override': [],
  'possibly-undefined': [],
  'redundant-cast': ['--warn-redundant-casts'],
  'redundant-expr': [],
  'redundant-self': [],
  'return': [],
  'return-value': [],
  'str-bytes-safe': [],
  'str-format': [],
  'truthy-bool': [],
  'truthy-function': [],
  'truthy-iterable': [],
  'type-abstract': [],
  'type-arg': ['--disallow-any-generics'],
  'type-var': [],
  'typeddict-item': [],
  'typeddict-unknown-key': [],
  'unimported-reveal': [],
  'union-attr': [],
  'unreachable': ['--warn-unreachable'],
  'untyped-decorator': ['--disallow-untyped-decorators'],
  'unused-awaitable': [],
  'unused-coroutine': [],
  'unused-ignore': ['--warn-unused-ignores'],
  'used-before-def': [],
  'valid-type': [],
  'var-annotated': [],
};

/** Codes that exist in mypy but cannot be a rule, and why. A Gate that selects one gets this sentence. */
export const unselectableCodes: Readonly<Record<string, string>> = {
  'syntax': 'a syntax error stops mypy before any rule is evaluated, so it always REFUSES instead of failing a rule.',
  'annotation-unchecked': 'it is a note about code mypy did not check, and the adapter checks untyped bodies itself.',
};

/** mypy's sub-codes: switching the parent off switches the child off, and `# type: ignore[parent]` covers the child. */
const PARENT: Readonly<Record<string, string>> = {
  'method-assign': 'assignment',
  'typeddict-unknown-key': 'typeddict-item',
  'import-not-found': 'import',
  'import-untyped': 'import',
  'overload-cannot-match': 'misc',
  'overload-overlap': 'misc',
  'prop-decorator': 'misc',
};

export const isMypyRuleCode = (code: string): boolean => Object.hasOwn(verifiedCodes, code);

/** Whether selecting `wide` also selects every finding of `narrow` (a code covers itself and its sub-codes). */
export function coversCode(wide: string, narrow: string): boolean {
  for (let code: string | undefined = narrow; code !== undefined; code = PARENT[code]) {
    if (code === wide) return true;
  }
  return false;
}

/** Either covers the other: a `# type: ignore[a]` hides a finding of `b` when this holds. */
export const relatedCodes = (a: string, b: string): boolean => coversCode(a, b) || coversCode(b, a);

/**
 * Whether `# type: ignore[ignored]` can hide a finding of the selected `chosen`. Besides the code tree, mypy 2.x reports
 * "Too many positional arguments" as `call-arg` with `misc` as its parent, which the tree cannot say for 1.11 (where it is `misc`),
 * so the edge exists for ignore comments only: a wrong edge there is a REFUSE, never a wrong breach.
 */
export const ignoreMayHide = (chosen: string, ignored: string): boolean =>
  relatedCodes(chosen, ignored) || (chosen === 'call-arg' && ignored === 'misc');

/** The import-resolution codes: when they fire, mypy typed the import as `Any`, so other rules saw less than they should. */
export const unresolvedImportCodes: readonly string[] = ['import-not-found', 'import-untyped'];

/** Codes the adapter must always see, even when no Gate rule selects them, so a silenced signal cannot pass. */
export const signalCodes: readonly string[] = ['import-not-found', 'import-untyped', 'unused-ignore', 'unreachable'];

/** Codes that are about ignore comments themselves; an ignore comment cannot hide these. */
export const ignoreCodes: readonly string[] = ['unused-ignore', 'ignore-without-code'];

/** One diagnostic from `mypy --output json`, reduced to what a verdict needs. */
export type MypyFinding = {
  readonly file: string;
  readonly line: number | null;
  /** 1-based, or null when mypy gives none (it reports -1 for a comment-level finding). */
  readonly column: number | null;
  readonly severity: 'error' | 'note';
  readonly code: string | null;
  readonly message: string;
  readonly hint: string | null;
};

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected a mypy diagnostic object.');
  return value as Record<string, unknown>;
}

const count = (n: unknown): number | null => (typeof n === 'number' && Number.isSafeInteger(n) && n >= 1 ? n : null);

/**
 * mypy prints one JSON object per line. A line that is not valid, or an object missing a field the verdict
 * relies on, throws: a partial report is never evidence. Blank lines are the only thing skipped.
 */
export function parseMypyReport(text: string): readonly MypyFinding[] {
  return text.split('\n').filter(line => line.trim()).map((line): MypyFinding => {
    const entry = record(JSON.parse(line));
    if (typeof entry.file !== 'string' || !entry.file) throw new Error('A mypy diagnostic has no file.');
    if (typeof entry.message !== 'string') throw new Error('A mypy diagnostic has no message.');
    if (entry.severity !== 'error' && entry.severity !== 'note') {
      throw new Error(`A mypy diagnostic has the severity ${JSON.stringify(entry.severity)}, which this adapter does not know.`);
    }
    if (entry.code !== null && (typeof entry.code !== 'string' || !entry.code)) throw new Error('A mypy diagnostic has an invalid code.');
    if (typeof entry.line !== 'number' || !Number.isSafeInteger(entry.line)) throw new Error('A mypy diagnostic has no line.');
    const column = typeof entry.column === 'number' && Number.isSafeInteger(entry.column) && entry.column >= 0 ? entry.column + 1 : null;
    return {
      file: entry.file,
      line: count(entry.line),
      column,
      severity: entry.severity,
      code: entry.code as string | null,
      message: entry.message,
      hint: typeof entry.hint === 'string' && entry.hint ? entry.hint : null,
    };
  });
}

export function ruleDefinition(code: string): { readonly id: `mypy/${string}`; readonly description: string } {
  return { id: `mypy/${code}`, description: `mypy must report no ${code} errors.` };
}

/** The selected rule that owns a finding's code: the code itself or its parent, never a neighbour. */
export function ownerOf<R extends RuleRef>(code: string, selected: ReadonlyMap<string, Rule<R>>): Rule<R> | undefined {
  for (const [selector, rule] of selected) if (coversCode(selector, code)) return rule;
  return undefined;
}

export function toBreach<R extends RuleRef>(rule: Rule<R>, finding: MypyFinding, file: string): Breach<R> {
  return breach(rule, {
    code: finding.code ?? 'mypy',
    message: finding.message,
    location: { file, line: finding.line, column: finding.column },
    ...(finding.hint ? { hint: finding.hint } : {}),
  });
}

/** `mypy 1.11.0 (compiled: yes)` or a bare `1.11.0`/`2.5.0+dev.<sha>` version string. */
export function parseMypyVersion(text: string): readonly [number, number, number] | null {
  const match = /^(?:mypy )?(\d+)\.(\d+)\.(\d+)/u.exec(text.trim());
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null;
}

/** `--output json` first appeared in mypy 1.11.0; 1.10.1 exits 2 on the flag. */
export const MINIMUM_MYPY_VERSION = '1.11.0';

export function mypyVersionSupported(version: readonly [number, number, number]): boolean {
  const minimum = parseMypyVersion(MINIMUM_MYPY_VERSION)!;
  for (const [i, part] of version.entries()) {
    if (part !== minimum[i]) return part > minimum[i]!;
  }
  return true;
}

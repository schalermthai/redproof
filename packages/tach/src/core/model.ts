import { breach, type Breach, type Rule, type RuleRef } from 'redproof';

export const ruleKinds = [
  'undeclared-dependency', 'forbidden-dependency', 'deprecated-dependency', 'layer-violation',
  'interface-violation', 'ignore-directive', 'circular-dependency', 'visibility-violation',
] as const;
export type TachRuleKind = typeof ruleKinds[number];

export const ruleDefinitions = {
  'undeclared-dependency': { id: 'tach/undeclared-dependency', description: 'A module must import only from modules it declares in depends_on.' },
  'forbidden-dependency': { id: 'tach/forbidden-dependency', description: 'A module must not import from a module listed in its cannot_depend_on.' },
  'deprecated-dependency': { id: 'tach/deprecated-dependency', description: 'A module must not import from a module its configuration marks as a deprecated dependency.' },
  'layer-violation': { id: 'tach/layer-violation', description: 'A module must not import from a higher layer, or across a closed layer.' },
  'interface-violation': { id: 'tach/interface-violation', description: 'A module must import only what the other module exposes in its interface, with the declared data types.' },
  'ignore-directive': { id: 'tach/ignore-directive', description: 'tach-ignore directives must be needed and, where the configuration asks, carry a reason.' },
  'circular-dependency': { id: 'tach/circular-dependency', description: 'Declared module dependencies must not form a cycle.' },
  'visibility-violation': { id: 'tach/visibility-violation', description: 'A module must not depend on a module whose visibility excludes it.' },
} as const satisfies Record<TachRuleKind, { readonly id: string; readonly description: string }>;

/** Rules the `tach check --output json` report cannot carry. Asking for one must fail at construction. */
export const unreadableRules: Readonly<Record<string, string>> = {
  'unused-dependency': 'tach reports unused module dependencies only in text mode (`--exact`); the JSON output has no such diagnostic.',
  'undeclared-external-dependency': '`tach check` never reports external packages; `tach check-external` has no JSON output.',
  'unused-external-dependency': '`tach check` never reports external packages; `tach check-external` has no JSON output.',
};

export type Severity = 'Error' | 'Warning';

/** One entry of the diagnostics array, reduced to what a verdict needs. */
export type Diagnostic = {
  readonly scope: 'code' | 'configuration';
  /** The Rust enum variant name, for example `UndeclaredDependency`. */
  readonly variant: string;
  readonly severity: Severity;
  readonly file: string | null;
  readonly line: number | null;
  readonly fields: Readonly<Record<string, string>>;
};

/** What `tach check --output json` can print. The last three are not an array: tach stopped early. */
export type TachReport =
  | { readonly kind: 'diagnostics'; readonly diagnostics: readonly Diagnostic[] }
  | { readonly kind: 'cycle'; readonly modules: readonly string[] }
  | { readonly kind: 'visibility'; readonly errors: readonly { readonly dependent: string; readonly dependency: string; readonly visibility: readonly string[] }[] }
  | { readonly kind: 'error'; readonly message: string };

const record = (value: unknown, what: string): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`Expected ${what} to be an object.`);
  return value as Record<string, unknown>;
};
const onlyEntry = (value: unknown, what: string): readonly [string, unknown] => {
  const entries = Object.entries(record(value, what));
  if (entries.length !== 1) throw new Error(`Expected ${what} to have exactly one key.`);
  return entries[0]!;
};
const strings = (value: unknown, what: string): readonly string[] => {
  if (!Array.isArray(value) || value.some(item => typeof item !== 'string')) throw new Error(`Expected ${what} to be a list of strings.`);
  return value as string[];
};

function parseDiagnostic(item: unknown): Diagnostic {
  const [scope, body] = onlyEntry(item, 'a diagnostic');
  if (scope !== 'Located' && scope !== 'Global') throw new Error(`Unknown diagnostic scope ${scope}.`);
  const entry = record(body, 'a diagnostic body');
  const severity = entry.severity;
  if (severity !== 'Error' && severity !== 'Warning') throw new Error('Diagnostic has an unknown severity.');
  const [family, inner] = onlyEntry(entry.details, 'diagnostic details');
  if (family !== 'Code' && family !== 'Configuration') throw new Error(`Unknown diagnostic family ${family}.`);
  const [variant, payload] = onlyEntry(inner, 'a diagnostic variant');
  // Variants with no fields serialise as an empty array, the rest as an object of strings.
  const fields = Array.isArray(payload) && payload.length === 0 ? {} : record(payload, 'a diagnostic payload');
  const text: Record<string, string> = {};
  for (const [key, value] of Object.entries(fields)) {
    if (typeof value !== 'string') throw new Error(`Diagnostic field ${key} is not a string.`);
    text[key] = value;
  }
  let file: string | null = null;
  let line: number | null = null;
  if (scope === 'Located') {
    if (typeof entry.file_path !== 'string' || !entry.file_path) throw new Error('Located diagnostic has no file_path.');
    if (!Number.isSafeInteger(entry.line_number) || (entry.line_number as number) < 1) throw new Error('Located diagnostic has no line_number.');
    file = entry.file_path;
    line = entry.line_number as number;
  }
  return { scope: family === 'Code' ? 'code' : 'configuration', variant, severity, file, line, fields: text };
}

export function parseTachReport(text: string): TachReport {
  const data: unknown = JSON.parse(text);
  if (Array.isArray(data)) return { kind: 'diagnostics', diagnostics: data.map(parseDiagnostic) };
  const entry = record(data, 'the tach report');
  if (typeof entry.error !== 'string') throw new Error('Expected a tach diagnostics array or an error object.');
  if (entry.error === 'Circular dependency') return { kind: 'cycle', modules: strings(entry.dependencies, 'dependencies') };
  if (entry.error === 'Visibility error') {
    if (!Array.isArray(entry.visibility_errors)) throw new Error('Visibility error has no visibility_errors.');
    return { kind: 'visibility', errors: entry.visibility_errors.map(tuple => {
      if (!Array.isArray(tuple) || tuple.length !== 3 || typeof tuple[0] !== 'string' || typeof tuple[1] !== 'string') {
        throw new Error('Visibility error entry is malformed.');
      }
      return { dependent: tuple[0], dependency: tuple[1], visibility: strings(tuple[2], 'visibility') };
    }) };
  }
  return { kind: 'error', message: entry.error };
}

/** Code diagnostics `tach check` can emit, and the rule each one belongs to. `null`: known, but no rule here covers it. */
const owners: Readonly<Record<string, TachRuleKind | null>> = {
  UndeclaredDependency: 'undeclared-dependency',
  ForbiddenDependency: 'forbidden-dependency',
  DeprecatedDependency: 'deprecated-dependency',
  LayerViolation: 'layer-violation',
  ClosedLayerViolation: 'layer-violation',
  PrivateDependency: 'interface-violation',
  InvalidDataTypeExport: 'interface-violation',
  UnnecessarilyIgnoredDependency: 'ignore-directive',
  UnusedIgnoreDirective: 'ignore-directive',
  MissingIgnoreDirectiveReason: 'ignore-directive',
  // External-package diagnostics belong to `check-external`; `check` does not print them.
  UndeclaredExternalDependency: null,
  UnusedExternalDependency: null,
  ModuleUndeclaredExternalDependency: null,
  ModuleForbiddenExternalDependency: null,
};

const ownerOf = (variant: string): TachRuleKind | null | undefined => owners[variant];

const f = (d: Diagnostic, key: string): string => d.fields[key] ?? '?';

/** The wording tach itself uses, rebuilt from the fields so a Breach reads the same as `tach check` text. */
export function messageOf(d: Diagnostic): string {
  switch (d.variant) {
    case 'PrivateDependency': return `The path '${f(d, 'dependency')}' is not part of the public interface for '${f(d, 'definition_module')}'.`;
    case 'InvalidDataTypeExport': return `The dependency '${f(d, 'dependency')}' (from module '${f(d, 'definition_module')}') matches an interface but does not match the expected data type ('${f(d, 'expected_data_type')}').`;
    case 'UndeclaredDependency':
    case 'ForbiddenDependency': return `Cannot use '${f(d, 'dependency')}'. Module '${f(d, 'usage_module')}' cannot depend on '${f(d, 'definition_module')}'.`;
    case 'DeprecatedDependency': return `Dependency '${f(d, 'dependency')}' is deprecated. Module '${f(d, 'usage_module')}' should not depend on '${f(d, 'definition_module')}'.`;
    case 'LayerViolation': return `Cannot use '${f(d, 'dependency')}'. Layer '${f(d, 'usage_layer')}' ('${f(d, 'usage_module')}') is lower than layer '${f(d, 'definition_layer')}' ('${f(d, 'definition_module')}').`;
    case 'ClosedLayerViolation': return `Cannot use '${f(d, 'dependency')}'. Layer '${f(d, 'usage_layer')}' ('${f(d, 'usage_module')}') cannot import from layer '${f(d, 'definition_layer')}' ('${f(d, 'definition_module')}') because layer '${f(d, 'closed_layer')}' is a closed layer between them.`;
    case 'UnnecessarilyIgnoredDependency': return `Dependency '${f(d, 'dependency')}' is unnecessarily ignored by a directive.`;
    case 'UnusedIgnoreDirective': return 'Ignore directive is unused.';
    case 'MissingIgnoreDirectiveReason': return 'Ignore directive is missing a reason.';
    default: return d.variant;
  }
}

export type Attribution<R extends RuleRef> = {
  readonly breaches: readonly Breach<R>[];
  /** Variants this adapter has never seen: tach said something it cannot be held to. */
  readonly unrecognised: readonly string[];
};

/**
 * The one policy for where a code diagnostic belongs: a breach of the selected rule that owns its variant, nothing
 * when no selected rule owns it (the Gate did not ask), or the unrecognised list. A warning still breaches: a
 * Gate that selects the rule is asking for it, whatever severity the project gave tach.
 */
export function attribute<R extends RuleRef>(
  diagnostics: readonly Diagnostic[],
  selected: ReadonlyMap<TachRuleKind, Rule<R>>,
  displayPath: (file: string) => string,
): Attribution<R> {
  const breaches: Breach<R>[] = [];
  const unrecognised = new Set<string>();
  for (const d of diagnostics) {
    const owner = ownerOf(d.variant);
    if (owner === undefined) { unrecognised.add(d.variant); continue; }
    const rule = owner === null ? undefined : selected.get(owner);
    if (!rule) continue;
    breaches.push(breach(rule, {
      code: d.variant,
      message: messageOf(d),
      location: d.file === null ? null : { file: displayPath(d.file), line: d.line, column: null },
      detail: `tach severity: ${d.severity}.`,
    }));
  }
  return { breaches, unrecognised: [...unrecognised] };
}

/** The oldest tach the evidence below covers: every example project and the battle-test cases agreed with raw tach on it. */
export const MINIMUM_TACH_VERSION = '0.35.3';

export function parseTachVersion(output: string): readonly [number, number, number] | null {
  const match = /^tach (\d+)\.(\d+)\.(\d+)/u.exec(output.trim());
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null;
}

export function tachVersionSupported(version: readonly [number, number, number]): boolean {
  const minimum = parseTachVersion(`tach ${MINIMUM_TACH_VERSION}`)!;
  for (const [i, part] of version.entries()) {
    if (part !== minimum[i]) return part > minimum[i]!;
  }
  return true;
}

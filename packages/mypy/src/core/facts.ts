import { isAbsolute, relative, resolve, sep } from 'node:path';
import type { Allowance } from './options.ts';
import { ignoreCodes, parseMypyVersion, relatedCodes, signalCodes } from './model.ts';

/** What mypy itself says it will do, read by the probe before the check runs. */
type FileFacts = {
  readonly path: string;
  readonly unreadable: string | null;
  readonly ignores: readonly { readonly line: number; readonly codes: readonly string[] | null; readonly top: boolean }[];
  readonly inline: readonly { readonly line: number; readonly text: string }[];
};

export type Facts = {
  readonly mypyVersion: string;
  readonly hostVersion: readonly [number, number];
  readonly hostPlatform: string;
  readonly configFile: string | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly sources: readonly { readonly path: string; readonly module: string | null }[];
  /** Global settings the project's configuration changed, against the same run with no configuration file. */
  readonly changed: Readonly<Record<string, unknown>>;
  /** Per-module sections: pattern to the settings that section sets. */
  readonly sections: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
  readonly files: readonly FileFacts[];
};

export type ProbeOutput =
  | { readonly kind: 'facts'; readonly facts: Facts }
  | { readonly kind: 'unavailable'; readonly detail: string }
  | { readonly kind: 'stopped'; readonly code: number | null; readonly crash: string | null; readonly stdout: string; readonly stderr: string; readonly mypyVersion: string | null };

export type Problem = { readonly code: string; readonly message: string; readonly detail?: string };

function object(value: unknown, what: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`The mypy probe gave no ${what} object.`);
  return value as Record<string, unknown>;
}
function text(value: unknown, what: string): string {
  if (typeof value !== 'string') throw new Error(`The mypy probe gave no ${what}.`);
  return value;
}
function list(value: unknown, what: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`The mypy probe gave no ${what} list.`);
  return value;
}

export function parseProbe(output: string): ProbeOutput {
  const data = object(JSON.parse(output), 'result');
  if (data.kind === 'unavailable') return { kind: 'unavailable', detail: text(data.detail, 'detail') };
  if (data.kind === 'stopped') {
    return {
      kind: 'stopped',
      code: typeof data.code === 'number' ? data.code : null,
      crash: typeof data.crash === 'string' ? data.crash : null,
      stdout: text(data.stdout, 'stdout'),
      stderr: text(data.stderr, 'stderr'),
      mypyVersion: typeof data.mypyVersion === 'string' ? data.mypyVersion : null,
    };
  }
  if (data.kind !== 'facts') throw new Error('The mypy probe answered with something that is not facts.');
  const host = list(data.hostVersion, 'hostVersion');
  if (host.length !== 2 || host.some(n => typeof n !== 'number')) throw new Error('The mypy probe gave a bad host version.');
  const sections = object(data.sections, 'sections');
  return {
    kind: 'facts',
    facts: {
      mypyVersion: text(data.mypyVersion, 'version'),
      hostVersion: [host[0] as number, host[1] as number],
      hostPlatform: text(data.hostPlatform, 'host platform'),
      configFile: data.configFile === null ? null : text(data.configFile, 'config file'),
      stdout: text(data.stdout, 'stdout'),
      stderr: text(data.stderr, 'stderr'),
      sources: list(data.sources, 'sources').map(item => {
        const source = object(item, 'source');
        return { path: text(source.path, 'source path'), module: typeof source.module === 'string' ? source.module : null };
      }),
      changed: object(data.changed, 'changed settings'),
      sections: Object.fromEntries(Object.entries(sections).map(([pattern, values]) => [pattern, object(values, 'section')])),
      files: list(data.files, 'files').map((item): FileFacts => {
        const file = object(item, 'file');
        return {
          path: text(file.path, 'file path'),
          unreadable: typeof file.unreadable === 'string' ? file.unreadable : null,
          ignores: list(file.ignores, 'ignores').map(entry => {
            const ignore = object(entry, 'ignore');
            const codes = ignore.codes === null ? null : list(ignore.codes, 'ignore codes').map(code => text(code, 'ignore code'));
            return { line: Number(ignore.line), codes, top: ignore.top === true };
          }),
          inline: list(file.inline, 'inline').map(entry => {
            const comment = object(entry, 'inline comment');
            return { line: Number(comment.line), text: text(comment.text, 'inline text') };
          }),
        };
      }),
    },
  };
}

/** Both paths must be absolute and canonical. */
export function withinRoot(root: string, actual: string): boolean {
  const rel = relative(root, actual);
  return !isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${sep}`);
}

/**
 * The settings vetted as unable to hide a finding. A setting in neither list, in the global scope or in a
 * `[mypy-pattern]` section, is unvetted and REFUSES: a denylist would pass every option nobody thought of.
 *
 * `HARMLESS` settings change how mypy talks or caches, never what it finds. `ONLY_TRUE` settings tighten
 * the check when on, and relax it when off, which is how a per-module section beats a flag on the command line.
 */
const HARMLESS = new Set([
  'cache_dir', 'cache_fine_grained', 'color_output', 'config_file', 'error_summary', 'fast_exit', 'fixed_format_cache',
  'hide_error_codes', 'incremental', 'many_errors_threshold', 'num_workers', 'pretty', 'show_absolute_path',
  'show_column_numbers', 'show_error_code_links', 'show_error_context', 'show_error_end', 'skip_cache_mtime_checks',
  'skip_version_check', 'sqlite_cache', 'sqlite_num_shards', 'warn_unused_configs', 'files', 'namespace_packages',
  'explicit_package_bases', 'package_root', 'enable_incomplete_feature', 'enable_error_code', 'enabled_error_codes',
  'native_parser', 'cache_map', 'fast_module_lookup',
]);
const ONLY_TRUE = new Set([
  'check_untyped_defs', 'disallow_any_decorated', 'disallow_any_explicit', 'disallow_any_expr', 'disallow_any_generics',
  'disallow_any_unimported', 'disallow_incomplete_defs', 'disallow_subclassing_any', 'disallow_untyped_calls',
  'disallow_untyped_decorators', 'disallow_untyped_defs', 'extra_checks', 'strict_equality', 'strict_equality_for_none',
  'strict_concatenate', 'strict_bytes', 'strict_optional', 'warn_incomplete_stub', 'warn_no_return',
  'warn_redundant_casts', 'warn_return_any', 'warn_unreachable', 'warn_unused_ignores', 'local_partial_types',
  'follow_untyped_imports', 'disable_bytearray_promotion', 'disable_memoryview_promotion', 'pos_only_special_methods',
]);
const ONLY_FALSE = new Set(['implicit_reexport']);

const empty = (value: unknown): boolean => value === undefined || value === null || value === false
  || (Array.isArray(value) && value.length === 0) || value === '';

/** `[mypy-pkg.*] ignore_errors`, or a global `follow_imports`, as the Gate reader will see it. */
type Place = { readonly where: string; readonly name: string; readonly value: unknown };

function places(facts: Facts): readonly Place[] {
  return [
    ...Object.entries(facts.changed).map(([name, value]) => ({ where: 'the configuration', name, value })),
    ...Object.entries(facts.sections).flatMap(([pattern, values]) =>
      Object.entries(values).map(([name, value]) => ({ where: `[mypy-${pattern}]`, name, value }))),
  ];
}

const show = (place: Place): string => `${place.where} ${place.name} = ${JSON.stringify(place.value)}`;

export type PolicyInput = {
  readonly facts: Facts;
  /** Selected codes, plus the codes the adapter always needs to see. */
  readonly selected: readonly string[];
  readonly allow: ReadonlySet<Allowance>;
  /** Whether the Gate (not the host) fixed the Python version and the platform. */
  readonly pinned: { readonly pythonVersion: boolean; readonly platform: boolean };
  /** Canonical absolute paths of `mypy_path` entries; the shell resolves links. */
  readonly mypyPath: readonly string[];
  readonly configFile: string | undefined;
  readonly root: string;
  /** Canonical absolute paths the Gate named, and the directory they were named from. */
  readonly requested: readonly string[];
  readonly cwd: string;
};

const refused = (code: string, message: string, offenders: readonly string[]): Problem =>
  ({ code, message, ...(offenders.length ? { detail: offenders.join('\n') } : {}) });

/**
 * Whether the configuration and sources mypy resolved can be trusted to report every finding of the selected
 * rules. Returns the first reason they cannot; the order is fixed so a failing Gate says the same thing twice.
 */
export function judgeFacts(input: PolicyInput): Problem | undefined {
  const { facts, allow } = input;
  const version = parseMypyVersion(facts.mypyVersion);
  if (!version) return refused('mypy-version-unknown', 'The tool did not identify itself as a mypy release.', [facts.mypyVersion]);

  if (facts.stderr.trim()) {
    return refused('mypy-config-warning', 'mypy complained while reading its configuration; a setting may not mean what the project meant.', [facts.stderr.trim()]);
  }
  if (facts.configFile !== null) {
    if (input.configFile === undefined || !withinRoot(input.root, input.configFile)) {
      return refused('mypy-config-outside-root',
        'mypy found its configuration outside the Gate root (a user-level file differs per machine). Name a configFile, or set isolated.',
        [facts.configFile]);
    }
  }
  const outside = input.mypyPath.filter(path => !withinRoot(input.root, path));
  if (outside.length) {
    return refused('mypy-config-outside-root', 'mypy_path names a directory outside the Gate root, which differs per machine.', outside);
  }

  if (!facts.sources.length) {
    return refused('mypy-nothing-inspected', 'mypy found no Python files to check, so a pass would mean nothing.', []);
  }
  const found = facts.sources.map(source => resolve(input.cwd, source.path));
  const unaccounted = input.requested.filter(path =>
    !found.some(file => file === path || file.startsWith(path.endsWith(sep) ? path : path + sep)));
  if (unaccounted.length) {
    return refused('mypy-path-excluded', 'mypy left out every file under a path the Gate named, so nothing there was checked.', unaccounted);
  }

  const pythonUnpinned = !input.pinned.pythonVersion && !('python_version' in facts.changed);
  const platformUnpinned = !input.pinned.platform && !('platform' in facts.changed);
  if ((pythonUnpinned || platformUnpinned) && !allow.has('host-defaults')) {
    return refused('mypy-host-dependent',
      'mypy would check as the host Python and platform, so the verdict differs by machine. Set pythonVersion and platform, or allow host-defaults.',
      [pythonUnpinned ? 'pythonVersion is not set' : '', platformUnpinned ? 'platform is not set' : ''].filter(Boolean));
  }

  const hides: Record<string, string[]> = {};
  const hide = (allowance: Allowance, place: Place): void => { (hides[allowance] ??= []).push(show(place)); };
  const unvetted: string[] = [];
  for (const place of places(facts)) {
    const { name, value } = place;
    if (name === 'python_version' || name === 'platform') continue; // pinned by the check above
    if (name === 'ignore_errors') { if (value === true) hide('ignore-errors', place); continue; }
    if (name === 'ignore_missing_imports') { if (value === true) hide('ignore-missing-imports', place); continue; }
    if (name === 'follow_imports') {
      if (value === 'skip' || value === 'silent') hide('follow-imports', place);
      else if (value !== 'normal') unvetted.push(show(place));
      continue;
    }
    if (name === 'exclude') { if (!empty(value)) hide('exclude', place); continue; }
    if (name === 'always_true' || name === 'always_false') { if (!empty(value)) hide('reachability', place); continue; }
    if (name === 'plugins') { if (!empty(value)) hide('plugins', place); continue; }
    if (name === 'mypy_path') continue; // checked against the root above
    if (name === 'disable_error_code' || name === 'disabled_error_codes') {
      const codes = Array.isArray(value) ? value.map(String) : [];
      // A global disable loses to the command line's --enable-error-code; a section's does not.
      if (place.where !== 'the configuration' && codes.some(code => input.selected.some(chosen => relatedCodes(chosen, code)))) {
        hide('disabled-codes', place);
      }
      continue;
    }
    if (HARMLESS.has(name)) continue;
    if (ONLY_TRUE.has(name)) { if (value !== true) unvetted.push(show(place)); continue; }
    if (ONLY_FALSE.has(name)) { if (value !== false) unvetted.push(show(place)); continue; }
    unvetted.push(show(place));
  }
  for (const [allowance, offenders] of Object.entries(hides)) {
    if (!allow.has(allowance as Allowance)) {
      return refused('mypy-setting-hides-findings',
        `The configuration can hide findings (${allowance}). Remove it, or allow ${allowance} to accept a weaker verdict.`, offenders);
    }
  }
  if (unvetted.length) {
    return refused('mypy-setting-unvetted',
      'The configuration sets something this adapter has not vetted as unable to hide a finding or change the tree.', unvetted);
  }

  const comments = facts.files.flatMap(file => file.inline.map(entry => `${file.path}:${entry.line}: # mypy: ${entry.text}`));
  if (comments.length && !allow.has('inline-config')) {
    return refused('mypy-inline-config', 'A source file configures mypy for itself with a `# mypy:` comment, which can hide findings.', comments);
  }
  const unreadable = facts.files.filter(file => file.unreadable !== null).map(file => `${file.path}: ${file.unreadable}`);
  if (unreadable.length) return refused('mypy-source-unreadable', 'A source file could not be read to look for ignore comments.', unreadable);
  const wholeFile = facts.files.flatMap(file => file.ignores.filter(ignore => ignore.top).map(ignore => `${file.path}:${ignore.line}`));
  if (wholeFile.length && !allow.has('type-ignore')) {
    return refused('mypy-ignore-comments', 'A `# type: ignore` before the first statement makes mypy skip the whole file.', wholeFile);
  }
  return undefined;
}

/**
 * After the run: `# type: ignore` comments that suppressed something relevant. `--warn-unused-ignores` is forced,
 * so an ignore that hid nothing came back as an `unused-ignore` finding; every other one hid a real error, and
 * if that error could have been one of the selected rules the verdict would be a lie.
 */
export function hidingIgnores(
  facts: Facts,
  selected: readonly string[],
  unused: ReadonlySet<string>,
  key: (path: string, line: number) => string,
): readonly string[] {
  const watched = selected.filter(code => !ignoreCodes.includes(code) && !signalCodes.includes(code));
  if (!watched.length) return [];
  const hiding: string[] = [];
  for (const file of facts.files) {
    for (const ignore of file.ignores) {
      if (unused.has(key(file.path, ignore.line))) continue;
      const relevant = ignore.codes === null || ignore.codes.some(code => watched.some(chosen => relatedCodes(chosen, code)));
      if (relevant) hiding.push(`${file.path}:${ignore.line}: # type: ignore${ignore.codes ? `[${ignore.codes.join(',')}]` : ''}`);
    }
  }
  return hiding;
}

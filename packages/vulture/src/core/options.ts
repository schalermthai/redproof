import { isAbsolute } from 'node:path';
import { rejectUnknownKeys } from 'redproof';
import { VULTURE_KINDS, isVultureKind } from './model.ts';

export type Selection = Readonly<Record<string, string>>;

export type VultureOptions<M extends Selection = Selection> = {
  /** Alias to a finding kind: `unused-import`, `unused-function`, ..., `unreachable-code`. */
  readonly rules: M;
  /**
   * Files and directories to analyse, relative to `cwd`. Defaults to the working directory.
   * A whitelist module (names that are used dynamically) goes here too.
   */
  readonly paths?: readonly string[];
  /** Working directory relative to the Gate root. */
  readonly cwd?: string;
  /**
   * Report only findings at or above this confidence, 0 to 100. Always passed to vulture, so a
   * project's `min_confidence` never applies. Defaults to 60, the lowest confidence vulture reports.
   * Imports are reported at 90; functions, classes, methods, attributes, properties and variables at
   * 60; unused arguments and unreachable code at 100.
   */
  readonly minConfidence?: number;
  /** vulture `--exclude` patterns (`fnmatch` on the absolute path: case-sensitive on POSIX, folded on Windows). */
  readonly exclude?: readonly string[];
  /** vulture `--ignore-names` patterns. */
  readonly ignoreNames?: readonly string[];
  /** vulture `--ignore-decorators` patterns, e.g. `@app.route`. */
  readonly ignoreDecorators?: readonly string[];
  /**
   * Accept a Gate root with a `test*` directory (`test`, `tests`, `testing`, `testbed`, `test-runner`, ...) among its ancestors. vulture then treats every file as a
   * test file (`test_*` functions and `*Test*` classes count as used), so the verdict would differ from a checkout
   * elsewhere; by default the check REFUSES instead.
   */
  readonly allowTestPathAncestors?: boolean;
  /**
   * A pyproject file relative to the Gate root whose `[tool.vulture]` applies. By default no project
   * configuration is read, because its `exclude` or `ignore_names` could hide findings unseen.
   */
  readonly configFile?: string;
  /** The vulture executable. Defaults to `vulture` on PATH. */
  readonly command?: string;
  readonly timeoutMs?: number;
  readonly maxOutputBytes?: number;
};

function validatePath(name: string, value: string): void {
  if (typeof value !== 'string' || !value.trim() || value.startsWith('-')
    || isAbsolute(value) || /^[A-Za-z]:/u.test(value) || value.split(/[\\/]/u).includes('..')) {
    throw new Error(`vulture ${name} must be a non-empty relative path inside the Gate root.`);
  }
}

/** Patterns travel as one comma-separated argument, so a comma or a leading dash would change their meaning. */
function validatePatterns(name: string, value: readonly string[] | undefined): void {
  if (value === undefined) return;
  if (!Array.isArray(value) || !value.length) throw new Error(`vulture ${name} must be a non-empty list.`);
  for (const pattern of value) {
    if (typeof pattern !== 'string' || !pattern.trim() || pattern.includes(',') || pattern.startsWith('-')) {
      throw new Error(`vulture ${name} entries must be non-empty, contain no comma and not start with a dash.`);
    }
  }
}

export function validateVultureOptions(options: VultureOptions): void {
  rejectUnknownKeys(options, ['rules', 'paths', 'cwd', 'minConfidence', 'exclude', 'ignoreNames', 'ignoreDecorators',
    'configFile', 'allowTestPathAncestors', 'command', 'timeoutMs', 'maxOutputBytes'], 'vulture adapter');
  const entries = Object.entries(options.rules ?? {});
  if (!entries.length) throw new Error('vulture requires at least one Redproof rule.');
  const seen = new Set<string>();
  for (const [alias, kind] of entries) {
    if (!alias.trim() || !isVultureKind(kind)) {
      throw new Error(`Unknown vulture rule: ${String(kind)}. Use one of ${VULTURE_KINDS.join(', ')}.`);
    }
    if (seen.has(kind)) throw new Error(`vulture rule ${kind} is selected twice.`);
    seen.add(kind);
  }
  if (options.paths !== undefined) {
    if (!Array.isArray(options.paths) || !options.paths.length) throw new Error('vulture paths must be a non-empty list.');
    for (const path of options.paths) validatePath('paths entry', path);
  }
  if (options.cwd !== undefined) validatePath('cwd', options.cwd);
  if (options.configFile !== undefined) validatePath('configFile', options.configFile);
  if (options.minConfidence !== undefined
    && (!Number.isInteger(options.minConfidence) || options.minConfidence < 0 || options.minConfidence > 100)) {
    throw new Error('vulture minConfidence must be an integer between 0 and 100.');
  }
  if (options.allowTestPathAncestors !== undefined && typeof options.allowTestPathAncestors !== 'boolean') throw new Error('vulture allowTestPathAncestors must be boolean.');
  validatePatterns('exclude', options.exclude);
  validatePatterns('ignoreNames', options.ignoreNames);
  validatePatterns('ignoreDecorators', options.ignoreDecorators);
  if (options.command !== undefined && (typeof options.command !== 'string' || !options.command.trim())) {
    throw new Error('vulture command must not be empty.');
  }
  for (const name of ['timeoutMs', 'maxOutputBytes'] as const) {
    const value = options[name];
    if (value !== undefined && (!Number.isSafeInteger(value) || value <= 0)) throw new Error(`vulture ${name} must be a positive integer.`);
  }
}

import { isAbsolute } from 'node:path';
import { rejectUnknownKeys } from 'redproof';
import { parseSelector, selectorCovers } from './model.ts';

export type Selection = Readonly<Record<string, string>>;

export type RuffOptions<M extends Selection = Selection> = {
  /** Alias to Ruff selector: a rule code (`F401`) or a family (`S`, `PLR`). */
  readonly rules: M;
  /** Files or directories to check, relative to `cwd`. Defaults to the working directory. */
  readonly paths?: readonly string[];
  /** Working directory relative to the Gate root. */
  readonly cwd?: string;
  /** A Ruff configuration file relative to the Gate root. */
  readonly configFile?: string;
  /** Ignore all project configuration (`--isolated`). Cannot combine with `configFile`. */
  readonly isolated?: boolean;
  /** Enable Ruff preview rules (`--preview`). */
  readonly preview?: boolean;
  /** Report findings suppressed by `# noqa` comments (`--ignore-noqa`). */
  readonly ignoreNoqa?: boolean;
  /** The Ruff executable. Defaults to `ruff` on PATH. */
  readonly command?: string;
  readonly timeoutMs?: number;
  readonly maxOutputBytes?: number;
};

function validatePath(name: string, value: string): void {
  if (typeof value !== 'string' || !value.trim() || value.startsWith('-')
    || isAbsolute(value) || /^[A-Za-z]:/u.test(value) || value.split(/[\\/]/u).includes('..')) {
    throw new Error(`Ruff ${name} must be a non-empty relative path inside the Gate root.`);
  }
}

export function validateRuffOptions(options: RuffOptions): void {
  rejectUnknownKeys(options, ['rules', 'paths', 'cwd', 'configFile', 'isolated', 'preview',
    'ignoreNoqa', 'command', 'timeoutMs', 'maxOutputBytes'], 'ruff adapter');
  const entries = Object.entries(options.rules ?? {});
  if (!entries.length) throw new Error('Ruff requires at least one Redproof rule.');
  for (const [alias, selector] of entries) {
    if (!alias.trim() || typeof selector !== 'string' || !parseSelector(selector)) {
      throw new Error(`Unknown Ruff selector: ${String(selector)}. Use a rule code such as F401 or a family such as S.`);
    }
  }
  const selectors = entries.map(([, selector]) => selector);
  for (const [i, a] of selectors.entries()) {
    for (const [j, b] of selectors.entries()) {
      if (i !== j && selectorCovers(a, b)) {
        throw new Error(`Ruff selectors must not overlap: ${a} already covers ${b}.`);
      }
    }
  }
  if (options.paths !== undefined) {
    if (!Array.isArray(options.paths) || !options.paths.length) throw new Error('Ruff paths must be a non-empty list.');
    for (const path of options.paths) validatePath('paths entry', path);
  }
  if (options.cwd !== undefined) validatePath('cwd', options.cwd);
  if (options.configFile !== undefined) validatePath('configFile', options.configFile);
  if (options.isolated && options.configFile !== undefined) {
    throw new Error('Ruff isolated cannot be combined with configFile.');
  }
  for (const name of ['isolated', 'preview', 'ignoreNoqa'] as const) {
    if (options[name] !== undefined && typeof options[name] !== 'boolean') throw new Error(`Ruff ${name} must be boolean.`);
  }
  if (options.command !== undefined && (typeof options.command !== 'string' || !options.command.trim())) {
    throw new Error('Ruff command must not be empty.');
  }
  for (const name of ['timeoutMs', 'maxOutputBytes'] as const) {
    const value = options[name];
    if (value !== undefined && (!Number.isSafeInteger(value) || value <= 0)) throw new Error(`Ruff ${name} must be a positive integer.`);
  }
}

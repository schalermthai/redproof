import { isAbsolute } from 'node:path';
import { rejectUnknownKeys } from 'redproof';
import { DEPTRY_CODES, isDeptryCode } from './model.ts';

export type Selection = Readonly<Record<string, string>>;

export type DeptryOptions<M extends Selection = Selection> = {
  /** Alias to deptry code: `DEP001` to `DEP005`. */
  readonly rules: M;
  /** Directories to scan, relative to `cwd`. Defaults to the working directory. */
  readonly paths?: readonly string[];
  /** Working directory relative to the Gate root; deptry reads `pyproject.toml` or requirements files here. */
  readonly cwd?: string;
  /** A pyproject file relative to the Gate root (`--config`). */
  readonly configFile?: string;
  /** Do not scan notebooks (`--ignore-notebooks`). */
  readonly ignoreNotebooks?: boolean;
  /**
   * Accept `per_rule_ignores` from the project configuration. deptry cannot be told to disregard
   * them, so by default a project that sets any makes the check REFUSE rather than pass quietly.
   */
  readonly allowPerRuleIgnores?: boolean;
  /** The deptry executable. Defaults to `deptry` on PATH; point it at the project's virtualenv. */
  readonly command?: string;
  readonly timeoutMs?: number;
  readonly maxOutputBytes?: number;
};

function validatePath(name: string, value: string): void {
  if (typeof value !== 'string' || !value.trim() || value.startsWith('-')
    || isAbsolute(value) || /^[A-Za-z]:/u.test(value) || value.split(/[\\/]/u).includes('..')) {
    throw new Error(`deptry ${name} must be a non-empty relative path inside the Gate root.`);
  }
}

export function validateDeptryOptions(options: DeptryOptions): void {
  rejectUnknownKeys(options, ['rules', 'paths', 'cwd', 'configFile', 'ignoreNotebooks', 'allowPerRuleIgnores',
    'command', 'timeoutMs', 'maxOutputBytes'], 'deptry adapter');
  const entries = Object.entries(options.rules ?? {});
  if (!entries.length) throw new Error('deptry requires at least one Redproof rule.');
  const seen = new Set<string>();
  for (const [alias, code] of entries) {
    if (!alias.trim() || !isDeptryCode(code)) {
      throw new Error(`Unknown deptry rule: ${String(code)}. Use one of ${DEPTRY_CODES.join(', ')}.`);
    }
    if (seen.has(code)) throw new Error(`deptry rule ${code} is selected twice.`);
    seen.add(code);
  }
  if (options.paths !== undefined) {
    if (!Array.isArray(options.paths) || !options.paths.length) throw new Error('deptry paths must be a non-empty list.');
    for (const path of options.paths) validatePath('paths entry', path);
  }
  if (options.cwd !== undefined) validatePath('cwd', options.cwd);
  if (options.configFile !== undefined) validatePath('configFile', options.configFile);
  for (const name of ['ignoreNotebooks', 'allowPerRuleIgnores'] as const) {
    if (options[name] !== undefined && typeof options[name] !== 'boolean') throw new Error(`deptry ${name} must be boolean.`);
  }
  if (options.command !== undefined && (typeof options.command !== 'string' || !options.command.trim())) {
    throw new Error('deptry command must not be empty.');
  }
  for (const name of ['timeoutMs', 'maxOutputBytes'] as const) {
    const value = options[name];
    if (value !== undefined && (!Number.isSafeInteger(value) || value <= 0)) throw new Error(`deptry ${name} must be a positive integer.`);
  }
}

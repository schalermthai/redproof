import { isAbsolute } from 'node:path';
import { rejectUnknownKeys } from 'redproof';
import { coversCode, isMypyRuleCode, unselectableCodes } from './model.ts';

export type Selection = Readonly<Record<string, string>>;

/**
 * Settings the adapter refuses by default because they can hide a finding. Naming one in `allow` accepts it,
 * and says so in the Gate: the verdict is then weaker than "mypy reports nothing".
 */
export const allowances = [
  'type-ignore',
  'inline-config',
  'ignore-errors',
  'ignore-missing-imports',
  'unresolved-imports',
  'follow-imports',
  'disabled-codes',
  'exclude',
  'reachability',
  'plugins',
  'host-defaults',
] as const;
export type Allowance = typeof allowances[number];

export type MypyOptions<M extends Selection = Selection> = {
  /** Alias to a mypy error code, such as `arg-type` or `no-untyped-def`. */
  readonly rules: M;
  /** Files or directories to check, relative to `cwd`. Defaults to the working directory. */
  readonly paths?: readonly string[];
  /** Working directory relative to the Gate root. */
  readonly cwd?: string;
  /** A mypy configuration file relative to the Gate root. Without it, the file mypy finds must lie inside the Gate root. */
  readonly configFile?: string;
  /** Ignore all configuration files (`--config-file=`). Cannot combine with `configFile`. */
  readonly isolated?: boolean;
  /** Check as this Python version (`--python-version`), such as `3.12`. Without it the verdict follows the host Python. */
  readonly pythonVersion?: string;
  /** Check as this platform (`--platform`), such as `linux`. Without it the verdict follows the host. */
  readonly platform?: string;
  /** Settings to accept although they can hide findings. */
  readonly allow?: readonly Allowance[];
  /** The Python interpreter that has mypy installed and that mypy type-checks against. Defaults to `python3`. */
  readonly python?: string;
  readonly timeoutMs?: number;
  readonly maxOutputBytes?: number;
};

function validatePath(name: string, value: string): void {
  if (typeof value !== 'string' || !value.trim() || value.startsWith('-')
    || isAbsolute(value) || /^[A-Za-z]:/u.test(value) || value.split(/[\\/]/u).includes('..')) {
    throw new Error(`mypy ${name} must be a non-empty relative path inside the Gate root.`);
  }
}

export function validateMypyOptions(options: MypyOptions): void {
  rejectUnknownKeys(options, ['rules', 'paths', 'cwd', 'configFile', 'isolated', 'pythonVersion', 'platform',
    'allow', 'python', 'timeoutMs', 'maxOutputBytes'], 'mypy adapter');
  const entries = Object.entries(options.rules ?? {});
  if (!entries.length) throw new Error('mypy requires at least one Redproof rule.');
  for (const [alias, code] of entries) {
    if (!alias.trim() || typeof code !== 'string') throw new Error(`Unknown mypy rule: ${String(code)}.`);
    const why = unselectableCodes[code];
    if (why) throw new Error(`mypy rule ${code} cannot be selected: ${why}`);
    if (!isMypyRuleCode(code)) throw new Error(`Unknown mypy rule: ${code}. Use an error code mypy reports and this adapter has verified.`);
  }
  const codes = entries.map(([, code]) => code);
  for (const [i, a] of codes.entries()) {
    for (const [j, b] of codes.entries()) {
      if (i === j) continue;
      if (a === b) throw new Error(`mypy rules must not be selected more than once: ${a}.`);
      if (coversCode(a, b)) throw new Error(`mypy rules must not overlap: ${a} already covers ${b}.`);
    }
  }
  if (options.paths !== undefined) {
    if (!Array.isArray(options.paths) || !options.paths.length) throw new Error('mypy paths must be a non-empty list.');
    for (const path of options.paths) validatePath('paths entry', path);
  }
  if (options.cwd !== undefined) validatePath('cwd', options.cwd);
  if (options.configFile !== undefined) validatePath('configFile', options.configFile);
  if (options.isolated !== undefined && typeof options.isolated !== 'boolean') throw new Error('mypy isolated must be boolean.');
  if (options.isolated && options.configFile !== undefined) throw new Error('mypy isolated cannot be combined with configFile.');
  if (options.pythonVersion !== undefined && !/^3\.\d{1,2}$/u.test(options.pythonVersion)) {
    throw new Error('mypy pythonVersion must look like 3.12.');
  }
  if (options.platform !== undefined && !/^[A-Za-z][A-Za-z0-9_-]*$/u.test(options.platform)) {
    throw new Error('mypy platform must be a platform name such as linux, darwin or win32.');
  }
  if (options.allow !== undefined) {
    if (!Array.isArray(options.allow)) throw new Error('mypy allow must be a list.');
    for (const name of options.allow) {
      if (!(allowances as readonly string[]).includes(name)) throw new Error(`Unknown mypy allowance: ${String(name)}.`);
    }
    if (new Set(options.allow).size !== options.allow.length) throw new Error('mypy allow must not repeat an entry.');
  }
  if (options.python !== undefined && (typeof options.python !== 'string' || !options.python.trim() || options.python.startsWith('-'))) {
    throw new Error('mypy python must not be empty.');
  }
  for (const name of ['timeoutMs', 'maxOutputBytes'] as const) {
    const value = options[name];
    if (value !== undefined && (!Number.isSafeInteger(value) || value <= 0)) throw new Error(`mypy ${name} must be a positive integer.`);
  }
}

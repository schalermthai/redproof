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
   * Directories and files to leave out, as deptry `--exclude` regular expressions matched from the start of a
   * path relative to `cwd`. Defaults to deptry's own: `venv`, `.venv`, `.direnv`, `tests`, `.git`, `setup.py`.
   * Always passed, so the project's `exclude` never applies, and so deptry does not read `.gitignore`, `.ignore`
   * or a global ignore file (it only does that while `--exclude` is left at its default).
   */
  readonly exclude?: readonly string[];
  /** More `--extend-exclude` regular expressions, on top of `exclude`. */
  readonly extendExclude?: readonly string[];
  /**
   * The check overrides these project settings, because each can erase a finding of a selected rule: `ignore`,
   * `per_rule_ignores`, `known_first_party`, `package_module_name_map`, `exclude` and `extend_exclude`. Each
   * `allow...` option below accepts the project's own value of that setting instead, and says so in the Gate.
   */
  readonly allowPerRuleIgnores?: boolean;
  /** Accept `known_first_party` (and `experimental_namespace_package`): modules deptry then treats as the project's own. */
  readonly allowKnownFirstParty?: boolean;
  /** Accept `package_module_name_map`: which module names deptry credits to a package. */
  readonly allowPackageModuleNameMap?: boolean;
  /** Accept `optional_dependencies_dev_groups` and `non_dev_dependency_groups`: which declared packages count as development. */
  readonly allowDependencyGroups?: boolean;
  /** Accept `requirements_files` and `requirements_files_dev` from the project: which files hold the declarations when there is no pyproject section. */
  readonly allowRequirementsFiles?: boolean;
  /** Accept `# deptry: ignore[...]` comments in source (deptry 0.25+ lists each one it honoured; by default a selected rule that was silenced this way REFUSES). */
  readonly allowInlineIgnores?: boolean;
  /** The deptry executable. Defaults to `deptry` on PATH; point it at the project's virtualenv. */
  readonly command?: string;
  readonly timeoutMs?: number;
  readonly maxOutputBytes?: number;
};

function validatePath(name: string, value: string): void {
  if (typeof value !== 'string' || !value.trim() || value.startsWith('-') || /[\r\n\0]/u.test(value)
    || isAbsolute(value) || /^[A-Za-z]:/u.test(value) || value.split(/[\\/]/u).includes('..')) {
    throw new Error(`deptry ${name} must be a non-empty relative path inside the Gate root.`);
  }
}

/** Patterns are echoed back and compared, so they must be plain: no quotes, no control characters, no leading dash. */
function validatePatterns(name: string, value: readonly string[] | undefined): void {
  if (value === undefined) return;
  if (!Array.isArray(value) || (name === 'exclude' && !value.length)) throw new Error(`deptry ${name} must be a ${name === 'exclude' ? 'non-empty ' : ''}list.`);
  for (const pattern of value) {
    if (typeof pattern !== 'string' || !pattern.trim() || pattern.startsWith('-') || /['"\u0000-\u001f]/u.test(pattern)) {
      throw new Error(`deptry ${name} entries must be non-empty, contain no quote or control character and not start with a dash.`);
    }
    try { new RegExp(pattern, 'u'); } catch { throw new Error(`deptry ${name} entry is not a valid regular expression: ${pattern}`); }
  }
}

export function validateDeptryOptions(options: DeptryOptions): void {
  rejectUnknownKeys(options, ['rules', 'paths', 'cwd', 'configFile', 'ignoreNotebooks', 'exclude', 'extendExclude',
    'allowPerRuleIgnores', 'allowKnownFirstParty', 'allowPackageModuleNameMap', 'allowDependencyGroups',
    'allowRequirementsFiles', 'allowInlineIgnores',
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
  for (const name of ['exclude', 'extendExclude'] as const) validatePatterns(name, options[name]);
  for (const name of ['ignoreNotebooks', 'allowPerRuleIgnores', 'allowKnownFirstParty', 'allowPackageModuleNameMap', 'allowDependencyGroups', 'allowRequirementsFiles', 'allowInlineIgnores'] as const) {
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

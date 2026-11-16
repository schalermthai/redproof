import { mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { executeCommand } from 'redproof/command';
import { parse } from 'smol-toml';
import { ConfigError, mergeDomain, readConfig, type ConfigFacts, type SourceTree } from '../core/config.ts';
import type { IgnoredFiles } from '../core/guards.ts';

export class DomainConfigError extends Error {
  constructor(message: string, cause: unknown) { super(message, { cause }); }
}

/** The facts in a config file's text. Text that is not TOML is a `ConfigError`, never a guess. */
function parseConfig(text: string, kind: 'project' | 'domain' = 'project'): ConfigFacts {
  let tree: unknown;
  try {
    tree = parse(text);
  } catch (error) {
    throw new ConfigError(`Not valid TOML: ${error instanceof Error ? error.message : String(error)}`);
  }
  return readConfig(tree, kind);
}

/**
 * Directories tach's own walker never reads: hidden ones, and only those. node_modules, __pycache__, site-packages
 * and directories holding pyvenv.cfg are read by tach, so they are walked here too.
 */
const NOT_WALKED = /^\./u;

/**
 * tach.toml plus every distributed `tach.domain.toml` below it, and the tree tach walks: its Python files, the
 * symbolic links it skips and the `.ignore` files it obeys. One walk answers every "does tach read this?" question,
 * so none of them is asked of a different list. A directory or file that cannot be read throws `DomainConfigError`:
 * code that could not be seen must not be assumed checked. A tach.toml that is not valid throws `ConfigError`.
 */
export async function readProject(cwd: string, configText: string): Promise<{ readonly facts: ConfigFacts; readonly tree: SourceTree }> {
  let facts = parseConfig(configText);
  const python: string[] = [];
  const symlinks: string[] = [];
  const nestedRepos: string[] = [];
  const ignoreFiles: string[] = [];
  const walk = async (dir: string, path: string): Promise<void> => {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch (error) {
      throw new DomainConfigError(`A directory under the project could not be read, so what tach reads there is unknown: ${path || '.'}`, error);
    }
    for (const entry of entries) {
      const child = path ? `${path}/${entry.name}` : entry.name;
      const full = join(dir, entry.name);
      if (path && entry.name === '.git') nestedRepos.push(path);
      if (entry.isSymbolicLink()) {
        const target = entry.name.startsWith('.') ? undefined : await stat(full).catch(() => undefined);
        if (target?.isDirectory() || (target?.isFile() && entry.name.endsWith('.py'))) symlinks.push(child);
      } else if (entry.isDirectory()) {
        if (!NOT_WALKED.test(entry.name)) await walk(full, child);
      } else if (entry.isFile()) {
        if (entry.name === '.ignore') ignoreFiles.push(child);
        else if (entry.name === 'tach.domain.toml') {
          try {
            facts = mergeDomain(facts, parseConfig(await readFile(full, 'utf8'), 'domain'), path || '.');
          } catch (error) {
            throw new DomainConfigError(`A tach.domain.toml could not be read: ${child}`, error);
          }
        } else if (entry.name.endsWith('.py') && !entry.name.startsWith('.')) python.push(child);
      }
    }
  };
  await walk(cwd, '');
  // tach also reads the `.ignore` of every directory above the project.
  for (let dir = dirname(cwd); ; dir = dirname(dir)) {
    const file = join(dir, '.ignore');
    if (await stat(file).then(s => s.isFile(), () => false)) ignoreFiles.push(relative(cwd, file).replaceAll('\\', '/'));
    if (dirname(dir) === dir) break;
  }
  return { facts, tree: { python, symlinks, nestedRepos, ignoreFiles } };
}

/** tach never reads hidden directories, so a hidden path is not a hidden source. */
const HIDDEN_DIRECTORIES = [':(exclude,glob)**/.*/**'];

const git = (cwd: string, args: readonly string[], limit: number) =>
  executeCommand({ command: 'git', args, cwd, label: 'git', timeoutMs: 30_000, maxOutputBytes: limit, env: { GIT_OPTIONAL_LOCKS: '0' } });

/**
 * With `respect_gitignore = false` tach switches off `.gitignore` and `.ignore` but still reads the repository's own
 * `.git/info/exclude`. The files that file hides; none when there is no repository; undefined when git cannot say.
 */
/** Whether a `.git` entry (directory or worktree file) sits in `dir` or above it. */
async function insideRepository(dir: string): Promise<boolean> {
  for (let here = dir; ; here = dirname(here)) {
    if (await stat(join(here, '.git')).then(() => true, () => false)) return true;
    if (dirname(here) === here) return false;
  }
}

async function hiddenByRepository(cwd: string, limit: number): Promise<IgnoredFiles> {
  if (!(await insideRepository(cwd))) return [];
  const top = await git(cwd, ['rev-parse', '--show-toplevel'], limit);
  const exclude = await git(cwd, ['rev-parse', '--git-path', 'info/exclude'], limit);
  if (top.kind === 'refused' || top.exitCode !== 0 || exclude.kind === 'refused' || exclude.exitCode !== 0) return undefined;
  const root = top.stdout.trim();
  const listed = await git(root, ['ls-files', '--cached', '--others', '--ignored', `--exclude-from=${resolve(cwd, exclude.stdout.trim())}`, '-z', '--', '*.py', ...HIDDEN_DIRECTORIES], limit);
  if (listed.kind === 'refused' || listed.exitCode !== 0) return undefined;
  return listed.stdout.split('\0').filter(Boolean).map(file => relative(cwd, resolve(root, file))).filter(file => !file.startsWith('..'));
}

/**
 * The Python files that ignore files hide, relative to `cwd`. tach reads .gitignore even outside a git repository
 * and honours ignore files above the project, so in a repo the answer is `git ls-files --cached --others --ignored`;
 * outside one, a throwaway git directory is pointed at the highest ancestor that holds a .gitignore. A .gitignore
 * above the repository, or a repository git cannot open, is more than git shows: undefined, like any time git cannot answer.
 */
export async function ignoredPython(cwd: string, limit: number, respect: ConfigFacts['respectGitignore']): Promise<IgnoredFiles> {
  if (respect === 'false') return hiddenByRepository(cwd, limit);
  // Tracked files count: a file committed before its .gitignore rule is still skipped by tach, which never reads the index.
  const listing = ['ls-files', '--cached', '--others', '--ignored', '--exclude-standard', '-z', '--', '*.py', ...HIDDEN_DIRECTORIES];
  const top = await git(cwd, ['rev-parse', '--show-toplevel'], limit);
  if (top.kind === 'refused') return undefined;
  if (top.exitCode === 0) {
    // git reads the ignore files inside the repository; tach also reads the ones above it.
    for (let dir = dirname(top.stdout.trim()); ; dir = dirname(dir)) {
      if (await stat(join(dir, '.gitignore')).then(() => true, () => false)) return undefined;
      if (dirname(dir) === dir) break;
    }
    const listed = await git(cwd, listing, limit);
    return listed.kind === 'completed' && listed.exitCode === 0 ? listed.stdout.split('\0').filter(Boolean) : undefined;
  }
  // git failed to open it (for example, dubious ownership), yet a repository is there: that is not "no repository".
  if (await insideRepository(cwd)) return undefined;
  let base = cwd;
  for (let dir = cwd; ; dir = dirname(dir)) {
    if (await stat(join(dir, '.gitignore')).then(s => s.isFile(), () => false)) base = dir;
    if (dirname(dir) === dir) break;
  }
  const scratch = await mkdtemp(join(tmpdir(), 'redproof-tach-git-'));
  try {
    const init = await git(scratch, ['init', '--bare', '-q', scratch], limit);
    if (init.kind === 'refused' || init.exitCode !== 0) return undefined;
    const listed = await git(base, [`--git-dir=${scratch}`, `--work-tree=${base}`, ...listing], limit);
    if (listed.kind === 'refused' || listed.exitCode !== 0) return undefined;
    return listed.stdout.split('\0').filter(Boolean).map(file => relative(cwd, resolve(base, file))).filter(file => !file.startsWith('..'));
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}

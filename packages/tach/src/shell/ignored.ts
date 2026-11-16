import { mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { executeCommand } from 'redproof/command';
import { mergeDomain, readConfig, type ConfigFacts } from '../core/config.ts';
import type { IgnoredFiles } from '../core/guards.ts';

export class DomainConfigError extends Error {
  constructor(message: string, cause: unknown) { super(message, { cause }); }
}

/**
 * Directories tach's own walker never reads: hidden ones, and environments and caches that are not project sources.
 * Everything else is walked to any depth, because a `tach.domain.toml` anywhere below can mark a module `unchecked`.
 */
const NOT_WALKED = /^(?:\..*|node_modules|venv|__pycache__|site-packages)$/u;

/**
 * tach.toml plus every distributed `tach.domain.toml` below it. A directory or file that cannot be read throws
 * `DomainConfigError`: a module that could not be seen must not be assumed checked.
 */
export async function readFacts(cwd: string, configText: string): Promise<ConfigFacts> {
  let facts = readConfig(configText);
  const walk = async (dir: string): Promise<void> => {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch (error) {
      throw new DomainConfigError(`A directory under the project could not be read, so a tach.domain.toml in it might have been missed: ${relative(cwd, dir) || '.'}`, error);
    }
    for (const entry of entries) {
      if (entry.isDirectory() && !NOT_WALKED.test(entry.name)) await walk(join(dir, entry.name));
      else if (entry.isFile() && entry.name === 'tach.domain.toml') {
        const file = join(dir, entry.name);
        try {
          facts = mergeDomain(facts, readConfig(await readFile(file, 'utf8')), relative(cwd, dir) || '.');
        } catch (error) {
          throw new DomainConfigError(`A tach.domain.toml could not be read: ${relative(cwd, file)}`, error);
        }
      }
    }
  };
  await walk(cwd);
  return facts;
}

const EXCLUDED_ENVIRONMENTS = ['.venv', 'venv', 'node_modules', 'site-packages', '.tox', '.git'].map(name => `:(exclude,glob)**/${name}/**`);

const git = (cwd: string, args: readonly string[], limit: number) =>
  executeCommand({ command: 'git', args, cwd, label: 'git', timeoutMs: 30_000, maxOutputBytes: limit, env: { GIT_OPTIONAL_LOCKS: '0' } });

/**
 * The Python files that ignore files hide, relative to `cwd`. tach reads .gitignore even outside a git repository
 * and honours ignore files above the project, so in a repo the answer is `git ls-files --others --ignored`;
 * outside one, a throwaway git directory is pointed at the highest ancestor that holds a .gitignore.
 * Undefined when git cannot answer.
 */
export async function ignoredPython(cwd: string, limit: number): Promise<IgnoredFiles> {
  const listing = ['ls-files', '--others', '--ignored', '--exclude-standard', '-z', '--', '*.py', ...EXCLUDED_ENVIRONMENTS];
  const top = await git(cwd, ['rev-parse', '--show-toplevel'], limit);
  if (top.kind === 'refused') return undefined;
  if (top.exitCode === 0) {
    const listed = await git(cwd, listing, limit);
    return listed.kind === 'completed' && listed.exitCode === 0 ? listed.stdout.split('\0').filter(Boolean) : undefined;
  }
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

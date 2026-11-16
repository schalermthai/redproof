import { mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { executeCommand } from 'redproof/command';
import { mergeDomain, readConfig, type ConfigFacts } from '../core/config.ts';
import type { IgnoredFiles } from '../core/guards.ts';

/** tach.toml plus every distributed `tach.domain.toml` below it (not inside environments). */
export async function readFacts(cwd: string, configText: string): Promise<ConfigFacts> {
  let facts = readConfig(configText);
  const skip = /^(?:\..*|node_modules|venv|__pycache__|site-packages)$/u;
  const walk = async (dir: string, depth: number): Promise<void> => {
    if (depth > 6) return;
    for (const entry of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
      if (entry.isDirectory() && !skip.test(entry.name)) await walk(join(dir, entry.name), depth + 1);
      else if (entry.isFile() && entry.name === 'tach.domain.toml') {
        facts = mergeDomain(facts, readConfig(await readFile(join(dir, entry.name), 'utf8')));
      }
    }
  };
  await walk(cwd, 0);
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

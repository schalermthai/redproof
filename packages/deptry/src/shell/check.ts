import { mkdtemp, readdir, readFile, realpath, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import type { Check, Rule, RuleRef } from 'redproof';
import { counting } from 'redproof';
import { executeCommand } from 'redproof/command';
import {
  checkResult, decideDeptry, displayPath, excludePatterns, finalOutcome, refusal, scanRoots, unexpectedFailure, withinRoot, type DeptryPlan,
  type ScanCensus, type DeptryDecision, type DeptryRefusal, type DeptryScan,
} from '../core/decision.ts';
import { excludedPath, isScannedEntry, type DeptryCode } from '../core/model.ts';
import type { DeptryOptions } from '../core/options.ts';

/** The canonical path when it exists inside the Gate root; otherwise the reason to REFUSE. */
async function confine(root: string, base: string, path: string, what: string): Promise<string | DeptryRefusal> {
  let actual: string;
  try {
    actual = await realpath(resolve(base, path));
  } catch (error) {
    const missing = (error as NodeJS.ErrnoException).code === 'ENOENT';
    return refusal(missing ? 'deptry-path-missing' : 'deptry-path-unreadable',
      `The ${what} ${missing ? 'does not exist' : 'could not be read'}: ${path}`, String(error));
  }
  return withinRoot(root, actual)
    ? actual
    : refusal('deptry-path-outside-root', `The ${what} resolves outside the Gate root: ${path}`, actual);
}

/**
 * The files deptry's walker will list, found the same way: every scan root, entries removed by the exclude patterns
 * (matched on the path relative to where deptry runs, `./` removed, directories included), `*.py` and `*.ipynb` files
 * (a symbolic link counts when it leads to a file), symbolic links to directories not entered, hidden entries included.
 */
async function censusOf(cwd: string, plan: DeptryPlan): Promise<ScanCensus> {
  const excluded = excludedPath(excludePatterns(plan));
  const files: string[] = [];
  const unreadable: string[] = [];
  const unsafeNames: string[] = [];
  const shown = (path: string): string => (path.startsWith('./') ? path.slice(2) : path);
  async function visit(shownPath: string, absolute: string, isRoot: boolean): Promise<void> {
    const name = shownPath.slice(shownPath.lastIndexOf('/') + 1);
    if (!isRoot && excluded(shown(shownPath))) return;
    if (/[\r\n]/u.test(name)) { unsafeNames.push(shown(shownPath)); return; }
    let entries;
    try { entries = await readdir(absolute, { withFileTypes: true }); } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOTDIR') return;
      unreadable.push(shown(shownPath)); return;
    }
    for (const entry of entries) {
      const child = `${shownPath}/${entry.name}`;
      if (entry.isDirectory()) { await visit(child, join(absolute, entry.name), false); continue; }
      if (excluded(shown(child))) continue;
      if (/[\r\n]/u.test(entry.name)) { unsafeNames.push(shown(child)); continue; }
      const symlinkToFile = entry.isSymbolicLink() && ((await stat(join(absolute, entry.name)).catch(() => undefined))?.isFile() ?? false);
      if (isScannedEntry(entry.name, { file: entry.isFile(), symlinkToFile }, plan.ignoreNotebooks === true)) files.push(shown(child));
    }
  }
  for (const root of scanRoots(plan)) await visit(root === '.' ? '.' : root, resolve(cwd, root), true);
  return { files, unreadable, unsafeNames };
}

const isRefusal = (value: string | DeptryRefusal): value is DeptryRefusal => typeof value !== 'string';

export function deptryCheck<R extends RuleRef>(
  settings: DeptryOptions,
  selected: ReadonlyMap<DeptryCode, Rule<R>>,
): Check<R> {
  const limit = settings.maxOutputBytes ?? 10 * 1024 * 1024;
  return {
    description: 'run deptry and fail on any finding of a selected rule',
    counting: counting.supported,
    async run(ctx) {
      const startedAt = new Date().toISOString();
      let temp: string | undefined;
      const decision = await (async (): Promise<DeptryDecision<R>> => {
        try {
          const root = await realpath(ctx.root);
          const cwd = await confine(root, root, settings.cwd ?? '.', 'working directory');
          if (isRefusal(cwd)) return cwd;
          const paths: string[] = [];
          for (const path of settings.paths ?? ['.']) {
            const confined = await confine(root, cwd, path, 'path');
            if (isRefusal(confined)) return confined;
            paths.push(confined);
          }
          const configFile = settings.configFile ? await confine(root, root, settings.configFile, 'configFile') : undefined;
          if (configFile !== undefined && isRefusal(configFile)) return configFile;
          temp = await mkdtemp(join(tmpdir(), 'redproof-deptry-'));
          const reportFile = join(temp, 'report.json');
          const command = settings.command ?? 'deptry';
          const timeoutMs = settings.timeoutMs ?? 60_000;
          const plan: DeptryPlan = {
              // Relative to the directory deptry runs in: its `exclude` patterns are matched from the start of the path, so an absolute one never matches.
              paths: paths.map(path => relative(cwd, path) || '.'), configFile, ignoreNotebooks: settings.ignoreNotebooks,
              exclude: settings.exclude, extendExclude: settings.extendExclude,
              allowPerRuleIgnores: settings.allowPerRuleIgnores, allowKnownFirstParty: settings.allowKnownFirstParty,
              allowPackageModuleNameMap: settings.allowPackageModuleNameMap, allowDependencyGroups: settings.allowDependencyGroups,
              allowRequirementsFiles: settings.allowRequirementsFiles, allowInlineIgnores: settings.allowInlineIgnores,
          };
          return await decideDeptry({
            plan,
            runner: {
              census: () => censusOf(cwd, plan),
              version: () => executeCommand({ command, args: ['--version'], cwd, label: 'deptry', timeoutMs, maxOutputBytes: limit }),
              scan: async (args): Promise<DeptryScan> => {
                const execution = await executeCommand({
                  command, args: [...args, '--json-output', reportFile], cwd, label: 'deptry', timeoutMs, maxOutputBytes: limit,
                });
                // A run that did not finish has no report worth reading, and a read error must not replace its own refusal.
                if (execution.kind !== 'completed') return { execution, report: null };
                const report = await readFile(reportFile, 'utf8').catch((error: NodeJS.ErrnoException) => {
                  if (error.code === 'ENOENT') return null;
                  throw error;
                });
                return { execution, report };
              },
            },
            selected,
            displayPath: file => displayPath(root, cwd, file),
          });
        } catch (error) {
          return unexpectedFailure(error);
        }
      })();
      let cleanupError: string | undefined;
      if (temp) {
        try { await rm(temp, { recursive: true, force: true }); }
        catch (error) { cleanupError = String(error); }
      }
      return checkResult(finalOutcome(decision, cleanupError), { startedAt, finishedAt: new Date().toISOString() });
    },
  };
}

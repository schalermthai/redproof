import { lstat, mkdtemp, readdir, realpath, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { Check, Rule, RuleRef } from 'redproof';
import { counting } from 'redproof';
import { executeCommand } from 'redproof/command';
import {
  checkResult, decideVulture, displayPath, finalOutcome, refusal, unexpectedFailure, withinRoot, type FileCensus, type VultureDecision, type VultureRefusal,
} from '../core/decision.ts';
import { excludeMatcher, isPythonSourceEntry, type VultureKind } from '../core/model.ts';
import type { VultureOptions } from '../core/options.ts';

/** The canonical path when it exists inside the Gate root; otherwise the reason to REFUSE. */
async function confine(root: string, base: string, path: string, what: string): Promise<string | VultureRefusal> {
  let actual: string;
  try {
    actual = await realpath(resolve(base, path));
  } catch (error) {
    const missing = (error as NodeJS.ErrnoException).code === 'ENOENT';
    return refusal(missing ? 'vulture-path-missing' : 'vulture-path-unreadable',
      `The ${what} ${missing ? 'does not exist' : 'could not be read'}: ${path}`, String(error));
  }
  return withinRoot(root, actual)
    ? actual
    : refusal('vulture-path-outside-root', `The ${what} resolves outside the Gate root: ${path}`, actual);
}

const isRefusal = (value: string | VultureRefusal): value is VultureRefusal => typeof value !== 'string';

/** The `.py` files below a directory, as `Path.rglob('*.py')` finds them: symlinked directories are not entered. */
async function pythonFiles(directory: string, unreadable: string[]): Promise<string[]> {
  const found: string[] = [];
  let entries;
  try { entries = await readdir(directory, { withFileTypes: true }); }
  catch { unreadable.push(directory); return found; } // `Path.rglob` skips it without a word: the check must not.
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) found.push(...await pythonFiles(path, unreadable));
    else if (isPythonSourceEntry(entry.name, {
      file: entry.isFile(),
      symlinkToFile: entry.isSymbolicLink() && ((await stat(path).catch(() => undefined))?.isFile() ?? false),
    })) found.push(path);
  }
  return found;
}

/** What vulture will read: every named file, and every `.py` file below a named directory, less `exclude`. */
async function censusOf(paths: readonly string[], exclude: readonly string[]): Promise<FileCensus> {
  const excluded = excludeMatcher(exclude, process.platform === 'win32');
  const unreadable: string[] = [];
  const unsafeNames: string[] = [];
  let count = 0;
  for (const path of paths) {
    const files = (await lstat(path).then(() => stat(path))).isDirectory() ? await pythonFiles(path, unreadable) : [path];
    for (const file of files.filter(candidate => !excluded(candidate))) {
      count += 1;
      if (/[\r\n]/u.test(file)) unsafeNames.push(file);
    }
  }
  return { count, unreadable, unsafeNames };
}

export function vultureCheck<R extends RuleRef>(
  settings: VultureOptions,
  selected: ReadonlyMap<VultureKind, Rule<R>>,
): Check<R> {
  const limit = settings.maxOutputBytes ?? 10 * 1024 * 1024;
  return {
    description: 'run vulture and fail on any finding of a selected rule',
    counting: counting.supported,
    async run(ctx) {
      const startedAt = new Date().toISOString();
      let temp: string | undefined;
      const decision = await (async (): Promise<VultureDecision<R>> => {
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
          let configFile: string;
          if (settings.configFile) {
            const confined = await confine(root, root, settings.configFile, 'configFile');
            if (isRefusal(confined)) return confined;
            configFile = confined;
          } else {
            // An empty configuration file: `--config` replaces the project's, so nothing in it can narrow the run.
            temp = await mkdtemp(join(tmpdir(), 'redproof-vulture-'));
            configFile = join(temp, 'empty.toml');
            await writeFile(configFile, '');
          }
          const command = settings.command ?? 'vulture';
          const timeoutMs = settings.timeoutMs ?? 60_000;
          // No Python warning may reach stderr: every stderr line is read as input vulture could not read.
          const env = { PYTHONWARNINGS: 'ignore' };
          return await decideVulture({
            plan: {
              paths, minConfidence: settings.minConfidence ?? 60, allowTestPathAncestors: settings.allowTestPathAncestors,
              exclude: settings.exclude, ignoreNames: settings.ignoreNames, ignoreDecorators: settings.ignoreDecorators,
            },
            runner: {
              version: () => executeCommand({ command, args: ['--version'], cwd, env, label: 'vulture', timeoutMs, maxOutputBytes: limit }),
              countFiles: () => censusOf(paths, settings.exclude ?? []),
              run: args => executeCommand({ command, args, cwd, env, label: 'vulture', timeoutMs, maxOutputBytes: limit }),
            },
            selected,
            displayPath: file => displayPath(root, cwd, file),
            configFile,
            root,
            windows: process.platform === 'win32',
            // A project configuration can exclude files the census cannot see, so the count is not claimed.
            countIsVerified: settings.configFile === undefined,
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

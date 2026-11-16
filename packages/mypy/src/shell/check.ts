import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import type { Check, Rule, RuleRef } from 'redproof';
import { counting } from 'redproof';
import { executeCommand } from 'redproof/command';
import {
  NEUTRALISED_ENVIRONMENT, checkResult, decideMypy, refusal, withinRoot, type ConfigChoice, type MypyDecision, type MypyRefusal, type Places,
} from '../core/decision.ts';
import type { Facts } from '../core/facts.ts';
import type { MypyOptions } from '../core/options.ts';

/** The canonical path when it exists inside the Gate root; otherwise the reason to REFUSE. */
async function confine(root: string, base: string, path: string, what: string): Promise<string | MypyRefusal> {
  let actual: string;
  try {
    actual = await realpath(resolve(base, path));
  } catch (error) {
    const missing = (error as NodeJS.ErrnoException).code === 'ENOENT';
    return refusal(missing ? 'mypy-path-missing' : 'mypy-path-unreadable',
      `The ${what} ${missing ? 'does not exist' : 'could not be read'}: ${path}`, String(error));
  }
  return withinRoot(root, actual)
    ? actual
    : refusal('mypy-path-outside-root', `The ${what} resolves outside the Gate root: ${path}`, actual);
}

const isRefusal = (value: string | MypyRefusal): value is MypyRefusal => typeof value !== 'string';

const settle = (path: string): Promise<string> => realpath(path).catch(() => path);

export function mypyCheck<R extends RuleRef>(
  settings: MypyOptions,
  selected: ReadonlyMap<string, Rule<R>>,
): Check<R> {
  const limit = settings.maxOutputBytes ?? 10 * 1024 * 1024;
  const environment = Object.fromEntries(NEUTRALISED_ENVIRONMENT.map(name => [name, undefined]));
  return {
    description: 'run mypy and fail on any error of a selected code',
    counting: counting.supported,
    async run(ctx) {
      const startedAt = new Date().toISOString();
      const decision = await (async (): Promise<MypyDecision<R>> => {
        let cacheDir: string | undefined;
        try {
          const root = await realpath(ctx.root);
          const cwd = await confine(root, root, settings.cwd ?? '.', 'working directory');
          if (isRefusal(cwd)) return cwd;
          const requested: string[] = [];
          for (const path of settings.paths ?? ['.']) {
            const confined = await confine(root, cwd, path, 'path');
            if (isRefusal(confined)) return confined;
            requested.push(confined);
          }
          let config: ConfigChoice = { kind: 'discover' };
          if (settings.isolated) config = { kind: 'none' };
          if (settings.configFile !== undefined) {
            const file = await confine(root, root, settings.configFile, 'configFile');
            if (isRefusal(file)) return file;
            config = { kind: 'file', path: file };
          }
          cacheDir = await mkdtemp(join(tmpdir(), 'redproof-mypy-cache-'));
          const resolvePlaces = async (facts: Facts): Promise<Places> => {
            const found = config.kind === 'file' ? config.path : facts.configFile === null ? undefined : await settle(resolve(cwd, facts.configFile));
            const paths = facts.changed.mypy_path;
            return {
              configFile: found,
              mypyPath: Array.isArray(paths) ? await Promise.all(paths.map(entry => settle(resolve(cwd, String(entry))))) : [],
            };
          };
          return await decideMypy({
            plan: {
              codes: [...selected.keys()],
              paths: requested.map(path => relative(cwd, path) || '.'),
              cacheDir,
              pythonVersion: settings.pythonVersion,
              platform: settings.platform,
            },
            config,
            allow: new Set(settings.allow ?? []),
            pinned: { pythonVersion: settings.pythonVersion !== undefined, platform: settings.platform !== undefined },
            root, cwd, requested, resolvePlaces,
            run: args => executeCommand({
              command: settings.python ?? 'python3', args, cwd, label: 'mypy', env: environment,
              timeoutMs: settings.timeoutMs ?? 300_000, maxOutputBytes: limit,
            }),
            selected,
          });
        } catch (error) {
          return refusal('mypy-unavailable', 'mypy could not complete the check.', String(error));
        } finally {
          if (cacheDir !== undefined) await rm(cacheDir, { recursive: true, force: true });
        }
      })();
      return checkResult(decision, { startedAt, finishedAt: new Date().toISOString() });
    },
  };
}

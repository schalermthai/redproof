import { mkdtemp, readFile, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { Check, Rule, RuleRef } from 'redproof';
import { counting } from 'redproof';
import { executeCommand } from 'redproof/command';
import {
  checkResult, decideDeptry, displayPath, refusal, withinRoot, type DeptryDecision, type DeptryRefusal, type DeptryScan,
} from '../core/decision.ts';
import type { DeptryCode } from '../core/model.ts';
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
          return await decideDeptry({
            plan: {
              paths, configFile, ignoreNotebooks: settings.ignoreNotebooks, allowPerRuleIgnores: settings.allowPerRuleIgnores,
            },
            runner: {
              version: () => executeCommand({ command, args: ['--version'], cwd, label: 'deptry', timeoutMs, maxOutputBytes: limit }),
              scan: async (args): Promise<DeptryScan> => {
                const execution = await executeCommand({
                  command, args: [...args, '--json-output', reportFile], cwd, label: 'deptry', timeoutMs, maxOutputBytes: limit,
                });
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
          return refusal('deptry-unavailable', 'deptry could not complete the check.', String(error));
        }
      })();
      if (temp) await rm(temp, { recursive: true, force: true }).catch(() => undefined);
      return checkResult(decision, { startedAt, finishedAt: new Date().toISOString() });
    },
  };
}

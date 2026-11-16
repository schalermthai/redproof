import { realpath } from 'node:fs/promises';
import { relative, resolve } from 'node:path';
import type { Check, Rule, RuleRef } from 'redproof';
import { counting } from 'redproof';
import { executeCommand } from 'redproof/command';
import {
  checkResult, decideRuff, displayPath, refusal, withinRoot, type RuffDecision, type RuffRefusal,
} from '../core/decision.ts';
import type { RuffOptions } from '../core/options.ts';

/** The canonical path when it exists inside the Gate root; otherwise the reason to REFUSE. */
async function confine(root: string, base: string, path: string, what: string): Promise<string | RuffRefusal> {
  let actual: string;
  try {
    actual = await realpath(resolve(base, path));
  } catch (error) {
    const missing = (error as NodeJS.ErrnoException).code === 'ENOENT';
    return refusal(missing ? 'ruff-path-missing' : 'ruff-path-unreadable',
      `The ${what} ${missing ? 'does not exist' : 'could not be read'}: ${path}`, String(error));
  }
  return withinRoot(root, actual)
    ? actual
    : refusal('ruff-path-outside-root', `The ${what} resolves outside the Gate root: ${path}`, actual);
}

const isRefusal = (value: string | RuffRefusal): value is RuffRefusal => typeof value !== 'string';

export function ruffCheck<R extends RuleRef>(
  settings: RuffOptions,
  selected: ReadonlyMap<string, Rule<R>>,
): Check<R> {
  const limit = settings.maxOutputBytes ?? 10 * 1024 * 1024;
  return {
    description: 'run Ruff and fail on any finding of a selected rule',
    counting: counting.supported,
    async run(ctx) {
      const startedAt = new Date().toISOString();
      const decision = await (async (): Promise<RuffDecision<R>> => {
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
          return await decideRuff({
            env: process.env,
            requested: paths,
            plan: {
              selectors: [...selected.keys()],
              paths: paths.map(path => relative(cwd, path) || '.'),
              configFile,
              isolated: settings.isolated,
              preview: settings.preview,
              ignoreNoqa: settings.ignoreNoqa,
            },
            run: args => executeCommand({
              command: settings.command ?? 'ruff', args, cwd, label: 'Ruff',
              timeoutMs: settings.timeoutMs ?? 60_000, maxOutputBytes: limit,
            }),
            selected,
            displayPath: filename => displayPath(root, filename),
          });
        } catch (error) {
          return refusal('ruff-unavailable', 'Ruff could not complete the check.', String(error));
        }
      })();
      return checkResult(decision, { startedAt, finishedAt: new Date().toISOString() });
    },
  };
}

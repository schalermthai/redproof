import { readFile, realpath, stat } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import type { Check, Rule, RuleRef } from 'redproof';
import { counting } from 'redproof';
import { executeCommand } from 'redproof/command';
import { checkResult, decideTach, refusal, withinRoot, type TachDecision } from '../core/decision.ts';
import { escapingRoots } from '../core/guards.ts';
import { ignoredPython, readFacts } from './ignored.ts';
import type { TachRuleKind } from '../core/model.ts';
import type { TachOptions } from '../core/options.ts';

export function tachCheck<R extends RuleRef>(
  settings: TachOptions,
  selected: ReadonlyMap<TachRuleKind, Rule<R>>,
): Check<R> {
  const limit = settings.maxOutputBytes ?? 10 * 1024 * 1024;
  return {
    description: 'run tach and fail on any finding of a selected kind',
    counting: counting.supported,
    async run(ctx) {
      const startedAt = new Date().toISOString();
      const decision = await (async (): Promise<TachDecision<R>> => {
        try {
          const root = await realpath(ctx.root);
          const cwd = await realpath(resolve(root, settings.cwd ?? '.'));
          if (!withinRoot(root, cwd)) {
            return refusal('tach-path-outside-root', 'The working directory resolves outside the Gate root.', cwd);
          }
          // tach walks up from the working directory to the nearest tach.toml, which could sit outside the
          // Gate root and judge someone else's project. Require the config right here.
          const config = await realpath(join(cwd, 'tach.toml')).catch(() => undefined);
          if (config === undefined || !(await stat(config)).isFile()) {
            return refusal('tach-config-missing', 'There is no tach.toml in the working directory.', cwd);
          }
          if (!withinRoot(root, config)) {
            return refusal('tach-path-outside-root', 'tach.toml resolves outside the Gate root.', config);
          }
          const facts = await readFacts(cwd, await readFile(config, 'utf8'));
          // A source root that is a symlink out of the Gate root escapes just as a `..` does.
          for (const sourceRoot of facts.sourceRoots) {
            if (escapingRoots([sourceRoot]).length) continue;
            const real = await realpath(resolve(cwd, sourceRoot)).catch(() => undefined);
            if (real !== undefined && !withinRoot(root, real)) return refusal('tach-path-outside-root', 'A source root resolves outside the Gate root.', real);
          }
          const needIgnored = !settings.allowIgnoredSources && facts.respectGitignore !== 'false';
          return await decideTach({
            facts,
            ignored: needIgnored ? await ignoredPython(cwd, limit) : [],
            options: settings,
            run: args => executeCommand({
              command: settings.command ?? 'tach', args, cwd, label: 'tach',
              timeoutMs: settings.timeoutMs ?? 60_000, maxOutputBytes: limit,
            }),
            selected,
            // tach prints paths relative to its project root, which is the working directory.
            displayPath: file => relative(root, join(cwd, file)),
          });
        } catch (error) {
          return refusal('tach-unavailable', 'tach could not complete the check.', String(error));
        }
      })();
      return checkResult(decision, { startedAt, finishedAt: new Date().toISOString() });
    },
  };
}

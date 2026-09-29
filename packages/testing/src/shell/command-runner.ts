import { realpath } from 'node:fs/promises';
import type { NoUnknownKeys } from 'redproof';
import { executeCommand, type CommandExecution } from 'redproof/command';
import {
  argsFor,
  describePlan,
  planFor,
  validateCommandRunnerOptions,
  type CommandRunnerOptions,
} from '../core/command-plan.ts';
import type { TestRunner, TestRunnerResult } from '../core/model.ts';
import { confineCanonicalTestingPath, resolveTestingPath } from '../core/paths.ts';

export function command<const O extends CommandRunnerOptions>(
  options: O & NoUnknownKeys<O, CommandRunnerOptions>,
): TestRunner {
  validateCommandRunnerOptions(options);
  const plan = planFor(options);

  return {
    description: options.description ?? describePlan(plan),
    plan,
    argsFor: ctx => argsFor(options.args, ctx),

    async run(ctx): Promise<TestRunnerResult> {
      const args = (() => {
        try {
          return argsFor(options.args, ctx);
        } catch (error) {
          return error instanceof Error ? error : new Error(String(error));
        }
      })();
      if (args instanceof Error) {
        return {
          kind: 'unavailable',
          message: `Could not prepare test command ${options.command}.`,
          detail: args.message,
        };
      }
      const cwd = resolveTestingPath(ctx.root, options.cwd ?? '.');
      if (cwd.kind === 'outside') {
        return {
          kind: 'unavailable',
          message: 'The test working directory resolves outside the Gate root.',
          detail: cwd.path,
        };
      }

      const canonicalRoot = await realpath(ctx.root).catch((error: Error) => error);
      const canonicalCwd = await realpath(cwd.path).catch((error: Error) => error);
      if (canonicalRoot instanceof Error || canonicalCwd instanceof Error) {
        return {
          kind: 'unavailable',
          message: 'The test working directory could not be resolved.',
          detail: canonicalRoot instanceof Error ? canonicalRoot.message : (canonicalCwd as Error).message,
        };
      }
      const confinedCwd = confineCanonicalTestingPath(canonicalRoot, canonicalCwd);
      if (confinedCwd.kind === 'outside') {
        return {
          kind: 'unavailable',
          message: 'The test working directory resolves outside the Gate root.',
          detail: confinedCwd.path,
        };
      }

      let execution: CommandExecution;
      try {
        execution = await executeCommand({
          command: options.command,
          args,
          label: `test command ${options.command}`,
          cwd: confinedCwd.path,
          env: {
            REDPROOF_TEST_REPORT: ctx.reportFile,
            ...options.env,
          },
          ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
          ...(options.maxOutputBytes === undefined ? {} : { maxOutputBytes: options.maxOutputBytes }),
        });
      } catch (error) {
        return {
          kind: 'unavailable',
          message: `Could not start test command ${options.command}.`,
          detail: error instanceof Error ? error.message : String(error),
        };
      }

      if (execution.kind === 'completed') return execution;
      return {
        kind: 'unavailable',
        message: execution.message,
        detail: [execution.code, execution.detail].filter(Boolean).join('\n\n'),
      };
    },
  };
}

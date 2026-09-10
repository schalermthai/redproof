import { realpath } from 'node:fs/promises';
import { basename } from 'node:path';
import { rejectUnknownKeys, type NoUnknownKeys } from 'redproof';
import { executeCommand, type CommandExecution } from 'redproof/command';
import type { CommandPlan, TestRunner, TestRunnerContext, TestRunnerResult } from './model.ts';
import { confineCanonicalTestingPath, resolveTestingPath } from './core/paths.ts';

export type CommandArgs = readonly string[] | ((ctx: TestRunnerContext) => readonly string[]);

export type CommandRunnerOptions = {
  readonly command: string;
  readonly args?: CommandArgs;
  /** Relative to the Gate root and confined inside it. Defaults to the root. */
  readonly cwd?: string;
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly description?: string;
  readonly timeoutMs?: number;
  /** Combined stdout and stderr capture limit. Defaults to 10 MiB. */
  readonly maxOutputBytes?: number;
};

function validatePositiveInteger(name: string, value: number | undefined): void {
  if (value !== undefined && (!Number.isSafeInteger(value) || value <= 0)) {
    throw new Error(`${name} must be a positive integer.`);
  }
}

function argsFor(args: CommandArgs | undefined, ctx: TestRunnerContext): readonly string[] {
  if (!args) return [];
  return typeof args === 'function' ? args(ctx) : args;
}

function planFor(options: CommandRunnerOptions): CommandPlan {
  return typeof options.args === 'function' || options.args === undefined
    ? { command: options.command }
    : { command: options.command, args: options.args };
}

/** The command line, with no machine-specific directory in front of it. */
function describePlan(plan: CommandPlan): string {
  const name = basename(plan.command);
  return plan.args?.length ? `run ${name} ${plan.args.join(' ')}` : `run ${name}`;
}

export function command<const O extends CommandRunnerOptions>(
  options: O & NoUnknownKeys<O, CommandRunnerOptions>,
): TestRunner {
  rejectUnknownKeys(
    options,
    ['command', 'args', 'cwd', 'env', 'description', 'timeoutMs', 'maxOutputBytes'],
    'testing command runner',
  );
  if (!options.command.trim()) throw new Error('command must not be empty.');
  validatePositiveInteger('timeoutMs', options.timeoutMs);
  validatePositiveInteger('maxOutputBytes', options.maxOutputBytes);
  const plan = planFor(options);

  return {
    description: options.description ?? describePlan(plan),
    plan,
    argsFor: ctx => argsFor(options.args, ctx),

    async run(ctx): Promise<TestRunnerResult> {
      const computedArgs = (() => {
        try {
          return argsFor(options.args, ctx);
        } catch (error) {
          return error instanceof Error ? error : new Error(String(error));
        }
      })();
      if (computedArgs instanceof Error) {
        return {
          kind: 'unavailable',
          message: `Could not prepare test command ${options.command}.`,
          detail: computedArgs.message,
        };
      }
      const args = computedArgs;
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
        const detail = canonicalRoot instanceof Error
          ? canonicalRoot.message
          : canonicalCwd instanceof Error
            ? canonicalCwd.message
            : 'Unknown working-directory error.';
        return {
          kind: 'unavailable',
          message: 'The test working directory could not be resolved.',
          detail,
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

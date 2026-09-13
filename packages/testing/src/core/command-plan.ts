import { basename } from 'node:path';
import { rejectUnknownKeys } from 'redproof';
import type { CommandPlan, TestRunnerContext } from './model.ts';

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

export function validateCommandRunnerOptions(options: CommandRunnerOptions): void {
  rejectUnknownKeys(
    options,
    ['command', 'args', 'cwd', 'env', 'description', 'timeoutMs', 'maxOutputBytes'],
    'testing command runner',
  );
  if (!options.command.trim()) throw new Error('command must not be empty.');
  validatePositiveInteger('timeoutMs', options.timeoutMs);
  validatePositiveInteger('maxOutputBytes', options.maxOutputBytes);
}

export function argsFor(args: CommandArgs | undefined, ctx: TestRunnerContext): readonly string[] {
  if (!args) return [];
  return typeof args === 'function' ? args(ctx) : args;
}

export function planFor(options: CommandRunnerOptions): CommandPlan {
  return typeof options.args === 'function' || options.args === undefined
    ? { command: options.command }
    : { command: options.command, args: options.args };
}

/** The command line, with no machine-specific directory in front of it. */
export function describePlan(plan: CommandPlan): string {
  const name = basename(plan.command);
  return plan.args?.length ? `run ${name} ${plan.args.join(' ')}` : `run ${name}`;
}

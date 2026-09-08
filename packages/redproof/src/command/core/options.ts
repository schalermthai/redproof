import { basename, isAbsolute } from 'node:path';
import type { Rule, RuleRef } from '../../domain/index.ts';
import type { CommandExitCodes } from './exit-codes.ts';

export const DEFAULT_MAX_OUTPUT_BYTES = 10 * 1024 * 1024;
export const DEFAULT_MAX_AT_ONCE = 4;

export type CommandExecutionOptions = {
  readonly command: string;
  readonly args?: readonly string[];
  readonly label?: string;
  /** Absolute working directory already chosen and confined by the caller. */
  readonly cwd: string;
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly timeoutMs?: number;
  /** Combined stdout and stderr capture limit. Defaults to 10 MiB. */
  readonly maxOutputBytes?: number;
};

export type CommandCheckOptions<R extends RuleRef> = Omit<CommandExecutionOptions, 'cwd'> & {
  readonly rule: Rule<R>;
  readonly description?: string;
  /** Relative to the Gate root and confined inside it. Defaults to the root. */
  readonly cwd?: string;
  readonly exitCodes?: CommandExitCodes;
};

export type CommandGroupExecution =
  | {
      readonly mode?: 'sequential';
      readonly maxAtOnce?: never;
    }
  | {
      readonly mode: 'parallel';
      /** Maximum number of child processes running together. Defaults to 4. */
      readonly maxAtOnce?: number;
    };

export type CommandGroupOptions<R extends RuleRef> = {
  readonly entries: readonly [CommandCheckOptions<R>, ...CommandCheckOptions<R>[]];
  readonly label?: string;
  readonly description?: string;
} & CommandGroupExecution;

function validatePositiveInteger(name: string, value: number | undefined): void {
  if (value !== undefined && (!Number.isSafeInteger(value) || value <= 0)) {
    throw new Error(`${name} must be a positive integer.`);
  }
}

function validateProcessOptions(options: Omit<CommandExecutionOptions, 'cwd'>): void {
  if (!options.command.trim()) throw new Error('command must not be empty.');
  validatePositiveInteger('timeoutMs', options.timeoutMs);
  validatePositiveInteger('maxOutputBytes', options.maxOutputBytes);
}

export function validateCommandExecutionOptions(options: CommandExecutionOptions): void {
  validateProcessOptions(options);
  if (!isAbsolute(options.cwd)) throw new Error('executeCommand cwd must be absolute.');
}

export function validateCommandOptions(options: CommandCheckOptions<RuleRef>): void {
  validateProcessOptions(options);
}

export function validateGroupOptions(options: CommandGroupOptions<RuleRef>): void {
  if (options.entries.length === 0) throw new Error('commands requires at least one entry.');
  if (options.mode !== 'parallel' && options.maxAtOnce !== undefined) {
    throw new Error('maxAtOnce is only available in parallel mode.');
  }
  if (options.mode === 'parallel') validatePositiveInteger('maxAtOnce', options.maxAtOnce);
}

export function labelOf(options: CommandCheckOptions<RuleRef>): string {
  return options.label ?? options.command;
}

export function commandDescription(options: CommandCheckOptions<RuleRef>): string {
  const invocation = [basename(options.command), ...(options.args ?? [])].join(' ');
  return options.description ?? `run ${invocation}`;
}

export function groupDescription(options: CommandGroupOptions<RuleRef>): string {
  return options.description
    ?? `run ${options.entries.length} commands: `
      + options.entries.map(entry => entry.label ?? basename(entry.command)).join(', ');
}

export function groupSource(options: CommandGroupOptions<RuleRef>): string {
  return options.label ?? options.entries.map(labelOf).join(', ');
}

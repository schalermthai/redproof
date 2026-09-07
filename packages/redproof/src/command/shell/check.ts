import { resolve } from 'node:path';
import { counting } from '../../composition/index.ts';
import type { Check, CheckResult, RuleRef } from '../../domain/index.ts';
import { mapLimit } from '../../support/index.ts';
import { exitPolicy } from '../core/exit-codes.ts';
import {
  commandDescription,
  DEFAULT_MAX_AT_ONCE,
  DEFAULT_MAX_OUTPUT_BYTES,
  groupDescription,
  groupSource,
  labelOf,
  validateCommandOptions,
  validateGroupOptions,
  type CommandCheckOptions,
  type CommandGroupOptions,
} from '../core/options.ts';
import {
  aggregateResults,
  commandResult,
  commandScan,
  cwdOutsideRoot,
  isInsideRoot,
} from '../core/outcome.ts';
import { executeCommand } from './spawn.ts';

const now = (): string => new Date().toISOString();

/** Create a Check that maps one executable invocation to PASS, a targeted Breach, or REFUSE. */
export function command<const R extends RuleRef>(options: CommandCheckOptions<R>): Check<R> {
  validateCommandOptions(options);

  const policy = exitPolicy(options.exitCodes);
  const label = labelOf(options);
  const maxOutputBytes = options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES;

  return {
    description: commandDescription(options),
    counting: counting.supported,

    async run(ctx): Promise<CheckResult<R>> {
      const startedAt = now();
      const root = resolve(ctx.root);
      const cwd = resolve(root, options.cwd ?? '.');
      if (!isInsideRoot(root, cwd)) {
        return cwdOutsideRoot(commandScan(label, startedAt, now(), 1), label, cwd);
      }

      const execution = await executeCommand(options, cwd, maxOutputBytes);
      return commandResult(options.rule, label, policy, execution, commandScan(label, startedAt, now(), 1));
    },
  };
}

/** Create one Check from multiple commands with deterministic sequential or bounded-parallel aggregation. */
export function commands<const R extends RuleRef>(options: CommandGroupOptions<R>): Check<R> {
  validateGroupOptions(options);

  const checks = options.entries.map(entry => command(entry));
  const source = groupSource(options);

  return {
    description: groupDescription(options),
    counting: counting.supported,

    async run(ctx): Promise<CheckResult<R>> {
      const startedAt = now();

      if (options.mode === 'parallel') {
        const outcomes = await mapLimit(checks, options.maxAtOnce ?? DEFAULT_MAX_AT_ONCE, check => check.run(ctx));
        return aggregateResults(outcomes, commandScan(source, startedAt, now(), outcomes.length));
      }

      const outcomes: CheckResult<R>[] = [];
      for (const check of checks) {
        const outcome = await check.run(ctx);
        outcomes.push(outcome);
        if (outcome.verdict === 'refuse') break;
      }
      return aggregateResults(outcomes, commandScan(source, startedAt, now(), outcomes.length));
    },
  };
}

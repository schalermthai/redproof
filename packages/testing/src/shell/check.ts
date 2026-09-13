import { mkdtemp, readFile, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { counting, type Check, type RuleRef } from 'redproof';
import {
  decideCheck,
  finalTestingOutcome,
  refuseTestRunnerUnavailable,
  type CheckEvidence,
  type SelectedTestRules,
} from '../core/check.ts';
import type { TestReportFormat, TestRunner } from '../core/model.ts';

function now(): string {
  return new Date().toISOString();
}

function errorOf(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

async function gatherEvidence(runner: TestRunner, root: string, reportFile: string): Promise<CheckEvidence> {
  const execution = await runner.run({ root, reportFile }).catch(
    (error: unknown) => ({
      kind: 'unavailable' as const,
      message: 'The test runner could not complete the check.',
      detail: error instanceof Error ? error.message : String(error),
    }),
  );
  if (execution.kind === 'unavailable') return execution;
  return {
    kind: 'completed',
    execution,
    root: await realpath(root).catch(() => root),
    report: await readFile(reportFile, 'utf8').catch(errorOf),
  };
}

/** Run the tests into a private report directory and decide the verdict from what they wrote. */
export function testingCheck<R extends RuleRef>(
  runner: TestRunner,
  format: TestReportFormat,
  rules: SelectedTestRules<R>,
): Check<R> {
  return {
    description: `${runner.description}; interpret ${format.kind} test results`,
    counting: counting.supported,

    async run(ctx) {
      const startedAt = now();
      const times = () => ({ startedAt, finishedAt: now() });

      const created = await mkdtemp(join(tmpdir(), 'redproof-testing-')).catch(errorOf);
      if (created instanceof Error) {
        return refuseTestRunnerUnavailable(
          format,
          times(),
          'The testing Adapter could not prepare its report directory.',
          created,
        );
      }
      const reportFile = join(created, `report${format.extension}`);

      const outcome = await gatherEvidence(runner, ctx.root, reportFile)
        .then(evidence => decideCheck({ times: times(), evidence, format, rules }))
        .catch((error: unknown) => refuseTestRunnerUnavailable(
          format,
          times(),
          'The testing Adapter could not complete the check.',
          error,
        ));

      const cleanup = await rm(created, { recursive: true, force: true })
        .then(() => undefined)
        .catch(errorOf);
      return finalTestingOutcome(outcome, cleanup, format, times());
    },
  };
}

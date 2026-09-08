import { randomUUID } from 'node:crypto';
import { copyFile, lstat, realpath, rename, rm } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import type { TestRunner, TestRunnerCompleted, TestRunnerResult } from '../model.ts';
import {
  confineCanonicalTestingPath,
  resolveTestingPath,
  validateRelativeTestingPath,
} from '../core/paths.ts';

export type ConfiguredVitestReportOptions = {
  readonly cwd: string;
  readonly reportFile: string;
};

function unavailable(message: string, detail: string): TestRunnerResult {
  return { kind: 'unavailable', message, detail };
}

function detailOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Remove the fresh report and put the previous one back. Null when both succeed. */
async function restoreReport(reportFile: string, backup: string | null): Promise<TestRunnerResult | null> {
  const removed = await rm(reportFile, { force: true }).catch((error: Error) => error);
  const restored = backup === null
    ? null
    : await rename(backup, reportFile).catch((error: Error) => error);
  if (restored instanceof Error) {
    return unavailable(
      `The previous Vitest report could not be restored from ${backup}.`,
      restored.message,
    );
  }
  if (removed instanceof Error) {
    return unavailable('The fresh Vitest report could not be removed after the run.', removed.message);
  }
  return null;
}

async function copyReport(
  execution: TestRunnerCompleted,
  source: string,
  target: string,
): Promise<TestRunnerResult> {
  try {
    await copyFile(source, target);
    return execution;
  } catch (error) {
    return unavailable('Vitest did not produce its configured JSON report.', detailOf(error));
  }
}

/** Consume a config-owned Vitest JSON report without leaving or trusting a stale artifact. */
export function configuredVitestReport(
  runner: TestRunner,
  options: ConfiguredVitestReportOptions,
): TestRunner {
  validateRelativeTestingPath('reportFile', options.reportFile);

  return {
    ...runner,

    async run(ctx) {
      const relativeReport = join(options.cwd, options.reportFile);
      const lexicalReport = resolveTestingPath(ctx.root, relativeReport);
      if (lexicalReport.kind === 'outside') {
        return unavailable(
          'The configured Vitest report resolves outside the Gate root.',
          lexicalReport.path,
        );
      }

      const canonicalRoot = await realpath(ctx.root).catch((error: Error) => error);
      const canonicalParent = await realpath(dirname(lexicalReport.path)).catch((error: Error) => error);
      if (canonicalRoot instanceof Error || canonicalParent instanceof Error) {
        const detail = canonicalRoot instanceof Error
          ? canonicalRoot.message
          : canonicalParent instanceof Error
            ? canonicalParent.message
            : 'Unknown report-directory error.';
        return unavailable('The configured Vitest report directory could not be resolved.', detail);
      }
      const confinedParent = confineCanonicalTestingPath(canonicalRoot, canonicalParent);
      if (confinedParent.kind === 'outside') {
        return unavailable(
          'The configured Vitest report resolves outside the Gate root.',
          lexicalReport.path,
        );
      }

      const reportFile = join(confinedParent.path, basename(lexicalReport.path));
      const existing = await lstat(reportFile).catch((error: NodeJS.ErrnoException) => error);
      if (existing instanceof Error && existing.code !== 'ENOENT') {
        return unavailable('The configured Vitest report could not be inspected.', existing.message);
      }
      if (!(existing instanceof Error) && existing.isDirectory()) {
        return unavailable('The configured Vitest report is a directory.', reportFile);
      }

      const backup = existing instanceof Error
        ? null
        : `${reportFile}.redproof-backup-${randomUUID()}`;
      if (backup !== null) {
        const setAside = await rename(reportFile, backup).catch((error: Error) => error);
        if (setAside instanceof Error) {
          return unavailable('The previous Vitest report could not be set aside.', setAside.message);
        }
      }

      let outcome: TestRunnerResult;
      try {
        const execution = await runner.run(ctx);
        outcome = execution.kind === 'unavailable'
          ? execution
          : await copyReport(execution, reportFile, ctx.reportFile);
      } catch (error) {
        outcome = unavailable('The test command failed before Vitest reported.', detailOf(error));
      }

      return await restoreReport(reportFile, backup) ?? outcome;
    },
  };
}

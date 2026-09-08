import { randomUUID } from 'node:crypto';
import { copyFile, lstat, realpath, rename, rm } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import type { TestRunner, TestRunnerCompleted, TestRunnerResult } from '../model.ts';
import { confineCanonicalTestingPath, resolveTestingPath } from '../core/paths.ts';

export type ConfiguredVitestReportOptions = {
  readonly cwd: string;
  readonly reportFile: string;
};

function unavailable(message: string, detail: string): TestRunnerResult {
  return { kind: 'unavailable', message, detail };
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
    return unavailable(
      'Vitest did not produce its configured JSON report.',
      error instanceof Error ? error.message : String(error),
    );
  }
}

/** Consume a config-owned Vitest JSON report without leaving or trusting a stale artifact. */
export function configuredVitestReport(
  runner: TestRunner,
  options: ConfiguredVitestReportOptions,
): TestRunner {
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

      const backup = `${reportFile}.redproof-backup-${randomUUID()}`;
      const hadExisting = !(existing instanceof Error);
      if (hadExisting) await rename(reportFile, backup);

      try {
        const execution = await runner.run(ctx);
        if (execution.kind === 'unavailable') return execution;
        return await copyReport(execution, reportFile, ctx.reportFile);
      } finally {
        await rm(reportFile, { force: true });
        if (hadExisting) await rename(backup, reportFile);
      }
    },
  };
}

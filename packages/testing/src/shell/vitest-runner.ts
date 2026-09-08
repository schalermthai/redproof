import { randomUUID } from 'node:crypto';
import { copyFile, lstat, realpath, rename, rm, rmdir } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import type {
  TestRunner,
  TestRunnerCompleted,
  TestRunnerResult,
  TestRunnerUnavailable,
} from '../model.ts';
import {
  confineCanonicalTestingPath,
  resolveTestingPath,
  validateRelativeTestingPath,
} from '../core/paths.ts';

export type ConfiguredVitestReportOptions = {
  readonly cwd: string;
  readonly reportFile: string;
};

function unavailable(message: string, detail: string): TestRunnerUnavailable {
  return { kind: 'unavailable', message, detail };
}

function detailOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

type PreparedReportPath = {
  readonly kind: 'prepared';
  readonly reportFile: string;
  /** Canonical directories that did not exist before the run, shallowest first. */
  readonly missingDirectories: readonly string[];
};

function isMissing(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && (error as NodeJS.ErrnoException).code === 'ENOENT';
}

/** Resolve through the nearest existing ancestor without creating tool-owned directories. */
async function prepareReportPath(
  canonicalRoot: string,
  lexicalReport: string,
): Promise<PreparedReportPath | TestRunnerUnavailable> {
  let existingParent = dirname(lexicalReport);
  const missingNames: string[] = [];

  for (;;) {
    const existing = await lstat(existingParent).catch((error: Error) => error);
    if (!(existing instanceof Error)) break;
    if (!isMissing(existing)) {
      return unavailable('The configured Vitest report directory could not be inspected.', existing.message);
    }

    const parent = dirname(existingParent);
    if (parent === existingParent) {
      return unavailable('The configured Vitest report directory could not be resolved.', existing.message);
    }
    missingNames.unshift(basename(existingParent));
    existingParent = parent;
  }

  const canonicalParent = await realpath(existingParent).catch((error: Error) => error);
  if (canonicalParent instanceof Error) {
    return unavailable('The configured Vitest report directory could not be resolved.', canonicalParent.message);
  }
  const confinedParent = confineCanonicalTestingPath(canonicalRoot, canonicalParent);
  if (confinedParent.kind === 'outside') {
    return unavailable('The configured Vitest report resolves outside the Gate root.', lexicalReport);
  }

  let reportParent = confinedParent.path;
  const missingDirectories = missingNames.map(name => {
    reportParent = join(reportParent, name);
    return reportParent;
  });
  return {
    kind: 'prepared',
    reportFile: join(reportParent, basename(lexicalReport)),
    missingDirectories,
  };
}

async function removeEmptyDirectories(
  directories: readonly string[],
): Promise<TestRunnerResult | null> {
  for (const directory of [...directories].reverse()) {
    const removed = await rmdir(directory).catch((error: NodeJS.ErrnoException) => error);
    if (!(removed instanceof Error) || removed.code === 'ENOENT') continue;
    if (removed.code === 'ENOTEMPTY' || removed.code === 'EEXIST') break;
    return unavailable('A generated Vitest report directory could not be removed.', removed.message);
  }
  return null;
}

/** Remove the fresh report and put the previous one back. Null when both succeed. */
async function restoreReport(
  reportFile: string,
  backup: string | null,
  missingDirectories: readonly string[],
): Promise<TestRunnerResult | null> {
  const removed = await rm(reportFile, { force: true }).catch((error: Error) => error);
  const restored = backup === null
    ? null
    : await rename(backup, reportFile).catch((error: Error) => error);
  const directoriesRemoved = await removeEmptyDirectories(missingDirectories);
  if (restored instanceof Error) {
    return unavailable(
      `The previous Vitest report could not be restored from ${backup}.`,
      restored.message,
    );
  }
  if (removed instanceof Error) {
    return unavailable('The fresh Vitest report could not be removed after the run.', removed.message);
  }
  return directoriesRemoved;
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
      if (canonicalRoot instanceof Error) {
        return unavailable('The configured Vitest report directory could not be resolved.', canonicalRoot.message);
      }
      const prepared = await prepareReportPath(canonicalRoot, lexicalReport.path);
      if (prepared.kind === 'unavailable') return prepared;

      const { reportFile, missingDirectories } = prepared;
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

      return await restoreReport(reportFile, backup, missingDirectories) ?? outcome;
    },
  };
}

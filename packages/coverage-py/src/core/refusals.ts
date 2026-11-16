import type { Scan } from 'redproof';
import type { CommandExecution } from 'redproof/command';

export type Refusal = { readonly kind: 'refused'; readonly code: string; readonly message: string; readonly detail?: string };
export type ReportStat = { readonly file: boolean; readonly symlink: boolean; readonly size: number };

export function unavailable(detail: string): Refusal {
  return { kind: 'refused', code: 'coverage-py-evidence-unavailable', message: 'Could not collect trustworthy coverage.py evidence.', detail };
}
export function cleanupUnavailable(detail: string): Refusal {
  return { kind: 'refused', code: 'coverage-py-cleanup-unavailable', message: 'Could not clean up private coverage artifacts.', detail };
}
export function scan(startedAt: string, finishedAt: string, inspected: number | null): Scan {
  return { source: 'coverage-py', startedAt, finishedAt, inspected };
}
/** Test failures exit non-zero but still leave data behind; that data cannot explain the failure. */
export function producerOutcome(step: string, execution: CommandExecution): Refusal | null {
  if (execution.kind === 'refused') return { kind: 'refused', code: execution.code, message: execution.message, ...(execution.detail ? { detail: execution.detail } : {}) };
  if (execution.exitCode !== 0) return { kind: 'refused', code: 'coverage-py-producer-unsuccessful', message: `coverage ${step} did not complete successfully.`,
    detail: `exit code: ${execution.exitCode}\n${execution.stderr}\n${execution.stdout}` };
  return null;
}
export function reportIdentity(stat: ReportStat, max: number): Refusal | null {
  if (!stat.file || stat.symlink || stat.size > max) return unavailable('Coverage report must be a private bounded regular file.');
  return null;
}

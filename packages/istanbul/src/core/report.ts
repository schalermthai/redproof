import type { Scan } from 'redproof';
import type { CommandExecution } from 'redproof/command';
import type { CoverageEvidence } from './model.ts';

export type Refusal = { readonly kind: 'refused'; readonly code: string; readonly message: string; readonly detail?: string };
export type PlannedCommand = { readonly kind: 'planned'; readonly command: string; readonly args: readonly string[] };
export type ReportStat = { readonly file: boolean; readonly symlink: boolean; readonly nlink: number; readonly size: number; readonly ino: number; readonly dev: number };
export type NycInputs = {
  readonly script: string;
  readonly cwd: string;
  readonly config: string | undefined;
  readonly include: readonly string[];
  readonly exclude: readonly string[];
  readonly reportDirectory: string;
  readonly tempDirectory: string;
  readonly all: boolean;
  readonly command: string;
  readonly args: readonly string[];
};

export function unavailable(detail: string): Refusal {
  return { kind: 'refused', code: 'istanbul-evidence-unavailable', message: 'Could not collect trustworthy Istanbul coverage.', detail };
}
export function scan(startedAt: string, finishedAt: string, inspected: number | null): Scan {
  return { source: 'istanbul', startedAt, finishedAt, inspected };
}
export function plannedArguments(planned: PlannedCommand): Refusal | null {
  if (!Array.isArray(planned.args) || planned.args.some(arg => typeof arg !== 'string' || arg.includes('\0'))) return unavailable('Invalid coverage command arguments.');
  return null;
}
export function producerOutcome(execution: CommandExecution): Refusal | null {
  if (execution.kind === 'refused') return { kind: 'refused', code: execution.code, message: execution.message, ...(execution.detail ? { detail: execution.detail } : {}) };
  // Coverage can be emitted even when tests or instrumentation fail. It cannot explain that failure.
  if (execution.exitCode !== 0) return { kind: 'refused', code: 'istanbul-producer-unsuccessful', message: 'Coverage producer did not complete successfully.',
    detail: `exit code: ${execution.exitCode}\n${execution.stderr}\n${execution.stdout}` };
  return null;
}
export function reportIdentity(stat: ReportStat, opened: ReportStat | undefined, max: number): Refusal | null {
  if (!stat.file || stat.symlink || stat.nlink !== 1 || stat.size > max) return unavailable('Coverage report must be a private bounded regular file.');
  if (opened && (!opened.file || opened.ino !== stat.ino || opened.dev !== stat.dev || opened.nlink !== 1)) return unavailable('Coverage report identity changed.');
  return null;
}
export function missingInventory(required: readonly string[], evidence: CoverageEvidence): Refusal | null {
  const reported = new Set(evidence.files.map(file => file.file));
  const missing = required.filter(file => !reported.has(file));
  if (missing.length) return { kind: 'refused', code: 'istanbul-incomplete-inventory', message: 'Expected source files are absent from coverage.', detail: missing.join('\n') };
  return null;
}
export function supportedNycVersion(manifest: string): Refusal | null {
  const { version } = JSON.parse(manifest) as { version: string };
  if (!/^(15|16|17|18)\.\d+\.\d+$/u.test(version)) return unavailable(`Unsupported nyc version ${version}; expected >=15 <19.`);
  return null;
}
export function nycArgs(inputs: NycInputs): readonly string[] {
  return [inputs.script,
    `--cwd=${inputs.cwd}`, ...(inputs.config ? [`--nycrc-path=${inputs.config}`] : []),
    ...inputs.include.map(pattern => `--include=${pattern}`), ...inputs.exclude.map(pattern => `--exclude=${pattern}`),
    '--reporter=json', `--report-dir=${inputs.reportDirectory}`, `--temp-dir=${inputs.tempDirectory}`,
    '--clean=true', '--cache=false', '--check-coverage=false', `--all=${inputs.all}`,
    '--', inputs.command, ...inputs.args];
}

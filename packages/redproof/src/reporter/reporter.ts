import type { CheckProjectRun, ProveProjectRun } from '../runtime/shell/project-runner.ts';
import { formatCompactRun } from './compact.ts';
import { formatJsonProofs, formatJsonRun } from './json.ts';
import { formatSarifRun } from './sarif.ts';
import { formatProof, formatRun, type ReportOptions } from './terminal.ts';

export type CheckReporterName = 'default' | 'compact' | 'json' | 'sarif';
export type ProveReporterName = 'default' | 'json';
export type ReporterName = CheckReporterName;

export type ReporterSpec = {
  readonly name: ReporterName;
  readonly outputFile?: string;
};

export async function renderCheckReporter(
  name: CheckReporterName,
  run: CheckProjectRun,
  options: ReportOptions = {},
): Promise<string> {
  switch (name) {
    case 'default': return formatRun(run, options);
    case 'compact': return formatCompactRun(run);
    case 'json': return formatJsonRun(run);
    case 'sarif': return formatSarifRun(run);
  }
}

export function renderProveReporter(name: ProveReporterName, run: ProveProjectRun): string {
  if (name === 'json') return formatJsonProofs(run);
  return run.outcomes.map(formatProof).join('\n');
}

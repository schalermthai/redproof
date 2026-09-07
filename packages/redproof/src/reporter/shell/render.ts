import type { CheckProjectRun, ProveProjectRun } from '../../run/index.ts';
import type { CheckReporterName, ProveReporterName } from '../core/arguments.ts';
import { formatCompactRun } from '../core/compact.ts';
import { formatJsonProofs, formatJsonRun } from '../core/json.ts';
import { formatSarifRun } from '../core/sarif.ts';
import { formatProof, type ReportOptions } from '../core/terminal.ts';
import { formatRun } from './terminal.ts';

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

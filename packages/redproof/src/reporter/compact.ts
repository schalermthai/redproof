import type { Diagnostic } from '../domain/diagnostic.ts';
import type { CheckProjectRun } from '../run/shell/project-runner.ts';
import { buildGateReportModel } from './model.ts';

function locationPrefix(diagnostic: Diagnostic): string | null {
  const location = diagnostic.location;
  if (!location) return null;
  if (location.line == null) return `${location.file}:`;
  if (location.column == null) return `${location.file}:${location.line}:`;
  return `${location.file}:${location.line}:${location.column}:`;
}

function diagnosticLine(code: string, diagnostic: Diagnostic): string {
  const prefix = locationPrefix(diagnostic);
  const body = `error redproof[${code}]: ${diagnostic.message}`;
  return prefix ? `${prefix} ${body}` : `redproof: ${body}`;
}

/** Line-oriented output intended for editor problem matchers and simple tooling. */
export function formatCompactRun(run: CheckProjectRun): string {
  const lines: string[] = [];

  for (const item of run.results) {
    if (item.result.verdict === 'fail') {
      const model = buildGateReportModel(item.module.gate.adapter, item.result);
      for (const rule of model.rules) {
        if (rule.state.kind !== 'breached') continue;
        for (const breach of rule.breaches) {
          lines.push(diagnosticLine(breach.rule, breach));
        }
      }
      continue;
    }

    if (item.result.verdict === 'refuse') {
      lines.push(diagnosticLine(`REFUSE:${item.module.gate.id}`, item.result.why));
    }
  }

  return lines.join('\n');
}

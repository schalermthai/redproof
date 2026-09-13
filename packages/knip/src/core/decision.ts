import { isAbsolute, relative, sep } from 'node:path';
import { result, type Breach, type CheckResult, type Rule, type RuleRef, type Scan } from 'redproof';
import type { CommandExecution } from 'redproof/command';
import { knipBreaches, parseKnipEvidence, type KnipEvidence, type KnipIssueType } from './model.ts';
import type { KnipOptions } from './options.ts';

type KnipRefusal = {
  readonly kind: 'refuse';
  readonly code: string;
  readonly message: string;
  readonly detail?: string;
};

export type KnipDecision<R extends RuleRef> =
  | KnipRefusal
  | { readonly kind: 'evidence'; readonly inspected: number; readonly breaches: readonly Breach<R>[] };

export type KnipReport =
  | { readonly kind: 'text'; readonly text: string }
  | { readonly kind: 'unavailable'; readonly error: string };

type KnipPaths = {
  readonly cli: string;
  readonly reporter: string;
  readonly configFile?: string | undefined;
};

type Timestamps = { readonly startedAt: string; readonly finishedAt: string };

export function refusal(code: string, message: string, detail?: string): KnipRefusal {
  return { kind: 'refuse', code, message, ...(detail ? { detail } : {}) };
}

/** Both paths must be absolute and canonical. */
export function withinRoot(root: string, actual: string): boolean {
  const rel = relative(root, actual);
  return !isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${sep}`);
}

export function knipArguments(settings: KnipOptions, paths: KnipPaths): readonly string[] {
  const args = [paths.cli, '--reporter', paths.reporter, '--no-progress'];
  if (paths.configFile) args.push('--config', paths.configFile);
  if (settings.workspace) args.push(`--workspace=${settings.workspace}`);
  for (const [name, flag] of [
    ['production', '--production'], ['strict', '--strict'],
    ['includeEntryExports', '--include-entry-exports'],
    ['treatConfigHintsAsErrors', '--treat-config-hints-as-errors'],
  ] as const) if (settings[name]) args.push(flag);
  return args;
}

export function evaluateExecution<R extends RuleRef>(
  execution: CommandExecution,
  report: KnipReport,
  selected: ReadonlyMap<KnipIssueType, Rule<R>>,
): KnipDecision<R> {
  if (execution.kind === 'refused') return refusal(execution.code, execution.message, execution.detail);
  const detail = [execution.stdout, execution.stderr].filter(Boolean).join('\n');
  if (execution.exitCode !== 0 && execution.exitCode !== 1) {
    return refusal('knip-unsuccessful', `Knip exited with code ${execution.exitCode}.`, detail);
  }
  const unavailable = (cause: string) => refusal('knip-report-unavailable',
    'Knip did not produce trustworthy evidence.', [cause, detail].filter(Boolean).join('\n'));
  if (report.kind === 'unavailable') return unavailable(report.error);
  let evidence: KnipEvidence;
  try {
    evidence = parseKnipEvidence(report.text);
  } catch (error) {
    return unavailable(String(error));
  }
  if (evidence.hasConfigLoadErrors) return refusal('knip-config-unavailable', 'Knip could not load all tool configurations.', detail);
  if (evidence.hasBlockingHints) return refusal('knip-config-hints', 'Knip configuration or tag hints require attention.', evidence.hintDetails.join('\n'));
  const disabled = [...selected.keys()].filter(type => !evidence.enabled[type]);
  if (disabled.length) return refusal('knip-rule-inactive', 'Selected Knip categories were not inspected.', disabled.join(', '));
  if (execution.exitCode !== 0 && !evidence.findings.length) {
    return refusal('knip-unsuccessful', 'Knip exited unsuccessfully without structured issues explaining the exit.', detail);
  }
  return { kind: 'evidence', inspected: evidence.inspected, breaches: knipBreaches(evidence.findings, selected) };
}

/** A leaked temporary directory cannot make a real breach or refusal untrustworthy. */
export function finalOutcome<R extends RuleRef>(decision: KnipDecision<R>, cleanupError: string | undefined): KnipDecision<R> {
  if (cleanupError === undefined || decision.kind !== 'evidence' || decision.breaches.length) return decision;
  return refusal('knip-cleanup-unavailable', 'Could not remove temporary Knip evidence.', cleanupError);
}

export function checkResult<R extends RuleRef>(decision: KnipDecision<R>, timestamps: Timestamps): CheckResult<R> {
  const scan = (inspected: number | null): Scan => ({ source: 'knip', ...timestamps, inspected });
  if (decision.kind === 'refuse') {
    return result.refuse(scan(null), { code: decision.code, message: decision.message, location: null,
      ...(decision.detail ? { detail: decision.detail } : {}) });
  }
  return result.fromBreaches(scan(decision.inspected), decision.breaches);
}

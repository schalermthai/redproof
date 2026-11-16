import { isAbsolute, relative, sep } from 'node:path';
import { result, type Breach, type CheckResult, type Rule, type RuleRef, type Scan } from 'redproof';
import type { CommandExecution, CompletedCommand } from 'redproof/command';
import {
  MINIMUM_DEPTRY_VERSION, attribute, deptryVersionSupported, hasPerRuleIgnores, ignoreIsCleared,
  parseDeptryReport, parseDeptryVersion, parseResolvedConfig, parseScannedFiles, skippedInput,
  type DeptryCode, type DeptryFinding,
} from './model.ts';

export type DeptryRefusal = {
  readonly kind: 'refuse';
  readonly code: string;
  readonly message: string;
  readonly detail?: string;
};

export type DeptryDecision<R extends RuleRef> =
  | DeptryRefusal
  | { readonly kind: 'evidence'; readonly inspected: number; readonly breaches: readonly Breach<R>[] };

type Timestamps = { readonly startedAt: string; readonly finishedAt: string };

export function refusal(code: string, message: string, detail?: string): DeptryRefusal {
  return { kind: 'refuse', code, message, ...(detail ? { detail } : {}) };
}

/** Both paths must be absolute and canonical. */
export function withinRoot(root: string, actual: string): boolean {
  const rel = relative(root, actual);
  return !isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${sep}`);
}

export type DeptryPlan = {
  /** Directories to scan, relative to the directory deptry runs in. */
  readonly paths: readonly string[];
  readonly configFile?: string | undefined;
  readonly ignoreNotebooks?: boolean | undefined;
  readonly allowPerRuleIgnores?: boolean | undefined;
};

/**
 * `--ignore ''` turns off the project's `ignore` list: a rule the Gate selected must not be silenced
 * by configuration. `--verbose` prints the resolved configuration, which the verdict checks.
 * `--no-ansi` keeps the notices plain. The report path is appended by the shell.
 */
export function deptryArguments(plan: DeptryPlan): readonly string[] {
  return [
    '--no-ansi', '--verbose', '--ignore', '',
    ...(plan.configFile ? ['--config', plan.configFile] : []),
    ...(plan.ignoreNotebooks ? ['--ignore-notebooks'] : []),
    ...plan.paths,
  ];
}

/** Decide from `deptry --version` whether this deptry is one the evidence covers. */
export function checkVersion(execution: CommandExecution): DeptryRefusal | undefined {
  if (execution.kind === 'refused') return refusal(execution.code, execution.message, execution.detail);
  const detail = [execution.stdout.trim(), execution.stderr.trim()].filter(Boolean).join('\n');
  const version = execution.exitCode === 0 ? parseDeptryVersion(detail) : null;
  if (!version) return refusal('deptry-version-unknown', 'The command did not identify itself as deptry.', detail);
  if (!deptryVersionSupported(version)) {
    return refusal('deptry-version-unsupported',
      `deptry ${version.join('.')} is older than ${MINIMUM_DEPTRY_VERSION}, the oldest release this Adapter has been verified against.`, detail);
  }
  return undefined;
}

/** A finished scan: what deptry said and the report file it wrote, or null when it wrote none. */
export type DeptryScan = { readonly execution: CommandExecution; readonly report: string | null };

const tail = (text: string, lines = 12): string => text.trim().split('\n').slice(-lines).join('\n');

function completedOrRefusal(execution: CommandExecution): CompletedCommand | DeptryRefusal {
  if (execution.kind === 'refused') return refusal(execution.code, execution.message, execution.detail);
  return execution;
}

/**
 * The verdict from one scan. deptry exits 1 for findings and also for a crash, and a crash writes no
 * report, so the exit code is never trusted alone: the report, the notices and the configuration
 * echo each have to agree before a pass or a fail is believed.
 */
export function evaluateScan<R extends RuleRef>(
  scan: DeptryScan,
  plan: DeptryPlan,
  selected: ReadonlyMap<DeptryCode, Rule<R>>,
  displayPath: (file: string) => string,
): DeptryDecision<R> {
  const run = completedOrRefusal(scan.execution);
  if (run.kind === 'refuse') return run;
  const output = [run.stderr, run.stdout].filter(Boolean).join('\n');
  const detail = tail(output);

  if (run.exitCode === 2) return refusal('deptry-usage-error', 'deptry rejected the command line.', detail);
  if (run.exitCode !== 0 && run.exitCode !== 1) return refusal('deptry-unsuccessful', `deptry exited with code ${run.exitCode}.`, detail);
  if (scan.report === null) {
    return refusal('deptry-report-unavailable', 'deptry wrote no report; it stopped before finishing (a missing or unreadable dependency specification is the usual cause).', detail);
  }

  const resolved = parseResolvedConfig(output);
  if (!resolved) return refusal('deptry-config-unreadable', 'deptry did not echo its resolved configuration, so the verdict cannot be tied to the rules asked for.', detail);
  if (!ignoreIsCleared(resolved)) return refusal('deptry-ignore-active', 'deptry still applies an ignore list, which could silence a selected rule.', `ignore: ${resolved.ignore}`);
  if (hasPerRuleIgnores(resolved) && !plan.allowPerRuleIgnores) {
    return refusal('deptry-per-rule-ignores', 'The project configures per_rule_ignores, which deptry cannot be told to disregard; a selected rule could be silenced.',
      `per_rule_ignores: ${resolved.perRuleIgnores}\nSet allowPerRuleIgnores to accept them.`);
  }

  const skipped = skippedInput(output);
  if (skipped.length) return refusal('deptry-input-skipped', 'deptry set part of the project aside, so some imports or dependencies were never read.', skipped.join('\n'));
  const inspected = parseScannedFiles(output);
  if (inspected === null) return refusal('deptry-scan-unreadable', 'deptry did not say how many files it scanned.', detail);
  if (inspected === 0) return refusal('deptry-nothing-inspected', 'deptry scanned no Python files, so a pass would mean nothing.', detail);

  let findings: readonly DeptryFinding[];
  try {
    findings = parseDeptryReport(scan.report);
  } catch (error) {
    return refusal('deptry-report-invalid', 'deptry did not produce a trustworthy JSON report.', [String(error), detail].filter(Boolean).join('\n'));
  }
  if (run.exitCode === 0 && findings.length) return refusal('deptry-report-inconsistent', 'deptry exited 0 but reported findings.', detail);
  if (run.exitCode === 1 && !findings.length) return refusal('deptry-report-inconsistent', 'deptry exited 1 without findings explaining the exit.', detail);
  return { kind: 'evidence', inspected, breaches: attribute(findings, selected, displayPath).breaches };
}

/** A finding's file as the Gate sees it: relative to the Gate root. `base` is the directory deptry ran in. */
export function displayPath(root: string, base: string, file: string): string {
  const absolute = isAbsolute(file) ? file : `${base}${sep}${file}`;
  const rel = relative(root, absolute);
  return withinRoot(root, absolute) && rel ? rel : file;
}

/** How the shell runs deptry: the only effects the core calls. */
export type DeptryRunner = {
  readonly version: () => Promise<CommandExecution>;
  readonly scan: (args: readonly string[]) => Promise<DeptryScan>;
};

/** The order of a check, in the core so it is testable without deptry: version, then one scan. */
export async function decideDeptry<R extends RuleRef>(input: {
  readonly plan: DeptryPlan;
  readonly runner: DeptryRunner;
  readonly selected: ReadonlyMap<DeptryCode, Rule<R>>;
  readonly displayPath: (file: string) => string;
}): Promise<DeptryDecision<R>> {
  const unsupported = checkVersion(await input.runner.version());
  if (unsupported) return unsupported;
  return evaluateScan(await input.runner.scan(deptryArguments(input.plan)), input.plan, input.selected, input.displayPath);
}

export function checkResult<R extends RuleRef>(decision: DeptryDecision<R>, timestamps: Timestamps): CheckResult<R> {
  const scan = (inspected: number | null): Scan => ({ source: 'deptry', ...timestamps, inspected });
  if (decision.kind === 'refuse') {
    return result.refuse(scan(null), { code: decision.code, message: decision.message, location: null,
      ...(decision.detail ? { detail: decision.detail } : {}) });
  }
  return result.fromBreaches(scan(decision.inspected), decision.breaches);
}

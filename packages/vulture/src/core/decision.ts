import { isAbsolute, relative, sep } from 'node:path';
import { result, type Breach, type CheckResult, type Rule, type RuleRef, type Scan } from 'redproof';
import type { CommandExecution } from 'redproof/command';
import {
  MINIMUM_VULTURE_VERSION, attribute, parseVultureOutput, parseVultureVersion, unreadInput, vultureVersionSupported,
  type VultureKind,
} from './model.ts';

export type VultureRefusal = {
  readonly kind: 'refuse';
  readonly code: string;
  readonly message: string;
  readonly detail?: string;
};

export type VultureDecision<R extends RuleRef> =
  | VultureRefusal
  | { readonly kind: 'evidence'; readonly inspected: number; readonly breaches: readonly Breach<R>[] };

type Timestamps = { readonly startedAt: string; readonly finishedAt: string };

export function refusal(code: string, message: string, detail?: string): VultureRefusal {
  return { kind: 'refuse', code, message, ...(detail ? { detail } : {}) };
}

/** Both paths must be absolute and canonical. */
export function withinRoot(root: string, actual: string): boolean {
  const rel = relative(root, actual);
  return !isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${sep}`);
}

export type VulturePlan = {
  /** Relative to the directory vulture runs in. */
  readonly paths: readonly string[];
  readonly minConfidence: number;
  readonly exclude?: readonly string[] | undefined;
  readonly ignoreNames?: readonly string[] | undefined;
  readonly ignoreDecorators?: readonly string[] | undefined;
};

/**
 * `--config` is always given, so the project's own `[tool.vulture]` (its `exclude`, `ignore_names`,
 * `min_confidence`, `paths`) cannot hide findings: the Gate's options are the whole configuration.
 */
export function vultureArguments(plan: VulturePlan, configFile: string): readonly string[] {
  return [
    '--min-confidence', String(plan.minConfidence),
    '--config', configFile,
    ...(plan.exclude?.length ? ['--exclude', plan.exclude.join(',')] : []),
    ...(plan.ignoreNames?.length ? ['--ignore-names', plan.ignoreNames.join(',')] : []),
    ...(plan.ignoreDecorators?.length ? ['--ignore-decorators', plan.ignoreDecorators.join(',')] : []),
    '--', ...plan.paths,
  ];
}

export function checkVersion(execution: CommandExecution): VultureRefusal | undefined {
  if (execution.kind === 'refused') return refusal(execution.code, execution.message, execution.detail);
  const detail = [execution.stdout.trim(), execution.stderr.trim()].filter(Boolean).join('\n');
  const version = execution.exitCode === 0 ? parseVultureVersion(detail) : null;
  if (!version) return refusal('vulture-version-unknown', 'The command did not identify itself as vulture.', detail);
  if (!vultureVersionSupported(version)) {
    return refusal('vulture-version-unsupported',
      `vulture ${version.join('.')} is older than ${MINIMUM_VULTURE_VERSION}, the oldest release this Adapter has been verified against.`, detail);
  }
  return undefined;
}

const tail = (text: string, lines = 12): string => text.trim().split('\n').slice(-lines).join('\n');

/**
 * The verdict from one run. vulture's text report has no end marker and its exit code is 3 for
 * findings, 1 for input it could not read, 2 for bad arguments. A syntax error is only on stderr, and
 * with findings elsewhere the exit code is 3 anyway, so stderr is read on every exit.
 */
export function evaluateRun<R extends RuleRef>(
  execution: CommandExecution,
  plan: VulturePlan,
  inspected: number,
  selected: ReadonlyMap<VultureKind, Rule<R>>,
  displayPath: (file: string) => string,
): VultureDecision<R> {
  if (execution.kind === 'refused') return refusal(execution.code, execution.message, execution.detail);
  const detail = tail([execution.stderr, execution.stdout].filter(Boolean).join('\n'));
  if (execution.exitCode === 2) return refusal('vulture-usage-error', 'vulture rejected the command line.', detail);
  if (![0, 1, 3].includes(execution.exitCode)) return refusal('vulture-unsuccessful', `vulture exited with code ${execution.exitCode}.`, detail);

  const unread = unreadInput(execution.stderr);
  if (unread.length) return refusal('vulture-input-unread', 'vulture could not read part of the project, so its code was never analysed.', unread.join('\n'));
  if (execution.exitCode === 1) return refusal('vulture-input-invalid', 'vulture reported invalid input without saying which.', detail);

  const report = parseVultureOutput(execution.stdout);
  if (report.unrecognised.length) {
    return refusal('vulture-report-unrecognised', 'vulture printed lines this Adapter does not understand, so the report cannot be trusted.', report.unrecognised.slice(0, 10).join('\n'));
  }
  if (execution.exitCode === 0 && report.findings.length) return refusal('vulture-report-inconsistent', 'vulture exited 0 but reported findings.', detail);
  if (execution.exitCode === 3 && !report.findings.length) return refusal('vulture-report-inconsistent', 'vulture exited 3 without findings explaining the exit.', detail);
  return { kind: 'evidence', inspected, breaches: attribute(report.findings, selected, plan.minConfidence, displayPath) };
}

/** A finding's file as the Gate sees it: relative to the Gate root. `base` is the directory vulture ran in. */
export function displayPath(root: string, base: string, file: string): string {
  const absolute = isAbsolute(file) ? file : `${base}${sep}${file}`;
  const rel = relative(root, absolute);
  return withinRoot(root, absolute) && rel ? rel : file;
}

/** How the shell runs vulture: the only effects the core calls. */
export type VultureRunner = {
  readonly version: () => Promise<CommandExecution>;
  /** How many Python files the run will read, by vulture's own rules for directories and `--exclude`. */
  readonly countFiles: () => Promise<number>;
  readonly run: (args: readonly string[]) => Promise<CommandExecution>;
};

/** The order of a check, in the core so it is testable without vulture: version, file count, then the run. */
export async function decideVulture<R extends RuleRef>(input: {
  readonly plan: VulturePlan;
  readonly runner: VultureRunner;
  readonly selected: ReadonlyMap<VultureKind, Rule<R>>;
  readonly displayPath: (file: string) => string;
  /** The configuration file to hand to `--config`. */
  readonly configFile: string;
}): Promise<VultureDecision<R>> {
  const unsupported = checkVersion(await input.runner.version());
  if (unsupported) return unsupported;
  const inspected = await input.runner.countFiles();
  if (inspected === 0) {
    return refusal('vulture-nothing-inspected', 'vulture would read no Python files, so a pass would mean nothing.', input.plan.paths.join('\n'));
  }
  return evaluateRun(await input.runner.run(vultureArguments(input.plan, input.configFile)), input.plan, inspected, input.selected, input.displayPath);
}

/**
 * A temp directory that could not be removed cannot make a real breach or refusal untrustworthy, but it can
 * make a clean pass unreliable (the environment is failing), so only a clean pass becomes a REFUSE.
 */
export function finalOutcome<R extends RuleRef>(decision: VultureDecision<R>, cleanupError: string | undefined): VultureDecision<R> {
  if (cleanupError === undefined || decision.kind !== 'evidence' || decision.breaches.length) return decision;
  return refusal('vulture-cleanup-failed', 'Could not remove the temporary directory that held the empty vulture configuration.', cleanupError);
}

/** An error the shell caught. A failing environment is "unavailable"; a bug in this adapter is reported as one, not as the environment. */
export function unexpectedFailure(error: unknown): VultureRefusal {
  const bug = error instanceof TypeError || error instanceof RangeError || error instanceof ReferenceError || error instanceof SyntaxError;
  return bug
    ? refusal('vulture-internal-error', 'The vulture Adapter failed on its own error; this is a bug in the Adapter, not in the project.', String((error as Error).stack ?? error))
    : refusal('vulture-unavailable', 'vulture could not complete the check.', String(error));
}

export function checkResult<R extends RuleRef>(decision: VultureDecision<R>, timestamps: Timestamps): CheckResult<R> {
  const scan = (inspected: number | null): Scan => ({ source: 'vulture', ...timestamps, inspected });
  if (decision.kind === 'refuse') {
    return result.refuse(scan(null), { code: decision.code, message: decision.message, location: null,
      ...(decision.detail ? { detail: decision.detail } : {}) });
  }
  return result.fromBreaches(scan(decision.inspected), decision.breaches);
}

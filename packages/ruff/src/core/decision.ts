import { isAbsolute, relative, sep } from 'node:path';
import { result, type Breach, type CheckResult, type Rule, type RuleRef, type Scan } from 'redproof';
import type { CommandExecution, CompletedCommand } from 'redproof/command';
import { MINIMUM_RUFF_VERSION, attribute, parseRuffVersion, ruffVersionSupported, parseRuffReport, type RuffFinding } from './model.ts';

export type RuffRefusal = {
  readonly kind: 'refuse';
  readonly code: string;
  readonly message: string;
  readonly detail?: string;
};

export type RuffDecision<R extends RuleRef> =
  | RuffRefusal
  | { readonly kind: 'evidence'; readonly inspected: number; readonly breaches: readonly Breach<R>[] };

type Timestamps = { readonly startedAt: string; readonly finishedAt: string };

export function refusal(code: string, message: string, detail?: string): RuffRefusal {
  return { kind: 'refuse', code, message, ...(detail ? { detail } : {}) };
}

/** Both paths must be absolute and canonical. */
export function withinRoot(root: string, actual: string): boolean {
  const rel = relative(root, actual);
  return !isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${sep}`);
}

export type RuffPlan = {
  readonly isolated?: boolean | undefined;
  readonly preview?: boolean | undefined;
  readonly ignoreNoqa?: boolean | undefined;
  readonly configFile?: string | undefined;
  readonly selectors: readonly string[];
  readonly paths: readonly string[];
};

/**
 * Flags shared by the file listing and the lint run, so both see the same files.
 * (`--ignore-noqa` is lint-only: Ruff rejects it beside `--show-files`, and noqa does not change which files are listed.)
 * `--no-fix` and `--no-cache` keep a check from changing the tree it judges.
 * Project `ignore` is overridden by `--select`; `per-file-ignores` and `# noqa` still apply
 * unless `isolated` or `ignoreNoqa` say otherwise.
 */
function commonArguments(plan: RuffPlan): string[] {
  const args = ['check', '--no-fix', '--no-cache', '--select', plan.selectors.join(',')];
  if (plan.isolated) args.push('--isolated');
  if (plan.configFile) args.push('--config', plan.configFile);
  if (plan.preview) args.push('--preview');
  return args;
}

export const ruffListArguments = (plan: RuffPlan): readonly string[] =>
  [...commonArguments(plan), '--show-files', '--', ...plan.paths];

export const ruffLintArguments = (plan: RuffPlan): readonly string[] =>
  [...commonArguments(plan), ...(plan.ignoreNoqa ? ['--ignore-noqa'] : []), '--output-format', 'json', '--', ...plan.paths];

/** Decide from `ruff --version` whether this Ruff is one the evidence covers. */
export function checkVersion(execution: CommandExecution): RuffRefusal | undefined {
  if (execution.kind === 'refused') return refusal(execution.code, execution.message, execution.detail);
  const detail = [execution.stdout.trim(), execution.stderr.trim()].filter(Boolean).join('\n');
  const version = execution.exitCode === 0 ? parseRuffVersion(execution.stdout) : null;
  if (!version) return refusal('ruff-version-unknown', 'The command did not identify itself as Ruff.', detail);
  if (!ruffVersionSupported(version)) {
    return refusal('ruff-version-unsupported', `Ruff ${version.join('.')} is older than ${MINIMUM_RUFF_VERSION}, the oldest release this Adapter has been verified against.`, detail);
  }
  return undefined;
}

/**
 * Ruff reports files it could not read, parse or select as a stderr line and still exits 0 or 1, so
 * the exit code alone would hide them (an unreadable directory with a violation inside passed).
 * Any such line REFUSES, unless it is one of the few known to say nothing about what was checked.
 */
const STDERR_NOTICE = /^\s*(?:warning|error): (.*)$/gmu;
const HARMLESS_NOTICE = [
  /top-level linter settings are deprecated/u,
  /are incompatible\. Ignoring/u,
  // A malformed `# noqa` suppresses nothing, so the findings are still reported.
  /Invalid `# noqa` directive/u,
  /Missing or joined rule code\(s\)/u,
  /Invalid rule code provided to `# noqa`/u,
];

function skippedInput(stderr: string, alsoHarmless: readonly RegExp[] = []): readonly string[] {
  return [...stderr.matchAll(STDERR_NOTICE)]
    .map(match => match[1]!)
    .filter(notice => ![...HARMLESS_NOTICE, ...alsoHarmless].some(harmless => harmless.test(notice)));
}

/** The finished run when Ruff ran and spoke honestly; otherwise the reason to REFUSE. */
function completedOrRefusal(execution: CommandExecution, what: string, alsoHarmless: readonly RegExp[] = []): CompletedCommand | RuffRefusal {
  if (execution.kind === 'refused') return refusal(execution.code, execution.message, execution.detail);
  const detail = [execution.stderr.trim(), execution.stdout.trim()].filter(Boolean).join('\n');
  if (execution.exitCode === 2) {
    return /Unknown rule selector|invalid value '[^']*' for '--select/u.test(execution.stderr)
      ? refusal('ruff-unknown-rule', 'Ruff does not know a selected rule code.', detail)
      : refusal('ruff-config-error', `Ruff could not ${what} because of a configuration or usage error.`, detail);
  }
  if (execution.exitCode !== 0 && execution.exitCode !== 1) {
    return refusal('ruff-unsuccessful', `Ruff exited with code ${execution.exitCode}.`, detail);
  }
  const skipped = skippedInput(execution.stderr, alsoHarmless);
  if (skipped.length) {
    return refusal('ruff-input-skipped', 'Ruff skipped or ignored part of the requested input.', skipped.join('\n'));
  }
  return execution;
}

/** Ruff also lists its own settings files (`ruff.toml`, `pyproject.toml`); they are not code under check. */
const SETTINGS_FILE = /(?:^|[\\/])(?:\.?ruff|pyproject)\.toml$/u;

function countFiles(listing: string): number {
  return listing.split('\n').filter(line => line.trim() && !SETTINGS_FILE.test(line.trim())).length;
}

export type ListingJudgement = RuffRefusal | { readonly kind: 'continue'; readonly inspected: number };

/**
 * First step: is there anything to lint? A listing that failed, or found no code, decides the
 * verdict by itself, so the shell never runs the lint for it.
 */
export function judgeListing(listing: CommandExecution, requested: readonly string[] = []): ListingJudgement {
  // An empty listing says so on stderr; the file count below turns that into its own REFUSE.
  const listed = completedOrRefusal(listing, 'list the files to check', [/No Python files found/u]);
  if (listed.kind === 'refuse') return listed;
  const inspected = countFiles(listed.stdout);
  if (inspected === 0) {
    return refusal('ruff-nothing-inspected', 'Ruff found no Python files to check, so a pass would mean nothing.',
      listed.stderr.trim());
  }
  // Every path the Gate named must account for at least one file. Config such as `force-exclude`
  // can remove a named file from the run, and checking nothing there would pass.
  const files = listed.stdout.split('\n').map(line => line.trim()).filter(line => line && !SETTINGS_FILE.test(line));
  const unaccounted = requested.filter(path => !files.some(file => file === path || file.startsWith(path.endsWith(sep) ? path : path + sep)));
  if (unaccounted.length) {
    return refusal('ruff-path-excluded', 'Ruff left out every file under a path the Gate named, so nothing there was checked.',
      unaccounted.join('\n'));
  }
  return { kind: 'continue', inspected };
}

/** Second step: the verdict from the lint run, given how many files the listing counted. */
export function evaluateLint<R extends RuleRef>(
  inspected: number,
  execution: CommandExecution,
  selected: ReadonlyMap<string, Rule<R>>,
  displayPath: (filename: string) => string,
): RuffDecision<R> {
  const lint = completedOrRefusal(execution, 'lint');
  if (lint.kind === 'refuse') return lint;

  const detail = [lint.stderr.trim(), lint.stdout.trim()].filter(Boolean).join('\n');
  let findings: readonly RuffFinding[];
  try {
    findings = parseRuffReport(lint.stdout);
  } catch (error) {
    return refusal('ruff-report-unavailable', 'Ruff did not produce a trustworthy JSON report.',
      [String(error), detail].filter(Boolean).join('\n'));
  }
  const placed = attribute(findings, selected, displayPath);
  if (placed.unanalysed.length) {
    return refusal('ruff-syntax-error', 'Ruff could not parse some files, so their rules were not evaluated.',
      placed.unanalysed.map(f => `${f.filename}:${f.line ?? '?'}: ${f.message}`).join('\n'));
  }
  // `--select` replaces the project's selection, so a stranger means Ruff answered for a different
  // code than the one asked (an alias or remap), not for extra config. Never a silent drop.
  if (placed.strangers.length) {
    return refusal('ruff-unattributed-finding', 'Ruff reported rules no selected selector covers; a selected code may have been remapped.',
      placed.strangers.join(', '));
  }
  if (lint.exitCode === 0 && findings.length) {
    return refusal('ruff-report-inconsistent', 'Ruff exited 0 but reported findings.', detail);
  }
  if (lint.exitCode === 1 && !findings.length) {
    return refusal('ruff-report-inconsistent', 'Ruff exited 1 without findings explaining the exit.', detail);
  }
  return { kind: 'evidence', inspected, breaches: placed.breaches };
}

/** A finding's file as the Gate sees it: relative to the Gate root when inside it. */
export function displayPath(root: string, filename: string): string {
  const rel = relative(root, filename);
  return withinRoot(root, filename) && rel ? rel : filename;
}

/** How the shell runs Ruff: arguments in, a finished or refused run out. The only effect the core calls. */
export type RunRuff = (args: readonly string[]) => Promise<CommandExecution>;

/**
 * The order of a check, in the core so it is testable without Ruff: environment, then version, then
 * the file listing, then the lint. Each step can end the check; a step never runs after a REFUSE.
 */
export async function decideRuff<R extends RuleRef>(input: {
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly plan: RuffPlan;
  /** The canonical absolute paths the Gate named. */
  readonly requested?: readonly string[];
  readonly run: RunRuff;
  readonly selected: ReadonlyMap<string, Rule<R>>;
  readonly displayPath: (filename: string) => string;
}): Promise<RuffDecision<R>> {
  const conflict = environmentRefusal(input.env);
  if (conflict) return conflict;
  const unsupported = checkVersion(await input.run(['--version']));
  if (unsupported) return unsupported;
  const listed = judgeListing(await input.run(ruffListArguments(input.plan)), input.requested);
  if (listed.kind === 'refuse') return listed;
  return evaluateLint(listed.inspected, await input.run(ruffLintArguments(input.plan)), input.selected, input.displayPath);
}

export function checkResult<R extends RuleRef>(decision: RuffDecision<R>, timestamps: Timestamps): CheckResult<R> {
  const scan = (inspected: number | null): Scan => ({ source: 'ruff', ...timestamps, inspected });
  if (decision.kind === 'refuse') {
    return result.refuse(scan(null), { code: decision.code, message: decision.message, location: null,
      ...(decision.detail ? { detail: decision.detail } : {}) });
  }
  return result.fromBreaches(scan(decision.inspected), decision.breaches);
}

/**
 * Ruff reads these from the caller's environment and an empty value is not "unset", so the Adapter
 * cannot neutralise them. They redirect or reshape the output the verdict is read from, so the same
 * tree and configuration would answer differently. The shell passes in a snapshot of the environment.
 */
const ENVIRONMENT_HAZARDS = ['RUFF_OUTPUT_FILE', 'RUFF_OUTPUT_FORMAT'] as const;

export function environmentRefusal(env: Readonly<Record<string, string | undefined>>): RuffRefusal | undefined {
  const set = ENVIRONMENT_HAZARDS.filter(name => env[name] !== undefined);
  return set.length
    ? refusal('ruff-environment-conflict', 'The environment sets Ruff output options, which would change what the verdict reads.',
      `Unset ${set.join(', ')} for this check.`)
    : undefined;
}

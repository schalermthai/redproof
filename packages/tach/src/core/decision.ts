import { isAbsolute, relative, sep } from 'node:path';
import { breach, result, type Breach, type CheckResult, type Rule, type RuleRef, type Scan } from 'redproof';
import type { CommandExecution } from 'redproof/command';
import type { ConfigFacts, SourceTree } from './config.ts';
import { configRefusal, escapingRoots, ignoredRefusal, symlinkRefusal, type GuardOptions, type IgnoredFiles } from './guards.ts';
import {
  MINIMUM_TACH_VERSION, NEWEST_VERIFIED_MINOR, attribute, parseTachReport, parseTachVersion, tachVersionSupported, tachVersionVerified,
  type TachReport, type TachRuleKind,
} from './model.ts';

export type TachRefusal = {
  readonly kind: 'refuse';
  readonly code: string;
  readonly message: string;
  readonly detail?: string;
};

export type TachDecision<R extends RuleRef> =
  | TachRefusal
  | { readonly kind: 'evidence'; readonly breaches: readonly Breach<R>[] };

type Timestamps = { readonly startedAt: string; readonly finishedAt: string };

export function refusal(code: string, message: string, detail?: string): TachRefusal {
  return { kind: 'refuse', code, message, ...(detail ? { detail } : {}) };
}

/** Both paths must be absolute and canonical. */
export function withinRoot(root: string, actual: string): boolean {
  const rel = relative(root, actual);
  return !isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${sep}`);
}

/** `tach check` with every check on. Narrowing flags (`--dependencies`, `--interfaces`, `-e`) would let a rule pass unchecked, so none is passed. */
const tachCheckArguments: readonly string[] = ['check', '--output', 'json'];

const output = (execution: { readonly stdout: string; readonly stderr: string }): string =>
  [execution.stderr.trim(), execution.stdout.trim()].filter(Boolean).join('\n');

/** Decide from `tach --version` whether this tach is one the evidence covers. */
export function checkVersion(execution: CommandExecution, allowUnverifiedVersion = false): TachRefusal | undefined {
  if (execution.kind === 'refused') return refusal(execution.code, execution.message, execution.detail);
  const version = execution.exitCode === 0 ? parseTachVersion(execution.stdout) : null;
  if (!version) return refusal('tach-version-unknown', 'The command did not identify itself as tach.', output(execution));
  if (!tachVersionSupported(version)) {
    return refusal('tach-version-unsupported', `tach ${version.join('.')} is older than ${MINIMUM_TACH_VERSION}, the oldest release this Adapter has been verified against.`, output(execution));
  }
  if (!allowUnverifiedVersion && !tachVersionVerified(version)) {
    return refusal('tach-version-unverified', `tach ${version.join('.')} is newer than 0.${NEWEST_VERIFIED_MINOR[1]}, the newest minor this Adapter has been verified against. Set allowUnverifiedVersion to run it anyway.`, output(execution));
  }
  return undefined;
}

const CONFIG_FILE = 'tach.toml';

function aborted<R extends RuleRef>(
  report: Extract<TachReport, { kind: 'cycle' | 'visibility' }>,
  selected: ReadonlyMap<TachRuleKind, Rule<R>>,
): TachDecision<R> {
  const kind: TachRuleKind = report.kind === 'cycle' ? 'circular-dependency' : 'visibility-violation';
  const text = report.kind === 'cycle'
    ? `Circular dependency between modules: ${report.modules.join(' -> ')}.`
    : report.errors.map(e => `'${e.dependent}' cannot depend on '${e.dependency}' because it does not match its visibility: [${e.visibility.join(', ')}].`).join('\n');
  const owner = selected.get(kind);
  // tach stops at the first structural error, before any diagnostic is computed. Only a Gate that asks for
  // nothing else can be told the truth with a Breach; any other selected rule was never evaluated.
  if (!owner || selected.size > 1) {
    return refusal('tach-run-aborted', 'tach stopped on a structural error before it evaluated every selected rule.', text);
  }
  const lines = report.kind === 'cycle' ? [text] : text.split('\n');
  return { kind: 'evidence', breaches: lines.map(message => breach(owner, {
    code: report.kind === 'cycle' ? 'CircularDependency' : 'VisibilityError',
    message,
    location: { file: CONFIG_FILE, line: null, column: null },
  })) };
}

/** The verdict from the `tach check` run. */
export function evaluateCheck<R extends RuleRef>(
  execution: CommandExecution,
  selected: ReadonlyMap<TachRuleKind, Rule<R>>,
  displayPath: (file: string) => string,
): TachDecision<R> {
  if (execution.kind === 'refused') return refusal(execution.code, execution.message, execution.detail);
  const detail = output(execution);
  if (execution.exitCode !== 0 && execution.exitCode !== 1) {
    return refusal('tach-unsuccessful', `tach exited with code ${execution.exitCode}.`, detail);
  }
  let report: TachReport;
  try {
    report = parseTachReport(execution.stdout);
  } catch (error) {
    // A missing or unreadable tach.toml prints plain text, not JSON.
    return refusal('tach-report-unavailable', 'tach did not produce a trustworthy JSON report.', [String(error), detail].filter(Boolean).join('\n'));
  }
  if (report.kind === 'error') return refusal('tach-error', 'tach reported an error instead of a result.', report.message);
  if (execution.exitCode !== 1 && report.kind !== 'diagnostics') {
    return refusal('tach-report-inconsistent', 'tach exited 0 with a structural error.', detail);
  }
  if (report.kind !== 'diagnostics') return aborted(report, selected);

  const diagnostics = report.diagnostics;
  // A configuration diagnostic means tach skipped input or found nothing to check, so a pass would mean nothing.
  const configuration = diagnostics.filter(d => d.scope === 'configuration');
  if (configuration.length) {
    return refusal('tach-configuration-diagnostic', 'tach reported a problem with what it was asked to check (a skipped file, a missing module or source root, or no first-party import to inspect), so its absence of findings proves nothing. A project whose modules import nothing of each other cannot pass.',
      configuration.map(d => `${d.variant}${Object.keys(d.fields).length ? ` ${JSON.stringify(d.fields)}` : ''}`).join('\n'));
  }
  const placed = attribute(diagnostics, selected, displayPath);
  if (placed.unrecognised.length) {
    return refusal('tach-unrecognised-diagnostic', 'tach reported diagnostics this Adapter has no rule for; the tach version may be newer than the evidence.', placed.unrecognised.join(', '));
  }
  const hasError = diagnostics.some(d => d.severity === 'Error');
  if (execution.exitCode === 0 && hasError) return refusal('tach-report-inconsistent', 'tach exited 0 but reported an error.', detail);
  if (execution.exitCode === 1 && !hasError) return refusal('tach-report-inconsistent', 'tach exited 1 without an error explaining the exit.', detail);
  return { kind: 'evidence', breaches: placed.breaches };
}

/** How the shell runs tach: arguments in, a finished or refused run out. The only effect the core calls. */
export type RunTach = (args: readonly string[]) => Promise<CommandExecution>;

function guards(selected: ReadonlyMap<TachRuleKind, Rule<RuleRef>>, facts: ConfigFacts, tree: SourceTree, ignored: IgnoredFiles, options: GuardOptions): TachRefusal | undefined {
  const escaping = escapingRoots(facts.sourceRoots);
  const found = escaping.length
    ? { code: 'tach-path-outside-root', message: 'A source root leaves the Gate root, so tach would read files the Gate never named.', detail: escaping.join('\n') }
    : configRefusal([...selected.keys()], facts, tree, options) ?? ignoredRefusal(ignored, tree, facts, options) ?? symlinkRefusal(tree, facts, options);
  return found ? refusal(found.code, found.message, found.detail) : undefined;
}

/**
 * The order of a check, in the core so it is testable without tach. Every step can only end in REFUSE, except the
 * last, so an ambiguous run never passes. Full precedence, first match wins:
 *  1. shell: path outside the Gate root, no `tach.toml` in the working directory, unreadable `tach.domain.toml`, thrown error
 *  2. `tach --version`: command refused, not tach, too old, newer than the verified minor
 *  3. guards: source root outside the Gate root, cycle check off, inactive rule, ignored sources, symlinked sources
 *  4. `tach check`: command refused, exit code not 0 or 1, report not JSON, error object, exit/report disagree,
 *     structural stop, configuration diagnostic, unknown variant, exit/severity mismatch
 *  5. only then breaches (FAIL) or none (PASS)
 */
export async function decideTach<R extends RuleRef>(input: {
  readonly run: RunTach;
  /** The text of tach.toml, as the shell read it, plus any distributed `tach.domain.toml` facts already merged by the shell. */
  readonly facts: ConfigFacts;
  /** What the shell found on disk under the working directory. */
  readonly tree: SourceTree;
  readonly ignored: IgnoredFiles;
  readonly options?: GuardOptions & { readonly allowUnverifiedVersion?: boolean | undefined };
  readonly selected: ReadonlyMap<TachRuleKind, Rule<R>>;
  readonly displayPath: (file: string) => string;
}): Promise<TachDecision<R>> {
  const unsupported = checkVersion(await input.run(['--version']), input.options?.allowUnverifiedVersion);
  if (unsupported) return unsupported;
  const guard = guards(input.selected, input.facts, input.tree, input.ignored, input.options ?? {});
  if (guard) return guard;
  return evaluateCheck(await input.run(tachCheckArguments), input.selected, input.displayPath);
}

export function checkResult<R extends RuleRef>(decision: TachDecision<R>, timestamps: Timestamps): CheckResult<R> {
  // tach does not say how many files it read, so a pass has no count; a project with nothing to read is a
  // configuration diagnostic, which REFUSES above.
  const scan: Scan = { source: 'tach', ...timestamps, inspected: null };
  if (decision.kind === 'refuse') {
    return result.refuse(scan, { code: decision.code, message: decision.message, location: null,
      ...(decision.detail ? { detail: decision.detail } : {}) });
  }
  return result.fromBreaches(scan, decision.breaches);
}

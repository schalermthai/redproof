import { relative, resolve } from 'node:path';
import { result, type Breach, type CheckResult, type Rule, type RuleRef, type Scan } from 'redproof';
import type { CommandExecution, CompletedCommand } from 'redproof/command';
import {
  hidingIgnores, judgeFacts, parseProbe, withinRoot, type Facts, type Problem,
} from './facts.ts';
import {
  MINIMUM_MYPY_VERSION, mypyVersionSupported, ownerOf, parseMypyReport, parseMypyVersion, signalCodes,
  toBreach, unresolvedImportCodes, verifiedCodes, coversCode, type MypyFinding,
} from './model.ts';
import type { Allowance } from './options.ts';
import { PROBE_SCRIPT } from './probe.ts';

export type MypyRefusal = {
  readonly kind: 'refuse';
  readonly code: string;
  readonly message: string;
  readonly detail?: string;
};

export type MypyDecision<R extends RuleRef> =
  | MypyRefusal
  | { readonly kind: 'evidence'; readonly inspected: number; readonly breaches: readonly Breach<R>[] };

type Timestamps = { readonly startedAt: string; readonly finishedAt: string };

export function refusal(code: string, message: string, detail?: string): MypyRefusal {
  return { kind: 'refuse', code, message, ...(detail ? { detail } : {}) };
}

const problem = (found: Problem): MypyRefusal => refusal(found.code, found.message, found.detail);

export type MypyPlan = {
  /** The selected error codes. */
  readonly codes: readonly string[];
  /** Relative to the working directory. */
  readonly paths: readonly string[];
  /** A scratch directory outside the project for mypy's cache. */
  readonly cacheDir: string;
  readonly pythonVersion?: string | undefined;
  readonly platform?: string | undefined;
};

/** Which configuration the run reads: whatever mypy finds, one named file, or none. */
export type ConfigChoice =
  | { readonly kind: 'discover' }
  | { readonly kind: 'file'; readonly path: string }
  | { readonly kind: 'none' };

/**
 * Everything the command line says, in one place so the probe and the real run get the same list.
 * The cache lives outside the tree (mypy otherwise writes `.mypy_cache` beside the project), untyped
 * bodies are checked (mypy skips them by default, so an unannotated project would pass), unused ignores
 * are reported (they tell used ignores apart), and every selected code is enabled and its flag raised.
 */
function mypyFlags(plan: MypyPlan, config: ConfigChoice): readonly string[] {
  const flags = new Set<string>();
  const pairs: string[] = [];
  for (const code of plan.codes) for (const flag of verifiedCodes[code] ?? []) flags.add(flag);
  const enabled = [...new Set([...plan.codes, ...signalCodes])];
  for (const code of enabled) pairs.push('--enable-error-code', code);
  return [
    ...(config.kind === 'discover' ? [] : [`--config-file=${config.kind === 'file' ? config.path : ''}`]),
    '--output', 'json',
    '--show-error-codes', '--no-error-summary', '--no-pretty', '--no-color-output',
    '--no-incremental', '--cache-dir', plan.cacheDir,
    '--check-untyped-defs', '--warn-unused-ignores',
    ...(plan.pythonVersion ? ['--python-version', plan.pythonVersion] : []),
    ...(plan.platform ? ['--platform', plan.platform] : []),
    ...flags,
    ...pairs,
    '--', ...plan.paths,
  ];
}

/** `-I` keeps the project's own `mypy.py` or `mypy/` from shadowing the installed mypy, and ignores PYTHON* variables. */
export const mypyArguments = (plan: MypyPlan, config: ConfigChoice): readonly string[] =>
  ['-I', '-m', 'mypy', ...mypyFlags(plan, config)];

export const probeArguments = (plan: MypyPlan, config: ConfigChoice): readonly string[] =>
  ['-I', '-c', PROBE_SCRIPT, ...mypyFlags(plan, config)];

/**
 * Variables mypy reads that would change which files and stubs it sees. The shell unsets them for the run
 * (verified to remove them from the child) rather than refusing, because the Gate's answer must not depend on them.
 */
export const NEUTRALISED_ENVIRONMENT = ['MYPYPATH', 'MYPY_ALT_LIB_PATH', 'MYPY_CACHE_DIR'] as const;

function unfinished(execution: CommandExecution, what: string): CompletedCommand | MypyRefusal {
  if (execution.kind === 'refused') return refusal(execution.code, execution.message, execution.detail);
  const detail = [execution.stderr.trim(), execution.stdout.trim()].filter(Boolean).join('\n');
  if (execution.exitCode !== 0 && execution.exitCode !== 1) {
    return refusal('mypy-unsuccessful', `${what} exited with code ${execution.exitCode}, which mypy does not document as a result.`, detail);
  }
  return execution;
}

const INVALID_CODE = /Invalid error code\(s\)/u;
const NO_FILES = /There are no \.py\[i\] files in directory|no input files/u;

/** Version first: an old mypy dies on a flag the rest of the check passes, and the real cause is the version. */
function versionRefusal(version: string | null): MypyRefusal | undefined {
  if (version === null) return undefined;
  const parsed = parseMypyVersion(version);
  if (!parsed) return refusal('mypy-version-unknown', 'The tool did not identify itself as a mypy release.', version);
  return mypyVersionSupported(parsed)
    ? undefined
    : refusal('mypy-version-unsupported', `mypy ${version} is older than ${MINIMUM_MYPY_VERSION}, the first release with --output json.`, version);
}

export type Places = {
  /** The canonical path of the configuration file mypy found, when it found one. */
  readonly configFile: string | undefined;
  /** The canonical paths of `mypy_path` entries. */
  readonly mypyPath: readonly string[];
};

type RunPython = (args: readonly string[]) => Promise<CommandExecution>;

export type DecideInput<R extends RuleRef> = {
  readonly plan: MypyPlan;
  readonly config: ConfigChoice;
  readonly allow: ReadonlySet<Allowance>;
  readonly pinned: { readonly pythonVersion: boolean; readonly platform: boolean };
  readonly root: string;
  /** The canonical working directory and the canonical paths the Gate named. */
  readonly cwd: string;
  readonly requested: readonly string[];
  readonly resolvePlaces: (facts: Facts) => Promise<Places>;
  readonly run: RunPython;
  readonly selected: ReadonlyMap<string, Rule<R>>;
};

/** The order of a check, in the core so it is testable without mypy: probe, judge, run, judge. */
export async function decideMypy<R extends RuleRef>(input: DecideInput<R>): Promise<MypyDecision<R>> {
  const probed = unfinished(await input.run(probeArguments(input.plan, input.config)), 'The mypy probe');
  if (probed.kind === 'refuse') return probed;
  // The probe answers on stdout and always exits 0; anything else is Python or mypy dying before it could answer.
  if (probed.exitCode !== 0) {
    return refusal('mypy-probe-failed', 'The Python interpreter failed before mypy could report what it would do.',
      [probed.stderr.trim(), probed.stdout.trim()].filter(Boolean).join('\n'));
  }
  let probe;
  try {
    probe = parseProbe(probed.stdout);
  } catch (error) {
    return refusal('mypy-probe-unavailable', 'The mypy probe did not answer in the form this adapter reads.',
      [String(error), probed.stderr.trim()].filter(Boolean).join('\n'));
  }
  if (probe.kind === 'unavailable') {
    return refusal('mypy-unavailable', 'The Python interpreter cannot import mypy.', probe.detail);
  }
  if (probe.kind === 'stopped') {
    const old = versionRefusal(probe.mypyVersion);
    if (old) return old;
    const detail = [probe.crash ?? '', probe.stderr.trim(), probe.stdout.trim()].filter(Boolean).join('\n');
    if (INVALID_CODE.test(detail)) return refusal('mypy-unknown-rule', 'The installed mypy does not know a selected error code.', detail);
    if (NO_FILES.test(detail)) return refusal('mypy-nothing-inspected', 'mypy found no Python files to check, so a pass would mean nothing.', detail);
    return refusal('mypy-usage-error', 'mypy could not read its configuration or arguments.', detail);
  }
  const facts = probe.facts;
  const old = versionRefusal(facts.mypyVersion);
  if (old) return old;

  const places = await input.resolvePlaces(facts);
  const forced = [...new Set([...input.plan.codes, ...signalCodes])];
  const judged = judgeFacts({
    facts, selected: forced, allow: input.allow, pinned: input.pinned, mypyPath: places.mypyPath,
    configFile: places.configFile, root: input.root, requested: input.requested, cwd: input.cwd,
  });
  if (judged) return problem(judged);

  // Pin what the probe read, so the run cannot read a different file than the one that was judged.
  const config: ConfigChoice = input.config.kind !== 'discover'
    ? input.config
    : facts.configFile === null || places.configFile === undefined ? { kind: 'none' } : { kind: 'file', path: places.configFile };
  const executed = await input.run(mypyArguments(input.plan, config));
  if (executed.kind === 'completed' && executed.exitCode === 2) return stopped(executed);
  const finished = unfinished(executed, 'mypy');
  if (finished.kind === 'refuse') return finished;
  return evaluate(finished, facts, input);
}

/**
 * Exit 2 is mypy's "could not finish": a blocking error such as a syntax error (which still prints JSON), a bad
 * flag, or a crash. It never carries a verdict, whatever the output looks like.
 */
function stopped(execution: CompletedCommand): MypyRefusal {
  const detail = [execution.stderr.trim(), execution.stdout.trim()].filter(Boolean).join('\n');
  let syntax = false;
  try {
    syntax = parseMypyReport(execution.stdout).some(finding => finding.code === 'syntax');
  } catch {
    syntax = false;
  }
  if (INVALID_CODE.test(detail)) return refusal('mypy-unknown-rule', 'The installed mypy does not know a selected error code.', detail);
  return syntax
    ? refusal('mypy-syntax-error', 'mypy could not parse some files, so its rules were not evaluated.', detail)
    : refusal('mypy-crashed', 'mypy stopped before it finished (exit code 2).', detail);
}

/** Where a finding is, as a stable key: the absolute path and the line. */
const keyOf = (cwd: string, file: string, line: number | null): string => `${resolve(cwd, file)}:${line ?? '?'}`;

function evaluate<R extends RuleRef>(execution: CompletedCommand, facts: Facts, input: DecideInput<R>): MypyDecision<R> {
  const detail = [execution.stderr.trim(), execution.stdout.trim()].filter(Boolean).join('\n');
  if (INVALID_CODE.test(detail)) return refusal('mypy-unknown-rule', 'The installed mypy does not know a selected error code.', detail);
  if (execution.stderr.trim()) {
    return refusal('mypy-unexpected-stderr', 'mypy wrote to stderr on a run that reported a result, so it may have skipped something.', execution.stderr.trim());
  }
  let findings: readonly MypyFinding[];
  try {
    findings = parseMypyReport(execution.stdout);
  } catch (error) {
    return refusal('mypy-report-unavailable', 'mypy did not produce a trustworthy JSON report.', [String(error), detail].filter(Boolean).join('\n'));
  }
  // JSON mode exits 1 for a run that printed only notes (verified on mypy 2.5-dev), so a note alone is no evidence either way.
  // Exit 0 with output, or exit 1 with none, is a report that disagrees with the run.
  if (execution.exitCode === 0 && findings.length) {
    return refusal('mypy-report-inconsistent', 'mypy exited 0 but reported diagnostics.', detail);
  }
  if (execution.exitCode === 1 && !findings.length) {
    return refusal('mypy-report-inconsistent', 'mypy exited 1 without a diagnostic explaining the exit.', detail);
  }
  const errors = findings.filter(finding => finding.severity === 'error');
  const unchecked = findings.filter(finding => finding.code === 'annotation-unchecked');
  if (unchecked.length) {
    return refusal('mypy-not-evaluated', 'mypy skipped the body of an untyped function, so its rules did not run there.',
      unchecked.map(f => `${f.file}:${f.line ?? '?'}`).join('\n'));
  }
  const syntax = errors.filter(finding => finding.code === 'syntax');
  if (syntax.length) {
    return refusal('mypy-syntax-error', 'mypy could not parse some files, so its rules were not evaluated there.',
      syntax.map(f => `${f.file}:${f.line ?? '?'}: ${f.message}`).join('\n'));
  }
  const nameless = errors.filter(finding => finding.code === null);
  if (nameless.length) {
    return refusal('mypy-unattributed-finding', 'mypy reported an error without an error code, so no rule can own it.',
      nameless.map(f => `${f.file}:${f.line ?? '?'}: ${f.message}`).join('\n'));
  }

  const display = (file: string): string => displayPath(input.root, resolve(input.cwd, file));
  const breaches: Breach<R>[] = [];
  const unresolved: MypyFinding[] = [];
  for (const finding of errors) {
    const owner = ownerOf(finding.code!, input.selected);
    if (owner) {
      breaches.push(toBreach(owner, finding, display(finding.file)));
    } else if (unresolvedImportCodes.some(code => coversCode(code, finding.code!))) {
      unresolved.push(finding);
    }
  }
  if (unresolved.length && !input.allow.has('unresolved-imports')) {
    return refusal('mypy-imports-unresolved',
      'mypy could not resolve some imports and typed them as Any, so other rules saw less than they should. Install the package or its stubs, or allow unresolved-imports.',
      unresolved.map(f => `${f.file}:${f.line ?? '?'}: ${f.message}`).join('\n'));
  }
  const unused = new Set(errors.filter(f => f.code === 'unused-ignore').map(f => keyOf(input.cwd, f.file, f.line)));
  const hiding = input.allow.has('type-ignore')
    ? []
    : hidingIgnores(facts, [...input.selected.keys()], unused, (file, line) => keyOf(input.cwd, file, line));
  if (hiding.length) {
    return refusal('mypy-ignore-comments',
      'A `# type: ignore` comment suppressed an error that a selected rule could have reported. Remove it, or allow type-ignore.',
      hiding.join('\n'));
  }
  return { kind: 'evidence', inspected: facts.sources.length, breaches };
}

/** A finding's file as the Gate sees it: relative to the Gate root when inside it. */
function displayPath(root: string, filename: string): string {
  const rel = relative(root, filename);
  return withinRoot(root, filename) && rel ? rel : filename;
}

export function checkResult<R extends RuleRef>(decision: MypyDecision<R>, timestamps: Timestamps): CheckResult<R> {
  const scan = (inspected: number | null): Scan => ({ source: 'mypy', ...timestamps, inspected });
  if (decision.kind === 'refuse') {
    return result.refuse(scan(null), { code: decision.code, message: decision.message, location: null,
      ...(decision.detail ? { detail: decision.detail } : {}) });
  }
  return result.fromBreaches(scan(decision.inspected), decision.breaches);
}

export { withinRoot };

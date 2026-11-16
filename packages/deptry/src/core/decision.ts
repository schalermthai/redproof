import { isAbsolute, relative, sep } from 'node:path';
import { result, type Breach, type CheckResult, type Rule, type RuleRef, type Scan } from 'redproof';
import type { CommandExecution, CompletedCommand } from 'redproof/command';
import {
  DEPTRY_DEFAULT_EXCLUDE, KNOWN_ECHO_KEYS, MATCHES_NOTHING, MINIMUM_DEPTRY_VERSION, NOTHING, assumedModuleNames, attribute, deptryVersionSupported,
  inlineIgnoredCodes, parseDeptryReport, parseDeptryVersion, parseEchoBlock, parseFileList, parseScannedFiles, pythonTuple, scanRoot, skippedInput,
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
  /** Directories to scan, relative to the directory deptry runs in (so deptry's exclude patterns can match them). */
  readonly paths: readonly string[];
  readonly configFile?: string | undefined;
  readonly ignoreNotebooks?: boolean | undefined;
  readonly exclude?: readonly string[] | undefined;
  readonly extendExclude?: readonly string[] | undefined;
  readonly allowPerRuleIgnores?: boolean | undefined;
  readonly allowKnownFirstParty?: boolean | undefined;
  readonly allowPackageModuleNameMap?: boolean | undefined;
  readonly allowDependencyGroups?: boolean | undefined;
  readonly allowRequirementsFiles?: boolean | undefined;
  readonly allowInlineIgnores?: boolean | undefined;
};

/** The scan roots as deptry is given them: relative to where it runs, never starting with a dash. */
export const scanRoots = (plan: DeptryPlan): readonly string[] => plan.paths.map(scanRoot);

/** Every pattern that removes a path from the walk, as deptry joins them. */
export const excludePatterns = (plan: DeptryPlan): readonly string[] => { const { exclude, extend } = exclusions(plan); return [...exclude, ...extend]; };

const exclusions = (plan: DeptryPlan): { readonly exclude: readonly string[]; readonly extend: readonly string[] } => ({
  exclude: plan.exclude ?? DEPTRY_DEFAULT_EXCLUDE,
  extend: [...(plan.extendExclude ?? []), MATCHES_NOTHING],
});

/**
 * Every project setting that can erase a finding of a selected rule is overridden on the command line, and the
 * verbose echo is then compared with what was asked for (`expectedEcho`):
 * `ignore`, `per_rule_ignores` (a package name cannot start with a dash, so `DEP001=-redproof-none-` ignores
 * nothing), `known_first_party`, `package_module_name_map`, `exclude` and `extend_exclude`.
 * Giving `--exclude` also makes deptry stop reading `.gitignore`, `.ignore`, `.git/info/exclude` and the global
 * ignore file, so the files scanned do not depend on the machine. `--no-ansi` keeps the notices plain.
 * Every value uses `--name=value`, so a value can never be taken for an option. The report path is added by the shell.
 */
export function deptryArguments(plan: DeptryPlan): readonly string[] {
  const { exclude, extend } = exclusions(plan);
  return [
    '--no-ansi', '--verbose', '--ignore=',
    ...(plan.allowPerRuleIgnores ? [] : [`--per-rule-ignores=DEP001=${NOTHING}`]),
    ...(plan.allowKnownFirstParty ? [] : ['--known-first-party=']),
    ...(plan.allowPackageModuleNameMap ? [] : [`--package-module-name-map=redproof-none=${NOTHING}`]),
    ...exclude.map(pattern => `--exclude=${pattern}`),
    ...extend.map(pattern => `--extend-exclude=${pattern}`),
    ...(plan.configFile ? [`--config=${plan.configFile}`] : []),
    ...(plan.ignoreNotebooks ? ['--ignore-notebooks'] : []),
    ...scanRoots(plan),
  ];
}

type Expectation = { readonly key: string; readonly value: string | null; readonly optional: boolean };

/** The echo lines a run that applied the arguments above must show; `value: null` means the Gate accepted the project's own. */
export function expectedEcho(plan: DeptryPlan): readonly Expectation[] {
  const { exclude, extend } = exclusions(plan);
  const need = (key: string, value: string | null): Expectation => ({ key, value, optional: false });
  const maybe = (key: string, value: string | null): Expectation => ({ key, value, optional: true });
  return [
    need('ignore', "('',)"),
    need('per_rule_ignores', plan.allowPerRuleIgnores ? null : `{'DEP001': ('${NOTHING}',)}`),
    need('known_first_party', plan.allowKnownFirstParty ? null : "('',)"),
    need('package_module_name_map', plan.allowPackageModuleNameMap ? null : `{'redproof-none': ('${NOTHING}',)}`),
    need('exclude', pythonTuple(exclude)),
    need('extend_exclude', pythonTuple(extend)),
    need('using_default_exclude', 'False'),
    // Project `ignore_notebooks` would hide every notebook import; the Gate's own `ignoreNotebooks` is the only way to turn them off.
    need('ignore_notebooks', plan.ignoreNotebooks ? 'True' : 'False'),
    // Which files hold the declarations, when there is no pyproject section (deptry ignores these keys otherwise).
    need('using_default_requirements_files', plan.allowRequirementsFiles ? null : 'True'),
    need('requirements_files_dev', plan.allowRequirementsFiles ? null : "('dev-requirements.txt', 'requirements-dev.txt')"),
    // Named differently or absent in some releases: when present they must be untouched.
    maybe('optional_dependencies_dev_groups', plan.allowDependencyGroups ? null : '()'),
    maybe('pep621_dev_dependency_groups', plan.allowDependencyGroups ? null : '()'),
    maybe('non_dev_dependency_groups', plan.allowDependencyGroups ? null : '()'),
    maybe('experimental_namespace_package', plan.allowKnownFirstParty ? null : 'False'),
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
  /** The files an independent walk expects deptry to read, as deptry prints them (relative to where it ran). */
  expectedFiles: readonly string[],
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

  const echo = parseEchoBlock(output);
  if (!echo) return refusal('deptry-config-unreadable', 'deptry did not echo its resolved configuration in the expected block, so the verdict cannot be tied to the rules asked for.', detail);
  const unknown = [...echo.keys()].filter(key => !KNOWN_ECHO_KEYS.has(key));
  if (unknown.length) {
    return refusal('deptry-config-unknown-key', 'deptry echoes settings this adapter has never judged, and one of them could hide a finding. Use a deptry release the adapter has been run against.', unknown.join(', '));
  }
  for (const { key, value, optional } of expectedEcho(plan)) {
    const got = echo.get(key);
    if (got === undefined) {
      if (optional) continue;
      return refusal('deptry-config-unreadable', `deptry did not echo ${key}, so the verdict cannot be tied to the rules asked for.`, detail);
    }
    if (value !== null && got !== value) {
      return refusal('deptry-config-not-applied', `The project configuration still sets ${key}, which could silence a selected rule.`,
        `${key}: ${got}\nexpected: ${value}\n${key === 'ignore_notebooks' ? 'Set ignoreNotebooks on the Gate to leave notebooks out.' : 'Set the matching allow option to accept the project\'s own value.'}`);
    }
  }

  const skipped = skippedInput(output);
  if (skipped.length) return refusal('deptry-input-skipped', 'deptry set part of the project aside, so some imports or dependencies were never read.', skipped.join('\n'));
  // DEP005 only compares a declared name with the standard library, so a guessed module name cannot change its answer.
  const guessed = [...selected.keys()].some(code => code !== 'DEP005') ? assumedModuleNames(output) : [];
  if (guessed.length) {
    return refusal('deptry-environment-incomplete', 'deptry could not find these declared packages installed and guessed their module names, so DEP001 to DEP004 may be wrong. Run the project\'s own deptry, or give the packages in package_module_name_map and set allowPackageModuleNameMap.', guessed.join('\n'));
  }
  // One check ties what deptry read to what the Gate promised: the list deptry prints of the files it will scan is
  // compared with an independent walk (same exclude patterns, same file types, no ignore files). The count line
  // must say the same, and each of the three is accepted only once, so no file name can add a line of its own.
  const count = parseScannedFiles(output);
  const listed = parseFileList(output);
  if (count === null || listed === null) {
    return refusal('deptry-scan-unreadable', 'deptry did not report, exactly once each, the list of files it scans and how many.', detail);
  }
  if (count === 0 && listed.length === 0) return refusal('deptry-nothing-inspected', 'deptry scanned no Python files, so a pass would mean nothing.', detail);
  if (count !== listed.length) return refusal('deptry-scan-mismatch', `deptry listed ${listed.length} files but says it scanned ${count}.`, detail);
  const difference = fileListDifference(expectedFiles, listed);
  if (difference.length) {
    return refusal('deptry-scan-mismatch', 'The files deptry scanned are not the files the Gate promised (its exclude patterns, notebooks flag and paths): something removed or added files.', difference.join('\n'));
  }
  const inspected = listed.length;
  const ignoredInline = plan.allowInlineIgnores ? [] : inlineIgnoredCodes(output).filter(code => selected.has(code as DeptryCode));
  if (ignoredInline.length) {
    return refusal('deptry-inline-ignore', '`# deptry: ignore` comments removed findings of a selected rule from the report. Remove the comments, or set allowInlineIgnores to accept them.', [...new Set(ignoredInline)].join(', '));
  }

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

/** What differs between the expected and the listed files, as `missing: x` / `unexpected: y` lines (a file listed twice counts twice). */
export function fileListDifference(expected: readonly string[], listed: readonly string[]): readonly string[] {
  const counts = new Map<string, number>();
  for (const file of expected) counts.set(file, (counts.get(file) ?? 0) + 1);
  const unexpected: string[] = [];
  for (const file of listed) {
    const left = counts.get(file) ?? 0;
    if (left > 0) counts.set(file, left - 1); else unexpected.push(file);
  }
  const missing = [...counts].flatMap(([file, n]) => Array.from({ length: n }, () => file));
  return [...missing.map(file => `missing: ${file}`), ...unexpected.map(file => `unexpected: ${file}`)].slice(0, 20);
}

/** A finding's file as the Gate sees it: relative to the Gate root. `base` is the directory deptry ran in. */
export function displayPath(root: string, base: string, file: string): string {
  const absolute = isAbsolute(file) ? file : `${base}${sep}${file}`;
  const rel = relative(root, absolute);
  return withinRoot(root, absolute) && rel ? rel : file;
}

/** What the shell found when it walked the scan roots the way deptry will. */
export type ScanCensus = {
  /** The files deptry should list, as it prints them. */
  readonly files: readonly string[];
  /** Directories that could not be listed: deptry's walker drops them silently. */
  readonly unreadable: readonly string[];
  /** Entries (files or directories, excluded ones aside) whose name holds a line break and could forge a line of deptry's log. */
  readonly unsafeNames: readonly string[];
};

/** How the shell runs deptry: the only effects the core calls. */
export type DeptryRunner = {
  readonly version: () => Promise<CommandExecution>;
  readonly census: () => Promise<ScanCensus>;
  readonly scan: (args: readonly string[]) => Promise<DeptryScan>;
};

/** The order of a check, in the core so it is testable without deptry: version, the census of files, then one scan. */
export async function decideDeptry<R extends RuleRef>(input: {
  readonly plan: DeptryPlan;
  readonly runner: DeptryRunner;
  readonly selected: ReadonlyMap<DeptryCode, Rule<R>>;
  readonly displayPath: (file: string) => string;
}): Promise<DeptryDecision<R>> {
  const unsupported = checkVersion(await input.runner.version());
  if (unsupported) return unsupported;
  const census = await input.runner.census();
  if (census.unreadable.length) {
    return refusal('deptry-path-unreadable', 'deptry\'s walker skips directories it cannot read without a word, so the code in them would never be analysed.', census.unreadable.join('\n'));
  }
  if (census.unsafeNames.length) {
    return refusal('deptry-unsafe-file-name', 'A file or directory name holds a line break, which can forge a line of the log the verdict is read from.', JSON.stringify(census.unsafeNames));
  }
  return evaluateScan(await input.runner.scan(deptryArguments(input.plan)), input.plan, input.selected, input.displayPath, census.files);
}

/**
 * A temp directory that could not be removed cannot make a real breach or refusal untrustworthy, but it can
 * make a clean pass unreliable (the environment is failing), so only a clean pass becomes a REFUSE.
 */
export function finalOutcome<R extends RuleRef>(decision: DeptryDecision<R>, cleanupError: string | undefined): DeptryDecision<R> {
  if (cleanupError === undefined || decision.kind !== 'evidence' || decision.breaches.length) return decision;
  return refusal('deptry-cleanup-failed', 'Could not remove the temporary directory that held the deptry report.', cleanupError);
}

/** An error the shell caught. A failing environment is "unavailable"; a bug in this adapter is reported as one, not as the environment. */
export function unexpectedFailure(error: unknown): DeptryRefusal {
  const bug = error instanceof TypeError || error instanceof RangeError || error instanceof ReferenceError || error instanceof SyntaxError;
  return bug
    ? refusal('deptry-internal-error', 'The deptry Adapter failed on its own error; this is a bug in the Adapter, not in the project.', String((error as Error).stack ?? error))
    : refusal('deptry-unavailable', 'deptry could not complete the check.', String(error));
}

export function checkResult<R extends RuleRef>(decision: DeptryDecision<R>, timestamps: Timestamps): CheckResult<R> {
  const scan = (inspected: number | null): Scan => ({ source: 'deptry', ...timestamps, inspected });
  if (decision.kind === 'refuse') {
    return result.refuse(scan(null), { code: decision.code, message: decision.message, location: null,
      ...(decision.detail ? { detail: decision.detail } : {}) });
  }
  return result.fromBreaches(scan(decision.inspected), decision.breaches);
}

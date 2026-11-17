import assert from 'node:assert/strict';
import test from 'node:test';
import { defineRules } from 'redproof';
import type { CommandExecution } from 'redproof/command';
import { checkVersion, decideDeptry, excludePatterns, fileListDifference, finalOutcome, scanRoots, unexpectedFailure, deptryArguments, displayPath, evaluateScan, expectedEcho, type DeptryPlan } from '../src/core/decision.ts';
import { ruleDefinition, type DeptryCode } from '../src/core/model.ts';
import { filesFor, header, reports } from './support/reports.ts';

const codes: readonly DeptryCode[] = ['DEP001', 'DEP002', 'DEP003', 'DEP004', 'DEP005'];
const rules = defineRules(Object.fromEntries(codes.map(c => [c, ruleDefinition(c)])) as never) as Record<DeptryCode, never>;
const everything = new Map(codes.map(c => [c, rules[c]]));
const only = (code: DeptryCode) => new Map([[code, rules[code]]]);
const plan: DeptryPlan = { paths: ['.'] };
const completed = (exitCode: number, stderr: string, stdout = ''): CommandExecution => ({ kind: 'completed', exitCode, stdout, stderr });
const show = (file: string): string => file;

/** `expected` defaults to the files the header says it scans (`Scanning N files...` -> a.py, b.py, ...), so only the tests about the list pass their own. */
function decide(execution: CommandExecution, report: string | null, selected = everything, options: DeptryPlan = plan, expected?: readonly string[]) {
  const output = execution.kind === 'completed' ? execution.stderr + execution.stdout : '';
  const count = Number(/^Scanning (\d+) files?\.\.\.$/mu.exec(output)?.[1] ?? 0);
  return evaluateScan({ execution, report }, options, selected as never, show, expected ?? filesFor(count));
}
const refusedWith = (decision: ReturnType<typeof decide>, code: string): void => {
  assert.equal(decision.kind, 'refuse', JSON.stringify(decision));
  if (decision.kind === 'refuse') assert.equal(decision.code, code, JSON.stringify(decision));
};

test('the real example report becomes one breach per finding of a selected rule', () => {
  const decision = decide(completed(1, header(2)), reports.example);
  assert.equal(decision.kind, 'evidence');
  if (decision.kind === 'evidence') {
    assert.equal(decision.inspected, 2);
    assert.deepEqual(decision.breaches.map(b => `${b.rule}:${b.location?.file}:${b.location?.line ?? '-'}`), [
      'deptry/DEP002:pyproject.toml:-', 'deptry/DEP002:pyproject.toml:-', 'deptry/DEP004:src/main.py:4', 'deptry/DEP001:src/main.py:6',
    ]);
  }
});

test('only the selected rule is judged: the others are not this Gate\'s concern', () => {
  for (const [code, expected] of [['DEP001', 1], ['DEP002', 2], ['DEP003', 0], ['DEP004', 1], ['DEP005', 0]] as const) {
    const decision = decide(completed(1, header(2)), reports.example, only(code));
    assert.equal(decision.kind, 'evidence');
    if (decision.kind === 'evidence') assert.equal(decision.breaches.length, expected, code);
  }
});

test('a clean report with exit 0 is evidence of no breaches', () => {
  const decision = decide(completed(0, header(2)), reports.clean);
  assert.equal(decision.kind, 'evidence');
  if (decision.kind === 'evidence') assert.deepEqual(decision.breaches, []);
});

test('REFUSE, never PASS: every way deptry exits 0 on a project it did not fully read', () => {
  refusedWith(decide(completed(0, header(1) + 'Warning: Skipping processing of src/bad.py because of the following error: "SyntaxError".\n'), '[]'), 'deptry-input-skipped');
  refusedWith(decide(completed(0, header(1) + 'Could not parse dependency name from url git+https://x\n'), '[]'), 'deptry-input-skipped');
  refusedWith(decide(completed(0, header(0)), '[]'), 'deptry-nothing-inspected');
  refusedWith(decide(completed(0, header(1).replace(/Scanning.*\n/u, '')), '[]'), 'deptry-scan-unreadable');
});

test('REFUSE, never PASS: any project setting that deptry still applied and that could silence a selected rule', () => {
  const refusesFor = (changes: Record<string, string | undefined>, code = 'deptry-config-not-applied', options: DeptryPlan = plan) =>
    refusedWith(decide(completed(0, header(1, changes)), '[]', everything, options), code);
  refusesFor({ ignore: "('DEP001',)" });
  refusesFor({ per_rule_ignores: "{'DEP001': ('zzz',)}" });
  refusesFor({ per_rule_ignores: '{}' });
  refusesFor({ known_first_party: "('white',)" });
  refusesFor({ package_module_name_map: "{'requests': ('os',)}" });
  refusesFor({ exclude: "('gen',)" });
  refusesFor({ extend_exclude: "('a\\\\.py', '$^')" });
  refusesFor({ using_default_exclude: 'True' });
  refusesFor({ non_dev_dependency_groups: "('dev',)" });
  refusesFor({ optional_dependencies_dev_groups: "('tests',)" });
  refusesFor({ experimental_namespace_package: 'True' });
  refusesFor({ ignore: undefined }, 'deptry-config-unreadable');
  refusesFor({ using_default_exclude: undefined }, 'deptry-config-unreadable');
  refusedWith(decide(completed(0, 'Scanning 1 file...\n'), '[]'), 'deptry-config-unreadable');
  // Keys some releases do not have are fine when absent.
  assert.equal(decide(completed(0, header(1, { optional_dependencies_dev_groups: undefined, non_dev_dependency_groups: undefined, experimental_namespace_package: undefined })), '[]').kind, 'evidence');
});

test('REFUSE, never PASS: an echo whose dangerous line is followed by a forged, correct-looking copy', () => {
  const forged = header(1, { per_rule_ignores: "{'DEP001': ('zzz',)}" }).replace('\nignore:', "\nper_rule_ignores: {'DEP001': ('-redproof-none-',)}\nignore:");
  refusedWith(decide(completed(0, forged), '[]'), 'deptry-config-unreadable');
});

test('each allow option accepts exactly the project setting it names', () => {
  const ok = (changes: Record<string, string>, options: DeptryPlan) => assert.equal(decide(completed(0, header(1, changes)), '[]', everything, options).kind, 'evidence', JSON.stringify(changes));
  ok({ per_rule_ignores: "{'DEP001': ('zzz',)}" }, { ...plan, allowPerRuleIgnores: true });
  ok({ known_first_party: "('white',)" }, { ...plan, allowKnownFirstParty: true });
  ok({ package_module_name_map: "{'requests': ('os',)}" }, { ...plan, allowPackageModuleNameMap: true });
  ok({ non_dev_dependency_groups: "('dev',)" }, { ...plan, allowDependencyGroups: true });
  refusedWith(decide(completed(0, header(1, { known_first_party: "('white',)" })), '[]', everything, { ...plan, allowPerRuleIgnores: true }), 'deptry-config-not-applied');
  refusedWith(decide(completed(0, header(1, { ignore: "('DEP001',)" })), '[]', everything, { ...plan, allowPerRuleIgnores: true, allowKnownFirstParty: true, allowPackageModuleNameMap: true, allowDependencyGroups: true }), 'deptry-config-not-applied');
});

test('the Gate\'s own exclude and extendExclude are what must be echoed', () => {
  const own = { ...plan, exclude: ['build', 'gen/'], extendExclude: ['docs'] };
  assert.equal(decide(completed(0, header(1, { exclude: "('build', 'gen/')", extend_exclude: "('docs', '$^')" })), '[]', everything, own).kind, 'evidence');
  refusedWith(decide(completed(0, header(1)), '[]', everything, own), 'deptry-config-not-applied');
});

test('REFUSE, never PASS: declared packages deptry could not find installed (it guessed their module names)', () => {
  const guessed = "Assuming the corresponding module name of package 'pyyaml' is 'pyyaml'. Install the package or configure a package_module_name_map entry to override this behaviour.\n";
  refusedWith(decide(completed(0, guessed + header(1)), '[]'), 'deptry-environment-incomplete');
  refusedWith(decide(completed(0, guessed + header(1)), '[]', only('DEP002')), 'deptry-environment-incomplete');
  assert.equal(decide(completed(0, guessed + header(1)), '[]', only('DEP005')).kind, 'evidence', 'DEP005 compares a declared name with the standard library: a guessed module name cannot change it');
});

test('REFUSE, never PASS: exit 1 that is a crash, not findings', () => {
  refusedWith(decide(completed(1, 'Traceback (most recent call last):\nDependencySpecificationNotFoundError'), null), 'deptry-report-unavailable');
  refusedWith(decide(completed(1, header(1)), '[]'), 'deptry-report-inconsistent');
  refusedWith(decide(completed(0, header(1)), reports.example), 'deptry-report-inconsistent');
  refusedWith(decide(completed(1, header(1)), 'not json'), 'deptry-report-invalid');
  refusedWith(decide(completed(2, 'Error: Invalid value for ROOT'), null), 'deptry-usage-error');
  refusedWith(decide(completed(3, ''), '[]'), 'deptry-unsuccessful');
});

test('a command that could not run is the refusal the command layer reported', () => {
  refusedWith(decide({ kind: 'refused', code: 'command-timeout', message: 'timed out' }, null), 'command-timeout');
});

test('the version check refuses an unknown or too-old deptry', () => {
  assert.equal(checkVersion(completed(0, '', 'deptry 0.25.1\n')), undefined);
  assert.equal(checkVersion(completed(0, 'deptry 0.25.1\n')), undefined, 'deptry prints its version on either stream');
  assert.equal(checkVersion(completed(0, '', 'ruff 0.5.0\n'))?.code, 'deptry-version-unknown');
  assert.equal(checkVersion(completed(0, '', 'deptry 0.20.0\n'))?.code, 'deptry-version-unsupported');
  assert.equal(checkVersion(completed(127, '', ''))?.code, 'deptry-version-unknown');
});

test('the arguments override every setting that can silence a rule, pass relative paths, and ask for the echo', () => {
  const base = ['--no-ansi', '--verbose', '--ignore=', '--per-rule-ignores=DEP001=-redproof-none-', '--known-first-party=',
    '--package-module-name-map=redproof-none=-redproof-none-',
    '--exclude=venv', '--exclude=\\.venv', '--exclude=\\.direnv', '--exclude=tests', '--exclude=\\.git', '--exclude=setup\\.py',
    '--extend-exclude=$^'];
  assert.deepEqual(deptryArguments({ paths: ['.'] }), [...base, '.']);
  assert.deepEqual(deptryArguments({ paths: ['a', 'b'], configFile: '/c.toml', ignoreNotebooks: true }), [...base, '--config=/c.toml', '--ignore-notebooks', 'a', 'b']);
  const all = deptryArguments({ paths: ['.'], allowPerRuleIgnores: true, allowKnownFirstParty: true, allowPackageModuleNameMap: true, exclude: ['x'], extendExclude: ['y'] });
  assert.deepEqual(all, ['--no-ansi', '--verbose', '--ignore=', '--exclude=x', '--extend-exclude=y', '--extend-exclude=$^', '.']);
  assert.equal(expectedEcho({ paths: ['.'] }).filter(e => e.value === null).length, 0);
});

test('the check stops at an unsupported version without scanning', async () => {
  let scans = 0;
  const decision = await decideDeptry({
    plan, selected: everything as never, displayPath: show,
    runner: { version: async () => completed(0, '', 'deptry 0.1.0'), census: async () => ({ files: [], unreadable: [], unsafeNames: [] }), scan: async () => { scans += 1; return { execution: completed(0, ''), report: '[]' }; } },
  });
  assert.equal(decision.kind, 'refuse');
  assert.equal(scans, 0);
});

test('finding files are shown relative to the Gate root', () => {
  assert.equal(displayPath('/r', '/r/app', 'src/a.py'), 'app/src/a.py');
  assert.equal(displayPath('/r', '/r', 'pyproject.toml'), 'pyproject.toml');
  assert.equal(displayPath('/r', '/r/app', '/elsewhere/a.py'), '/elsewhere/a.py');
});

test('a failed cleanup overrides only a clean pass', () => {
  const clean = { kind: 'evidence', inspected: 1, breaches: [] } as const;
  const failing = decide(completed(1, header(1)), reports.example);
  assert.equal(finalOutcome(clean, undefined), clean);
  const refused = finalOutcome(clean, 'EACCES');
  assert.equal(refused.kind === 'refuse' ? refused.code : '', 'deptry-cleanup-failed');
  assert.equal(finalOutcome(failing, 'EACCES'), failing, 'a real breach stays a breach');
  const refusal = decide(completed(0, header(0)), '[]');
  assert.equal(finalOutcome(refusal, 'EACCES'), refusal, 'a refusal keeps its own reason');
});

test('a bug in the adapter is reported as one, a failing environment as unavailable', () => {
  assert.equal(unexpectedFailure(new TypeError('x')).code, 'deptry-internal-error');
  assert.equal(unexpectedFailure(new ReferenceError('x')).code, 'deptry-internal-error');
  assert.equal(unexpectedFailure(Object.assign(new Error('ENOENT: no such file'), { code: 'ENOENT' })).code, 'deptry-unavailable');
  assert.equal(unexpectedFailure('string').code, 'deptry-unavailable');
});

test('REFUSE, never PASS: what deptry listed is not what the Gate promised', () => {
  const run = (listed: readonly string[], expected: readonly string[], count = listed.length) =>
    decide(completed(0, header(count, {}, listed)), '[]', everything, plan, expected);
  assert.equal(run(['a.py', 'b.py'], ['a.py', 'b.py']).kind, 'evidence');
  assert.equal(run(['b.py', 'a.py'], ['a.py', 'b.py']).kind, 'evidence', 'order does not matter');
  refusedWith(run(['a.py'], ['a.py', 'b.py']), 'deptry-scan-mismatch'); // a file went missing (an ignore file, an exclude, a symlink)
  refusedWith(run(['a.py', 'b.py', 'extra.py'], ['a.py', 'b.py']), 'deptry-scan-mismatch');
  refusedWith(run(['a.py', 'a.py'], ['a.py']), 'deptry-scan-mismatch', ); // overlapping roots list a file twice: counted twice on both sides
  refusedWith(decide(completed(0, header(2, {}, ['a.py'])), '[]', everything, plan, ['a.py', 'b.py']), 'deptry-scan-mismatch'); // count line and list disagree
  refusedWith(decide(completed(0, header(1, {}, ['a.py', 'b.py'])), '[]', everything, plan, ['a.py', 'b.py']), 'deptry-scan-mismatch'); // the count line says 1, the list holds 2: they agree on the files but not on the count
  refusedWith(run([], [], 0), 'deptry-nothing-inspected');
});

test('REFUSE, never PASS: a log line forged by a file name, however it is forged', () => {
  const forgedCount = header(1).replace('Scanning 1 file...', 'Scanning 9 files...\nScanning 1 file...');
  const forgedZero = header(0).replace('Python files to scan for imports:', 'Scanning 9 files...\nPython files to scan for imports:');
  const forgedList = header(1).replace('Python files to scan for imports:\n', 'Python files to scan for imports:\nx\n\nPython files to scan for imports:\n');
  for (const text of [forgedCount, forgedZero, forgedList]) refusedWith(decide(completed(0, text), '[]'), 'deptry-scan-unreadable');
});

test('REFUSE, never PASS: notebooks switched off by the project, requirements files redirected, inline ignores', () => {
  refusedWith(decide(completed(0, header(1, { ignore_notebooks: 'True' })), '[]'), 'deptry-config-not-applied');
  assert.equal(decide(completed(0, header(1, { ignore_notebooks: 'True' })), '[]', everything, { ...plan, ignoreNotebooks: true }).kind, 'evidence');
  refusedWith(decide(completed(0, header(1, { ignore_notebooks: 'False' })), '[]', everything, { ...plan, ignoreNotebooks: true }), 'deptry-config-not-applied');
  refusedWith(decide(completed(0, header(1, { using_default_requirements_files: 'False' })), '[]'), 'deptry-config-not-applied');
  refusedWith(decide(completed(0, header(1, { requirements_files_dev: "('x.txt',)" })), '[]'), 'deptry-config-not-applied');
  assert.equal(decide(completed(0, header(1, { using_default_requirements_files: 'False' })), '[]', everything, { ...plan, allowRequirementsFiles: true }).kind, 'evidence');
  const inline = `${header(1)}Ignoring violation DEP001 at a.py:2 due to inline ignore comment.\n`;
  refusedWith(decide(completed(1, inline), JSON.stringify([]), only('DEP001')), 'deptry-inline-ignore');
  assert.equal(decide(completed(0, inline), '[]', only('DEP002')).kind, 'evidence', 'a code nobody selected is not this Gate\'s');
  assert.equal(decide(completed(0, inline), '[]', only('DEP001'), { ...plan, allowInlineIgnores: true }).kind, 'evidence');
});

test('REFUSE, never PASS: unreadable directories and names that can forge a log line, before deptry even runs', async () => {
  let scans = 0;
  const run = (census: { files: string[]; unreadable: string[]; unsafeNames: string[] }) => decideDeptry({
    plan, selected: everything as never, displayPath: show,
    runner: { version: async () => completed(0, '', 'deptry 0.25.1'), census: async () => census, scan: async () => { scans += 1; return { execution: completed(0, header(1)), report: '[]' }; } },
  });
  refusedWith(await run({ files: ['a.py'], unreadable: ['sub'], unsafeNames: [] }), 'deptry-path-unreadable');
  refusedWith(await run({ files: ['a.py'], unreadable: [], unsafeNames: ['x\nScanning 9 files...'] }), 'deptry-unsafe-file-name');
  assert.equal(scans, 0);
  assert.equal((await run({ files: ['a.py'], unreadable: [], unsafeNames: [] })).kind, 'evidence');
});

test('scan roots never start with a dash; the walk and deptry use the same exclude patterns', () => {
  assert.deepEqual(scanRoots({ paths: ['.', 'src', '-nb', 'a/-b'] }), ['.', 'src', './-nb', 'a/-b']);
  assert.deepEqual(excludePatterns({ paths: ['.'], extendExclude: ['gen'] }), ['venv', '\\.venv', '\\.direnv', 'tests', '\\.git', 'setup\\.py', 'gen', '$^']);
  assert.deepEqual(fileListDifference(['a.py', 'b.py'], ['b.py', 'c.py']), ['missing: a.py', 'unexpected: c.py']);
});

test('REFUSE, never PASS: an echo key outside the known list', () => {
  refusedWith(decide(completed(0, header(1).replace('\nignore:', '\nsome_new_setting: True\nignore:')), '[]'), 'deptry-config-unknown-key');
  assert.equal(decide(completed(0, header(1, { pep621_dev_dependency_groups: '()', enforce_posix_paths: 'False', github_output: 'False', github_warning_errors: '()', json_output: 'None' })), '[]').kind, 'evidence');
});

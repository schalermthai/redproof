import assert from 'node:assert/strict';
import test from 'node:test';
import { defineRule } from 'redproof';
import { facts as readConfig } from './support/toml.ts';
import { checkVersion, decideTach, evaluateCheck, type TachDecision } from '../src/core/decision.ts';
import type { TachRuleKind } from '../src/core/model.ts';

const done = (exitCode: number, stdout: string, stderr = '') => ({ kind: 'completed' as const, exitCode, stdout, stderr });
const refused = (code: 'command-unavailable' | 'command-timeout' | 'command-output-limit') => ({ kind: 'refused' as const, code, message: code });
const only = (kind: TachRuleKind) => new Map([[kind, defineRule({ id: `tach/${kind}`, description: kind })]]);
const some = new Map<TachRuleKind, ReturnType<typeof defineRule>>([
  ['undeclared-dependency', defineRule({ id: 'tach/undeclared-dependency', description: 'u' })],
  ['circular-dependency', defineRule({ id: 'tach/circular-dependency', description: 'c' })],
]);
const located = (variant: string, fields: object, severity = 'Error') => ({ Located: { file_path: 'src/a.py', line_number: 3,
  original_line_number: 3, severity, details: { Code: { [variant]: fields } } } });
const global = (variant: string, fields: object | never[] = []) => ({ Global: { severity: 'Warning', details: { Configuration: { [variant]: fields } } } });
const undeclared = located('UndeclaredDependency', { dependency: 'b.x', usage_module: 'a', definition_module: 'b' });
const check = (exec: Parameters<typeof evaluateCheck>[0], selected = only('undeclared-dependency')): TachDecision<string> =>
  evaluateCheck(exec, selected, f => f);
const READY = readConfig('forbid_circular_dependencies = true\n');
const inputs = { facts: READY, tree: { python: [], symlinks: [], ignoreFiles: [] }, ignored: [] as readonly string[], options: { allowInactiveRules: true } };
const codeOf = (d: { kind: string; code?: string }) => d.kind === 'refuse' ? d.code : d.kind;

// The verdict table needs values, not processes.
const VERDICTS: ReadonlyArray<readonly [string, Parameters<typeof evaluateCheck>[0], string]> = [
  ['a finding with exit 1', done(1, JSON.stringify([undeclared])), 'evidence'],
  ['clean with exit 0', done(0, '[]'), 'evidence'],
  ['exit 1 yet no error', done(1, '[]'), 'tach-report-inconsistent'],
  ['exit 1 yet only a warning', done(1, JSON.stringify([located('DeprecatedDependency', { dependency: 'b', usage_module: 'a', definition_module: 'b' }, 'Warning')])), 'tach-report-inconsistent'],
  ['exit 0 yet an error', done(0, JSON.stringify([undeclared])), 'tach-report-inconsistent'],
  ['output is not JSON (missing or broken tach.toml)', done(1, 'Failed to parse project config: TOML parse error'), 'tach-report-unavailable'],
  ['no output at all', done(1, '', "Configuration file not found. Run 'tach init' to get started!"), 'tach-report-unavailable'],
  ['a JSON value that is not a report', done(0, '{"hello": 1}'), 'tach-report-unavailable'],
  ['tach reports an error object', done(1, '{"error": "boom"}'), 'tach-error'],
  ['a structural stop that exits 0', done(0, '{"error": "Circular dependency", "dependencies": ["a", "b"]}'), 'tach-report-inconsistent'],
  ['a cycle while another rule is selected', done(1, '{"error": "Circular dependency", "dependencies": ["a", "b"]}'), 'tach-run-aborted'],
  ['a syntax error: the file was skipped', done(1, JSON.stringify([global('SkippedFileSyntaxError', { file_path: 'a/bad.py' })])), 'tach-configuration-diagnostic'],
  ['nothing to check', done(0, JSON.stringify([global('NoFirstPartyImportsFound')])), 'tach-configuration-diagnostic'],
  ['a variant tach never printed before', done(1, JSON.stringify([located('TeleportDependency', { dependency: 'b' })])), 'tach-unrecognised-diagnostic'],
  ['exit 2', done(2, '', 'usage: tach'), 'tach-unsuccessful'],
  ['segfault exit 139', done(139, ''), 'tach-unsuccessful'],
  ['unavailable', refused('command-unavailable'), 'command-unavailable'],
  ['timeout', refused('command-timeout'), 'command-timeout'],
  ['output limit', refused('command-output-limit'), 'command-output-limit'],
];
for (const [name, exec, expected] of VERDICTS) {
  test(`verdict table: ${name} -> ${expected}`, () => assert.equal(codeOf(check(exec)), expected));
}

// REFUSE dominates FAIL: a real finding beside a problem with what tach was asked to check must not fail the Gate on a partial view.
const finding = located('UndeclaredDependency', { dependency: 'b.x', usage_module: 'a', definition_module: 'b' });
const unreadable = global('SkippedFileIoError', { file_path: 'a/latin.py' });
for (const [name, report] of [['finding first', [finding, unreadable]], ['finding last', [unreadable, finding]]] as const) {
  test(`REFUSE beats FAIL: a real error and a skipped file, ${name}`, () => {
    assert.equal(codeOf(check(done(1, JSON.stringify(report)))), 'tach-configuration-diagnostic');
    assert.equal(codeOf(check(done(1, JSON.stringify([finding])))), 'evidence', 'the same finding alone FAILs');
  });
}
test('REFUSE beats FAIL: a real error beside a variant this adapter does not know', () => {
  assert.equal(codeOf(check(done(1, JSON.stringify([finding, located('TeleportDependency', { dependency: 'b' })])))), 'tach-unrecognised-diagnostic');
});

test('a cycle or visibility stop is a Breach only for a Gate that asks for nothing else', () => {
  const cycle = done(1, '{"error": "Circular dependency", "dependencies": ["a", "b", "c"]}');
  const alone = check(cycle, only('circular-dependency'));
  assert.equal(alone.kind, 'evidence');
  if (alone.kind === 'evidence') assert.deepEqual(alone.breaches.map(b => [b.rule, b.code, b.location?.file]), [['tach/circular-dependency', 'CircularDependency', 'tach.toml']]);
  assert.equal(codeOf(check(cycle, only('visibility-violation'))), 'tach-run-aborted', 'the wrong rule was selected');
  const visibility = done(1, '{"error": "Visibility error", "visibility_errors": [["a", "b", ["c"]], ["x", "y", []]]}');
  const seen = check(visibility, only('visibility-violation'));
  assert.equal(seen.kind === 'evidence' ? seen.breaches.length : -1, 2, 'one Breach per offending pair');
});

test('an error elsewhere does not fail a rule that was not selected, but its exit still has to add up', () => {
  const other = located('LayerViolation', { dependency: 'x', usage_module: 'a', usage_layer: 'l', definition_module: 'b', definition_layer: 'h' });
  const decision = check(done(1, JSON.stringify([other])), only('undeclared-dependency'));
  assert.deepEqual(decision, { kind: 'evidence', breaches: [] });
});

test('version gate: unknown, too old, and refused commands', () => {
  assert.equal(checkVersion(done(0, 'tach 0.35.3\n')), undefined);
  assert.equal(checkVersion(done(0, 'tach 0.35.4\n')), undefined);
  assert.equal(checkVersion(done(0, 'tach 0.35.9\n')), undefined, 'a patch release of the verified minor');
  assert.equal(checkVersion(done(0, 'tach 0.36.0\n'))?.code, 'tach-version-unverified');
  assert.equal(checkVersion(done(0, 'tach 1.0.0\n'))?.code, 'tach-version-unverified');
  assert.equal(checkVersion(done(0, 'tach 1.0.0\n'), true), undefined, 'allowUnverifiedVersion');
  assert.equal(checkVersion(done(0, 'tach 0.35.2\n'))?.code, 'tach-version-unsupported');
  assert.equal(checkVersion(done(0, 'tach 0.9.9\n'))?.code, 'tach-version-unsupported');
  assert.equal(checkVersion(done(0, 'ruff 0.17.5\n'))?.code, 'tach-version-unknown');
  assert.equal(checkVersion(done(2, '', 'error'))?.code, 'tach-version-unknown');
  assert.equal(checkVersion(refused('command-unavailable'))?.code, 'command-unavailable');
});

test('order: the version is read first, and a refused version never reaches the check', async () => {
  const calls: string[] = [];
  const run = (version: string) => async (args: readonly string[]) => {
    calls.push(args[0]!);
    return args[0] === '--version' ? done(0, version) : done(0, '[]');
  };
  assert.equal(codeOf(await decideTach({ ...inputs, run: run('nonsense'), selected: only('layer-violation'), displayPath: f => f })), 'tach-version-unknown');
  assert.deepEqual(calls, ['--version']);
  calls.length = 0;
  assert.equal(codeOf(await decideTach({ ...inputs, run: run('tach 0.35.3'), selected: only('layer-violation'), displayPath: f => f })), 'evidence');
  assert.deepEqual(calls, ['--version', 'check']);
});

test('the check runs every check: no narrowing flag is passed', async () => {
  const seen: (readonly string[])[] = [];
  await decideTach({ ...inputs, run: async args => { seen.push(args); return done(0, args[0] === '--version' ? 'tach 0.35.3' : '[]'); }, selected: some, displayPath: f => f });
  assert.deepEqual(seen[1], ['check', '--output', 'json']);
});

// A variant is known only if the table says so: every object also "has" constructor, toString and valueOf.
for (const variant of ['constructor', 'toString', 'valueOf', 'hasOwnProperty', '__proto__']) {
  test(`a diagnostic variant named ${variant} is unrecognised, not silently known`, () => {
    assert.equal(codeOf(check(done(1, JSON.stringify([located(variant, { dependency: 'b.x' })])))), 'tach-unrecognised-diagnostic');
  });
}

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { defineRules } from 'redproof';
import type { CommandExecution } from 'redproof/command';
import { checkVersion, decideDeptry, deptryArguments, displayPath, evaluateScan, type DeptryPlan } from '../src/core/decision.ts';
import { ruleDefinition, type DeptryCode } from '../src/core/model.ts';
import { fixtures, header } from './support/workspace.ts';

const real = (name: string): string => readFileSync(`${fixtures}${name}`, 'utf8');
const codes: readonly DeptryCode[] = ['DEP001', 'DEP002', 'DEP003', 'DEP004', 'DEP005'];
const rules = defineRules(Object.fromEntries(codes.map(c => [c, ruleDefinition(c)])) as never) as Record<DeptryCode, never>;
const everything = new Map(codes.map(c => [c, rules[c]]));
const only = (code: DeptryCode) => new Map([[code, rules[code]]]);
const plan: DeptryPlan = { paths: ['.'] };
const completed = (exitCode: number, stderr: string, stdout = ''): CommandExecution => ({ kind: 'completed', exitCode, stdout, stderr });
const show = (file: string): string => file;

function decide(execution: CommandExecution, report: string | null, selected = everything, options: DeptryPlan = plan) {
  return evaluateScan({ execution, report }, options, selected as never, show);
}
const refusedWith = (decision: ReturnType<typeof decide>, code: string): void => {
  assert.equal(decision.kind, 'refuse', JSON.stringify(decision));
  if (decision.kind === 'refuse') assert.equal(decision.code, code, JSON.stringify(decision));
};

test('the real example report becomes one breach per finding of a selected rule', () => {
  const decision = decide(completed(1, header(2)), real('example.json'));
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
    const decision = decide(completed(1, header(2)), real('example.json'), only(code));
    assert.equal(decision.kind, 'evidence');
    if (decision.kind === 'evidence') assert.equal(decision.breaches.length, expected, code);
  }
});

test('a clean report with exit 0 is evidence of no breaches', () => {
  const decision = decide(completed(0, header(2)), real('clean.json'));
  assert.equal(decision.kind, 'evidence');
  if (decision.kind === 'evidence') assert.deepEqual(decision.breaches, []);
});

test('REFUSE, never PASS: every way deptry exits 0 on a project it did not fully read', () => {
  refusedWith(decide(completed(0, header(1) + 'Warning: Skipping processing of src/bad.py because of the following error: "SyntaxError".\n'), '[]'), 'deptry-input-skipped');
  refusedWith(decide(completed(0, header(1) + 'Could not parse dependency name from url git+https://x\n'), '[]'), 'deptry-input-skipped');
  refusedWith(decide(completed(0, header(0)), '[]'), 'deptry-nothing-inspected');
  refusedWith(decide(completed(0, header(1).replace(/Scanning.*\n/u, '')), '[]'), 'deptry-scan-unreadable');
});

test('REFUSE, never PASS: configuration that could silence a selected rule', () => {
  refusedWith(decide(completed(0, header(1, "('DEP001',)")), '[]'), 'deptry-ignore-active');
  refusedWith(decide(completed(0, header(1, "('',)", "{'DEP001': ('zzz',)}")), '[]'), 'deptry-per-rule-ignores');
  assert.equal(decide(completed(0, header(1, "('',)", "{'DEP001': ('zzz',)}")), '[]', everything, { ...plan, allowPerRuleIgnores: true }).kind, 'evidence');
  refusedWith(decide(completed(0, 'Scanning 1 file...\n'), '[]'), 'deptry-config-unreadable');
});

test('REFUSE, never PASS: exit 1 that is a crash, not findings', () => {
  refusedWith(decide(completed(1, 'Traceback (most recent call last):\nDependencySpecificationNotFoundError'), null), 'deptry-report-unavailable');
  refusedWith(decide(completed(1, header(1)), '[]'), 'deptry-report-inconsistent');
  refusedWith(decide(completed(0, header(1)), real('example.json')), 'deptry-report-inconsistent');
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
  assert.equal(checkVersion(completed(0, '', 'deptry 0.12.0\n'))?.code, 'deptry-version-unsupported');
  assert.equal(checkVersion(completed(127, '', ''))?.code, 'deptry-version-unknown');
});

test('the arguments always clear the ignore list and ask for the configuration echo', () => {
  assert.deepEqual(deptryArguments({ paths: ['.'] }), ['--no-ansi', '--verbose', '--ignore', '', '.']);
  assert.deepEqual(deptryArguments({ paths: ['a', 'b'], configFile: '/c.toml', ignoreNotebooks: true }),
    ['--no-ansi', '--verbose', '--ignore', '', '--config', '/c.toml', '--ignore-notebooks', 'a', 'b']);
});

test('the check stops at an unsupported version without scanning', async () => {
  let scans = 0;
  const decision = await decideDeptry({
    plan, selected: everything as never, displayPath: show,
    runner: { version: async () => completed(0, '', 'deptry 0.1.0'), scan: async () => { scans += 1; return { execution: completed(0, ''), report: '[]' }; } },
  });
  assert.equal(decision.kind, 'refuse');
  assert.equal(scans, 0);
});

test('finding files are shown relative to the Gate root', () => {
  assert.equal(displayPath('/r', '/r/app', 'src/a.py'), 'app/src/a.py');
  assert.equal(displayPath('/r', '/r', 'pyproject.toml'), 'pyproject.toml');
  assert.equal(displayPath('/r', '/r/app', '/elsewhere/a.py'), '/elsewhere/a.py');
});

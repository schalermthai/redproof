import assert from 'node:assert/strict';
import test from 'node:test';
import { defineRules } from 'redproof';
import type { CommandExecution } from 'redproof/command';
import { checkVersion, decideVulture, displayPath, evaluateRun, vultureArguments, type VulturePlan } from '../src/core/decision.ts';
import { VULTURE_KINDS, ruleDefinition, type VultureKind } from '../src/core/model.ts';
import { reports } from './support/reports.ts';

const rules = defineRules(Object.fromEntries(VULTURE_KINDS.map(k => [k, ruleDefinition(k)])) as never) as Record<VultureKind, never>;
const everything = new Map(VULTURE_KINDS.map(k => [k, rules[k]]));
const only = (kind: VultureKind) => new Map([[kind, rules[kind]]]);
const plan: VulturePlan = { paths: ['.'], minConfidence: 60 };
const done = (exitCode: number, stdout = '', stderr = ''): CommandExecution => ({ kind: 'completed', exitCode, stdout, stderr });
const show = (file: string): string => file;
const refusedWith = (decision: ReturnType<typeof evaluateRun>, code: string): void => {
  assert.equal(decision.kind, 'refuse', JSON.stringify(decision));
  if (decision.kind === 'refuse') assert.equal(decision.code, code, JSON.stringify(decision));
};

test('the real report becomes one breach per finding of a selected rule at or above the threshold', () => {
  const all = evaluateRun(done(3, reports.dirty), plan, 1, everything as never, show);
  assert.equal(all.kind, 'evidence');
  if (all.kind === 'evidence') assert.equal(all.breaches.length, 17);
  for (const [kind, expected] of [['unused-import', 2], ['unused-function', 2], ['unused-variable', 5], ['unreachable-code', 4]] as const) {
    const decision = evaluateRun(done(3, reports.dirty), plan, 1, only(kind) as never, show);
    assert.equal(decision.kind === 'evidence' ? decision.breaches.length : -1, expected, kind);
  }
  const strict = evaluateRun(done(3, reports.dirty), { ...plan, minConfidence: 100 }, 1, only('unused-import') as never, show);
  assert.equal(strict.kind === 'evidence' ? strict.breaches.length : -1, 0, 'imports are reported at 90, below 100');
  const some = evaluateRun(done(3, reports.dirty), { ...plan, minConfidence: 90 }, 1, only('unused-import') as never, show);
  assert.equal(some.kind === 'evidence' ? some.breaches.length : -1, 2);
});

test('exit 0 with nothing printed is evidence of no breaches', () => {
  const decision = evaluateRun(done(0), plan, 3, everything as never, show);
  assert.equal(decision.kind === 'evidence' ? decision.inspected : -1, 3);
});

test('REFUSE, never PASS: input vulture did not read, on any exit code', () => {
  refusedWith(evaluateRun(done(1, '', reports.syntaxError), plan, 1, everything as never, show), 'vulture-input-unread');
  refusedWith(evaluateRun(done(3, reports.dirty, reports.syntaxError), plan, 1, everything as never, show), 'vulture-input-unread');
  refusedWith(evaluateRun(done(0, '', reports.syntaxError), plan, 1, everything as never, show), 'vulture-input-unread');
  refusedWith(evaluateRun(done(1), plan, 1, everything as never, show), 'vulture-input-invalid');
  assert.equal(evaluateRun(done(0, '', reports.syntaxWarning), plan, 1, everything as never, show).kind, 'evidence', 'a Python warning is not unread input');
});

test('REFUSE, never PASS: unexpected exit codes, an unreadable report, a report that disagrees with the exit', () => {
  for (const code of [4, 126, 127, 137, 139, 255]) refusedWith(evaluateRun(done(code, reports.dirty), plan, 1, everything as never, show), 'vulture-unsuccessful');
  refusedWith(evaluateRun(done(2, '', 'usage: vulture'), plan, 1, everything as never, show), 'vulture-usage-error');
  refusedWith(evaluateRun(done(3, 'a.py:1: whatever'), plan, 1, everything as never, show), 'vulture-report-unrecognised');
  refusedWith(evaluateRun(done(0, 'Traceback (most recent call last):'), plan, 1, everything as never, show), 'vulture-report-unrecognised');
  refusedWith(evaluateRun(done(0, reports.dirty), plan, 1, everything as never, show), 'vulture-report-inconsistent');
  refusedWith(evaluateRun(done(3), plan, 1, everything as never, show), 'vulture-report-inconsistent');
  refusedWith(evaluateRun({ kind: 'refused', code: 'command-timeout', message: 'timed out' }, plan, 1, everything as never, show), 'command-timeout');
});

test('the version check refuses an unknown or too-old vulture', () => {
  assert.equal(checkVersion(done(0, 'vulture 2.16\n')), undefined);
  assert.equal(checkVersion(done(0, 'ruff 0.5\n'))?.code, 'vulture-version-unknown');
  assert.equal(checkVersion(done(0, 'vulture 2.11\n'))?.code, 'vulture-version-unsupported');
  assert.equal(checkVersion(done(127))?.code, 'vulture-version-unknown');
});

test('the arguments always carry the confidence and the isolated configuration, and paths come last', () => {
  assert.deepEqual(vultureArguments(plan, '/t/empty.toml'), ['--min-confidence', '60', '--config', '/t/empty.toml', '--', '.']);
  assert.deepEqual(vultureArguments({ paths: ['a'], minConfidence: 90, exclude: ['x', 'y'], ignoreNames: ['n*'], ignoreDecorators: ['@d'] }, '/c'),
    ['--min-confidence', '90', '--config', '/c', '--exclude', 'x,y', '--ignore-names', 'n*', '--ignore-decorators', '@d', '--', 'a']);
});

test('the check stops before running when the version is wrong or no Python file would be read', async () => {
  let runs = 0;
  const runner = (version: string, count: number) => ({
    version: async () => done(0, version), countFiles: async () => count, run: async () => { runs += 1; return done(0); },
  });
  const decide = (v: string, n: number) => decideVulture({ plan, runner: runner(v, n), selected: everything as never, displayPath: show, configFile: '/c' });
  refusedWith(await decide('vulture 1.0', 3), 'vulture-version-unsupported');
  refusedWith(await decide('vulture 2.16', 0), 'vulture-nothing-inspected');
  assert.equal(runs, 0);
  assert.equal((await decide('vulture 2.16', 2)).kind, 'evidence');
  assert.equal(runs, 1);
});

test('finding files are shown relative to the Gate root', () => {
  assert.equal(displayPath('/r', '/r/app', 'src/a.py'), 'app/src/a.py');
  assert.equal(displayPath('/r', '/r/app', '/r/app/x.py'), 'app/x.py');
  assert.equal(displayPath('/r', '/r/app', '/elsewhere/a.py'), '/elsewhere/a.py');
});

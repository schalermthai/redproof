import assert from 'node:assert/strict';
import test from 'node:test';
import { defineRules } from 'redproof';
import type { CommandExecution } from 'redproof/command';
import { checkVersion, decideVulture, displayPath, evaluateRun, finalOutcome, unexpectedFailure, vultureArguments, type VulturePlan } from '../src/core/decision.ts';
import { VULTURE_KINDS, isPythonSourceEntry, ruleDefinition, type VultureKind } from '../src/core/model.ts';
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
  refusedWith(evaluateRun(done(0, '', reports.syntaxWarning), plan, 1, everything as never, show), 'vulture-input-unread');
  refusedWith(evaluateRun(done(3, reports.dirty, '/p/a:1: Warning: .py:1: invalid syntax at "x = = 1"\n'), plan, 1, only('unused-function') as never, show), 'vulture-input-unread');
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
    version: async () => done(0, version), countFiles: async () => ({ count, unreadable: [], unsafeNames: [] }), run: async () => { runs += 1; return done(0); },
  });
  const decide = (v: string, n: number) => decideVulture({ plan, runner: runner(v, n), selected: everything as never, displayPath: show, configFile: '/c', root: '/r', windows: false });
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

test('the verdict does not depend on the order of vulture\'s lines', () => {
  const lines = reports.dirty.split('\n').filter(Boolean);
  const shape = (text: string) => {
    const decision = evaluateRun(done(3, text), plan, 1, everything as never, show);
    assert.equal(decision.kind, 'evidence');
    return decision.kind === 'evidence' ? decision.breaches.map(b => `${b.rule}@${b.location?.file}:${b.location?.line}`).sort() : [];
  };
  const expected = shape(reports.dirty);
  assert.equal(expected.length, 17);
  assert.deepEqual(shape([...lines].reverse().join('\n') + '\n'), expected);
  const shuffled = lines.map((line, i) => [(i * 7) % lines.length, line] as const).sort((a, b) => a[0] - b[0]).map(entry => entry[1]);
  assert.deepEqual(shape(shuffled.join('\n') + '\n'), expected);
});

test('which directory entries vulture reads: .py files and symlinks that lead to files, as Path.rglob finds them', () => {
  assert.equal(isPythonSourceEntry('a.py', { file: true, symlinkToFile: false }), true);
  assert.equal(isPythonSourceEntry('a.py', { file: false, symlinkToFile: true }), true);
  assert.equal(isPythonSourceEntry('a.py', { file: false, symlinkToFile: false }), false, 'a broken or directory symlink');
  assert.equal(isPythonSourceEntry('a.pyi', { file: true, symlinkToFile: false }), false);
  assert.equal(isPythonSourceEntry('a.pyc', { file: true, symlinkToFile: false }), false);
  assert.equal(isPythonSourceEntry('py', { file: true, symlinkToFile: false }), false);
});

test('a failed cleanup overrides only a clean pass', () => {
  const clean = { kind: 'evidence', inspected: 1, breaches: [] } as const;
  assert.equal(finalOutcome(clean, undefined), clean);
  const refused = finalOutcome(clean, 'EACCES');
  assert.equal(refused.kind === 'refuse' ? refused.code : '', 'vulture-cleanup-failed');
  const failing = evaluateRun(done(3, reports.dirty), plan, 1, everything as never, show);
  assert.equal(finalOutcome(failing, 'EACCES'), failing, 'a real breach stays a breach');
  const refusal = evaluateRun(done(1, '', reports.syntaxError), plan, 1, everything as never, show);
  assert.equal(finalOutcome(refusal, 'EACCES'), refusal, 'a refusal keeps its own reason');
});

test('a bug in the adapter is reported as one, a failing environment as unavailable', () => {
  assert.equal(unexpectedFailure(new TypeError('x')).code, 'vulture-internal-error');
  assert.equal(unexpectedFailure(new RangeError('x')).code, 'vulture-internal-error');
  assert.equal(unexpectedFailure(Object.assign(new Error('EACCES'), { code: 'EACCES' })).code, 'vulture-unavailable');
  assert.equal(unexpectedFailure('string').code, 'vulture-unavailable');
});

const census = (count: number, extra: Partial<{ unreadable: string[]; unsafeNames: string[] }> = {}) => ({ count, unreadable: [], unsafeNames: [], ...extra });
const decideWith = (c: ReturnType<typeof census>, options: Partial<Parameters<typeof decideVulture>[0]> = {}) => decideVulture({
  plan, selected: everything as never, displayPath: show, configFile: '/c', root: '/r', windows: false,
  runner: { version: async () => done(0, 'vulture 2.16'), countFiles: async () => c, run: async () => done(0) }, ...options,
});

test('REFUSE, never PASS: a directory vulture will skip because it cannot be read, a file name that can forge a line, a root under a test directory', async () => {
  refusedWith(await decideWith(census(3, { unreadable: ['/r/sub'] })), 'vulture-path-unreadable');
  refusedWith(await decideWith(census(3, { unsafeNames: ['/r/a\nb.py'] })), 'vulture-unsafe-file-name');
  refusedWith(await decideWith(census(3), { root: '/ci/tests/proj' }), 'vulture-root-in-test-directory');
  assert.equal((await decideWith(census(3), { root: '/ci/tests/proj', plan: { ...plan, allowTestPathAncestors: true } })).kind, 'evidence');
  assert.equal((await decideWith(census(3), { root: '/ci/contests/proj' })).kind, 'evidence');
});

test('a count that cannot be verified is not reported as a number', async () => {
  const verified = await decideWith(census(3));
  assert.equal(verified.kind === 'evidence' ? verified.inspected : -1, 3);
  const unverified = await decideWith(census(3), { countIsVerified: false });
  assert.equal(unverified.kind === 'evidence' ? unverified.inspected : -1, null);
  refusedWith(await decideWith(census(0), { countIsVerified: false }), 'vulture-nothing-inspected');
});

import assert from 'node:assert/strict';
import test from 'node:test';
import { defineRule } from 'redproof';
import {
  checkVersion, decideRuff, environmentRefusal, evaluateLint, judgeListing, ruffLintArguments, ruffListArguments,
  type RuffDecision, type RuffPlan,
} from '../src/core/decision.ts';

const done = (exitCode: number, stdout: string, stderr = '') => ({ kind: 'completed' as const, exitCode, stdout, stderr });
const refused = (code: 'command-unavailable' | 'command-timeout' | 'command-output-limit') =>
  ({ kind: 'refused' as const, code, message: code });
const selected = new Map([['F401', defineRule({ id: 'ruff/F401', description: 'x' })]]);
const lint = (exec: Parameters<typeof evaluateLint>[1]): RuffDecision<string> => evaluateLint(3, exec, selected, f => f);
const one = (code: string) => JSON.stringify([{ code, message: 'm', filename: '/p/a.py', location: { row: 1, column: 1 } }]);
const codeOf = (d: { kind: string; code?: string }) => d.kind === 'refuse' ? d.code : d.kind;

// Moved down from spawn-a-fake-Ruff tests: the verdict table needs values, not processes.
const VERDICTS: ReadonlyArray<readonly [string, Parameters<typeof evaluateLint>[1], string]> = [
  ['findings with exit 1', done(1, one('F401')), 'evidence'],
  ['clean with exit 0', done(0, '[]'), 'evidence'],
  ['exit 0 yet findings', done(0, one('F401')), 'ruff-report-inconsistent'],
  ['exit 1 yet no findings', done(1, '[]'), 'ruff-report-inconsistent'],
  ['output is not JSON', done(1, 'not json'), 'ruff-report-unavailable'],
  ['output is JSON but not a list', done(1, '{}'), 'ruff-report-unavailable'],
  ['a code no selector covers', done(1, one('SIM110')), 'ruff-unattributed-finding'],
  ['a syntax error (null code)', done(1, one('invalid-syntax')), 'ruff-syntax-error'],
  ['exit 2, Ruff 0.17 unknown selector', done(2, '', "ruff failed\n  Cause: Unknown rule selector `ZZ999` in `select` from the CLI"), 'ruff-unknown-rule'],
  ['exit 2, Ruff 0.14 unknown selector', done(2, '', "error: invalid value 'ZZ999' for '--select <RULE_CODE>'"), 'ruff-unknown-rule'],
  ['exit 2, any other usage error', done(2, '', 'error: the argument --ignore-noqa cannot be used with --show-files'), 'ruff-config-error'],
  ['segfault exit 139', done(139, ''), 'ruff-unsuccessful'],
  ['panic exit 101', done(101, '', 'thread main panicked'), 'ruff-unsuccessful'],
  ['stderr: warning Failed to lint (0.17)', done(0, '[]', 'warning: Failed to lint a.py: No such file'), 'ruff-input-skipped'],
  ['stderr: error Failed to parse (0.4)', done(0, one('F401').replace('F401', 'F401'), 'error: Failed to parse a.py:1:5: Expected an identifier'), 'ruff-input-skipped'],
  ['stderr: code remapped', done(1, one('F401'), 'warning: `SIM111` has been remapped to `SIM110`.'), 'ruff-input-skipped'],
  ['stderr: preview rule has no effect', done(0, '[]', 'warning: Selection `RUF029` has no effect because preview is not enabled.'), 'ruff-input-skipped'],
  ['stderr: unreadable directory (indented, "Encountered error")', done(0, '[]', ' warning: Encountered error: Permission denied (os error 13)'), 'ruff-input-skipped'],
  // CLICOLOR_FORCE / FORCE_COLOR make Ruff colour the prefix; the notice must still be seen.
  ['stderr: coloured unreadable-directory warning', done(0, '[]', '\u001b[1;33mwarning\u001b[0m\u001b[1m:\u001b[0m \u001b[1mEncountered error:\u001b[0m Permission denied (os error 13)'), 'ruff-input-skipped'],
  ['stderr: coloured panic error', done(1, one('F401'), '\u001b[1;31merror\u001b[0m\u001b[1m:\u001b[0m Panicked while linting /p/b.py'), 'ruff-input-skipped'],
  ['stderr: coloured harmless notice still passes', done(1, one('F401'), '\u001b[1;33mwarning\u001b[0m\u001b[1m:\u001b[0m The top-level linter settings are deprecated'), 'evidence'],
  ['exit 2, coloured unknown selector', done(2, '', "\u001b[1;31merror\u001b[0m: invalid value 'ZZ999' for '--select <RULE_CODE>'"), 'ruff-unknown-rule'],
  ['stderr: any unknown warning', done(1, one('F401'), 'warning: something Ruff added in a future release'), 'ruff-input-skipped'],
  ['stderr: incompatible pair drops the exact code a Gate selected (D203 never ran)', done(0, '[]', 'warning: `unused-import` (F401) and `other-rule` (F402) are incompatible. Ignoring `unused-import`.'), 'ruff-input-skipped'],
  ['stderr: incompatible pair drops a code nobody selected exactly', done(0, '[]', 'warning: `incorrect-blank-line-before-class` (D203) and `blank-line-before-class` (D211) are incompatible. Ignoring `incorrect-blank-line-before-class`.'), 'evidence'],
  ['stderr: incompatible pair, the selected code is the one kept (old code-only wording)', done(0, '[]', 'warning: `F402` and `F401` are incompatible. Ignoring `F402`.'), 'evidence'],
  ['stderr: incompatible pair, old code-only wording, selected code dropped', done(0, '[]', 'warning: `F401` and `F402` are incompatible. Ignoring `F401`.'), 'ruff-input-skipped'],
  ['stderr: two known-harmless notices', done(1, one('F401'), "warning: `D203` and `D211` are incompatible. Ignoring `D203`.\nwarning: The top-level linter settings are deprecated in favour of lint"), 'evidence'],
  ['stderr: malformed noqa comment (findings still reported)', done(1, one('F401'), 'warning: Invalid `# noqa` directive on /p/a.py:5: expected a comma-separated list of codes'), 'evidence'],
  ['stderr: a Ruff panic on one file (Ruff skips it and exits on)', done(1, one('F401'), 'error: Panicked while linting /p/b.py: This indicates a bug in Ruff.'), 'ruff-input-skipped'],
  ['stderr: unknown rule code inside a noqa comment', done(1, one('F401'), 'warning: Invalid rule code provided to `# noqa` at /p/a.py:3: RUF950'), 'evidence'],
  ['stderr: harmless warning', done(1, one('F401'), 'warning: The top-level linter settings are deprecated'), 'evidence'],
  ['the command timed out', refused('command-timeout'), 'command-timeout'],
  ['output limit reached', refused('command-output-limit'), 'command-output-limit'],
];

test('a numeric prefix selector (F40) is as exposed as the exact code when Ruff drops a rule it covers; a family (F) is not', () => {
  const notice = done(0, '[]', 'warning: `unused-import` (F401) and `other-rule` (F402) are incompatible. Ignoring `unused-import`.');
  const decide = (selector: string) => codeOf(evaluateLint(1, notice, new Map([[selector, defineRule({ id: `ruff/${selector}`, description: 'x' })]]), f => f));
  assert.equal(decide('F40'), 'ruff-input-skipped');
  assert.equal(decide('F'), 'evidence');
});

for (const [name, exec, expected] of VERDICTS) {
  test(`lint verdict: ${name} -> ${expected}`, () => assert.equal(codeOf(lint(exec)), expected));
}

test('a listing that failed or timed out is judged by the same rules before any lint runs', () => {
  assert.equal(codeOf(judgeListing(done(2, '', 'error: bad config'))), 'ruff-config-error');
  assert.equal(codeOf(judgeListing(refused('command-timeout'))), 'command-timeout');
  assert.equal(codeOf(judgeListing(done(0, '/p/a.py\n', 'warning: Failed to lint b.py'))), 'ruff-input-skipped');
  assert.equal(codeOf(judgeListing(done(0, '', 'warning: No Python files found under the given path(s)'))), 'ruff-nothing-inspected');
});

const VERSIONS: ReadonlyArray<readonly [string, ReturnType<typeof done> | ReturnType<typeof refused>, string]> = [
  ['the floor', done(0, 'ruff 0.4.10\n'), 'ok'],
  ['current', done(0, 'ruff 0.17.5\n'), 'ok'],
  ['a future major', done(0, 'ruff 1.2.3\n'), 'ok'],
  ['one patch under the floor', done(0, 'ruff 0.4.9\n'), 'ruff-version-unsupported'],
  ['an old minor', done(0, 'ruff 0.1.15\n'), 'ruff-version-unsupported'],
  ['another tool', done(0, 'flake8 7.0.0\n'), 'ruff-version-unknown'],
  ['empty output', done(0, ''), 'ruff-version-unknown'],
  ['version command failed', done(2, 'ruff 0.17.5\n', 'error'), 'ruff-version-unknown'],
  ['binary missing', refused('command-unavailable'), 'command-unavailable'],
];
for (const [name, exec, expected] of VERSIONS) {
  test(`version gate: ${name} -> ${expected}`, () => assert.equal(checkVersion(exec)?.code ?? 'ok', expected));
}

test('environment: only the output variables conflict, and the refusal names every one set', () => {
  assert.equal(environmentRefusal({}), undefined);
  assert.equal(environmentRefusal({ RUFF_NO_CACHE: 'true', RUFF_CACHE_DIR: '/x', PATH: '/bin' }), undefined);
  assert.equal(environmentRefusal({ RUFF_OUTPUT_FORMAT: undefined }), undefined);
  const both = environmentRefusal({ RUFF_OUTPUT_FILE: '/x', RUFF_OUTPUT_FORMAT: 'text' });
  assert.equal(both?.code, 'ruff-environment-conflict');
  assert.match(both?.detail ?? '', /RUFF_OUTPUT_FILE, RUFF_OUTPUT_FORMAT/u);
});

// ---- Sequencing: the order of a check is a decision, so it is tested with a recording runner.
type Call = string;
function recorder(replies: Record<string, Parameters<typeof evaluateLint>[1]>) {
  const calls: Call[] = [];
  const run = async (args: readonly string[]) => {
    const step = args.includes('--version') ? 'version' : args.includes('--show-files') ? 'list' : 'lint';
    calls.push(step);
    return replies[step] ?? done(0, '');
  };
  return { calls, run };
}
const plan: RuffPlan = { selectors: ['F401'], paths: ['.'] };
const ok = { version: done(0, 'ruff 0.17.5\n'), list: done(0, '/p/a.py\n'), lint: done(1, one('F401')) };
const sequence = async (replies: Record<string, Parameters<typeof evaluateLint>[1]>, env: Record<string, string> = {}) => {
  const { calls, run } = recorder(replies);
  const decision = await decideRuff({ env, plan, run, selected, displayPath: f => f });
  return { calls, decision };
};

test('sequence: a clean run asks version, then the listing, then the lint, once each, in that order', async () => {
  const { calls, decision } = await sequence(ok);
  assert.deepEqual(calls, ['version', 'list', 'lint']);
  assert.equal(decision.kind, 'evidence');
});

test('sequence: nothing runs when the environment conflicts', async () => {
  const { calls, decision } = await sequence(ok, { RUFF_OUTPUT_FILE: '/x' });
  assert.deepEqual(calls, []);
  assert.equal(codeOf(decision), 'ruff-environment-conflict');
});

test('sequence: an unsupported version stops before the listing', async () => {
  const { calls, decision } = await sequence({ ...ok, version: done(0, 'ruff 0.4.9\n') });
  assert.deepEqual(calls, ['version']);
  assert.equal(codeOf(decision), 'ruff-version-unsupported');
});

test('sequence: a failed or empty listing stops before the lint', async () => {
  for (const [list, code] of [[done(2, '', 'error: bad'), 'ruff-config-error'], [done(0, ''), 'ruff-nothing-inspected'], [refused('command-timeout'), 'command-timeout']] as const) {
    const { calls, decision } = await sequence({ ...ok, list });
    assert.deepEqual(calls, ['version', 'list'], code);
    assert.equal(codeOf(decision), code);
  }
});

test('sequence: a refused lint is a REFUSE, not a pass', async () => {
  const { decision } = await sequence({ ...ok, lint: refused('command-output-limit') });
  assert.equal(codeOf(decision), 'command-output-limit');
});

// ---- Arguments: the flags that keep a check honest, tested without running Ruff.
test('arguments: the listing and the lint see the same files; the lint alone asks for JSON and noqa behavior', () => {
  const full: RuffPlan = { selectors: ['F401', 'S'], paths: ['src', '-odd.py'], configFile: '/r/ruff.toml', isolated: false, preview: true, ignoreNoqa: true };
  const list = ruffListArguments(full), lintArgs = ruffLintArguments(full);
  for (const args of [list, lintArgs]) {
    for (const flag of ['--no-fix', '--no-cache', '--preview']) assert.ok(args.includes(flag), flag);
    assert.equal(args[args.indexOf('--select') + 1], 'F401,S');
    assert.deepEqual(args.slice(args.indexOf('--config'), args.indexOf('--config') + 2), ['--config', '/r/ruff.toml']);
    assert.deepEqual(args.slice(args.indexOf('--') + 1), ['src', '-odd.py'], 'paths come after -- so a leading dash is a file');
  }
  assert.ok(!list.includes('--ignore-noqa'), 'Ruff rejects --ignore-noqa beside --show-files');
  assert.ok(lintArgs.includes('--ignore-noqa'));
  assert.ok(list.includes('--show-files') && !lintArgs.includes('--show-files'));
  assert.deepEqual(lintArgs.slice(lintArgs.indexOf('--output-format'), lintArgs.indexOf('--output-format') + 2), ['--output-format', 'json']);
  assert.ok(!ruffLintArguments({ selectors: ['F'], paths: ['.'] }).some(a => ['--isolated', '--preview', '--ignore-noqa', '--config'].includes(a)), 'off by default');
  assert.ok(ruffLintArguments({ selectors: ['F'], paths: ['.'], isolated: true }).includes('--isolated'));
});

test('named paths: every requested path must account for a listed file', () => {
  const listing = done(0, '/r/src/a.py\n/r/src/deep/b.py\n/r/ruff.toml\n');
  const verdict = (requested: string[]) => codeOf(judgeListing(listing, requested));
  assert.deepEqual(judgeListing(listing, ['/r/src']), { kind: 'continue', inspected: 2 });
  assert.deepEqual(judgeListing(listing, ['/r/src/a.py', '/r/src/deep']), { kind: 'continue', inspected: 2 });
  assert.equal(verdict(['/r/src/a.py', '/r/src/c.py']), 'ruff-path-excluded', 'a named file the listing dropped');
  assert.equal(verdict(['/r/srcx']), 'ruff-path-excluded', 'a path that is not in the listing');
  assert.equal(codeOf(judgeListing(done(0, '/r/srcx/a.py\n'), ['/r/src'])), 'ruff-path-excluded', 'a sibling that merely shares a prefix is not under the path');
  assert.equal(verdict(['/r/src', '/r/other']), 'ruff-path-excluded');
  assert.deepEqual(judgeListing(listing), { kind: 'continue', inspected: 2 }, 'no named paths, nothing to account for');
});

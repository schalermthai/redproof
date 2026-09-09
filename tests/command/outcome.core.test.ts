import assert from 'node:assert/strict';
import test from 'node:test';
import { breach, defineRule, fail, pass, refuse, type Scan } from 'redproof';
import { exitPolicy } from '../../packages/redproof/src/command/core/exit-codes.ts';
import {
  aggregateResults,
  commandResult,
  commandScan,
  cwdOutsideRoot,
  isInsideRoot,
  outputDetail,
} from '../../packages/redproof/src/command/core/outcome.ts';

const rule = defineRule({ id: 'command/succeeds', description: 'The command must succeed.' });
const second = defineRule({ id: 'command/second-succeeds', description: 'The second command must succeed.' });

const scan: Scan = { source: 'lint', startedAt: 't0', finishedAt: 't1', inspected: 1 };
const groupScan: Scan = { source: 'lint, tsc', startedAt: 't0', finishedAt: 't2', inspected: 2 };
const defaults = exitPolicy(undefined);
const explicit = exitPolicy({ pass: [0], breach: [1] });

test('a scan records the source, the times, and the inspected count as given', () => {
  assert.deepEqual(commandScan('lint', 't0', 't1', 3), { source: 'lint', startedAt: 't0', finishedAt: 't1', inspected: 3 });
});

test('a passing exit produces PASS and does not forward the captured output', () => {
  const execution = { kind: 'completed', exitCode: 0, stdout: 'noise', stderr: 'warnings' } as const;

  assert.deepEqual(commandResult(rule, 'lint', defaults, execution, scan), pass(scan));
});

test('a breaching exit targets the Rule and carries the exit code and both output streams', () => {
  const execution = { kind: 'completed', exitCode: 3, stdout: 'out', stderr: 'err' } as const;

  assert.deepEqual(commandResult(rule, 'lint', defaults, execution, scan), fail(scan, [
    breach(rule, {
      code: 'command-exit',
      message: 'lint exited with code 3.',
      location: null,
      detail: 'exit code: 3\n\nstdout:\nout\n\nstderr:\nerr',
    }),
  ]));
});

test('a breaching exit without output still records the exit code', () => {
  const execution = { kind: 'completed', exitCode: 1, stdout: '', stderr: '' } as const;
  const outcome = commandResult(rule, 'lint', defaults, execution, scan);

  assert.equal(outcome.verdict, 'fail');
  if (outcome.verdict !== 'fail') return;
  assert.equal(outcome.breaches[0].detail, 'exit code: 1');
});

test('an exit code outside an explicit policy is REFUSE, not a Breach', () => {
  const execution = { kind: 'completed', exitCode: 2, stdout: '', stderr: 'usage' } as const;

  assert.deepEqual(commandResult(rule, 'lint', explicit, execution, scan), refuse(scan, {
    code: 'command-exit-unclassified',
    message: 'lint exited with unclassified code 2.',
    location: null,
    detail: 'exit code: 2\n\nstderr:\nusage',
  }));
});

test('a refused execution keeps its own code and message, and carries detail only when it has one', () => {
  const withDetail = commandResult(rule, 'lint', defaults, {
    kind: 'refused', code: 'command-timeout', message: 'lint exceeded its 5ms timeout.', detail: 'stdout:\npartial',
  }, scan);
  const withoutDetail = commandResult(rule, 'lint', defaults, {
    kind: 'refused', code: 'command-unavailable', message: 'Could not start lint.',
  }, scan);

  assert.deepEqual(withDetail, refuse(scan, {
    code: 'command-timeout', message: 'lint exceeded its 5ms timeout.', location: null, detail: 'stdout:\npartial',
  }));
  assert.deepEqual(withoutDetail, refuse(scan, {
    code: 'command-unavailable', message: 'Could not start lint.', location: null,
  }));
  assert.equal('detail' in withoutDetail.why, false);
});

test('output detail lists the prefix, then stdout, then stderr, and omits empty sections', () => {
  assert.equal(outputDetail('out', 'err', 'exit code: 1'), 'exit code: 1\n\nstdout:\nout\n\nstderr:\nerr');
  assert.equal(outputDetail('out', ''), 'stdout:\nout');
  assert.equal(outputDetail('', 'err'), 'stderr:\nerr');
  assert.equal(outputDetail('', '', 'exit code: 1'), 'exit code: 1');
  assert.equal(outputDetail('', ''), undefined);
});

test('a working directory is inside the root only when it is the root or below it', () => {
  assert.equal(isInsideRoot('/repo', '/repo'), true);
  assert.equal(isInsideRoot('/repo', '/repo/packages/app'), true);
  assert.equal(isInsideRoot('/repo', '/'), false);
  assert.equal(isInsideRoot('/repo', '/repo-other'), false);
  assert.equal(isInsideRoot('/repo/packages', '/repo'), false);
  assert.equal(isInsideRoot('/repo', '/elsewhere/repo'), false);
});

test('a working directory outside the root is a refusal that names the directory', () => {
  assert.deepEqual(cwdOutsideRoot(scan, 'lint', '/elsewhere'), refuse(scan, {
    code: 'command-cwd-outside-root',
    message: 'The working directory for lint resolves outside the Gate root.',
    location: null,
    detail: '/elsewhere',
  }));
});

const lintBreach = breach(rule, { code: 'command-exit', message: 'lint exited with code 1.', location: null });
const tscBreach = breach(second, { code: 'command-exit', message: 'tsc exited with code 2.', location: null });
const unavailable = { code: 'command-unavailable', message: 'Could not start docs.', location: null } as const;
const timedOut = { code: 'command-timeout', message: 'tsc exceeded its 5ms timeout.', location: null } as const;

test('a group of passing commands passes under the group scan', () => {
  assert.deepEqual(aggregateResults([pass(scan), pass(scan)], groupScan), pass(groupScan));
});

test('a group carries every Breach in declaration order, whatever each command reported', () => {
  const outcomes = [fail(scan, [lintBreach]), pass(scan), fail(scan, [tscBreach])];

  assert.deepEqual(aggregateResults(outcomes, groupScan), fail(groupScan, [lintBreach, tscBreach]));
});

test('the first REFUSE in declaration order wins over every Breach', () => {
  const outcomes = [fail(scan, [lintBreach]), refuse(scan, unavailable), refuse(scan, timedOut), fail(scan, [tscBreach])];

  assert.deepEqual(aggregateResults(outcomes, groupScan), refuse(groupScan, unavailable));
});

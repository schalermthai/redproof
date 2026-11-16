import assert from 'node:assert/strict';
import test from 'node:test';
import { defineGate, runGate } from 'redproof';
import { deptry } from '../src/index.ts';
import { fakeDeptry, header, withProject } from './support/workspace.ts';

const PROJECT = { 'pyproject.toml': '[project]\nname="d"\nversion="0.1"\ndependencies=[]\n', 'a.py': 'import white\n' };
const FINDING = JSON.stringify([{ error: { code: 'DEP001', message: 'm' }, module: 'white', location: { file: 'a.py', line: 1, column: 8 } }]);
const CODES = ['DEP001', 'DEP002', 'DEP003', 'DEP004', 'DEP005'] as const;

type Run = { report: string | null; stderr: string; exitCode: number; behaviour?: 'hang' | 'kill'; timeoutMs?: number };

/** Every rule alone, through `runGate`: what the Gate says when deptry ends the way `run` describes. */
async function verdicts(run: Run): Promise<readonly string[]> {
  return withProject(PROJECT, async root => {
    const command = await fakeDeptry(root, run);
    const all: string[] = [];
    for (const code of CODES) {
      const adapter = deptry({ command, rules: { r: code }, ...(run.timeoutMs ? { timeoutMs: run.timeoutMs } : {}) } as never);
      const verdict = await runGate(defineGate({ id: 'd', adapter: adapter as never }), root);
      all.push(verdict.verdict === 'refuse' ? `refuse:${verdict.why.code}` : verdict.verdict);
    }
    return all;
  });
}
const every = (code: string): readonly string[] => CODES.map(() => `refuse:${code}`);

test('REFUSE, never PASS: deptry that does not finish', async () => {
  assert.deepEqual(await verdicts({ report: null, stderr: header(1), exitCode: 0, behaviour: 'hang', timeoutMs: 700 }), every('command-timeout'));
  assert.deepEqual(await verdicts({ report: '[]', stderr: header(1), exitCode: 0, behaviour: 'kill' }), every('command-signaled'));
  assert.deepEqual(await verdicts({ report: '[]', stderr: header(1), exitCode: 137 }), every('deptry-unsuccessful'));
  assert.deepEqual(await verdicts({ report: '[]', stderr: header(1), exitCode: 139 }), every('deptry-unsuccessful'));
});

test('REFUSE, never PASS: a crash leaves no report, an empty one, or half of one', async () => {
  const crash = 'Traceback (most recent call last):\nValueError: boom\n';
  assert.deepEqual(await verdicts({ report: null, stderr: crash, exitCode: 1 }), every('deptry-report-unavailable'));
  assert.deepEqual(await verdicts({ report: null, stderr: crash, exitCode: 0 }), every('deptry-report-unavailable'));
  assert.deepEqual(await verdicts({ report: '', stderr: header(1), exitCode: 0 }), every('deptry-report-invalid'));
  assert.deepEqual(await verdicts({ report: '', stderr: header(1), exitCode: 1 }), every('deptry-report-invalid'));
  assert.deepEqual(await verdicts({ report: FINDING.slice(0, 40), stderr: header(1), exitCode: 1 }), every('deptry-report-invalid'));
  assert.deepEqual(await verdicts({ report: '{"error":1}', stderr: header(1), exitCode: 1 }), every('deptry-report-invalid'));
  assert.deepEqual(await verdicts({ report: '[{}]', stderr: header(1), exitCode: 1 }), every('deptry-report-invalid'));
});

test('REFUSE, never PASS: exit codes deptry does not document as findings', async () => {
  for (const exitCode of [2, 3, 126, 127, 255]) {
    const got = await verdicts({ report: FINDING, stderr: header(1), exitCode });
    assert.ok(got.every(v => v.startsWith('refuse:deptry-')), `exit ${exitCode}: ${got.join(' ')}`);
  }
});

test('REFUSE, never PASS: nothing inspected, or the exit code and report disagree', async () => {
  assert.deepEqual(await verdicts({ report: '[]', stderr: header(0), exitCode: 0 }), every('deptry-nothing-inspected'));
  assert.deepEqual(await verdicts({ report: FINDING, stderr: header(1), exitCode: 0 }), every('deptry-report-inconsistent'));
  assert.deepEqual(await verdicts({ report: '[]', stderr: header(1), exitCode: 1 }), every('deptry-report-inconsistent'));
});

test('a real breach still FAILS and a clean exit 0 still PASSES through the stand-in', async () => {
  assert.deepEqual(await verdicts({ report: FINDING, stderr: header(1), exitCode: 1 }), ['fail', 'pass', 'pass', 'pass', 'pass']);
  assert.deepEqual(await verdicts({ report: '[]', stderr: header(1), exitCode: 0 }), ['pass', 'pass', 'pass', 'pass', 'pass']);
});

import assert from 'node:assert/strict';
import { chmod, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { defineGate, runGate } from 'redproof';
import { vulture } from '../src/index.ts';
import { VULTURE_KINDS } from '../src/core/model.ts';
import { fakeVulture, withProject } from './support/workspace.ts';

const PROJECT = { 'a.py': 'import os\n' };
const FINDING = "a.py:1: unused import 'os' (90% confidence)\n";
const SYNTAX = '/p/bad.py:1: invalid syntax at "def broken(:"\n';

type Run = { stdout: string; stderr: string; exitCode: number; behaviour?: 'hang' | 'kill'; timeoutMs?: number };

/** Every rule alone, through `runGate`: what the Gate says when vulture ends the way `run` describes. */
async function verdicts(run: Run, files: Readonly<Record<string, string>> = PROJECT): Promise<readonly string[]> {
  return withProject(files, async root => {
    const command = await fakeVulture(root, run);
    const all: string[] = [];
    for (const kind of VULTURE_KINDS) {
      const adapter = vulture({ command, rules: { r: kind }, ...(run.timeoutMs ? { timeoutMs: run.timeoutMs } : {}) } as never);
      const verdict = await runGate(defineGate({ id: 'v', adapter: adapter as never }), root);
      all.push(verdict.verdict === 'refuse' ? `refuse:${verdict.why.code}` : verdict.verdict);
    }
    return all;
  });
}
const every = (code: string): readonly string[] => VULTURE_KINDS.map(() => `refuse:${code}`);

test('REFUSE, never PASS: vulture that does not finish', async () => {
  assert.deepEqual(await verdicts({ stdout: '', stderr: '', exitCode: 0, behaviour: 'hang', timeoutMs: 700 }), every('command-timeout'));
  assert.deepEqual(await verdicts({ stdout: '', stderr: '', exitCode: 0, behaviour: 'kill' }), every('command-signaled'));
  assert.deepEqual(await verdicts({ stdout: '', stderr: '', exitCode: 137 }), every('vulture-unsuccessful'));
  assert.deepEqual(await verdicts({ stdout: FINDING, stderr: '', exitCode: 139 }), every('vulture-unsuccessful'));
});

test('REFUSE, never PASS: a crash, a truncated or foreign report, an exit that disagrees with the report', async () => {
  const trace = 'Traceback (most recent call last):\nValueError: min_confidence must be between 0 and 100.\n';
  assert.deepEqual(await verdicts({ stdout: '', stderr: trace, exitCode: 1 }), every('vulture-input-unread'));
  assert.deepEqual(await verdicts({ stdout: '', stderr: trace, exitCode: 0 }), every('vulture-input-unread'));
  assert.deepEqual(await verdicts({ stdout: FINDING.slice(0, 30), stderr: '', exitCode: 3 }), every('vulture-report-unrecognised'));
  assert.deepEqual(await verdicts({ stdout: 'Traceback (most recent call last):\n', stderr: '', exitCode: 0 }), every('vulture-report-unrecognised'));
  assert.deepEqual(await verdicts({ stdout: FINDING, stderr: '', exitCode: 0 }), every('vulture-report-inconsistent'));
  assert.deepEqual(await verdicts({ stdout: '', stderr: '', exitCode: 3 }), every('vulture-report-inconsistent'));
  assert.deepEqual(await verdicts({ stdout: '', stderr: '', exitCode: 1 }), every('vulture-input-invalid'));
});

test('REFUSE, never PASS: input vulture skipped, even when it also found things', async () => {
  assert.deepEqual(await verdicts({ stdout: '', stderr: SYNTAX, exitCode: 1 }), every('vulture-input-unread'));
  assert.deepEqual(await verdicts({ stdout: FINDING, stderr: SYNTAX, exitCode: 3 }), every('vulture-input-unread'));
});

test('REFUSE, never PASS: exit codes vulture does not document, and no Python file to read', async () => {
  for (const exitCode of [2, 4, 126, 127, 255]) {
    const got = await verdicts({ stdout: FINDING, stderr: '', exitCode });
    assert.ok(got.every(v => v.startsWith('refuse:vulture-')), `exit ${exitCode}: ${got.join(' ')}`);
  }
  assert.deepEqual(await verdicts({ stdout: '', stderr: '', exitCode: 0 }, { 'notes.txt': 'x' }), every('vulture-nothing-inspected'));
});

test('a real breach still FAILS and a clean exit 0 still PASSES through the stand-in', async () => {
  assert.deepEqual(await verdicts({ stdout: FINDING, stderr: '', exitCode: 3 }), ['fail', ...VULTURE_KINDS.slice(1).map(() => 'pass')]);
  assert.deepEqual(await verdicts({ stdout: '', stderr: '', exitCode: 0 }), VULTURE_KINDS.map(() => 'pass'));
});

async function one(root: string, options: Record<string, unknown>): Promise<string> {
  const verdict = await runGate(defineGate({ id: 'v', adapter: vulture({ rules: { r: 'unused-import' }, ...options } as never) as never }), root);
  return verdict.verdict === 'refuse' ? `refuse:${verdict.why.code}` : verdict.verdict;
}

test('a temp directory that cannot be removed turns a clean PASS into a REFUSE, and leaves a FAIL or a REFUSE as it was', () => withProject(PROJECT, async root => {
  const leftovers: string[] = [];
  const outcome = async (run: Run): Promise<string> => {
    const command = await fakeVulture(root, { ...run, lockTemp: true });
    const result = await one(root, { command });
    const temp = await readFile(join(root, 'temp-path.txt'), 'utf8');
    await chmod(join(temp, 'locked'), 0o755);
    leftovers.push(temp);
    return result;
  };
  try {
    assert.equal(await outcome({ stdout: '', stderr: '', exitCode: 0 }), 'refuse:vulture-cleanup-failed');
    assert.equal(await outcome({ stdout: FINDING, stderr: '', exitCode: 3 }), 'fail');
    assert.equal(await outcome({ stdout: '', stderr: SYNTAX, exitCode: 1 }), 'refuse:vulture-input-unread');
  } finally {
    for (const temp of leftovers) await rm(temp, { recursive: true, force: true });
  }
}));

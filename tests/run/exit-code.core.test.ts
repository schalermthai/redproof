import assert from 'node:assert/strict';
import test from 'node:test';
import type { CheckResult } from '../../packages/redproof/src/domain/index.ts';
import type { ProofOutcome } from '../../packages/redproof/src/proof/core/index.ts';
import { checkExitCode, proofExitCode } from '../../packages/redproof/src/run/core/exit-code.ts';

const scan = {
  source: 'unit',
  startedAt: '2026-01-01T00:00:00.000Z',
  finishedAt: '2026-01-01T00:00:01.000Z',
  inspected: 1,
};

const pass: CheckResult = { verdict: 'pass', scan };
const fail: CheckResult = {
  verdict: 'fail',
  scan,
  breaches: [{ rule: 'unit/r1', code: 'breach', message: 'R1 was breached.', location: null }],
};
const refuse: CheckResult = {
  verdict: 'refuse',
  scan,
  why: { code: 'unavailable', message: 'The Check could not run.', location: null },
};

test('a Check run where every Gate passes exits 0', () => {
  assert.equal(checkExitCode([pass], 2), 0);
  assert.equal(checkExitCode([pass, pass, pass], 2), 0);
});

test('a failed Gate exits 1 whatever refusalExit is', () => {
  assert.equal(checkExitCode([pass, fail], 2), 1);
  assert.equal(checkExitCode([fail, pass], 7), 1);
});

test('a refused Gate exits refusalExit even beside a failure, in any order', () => {
  assert.equal(checkExitCode([refuse], 2), 2);
  assert.equal(checkExitCode([pass, fail, refuse], 2), 2);
  assert.equal(checkExitCode([refuse, fail, pass], 7), 7);
});

const identity = { gate: 'unit', workerPid: 4242 };

const provedRed: ProofOutcome = {
  status: 'completed',
  ...identity,
  proof: 'red',
  expected: 'red',
  result: fail,
  reason: { kind: 'proved', target: 'unit/r1' },
};
const provedGreen: ProofOutcome = {
  status: 'completed',
  ...identity,
  proof: 'green',
  expected: 'green',
  result: pass,
  reason: { kind: 'proved' },
};
const mismatched: ProofOutcome = {
  status: 'completed',
  ...identity,
  proof: 'mismatched',
  expected: 'red',
  result: pass,
  reason: { kind: 'verdict-mismatch', expected: 'fail', actual: 'pass' },
};
const unrestored: ProofOutcome = {
  status: 'unrestored',
  ...identity,
  proof: 'unrestored',
  expected: 'red',
  result: fail,
  error: { code: 'workspace-not-restored', message: 'The workspace changed.' },
};
const aborted: ProofOutcome = {
  status: 'aborted',
  ...identity,
  proof: 'aborted',
  expected: 'green',
  error: { code: 'mutation-apply-failed', message: 'The mutation could not be applied.' },
};

test('a prove run exits 0 only when every proof is established', () => {
  assert.equal(proofExitCode([provedRed, provedGreen]), 0);
  assert.equal(proofExitCode([provedRed, mismatched, provedGreen]), 1);
  assert.equal(proofExitCode([provedGreen, unrestored]), 1);
  assert.equal(proofExitCode([aborted, provedRed]), 1);
});

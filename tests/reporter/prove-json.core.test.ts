import assert from 'node:assert/strict';
import test from 'node:test';
import type { CheckResult, CompletedProofOutcome, ProofOutcome } from 'redproof';
import { buildJsonProveReport, formatJsonProofs } from '../../packages/redproof/src/reporter/core/json.ts';
import { at, breach, fail, pass, proveRun, refuse } from './runs.ts';

function completed<E extends CompletedProofOutcome['expected']>(
  expected: E,
  reason: Extract<CompletedProofOutcome, { expected: E }>['reason'],
  result: CheckResult,
  gate = 'lint',
): ProofOutcome {
  return { status: 'completed', gate, proof: 'a var is flagged', expected, reason, result, workerPid: 7 } as CompletedProofOutcome;
}

const noVar = breach('lint/no-var', 'src/a.mjs:3: use let or const', at('src/a.mjs', 3), {
  code: 'no-var',
  detail: 'var is function scoped',
  hint: 'use const',
});
const why = { code: 'unavailable', message: 'No input', location: null };

test('the report names its version and command and takes its status from the exit code', () => {
  const outcome = completed('green', { kind: 'proved' }, pass());

  const passed = buildJsonProveReport(proveRun([outcome], 0));
  assert.equal(passed.version, 1);
  assert.equal(passed.command, 'prove');
  assert.equal(passed.status, 'passed');

  assert.equal(buildJsonProveReport(proveRun([outcome], 1)).status, 'failed');
});

test('an established proof is proved, and a completed proof that missed is not-proved', () => {
  const report = buildJsonProveReport(proveRun([
    completed('red', { kind: 'proved', target: 'lint/no-var' }, fail(noVar)),
    completed('red', { kind: 'verdict-mismatch', expected: 'fail', actual: 'pass' }, pass()),
    completed('refuse', { kind: 'proved' }, refuse(why)),
    completed('green', { kind: 'verdict-mismatch', expected: 'pass', actual: 'refuse' }, refuse(why)),
  ], 1));

  assert.deepEqual(report.proofs.map(item => item.status), ['proved', 'not-proved', 'proved', 'not-proved']);
});

test('each proof carries the Gate, the claim, what it expected, and the worker that ran it', () => {
  const [proof] = buildJsonProveReport(proveRun([
    completed('red', { kind: 'proved', target: 'lint/no-var' }, fail(noVar), 'architecture'),
  ], 1)).proofs;

  assert.equal(proof?.gate, 'architecture');
  assert.equal(proof?.proof, 'a var is flagged');
  assert.equal(proof?.expected, 'red');
  assert.equal(proof?.workerPid, 7);
});

test('a completed proof states how it was judged and what the Check found', () => {
  const report = buildJsonProveReport(proveRun([
    completed('red', { kind: 'target-rule-not-breached', target: 'lint/no-var', breached: ['lint/no-let'] }, fail(noVar)),
    completed('refuse', { kind: 'proved' }, refuse({ ...why, hint: 'Give it input.' })),
    completed('green', { kind: 'proved' }, pass()),
  ], 1));

  assert.deepEqual(report.proofs[0]?.reason, { kind: 'target-rule-not-breached', target: 'lint/no-var', breached: ['lint/no-let'] });
  assert.deepEqual(report.proofs[0]?.check, {
    verdict: 'fail',
    breaches: [{
      rule: 'lint/no-var',
      code: 'no-var',
      message: 'src/a.mjs:3: use let or const',
      location: { file: 'src/a.mjs', line: 3, column: null },
      detail: 'var is function scoped',
      hint: 'use const',
    }],
  });

  assert.deepEqual(report.proofs[1]?.reason, { kind: 'proved' });
  assert.deepEqual(report.proofs[1]?.check, {
    verdict: 'refuse',
    refusal: { code: 'unavailable', message: 'No input', location: null, hint: 'Give it input.' },
  });

  assert.deepEqual(report.proofs[2]?.check, { verdict: 'pass' });
});

test('an aborted proof is an infrastructure error with no judgement and no Check result', () => {
  const aborted: ProofOutcome = {
    status: 'aborted',
    gate: 'lint',
    proof: 'a var is flagged',
    expected: 'green',
    error: { code: 'mutation-apply-failed', message: 'Mutation could not be applied.', detail: 'src/a.mjs is missing' },
    workerPid: 11,
  };

  const [proof] = buildJsonProveReport(proveRun([aborted], 1)).proofs;
  assert.equal(proof?.status, 'infrastructure-error');
  assert.deepEqual(proof?.error, {
    code: 'mutation-apply-failed',
    message: 'Mutation could not be applied.',
    detail: 'src/a.mjs is missing',
  });
  assert.equal(proof && 'reason' in proof, false);
  assert.equal(proof && 'check' in proof, false);
});

test('an unrestored proof is an infrastructure error that still reports what the Check found', () => {
  const unrestored: ProofOutcome = {
    status: 'unrestored',
    gate: 'workspace',
    proof: 'restores the mutation',
    expected: 'red',
    error: { code: 'workspace-not-restored', message: 'The workspace changed.' },
    result: fail(noVar),
    workerPid: 12,
  };

  const [proof] = buildJsonProveReport(proveRun([unrestored], 1)).proofs;
  assert.equal(proof?.status, 'infrastructure-error');
  assert.deepEqual(proof?.error, { code: 'workspace-not-restored', message: 'The workspace changed.' });
  assert.equal(proof?.check?.verdict, 'fail');
  assert.equal(proof && 'reason' in proof, false);
});

test('the formatted document is the report, indented by default and compact on request', () => {
  const source = proveRun([completed('green', { kind: 'proved' }, pass())], 0);
  const report = buildJsonProveReport(source);

  const pretty = formatJsonProofs(source);
  assert.deepEqual(JSON.parse(pretty), report);
  assert.match(pretty, /^\{\n  "version": 1,\n/);

  const compact = formatJsonProofs(source, { pretty: false });
  assert.deepEqual(JSON.parse(compact), report);
  assert.equal(compact.includes('\n'), false);
});

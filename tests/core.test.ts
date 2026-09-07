import assert from 'node:assert/strict';
import test from 'node:test';
import {
  breach,
  counting,
  defineAdapter,
  fail,
  pass,
  proof,
  refuse,
  type CountingCapability,
  type Scan,
} from 'redproof';
import { resolveConfig } from '../packages/redproof/src/composition/config.ts';
import { executionPolicy } from '../packages/redproof/src/run/core/policy.ts';
import { checkExitCode, proofExitCode } from '../packages/redproof/src/run/core/exit-code.ts';
import { evaluateProof } from '../packages/redproof/src/proof/core/evaluation.ts';
import type { ProofOutcome } from '../packages/redproof/src/proof/core/outcome.ts';
import { canReuseWorkspace, verifyProofRestoration } from '../packages/redproof/src/proof/core/restoration.ts';
import { buildGateReportModel, summarizeGateReports } from '../packages/redproof/src/reporter/model.ts';
import { assessFreshness } from '../packages/redproof/src/workspace/core/freshness.ts';


const scan: Scan = {
  source: 'unit',
  startedAt: '',
  finishedAt: '',
  inspected: 1,
};

const R1 = { id: 'r1', description: 'R1' } as const;
const R2 = { id: 'r2', description: 'R2' } as const;
const noop = { description: 'noop', async apply() { return async () => {}; } };

function adapter(countingCapability: CountingCapability = counting.supported) {
  return defineAdapter({
    kind: 'unit',
    rules: { r1: R1, r2: R2 },
    check: {
      description: 'not executed by these tests',
      counting: countingCapability,
      async run() { return pass(scan); },
    },
  });
}

test('a config with no execution block defaults to copies', () => {
  assert.deepEqual(resolveConfig({}).execution, { mode: 'copies', maxAtOnce: 4 });
  assert.deepEqual(resolveConfig({ root: 'x' }).execution, { mode: 'copies', maxAtOnce: 4 });
});

test('an explicit execution block overrides the default', () => {
  assert.deepEqual(
    resolveConfig({ execution: { mode: 'in-place' } }).execution,
    { mode: 'in-place' },
  );

  assert.deepEqual(
    resolveConfig({ execution: { mode: 'copies', maxAtOnce: 2 } }).execution,
    { mode: 'copies', maxAtOnce: 2 },
  );
});

test('execution policy makes in-place serial and copies Gate-parallel', () => {
  assert.deepEqual(executionPolicy({ mode: 'in-place' }), {
    mode: 'in-place',
    maxAtOnce: 1,
    workspace: 'original',
    process: 'coordinator',
  });

  assert.deepEqual(executionPolicy({ mode: 'copies', maxAtOnce: 3 }), {
    mode: 'copies',
    maxAtOnce: 3,
    workspace: 'gate-copy',
    process: 'child',
  });
});

test('RED proof requires its target Rule, not merely a failed Gate', () => {
  const result = fail(scan, [
    breach(R2.id, { code: 'r2', message: 'R2 failed', location: null }),
  ]);

  assert.deepEqual(evaluateProof(proof.red(R1, 'prove R1', noop), result), {
    kind: 'target-rule-not-breached',
    target: 'r1',
    breached: ['r2'],
  });
});

test('proof evaluation distinguishes verdict mismatch from success', () => {
  assert.deepEqual(evaluateProof(proof.green('green'), pass(scan)), { kind: 'proved' });
  assert.deepEqual(evaluateProof(proof.green('green'), refuse(scan, {
    code: 'no-input', message: 'No input', location: null,
  })), {
    kind: 'verdict-mismatch',
    expected: 'pass',
    actual: 'refuse',
  });
});

test('freshness comparison is pure and checks both digest and entry count', () => {
  assert.deepEqual(
    assessFreshness({ digest: 'abcdef', entries: 2 }, { digest: 'abcdef', entries: 2 }),
    { kind: 'fresh' },
  );

  assert.deepEqual(
    assessFreshness({ digest: 'abcdef', entries: 2 }, { digest: 'abcdef', entries: 3 }),
    { kind: 'stale', why: 'workspace changed from abcdef to abcdef' },
  );
});

test('freshness diagnostics identify added, removed, and modified paths', () => {
  const freshness = assessFreshness(
    {
      digest: 'before',
      entries: 2,
      fingerprints: { 'removed.ts': 'old', 'modified.ts': 'old' },
    },
    {
      digest: 'after',
      entries: 2,
      fingerprints: { 'added.ts': 'new', 'modified.ts': 'new' },
    },
  );

  assert.deepEqual(freshness, {
    kind: 'stale',
    why: 'workspace changed from before to after; changed paths: added added.ts, modified modified.ts, removed removed.ts',
  });
});

test('restoration failure replaces proof success and prevents copy reuse', () => {
  const result = pass(scan);
  const completed: ProofOutcome = {
    status: 'completed',
    gate: 'g',
    proof: 'p',
    expected: 'green',
    ok: true,
    result,
    workerPid: 10,
  };

  const outcome = verifyProofRestoration(
    completed,
    { kind: 'stale', why: 'workspace changed' },
    10,
  );

  assert.equal(outcome.status, 'error');
  assert.equal(outcome.ok, false);
  if (outcome.status !== 'error') throw new Error('expected error');
  assert.equal(outcome.error.code, 'workspace-not-restored');
  assert.equal(canReuseWorkspace(outcome), false);
});

test('report model does not claim unknown Rules hold for non-countable failures', () => {
  const model = buildGateReportModel(
    adapter(counting.unsupported('only first finding is observable')),
    fail(scan, [breach(R1.id, { code: 'r1', message: 'R1 failed', location: null })]),
  );

  assert.deepEqual(model.rules.map(item => [item.rule.id, item.state.kind]), [
    ['r1', 'breached'],
    ['r2', 'unknown'],
  ]);
});

test('run summary is derived from Gate report models without I/O', () => {
  const a = buildGateReportModel(adapter(), pass(scan));
  const b = buildGateReportModel(adapter(), fail(scan, [
    breach(R1.id, { code: 'r1', message: 'R1 failed', location: null }),
  ]));
  const c = buildGateReportModel(adapter(), refuse(scan, {
    code: 'unavailable', message: 'Unavailable', location: null,
  }));

  assert.deepEqual(summarizeGateReports([a, b, c]), {
    passedGates: 1,
    failedGates: 1,
    refusedGates: 1,
    heldRules: 3,
    breachedRules: 1,
    undecidedRules: 2,
    unknownRules: 0,
    totalRules: 6,
    breaches: 1,
    exactBreachCount: true,
  });
});

test('exit-code policy is pure and REFUSE takes precedence over FAIL', () => {
  const failed = fail(scan, [breach(R1.id, { code: 'x', message: 'x', location: null })]);
  const refused = refuse(scan, { code: 'x', message: 'x', location: null });

  assert.equal(checkExitCode([pass(scan)], 7), 0);
  assert.equal(checkExitCode([failed], 7), 1);
  assert.equal(checkExitCode([failed, refused], 7), 7);
  assert.equal(proofExitCode([{ ok: true }, { ok: true }]), 0);
  assert.equal(proofExitCode([{ ok: true }, { ok: false }]), 1);
});

test('config resolution rejects an unknown option instead of ignoring it', () => {
  assert.throws(
    () => resolveConfig({ root: '.', refuseExit: 2 } as never),
    /Unknown config option: "refuseExit"\. Known options: root, gatesRoot, refusalExit, execution\./,
  );

  assert.throws(
    () => resolveConfig({ execution: { mode: 'copies', maxAtOne: 4 } } as never),
    /Unknown execution option: "maxAtOne"\. Known options: mode, maxAtOnce\./,
  );

  assert.throws(
    () => resolveConfig({ refuseExit: 2, gateRoot: 'g' } as never),
    /Unknown config options: "refuseExit", "gateRoot"/,
  );

  assert.doesNotThrow(() => resolveConfig({
    root: '.',
    gatesRoot: 'gates/**/*.ts',
    refusalExit: 2,
    execution: { mode: 'copies', maxAtOnce: 2 },
  }));
});

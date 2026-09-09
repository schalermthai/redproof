import assert from 'node:assert/strict';
import test from 'node:test';
import {
  breach,
  counting,
  defineAdapter,
  defineGate,
  fail,
  pass,
  proof,
  proofEstablished,
  refuse,
  runGate,
  runProof,
  type CheckContext,
  type Mutation,
  type Scan,
} from 'redproof';

const scan: Scan = {
  source: 'test',
  startedAt: '',
  finishedAt: '',
  inspected: 1,
};

const R1 = { id: 'r1', description: 'R1' } as const;
const R2 = { id: 'r2', description: 'R2' } as const;

type RuleId = 'r1' | 'r2';

type World = {
  breached: readonly RuleId[];
  refused: boolean;
  checkThrows: boolean;
  inspected: number | null;
  readonly contexts: CheckContext[];
  readonly log: string[];
};

function world(overrides: Partial<World> = {}): World {
  return { breached: [], refused: false, checkThrows: false, inspected: 1, contexts: [], log: [], ...overrides };
}

function gateOver(state: World, emptyEvidence: 'refuse' | 'allow' = 'refuse') {
  return defineGate({
    id: 'world',
    ...(emptyEvidence === 'allow' ? { policies: { emptyEvidence } } : {}),
    adapter: defineAdapter({
      kind: 'test',
      rules: { r1: R1, r2: R2 },
      check: {
        description: 'read the world',
        counting: counting.supported,
        async run(ctx) {
          state.contexts.push(ctx);
          if (state.checkThrows) throw new Error('check exploded');
          const checkScan = { ...scan, inspected: state.inspected };
          if (state.refused) return refuse(checkScan, { code: 'unavailable', message: 'Unavailable', location: null });
          const [first, ...rest] = state.breached.map(rule =>
            breach(rule, { code: rule, message: `${rule} breached`, location: null }));
          return first ? fail(checkScan, [first, ...rest]) : pass(checkScan);
        },
      },
    }),
  });
}

function breachRule(state: World, rule: RuleId): Mutation {
  return {
    description: `breach ${rule}`,
    async apply() {
      const before = state.breached;
      state.breached = [...before, rule];
      state.log.push(`apply ${rule}`);
      return async () => {
        state.breached = before;
        state.log.push(`undo ${rule}`);
      };
    },
  };
}

function setFlag(state: World, flag: 'refused' | 'checkThrows', undoFails = false): Mutation {
  return {
    description: `set ${flag}`,
    async apply() {
      state[flag] = true;
      state.log.push(`apply ${flag}`);
      return async () => {
        state[flag] = false;
        state.log.push(`undo ${flag}`);
        if (undoFails) throw new Error(`undo of ${flag} exploded`);
      };
    },
  };
}

const failingMutation: Mutation = {
  description: 'cannot apply',
  async apply() { throw new Error('cannot apply'); },
};

test('runGate hands the Check its root and every Rule of the Adapter', async () => {
  const state = world();
  const result = await runGate(gateOver(state), '/project');

  assert.equal(result.verdict, 'pass');
  assert.deepEqual(state.contexts, [{ root: '/project', rules: ['r1', 'r2'] }]);
});

test('runGate refuses a zero-inspected PASS by default and permits an explicit empty scope', async () => {
  const state = world({ inspected: 0 });

  const guarded = await runGate(gateOver(state), '/project');
  assert.equal(guarded.verdict, 'refuse');
  if (guarded.verdict !== 'refuse') throw new Error('expected refusal');
  assert.equal(guarded.why.code, 'nothing-inspected');

  const allowed = await runGate(gateOver(state, 'allow'), '/project');
  assert.equal(allowed.verdict, 'pass');
});

test('a RED proof runs its mutation, judges the mutated world, then restores it', async () => {
  const state = world();
  const outcome = await runProof(gateOver(state), proof.red(R1, 'prove R1', breachRule(state, 'r1')), '/project');

  assert.equal(outcome.status, 'completed');
  assert.equal(proofEstablished(outcome), true);
  assert.equal(outcome.status === 'completed' && outcome.result.verdict, 'fail');
  assert.deepEqual(state.log, ['apply r1', 'undo r1']);
  assert.deepEqual(state.breached, [], 'the world is back to its baseline');
});

test('a mutation plan is applied in order and undone in reverse order', async () => {
  const state = world();
  const plan = [breachRule(state, 'r1'), setFlag(state, 'refused'), breachRule(state, 'r2')];
  const outcome = await runProof(gateOver(state), proof.refuse('undo in reverse', plan), '/project');

  assert.equal(proofEstablished(outcome), true);
  assert.deepEqual(state.log, ['apply r1', 'apply refused', 'apply r2', 'undo r2', 'undo refused', 'undo r1']);
  assert.deepEqual(state.breached, []);
  assert.equal(state.refused, false);
});

test('a RED proof is not established when the Gate fails for another Rule', async () => {
  const state = world();
  const outcome = await runProof(gateOver(state), proof.red(R1, 'prove R1', breachRule(state, 'r2')), '/project');

  assert.equal(outcome.status, 'completed');
  assert.equal(proofEstablished(outcome), false);
  assert.equal(outcome.status === 'completed' && outcome.reason.kind, 'target-rule-not-breached');
  assert.deepEqual(state.log, ['apply r2', 'undo r2']);
});

test('a RED proof whose target is already breached runs only the baseline Check and never mutates', async () => {
  const state = world({ breached: ['r1'] });
  const outcome = await runProof(gateOver(state), proof.red(R1, 'prove R1 causally', breachRule(state, 'r1')), '/project');

  assert.equal(outcome.status, 'completed');
  assert.equal(proofEstablished(outcome), false);
  assert.equal(outcome.status === 'completed' && outcome.reason.kind, 'target-already-breached');
  assert.deepEqual(state.log, [], 'the mutation must never be applied');
  assert.equal(state.contexts.length, 1, 'only the baseline Check runs');
});

test('a GREEN proof needs no mutation and a REFUSE proof restores its mutation', async () => {
  const state = world();
  const green = await runProof(gateOver(state), proof.green('stays green'), '/project');
  assert.equal(proofEstablished(green), true);
  assert.deepEqual(state.log, []);

  const refused = await runProof(gateOver(state), proof.refuse('refuses', setFlag(state, 'refused')), '/project');
  assert.equal(proofEstablished(refused), true);
  assert.equal(refused.status === 'completed' && refused.result.verdict, 'refuse');
  assert.equal(state.refused, false);
});

test('a mutation that cannot be applied aborts the proof and undoes the mutations applied before it', async () => {
  const state = world();
  const outcome = await runProof(
    gateOver(state),
    proof.red(R1, 'prove R1', [breachRule(state, 'r1'), failingMutation, breachRule(state, 'r2')]),
    '/project',
  );

  assert.equal(outcome.status, 'aborted');
  if (outcome.status !== 'aborted') throw new Error('expected an aborted proof');
  assert.equal(outcome.error.code, 'mutation-apply-failed');
  assert.match(outcome.error.detail ?? '', /cannot apply/);
  assert.deepEqual(state.log, ['apply r1', 'undo r1']);
  assert.deepEqual(state.breached, []);
  assert.equal(state.contexts.length, 1, 'the Gate is not checked over a half-applied plan');
});

test('a Check that throws after mutation aborts the proof, and the mutation is undone', async () => {
  const state = world();
  const outcome = await runProof(gateOver(state), proof.green('sees the throw', setFlag(state, 'checkThrows')), '/project');

  assert.equal(outcome.status, 'aborted');
  if (outcome.status !== 'aborted') throw new Error('expected an aborted proof');
  assert.equal(outcome.error.code, 'check-threw');
  assert.doesNotMatch(outcome.error.message, /baseline/);
  assert.match(outcome.error.detail ?? '', /check exploded/);
  assert.deepEqual(state.log, ['apply checkThrows', 'undo checkThrows']);
  assert.equal(state.checkThrows, false);
});

test('a baseline Check that throws aborts a RED proof before any mutation', async () => {
  const state = world({ checkThrows: true });
  const outcome = await runProof(gateOver(state), proof.red(R1, 'prove R1', breachRule(state, 'r1')), '/project');

  assert.equal(outcome.status, 'aborted');
  if (outcome.status !== 'aborted') throw new Error('expected an aborted proof');
  assert.equal(outcome.error.code, 'check-threw');
  assert.match(outcome.error.message, /baseline/);
  assert.deepEqual(state.log, []);
});

test('an undo that fails leaves the proof unrestored and keeps the Check result', async () => {
  const state = world();
  const outcome = await runProof(gateOver(state), proof.green('undo fails', setFlag(state, 'refused', true)), '/project');

  assert.equal(outcome.status, 'unrestored');
  if (outcome.status !== 'unrestored') throw new Error('expected an unrestored proof');
  assert.equal(proofEstablished(outcome), false);
  assert.equal(outcome.error.code, 'mutation-restore-failed');
  assert.match(outcome.error.detail ?? '', /undo of refused exploded/);
  assert.equal(outcome.result.verdict, 'refuse');
});

test('a Check that throws and an undo that fails aborts as mutation-restore-failed without a result', async () => {
  const state = world();
  const outcome = await runProof(
    gateOver(state),
    proof.green('both fail', setFlag(state, 'checkThrows', true)),
    '/project',
  );

  assert.equal(outcome.status, 'aborted');
  if (outcome.status !== 'aborted') throw new Error('expected an aborted proof');
  assert.equal(outcome.error.code, 'mutation-restore-failed');
  assert.match(outcome.error.message, /Check threw/);
  assert.match(outcome.error.detail ?? '', /undo of checkThrows exploded/);
});

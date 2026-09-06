import assert from 'node:assert/strict';
import test from 'node:test';
import {
  breach,
  counting,
  defineAdapter,
  defineGate,
  fail,
  proof,
  runProof,
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

const gate = defineGate({
  id: 'multi-rule',
  adapter: defineAdapter({
    kind: 'test',
    rules: { r1: R1, r2: R2 },
    check: {
      description: 'check both test rules',
      counting: counting.supported,
      async run() {
        return fail(scan, [
          breach(R2.id, {
            code: 'r2',
            message: 'Only R2 was breached.',
            location: null,
          }),
        ]);
      },
    },
  }),
});

test('RED proof does not pass when the Gate fails for another Rule', async () => {
  const outcome = await runProof(
    gate,
    proof.red(R1, 'prove R1', {
      description: 'noop',
      async apply() { return async () => {}; },
    }),
    process.cwd(),
  );

  assert.equal(outcome.status, 'completed');
  if (outcome.status !== 'completed') throw new Error('expected completed proof');
  assert.equal(outcome.result.verdict, 'fail');
  assert.equal(outcome.ok, false);
});

test('RED proof does not pass when its target was already breached before mutation', async () => {
  let mutationApplied = false;
  const alreadyRedGate = defineGate({
    id: 'already-red',
    adapter: defineAdapter({
      kind: 'test',
      rules: { r1: R1 },
      check: {
        description: 'always breach R1',
        counting: counting.supported,
        async run() {
          return fail(scan, [
            breach(R1.id, {
              code: 'r1',
              message: 'R1 was already breached.',
              location: null,
            }),
          ]);
        },
      },
    }),
  });

  const outcome = await runProof(
    alreadyRedGate,
    proof.red(R1, 'prove R1 causally', {
      description: 'irrelevant mutation',
      async apply() {
        mutationApplied = true;
        return async () => {};
      },
    }),
    process.cwd(),
  );

  assert.equal(outcome.status, 'completed');
  if (outcome.status !== 'completed') throw new Error('expected completed proof');
  assert.equal(outcome.result.verdict, 'fail');
  assert.equal(outcome.ok, false);
  assert.equal(mutationApplied, false);
});

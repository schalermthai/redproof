import assert from 'node:assert/strict';
import test from 'node:test';
import { defineGate } from '../../packages/redproof/src/composition/core/gate.ts';
import { defineProofs, proof } from '../../packages/redproof/src/composition/core/proof.ts';
import type { Mutation, Scan } from '../../packages/redproof/src/domain/index.ts';

const scan: Scan = { source: 'proofs-core', startedAt: '', finishedAt: '', inspected: 1 };
const rules = { noTodo: { id: 'source/no-todo', description: 'No TODO comments.' } } as const;
const noop: Mutation = { description: 'noop', async apply() { return async () => {}; } };
const other: Mutation = { description: 'other', async apply() { return async () => {}; } };

const gate = defineGate({
  id: 'source-markers',
  rules,
  check: { description: 'check', counting: { kind: 'supported' }, async run() { return { verdict: 'pass', scan }; } },
});

test('a RED proof targets its Rule by id and keeps the name and mutation plan', () => {
  assert.deepEqual(proof.red(rules.noTodo, 'detects a TODO', noop), {
    expected: 'red',
    target: 'source/no-todo',
    name: 'detects a TODO',
    mutate: noop,
  });
  assert.deepEqual(proof.red(rules.noTodo, 'two steps', [noop, other]).mutate, [noop, other]);
});

test('a GREEN proof carries a mutation plan only when one was given', () => {
  assert.deepEqual(proof.green('accepts clean source'), { expected: 'green', name: 'accepts clean source' });
  assert.deepEqual(proof.green('still green after a harmless edit', noop), {
    expected: 'green',
    name: 'still green after a harmless edit',
    mutate: noop,
  });
});

test('a REFUSE proof keeps the name and the mutation plan', () => {
  assert.deepEqual(proof.refuse('refuses without config', noop), {
    expected: 'refuse',
    name: 'refuses without config',
    mutate: noop,
  });
});

test('defineProofs binds the proofs to their Gate in the order given', () => {
  const red = proof.red(rules.noTodo, 'red', noop);
  const green = proof.green('green');
  const suite = defineProofs(gate, [red, green]);

  assert.equal(suite.gate, gate);
  assert.deepEqual(suite.proofs, [red, green]);
});

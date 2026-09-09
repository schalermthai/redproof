import assert from 'node:assert/strict';
import test from 'node:test';
import { defineGate } from '../../packages/redproof/src/composition/core/gate.ts';
import type { Adapter, Check, Scan } from '../../packages/redproof/src/domain/index.ts';

const scan: Scan = { source: 'gate-core', startedAt: '', finishedAt: '', inspected: 1 };

const rules = {
  noTodo: { id: 'source/no-todo', description: 'No TODO comments.' },
  noFixme: { id: 'source/no-fixme', description: 'No FIXME comments.' },
} as const;

const check: Check<'source/no-todo' | 'source/no-fixme'> = {
  description: 'check source markers',
  counting: { kind: 'supported' },
  async run() { return { verdict: 'pass', scan }; },
};

const adapter: Adapter<typeof rules> = { kind: 'markers', rules, check };

test('a native Gate wraps the Rules and the Check it was given in a native Adapter', () => {
  const gate = defineGate({ id: 'source-markers', rules, check });

  assert.deepEqual(gate, {
    id: 'source-markers',
    adapter: { kind: 'native', rules, check },
  });
  assert.equal(gate.adapter.rules, rules, 'the alias catalog is the same object, so rules.noTodo stays usable');
  assert.equal(gate.adapter.check, check);
  assert.equal('policies' in gate, false, 'a Gate without policies carries no policies key');
});

test('a native Gate keeps the policies it was given', () => {
  const gate = defineGate({ id: 'optional', rules, check, policies: { emptyEvidence: 'allow' } });
  assert.deepEqual(gate.policies, { emptyEvidence: 'allow' });
});

test('an Adapter Gate is returned unchanged', () => {
  const definition = { id: 'adapter-gate', adapter, policies: { emptyEvidence: 'refuse' as const } };
  assert.equal(defineGate(definition), definition);
});

test('an unknown Gate option is rejected with the known options of that Gate form', () => {
  assert.throws(
    () => defineGate({ id: 'legacy', rules, check, allowEmptyInspection: true } as never),
    { message: 'Unknown Gate option: "allowEmptyInspection". Known options: id, rules, check, policies.' },
  );
  assert.throws(
    () => defineGate({ id: 'legacy-adapter', adapter, allowEmptyInspection: true } as never),
    { message: 'Unknown Gate option: "allowEmptyInspection". Known options: id, adapter, policies.' },
  );
});

test('an unknown policy or an emptyEvidence value outside refuse and allow is rejected', () => {
  assert.throws(
    () => defineGate({ id: 'typo', rules, check, policies: { emptyInspection: 'allow' } } as never),
    { message: 'Unknown policies option: "emptyInspection". Known options: emptyEvidence.' },
  );
  assert.throws(
    () => defineGate({ id: 'value', adapter, policies: { emptyEvidence: true } } as never),
    { message: "policies.emptyEvidence must be 'refuse' or 'allow'." },
  );
  assert.throws(
    () => defineGate({ id: 'value', adapter, policies: { emptyEvidence: 'yes' } } as never),
    { message: "policies.emptyEvidence must be 'refuse' or 'allow'." },
  );
});

test('both spellings of the empty-evidence policy and an empty policies block are accepted', () => {
  assert.equal(defineGate({ id: 'refuse', adapter, policies: { emptyEvidence: 'refuse' } }).policies?.emptyEvidence, 'refuse');
  assert.equal(defineGate({ id: 'allow', adapter, policies: { emptyEvidence: 'allow' } }).policies?.emptyEvidence, 'allow');
  assert.deepEqual(defineGate({ id: 'empty', rules, check, policies: {} }).policies, {});
});

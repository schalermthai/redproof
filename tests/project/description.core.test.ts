import assert from 'node:assert/strict';
import test from 'node:test';
import type { Gate, GatePolicies, Mutation, Proof } from '../../packages/redproof/src/domain/index.ts';
import { describeLoadedProject, describeModule } from '../../packages/redproof/src/project/core/description.ts';
import type { LoadedGateModule, LoadedProject } from '../../packages/redproof/src/project/core/discovery.ts';

const scan = {
  source: 'unit',
  startedAt: '2026-01-01T00:00:00.000Z',
  finishedAt: '2026-01-01T00:00:01.000Z',
  inspected: 1,
};

const first = { id: 'unit/first', description: 'First rule' } as const;
const second = { id: 'unit/second', description: 'Second rule' } as const;

function gateOf(id: string, policies?: GatePolicies): Gate<any> {
  return {
    id,
    adapter: {
      kind: 'unit',
      rules: { first, second },
      check: {
        description: 'inspect the unit',
        counting: { kind: 'supported' },
        async run() {
          return { verdict: 'pass', scan };
        },
      },
    },
    ...(policies ? { policies } : {}),
  };
}

function moduleOf(gate: Gate<any>, proofs?: readonly Proof<any>[]): LoadedGateModule {
  return proofs ? { file: `gates/${gate.id}.ts`, gate, proofs: { gate, proofs } } : { file: `gates/${gate.id}.ts`, gate };
}

function noop(description: string): Mutation {
  return { description, async apply() { return async () => {}; } };
}

test('rules are labelled R1, R2 in adapter order, beside the Gate id and the Check description', () => {
  const described = describeModule(moduleOf(gateOf('unit')));

  assert.equal(described.gate, 'unit');
  assert.equal(described.check, 'inspect the unit');
  assert.deepEqual(described.rules, [
    { label: 'R1', id: 'unit/first', description: 'First rule' },
    { label: 'R2', id: 'unit/second', description: 'Second rule' },
  ]);
  assert.deepEqual(described.proofs, []);
});

test('a RED proof names its target by label, or by raw id when the adapter does not own the Rule', () => {
  const described = describeModule(moduleOf(gateOf('unit'), [
    { expected: 'red', name: 'breaks second', target: 'unit/second', mutate: noop('edit') },
    { expected: 'red', name: 'breaks a foreign rule', target: 'other/rule', mutate: noop('edit') },
  ]));

  assert.deepEqual(described.proofs, [
    { kind: 'red', name: 'breaks second', targetLabel: 'R2', mutation: 'edit' },
    { kind: 'red', name: 'breaks a foreign rule', targetLabel: 'other/rule', mutation: 'edit' },
  ]);
});

test('mutation descriptions are joined in order, and a proof without a mutation carries none', () => {
  const described = describeModule(moduleOf(gateOf('unit'), [
    { expected: 'red', name: 'two edits', target: 'unit/first', mutate: [noop('add a file'), noop('remove a line')] },
    { expected: 'refuse', name: 'hides the tool', mutate: noop('rename the config') },
    { expected: 'green', name: 'clean baseline' },
  ]));

  assert.deepEqual(described.proofs, [
    { kind: 'red', name: 'two edits', targetLabel: 'R1', mutation: 'add a file; remove a line' },
    { kind: 'refuse', name: 'hides the tool', mutation: 'rename the config' },
    { kind: 'green', name: 'clean baseline' },
  ]);
});

test('the empty-evidence policy defaults to refuse and reports an explicit allow', () => {
  assert.deepEqual(describeModule(moduleOf(gateOf('strict'))).policies, { emptyEvidence: 'refuse' });
  assert.deepEqual(
    describeModule(moduleOf(gateOf('quiet', { emptyEvidence: 'allow' }))).policies,
    { emptyEvidence: 'allow' },
  );
});

test('a project description covers every discovered Gate in discovery order', () => {
  const project: LoadedProject = {
    root: '/work/project',
    refusalExit: 2,
    execution: { mode: 'in-place' },
    modules: [moduleOf(gateOf('alpha')), moduleOf(gateOf('beta'), [{ expected: 'green', name: 'ok' }])],
  };

  assert.deepEqual(
    describeLoadedProject(project).map(item => [item.gate, item.proofs.length]),
    [['alpha', 0], ['beta', 1]],
  );
});

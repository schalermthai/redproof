import assert from 'node:assert/strict';
import test from 'node:test';
import type { Gate, ProofSuite } from '../../packages/redproof/src/domain/index.ts';
import { gateFilesFrom, gateModuleFrom } from '../../packages/redproof/src/project/core/discovery.ts';

const scan = {
  source: 'unit',
  startedAt: '2026-01-01T00:00:00.000Z',
  finishedAt: '2026-01-01T00:00:01.000Z',
  inspected: 1,
};

function gateOf(id: string): Gate<any> {
  return {
    id,
    adapter: {
      kind: 'unit',
      rules: { r1: { id: `${id}/r1`, description: 'R1' } },
      check: {
        description: 'unit',
        counting: { kind: 'supported' },
        async run() {
          return { verdict: 'pass', scan };
        },
      },
    },
  };
}

test('a Gate module must default-export a Gate', () => {
  assert.throws(
    () => gateModuleFrom('gates/no-default.ts', {}),
    { message: 'Gate module gates/no-default.ts must default-export a Gate.' },
  );
  assert.throws(
    () => gateModuleFrom('gates/no-default.ts', { proofs: { gate: gateOf('g'), proofs: [] } }),
    { message: 'Gate module gates/no-default.ts must default-export a Gate.' },
  );
});

test('a Gate module keeps the proofs of its own Gate and rejects proofs for another instance', () => {
  const gate = gateOf('own');
  const suite: ProofSuite = { gate, proofs: [{ expected: 'green', name: 'green' }] };

  const withProofs = gateModuleFrom('gates/own.ts', { default: gate, proofs: suite });
  assert.equal(withProofs.file, 'gates/own.ts');
  assert.equal(withProofs.gate, gate);
  assert.equal(withProofs.proofs, suite);

  const withoutProofs = gateModuleFrom('gates/own.ts', { default: gate });
  assert.equal(withoutProofs.gate, gate);
  assert.equal(withoutProofs.proofs, undefined);

  const lookalike: ProofSuite = { gate: gateOf('own'), proofs: [] };
  assert.throws(
    () => gateModuleFrom('gates/own.ts', { default: gate, proofs: lookalike }),
    { message: 'Gate module gates/own.ts exports proofs for a different Gate instance.' },
  );
});

test('discovered Gate files are ordered and listed once each', () => {
  assert.deepEqual(
    gateFilesFrom('/work/project', ['gates/**/*.ts'], [
      '/work/project/gates/beta.ts',
      '/work/project/gates/nested/gamma.ts',
      '/work/project/gates/alpha.ts',
      '/work/project/gates/beta.ts',
    ]),
    ['/work/project/gates/alpha.ts', '/work/project/gates/beta.ts', '/work/project/gates/nested/gamma.ts'],
  );
});

test('discovering no Gate file is an error that names the root and every pattern, never an empty project', () => {
  assert.throws(
    () => gateFilesFrom('/work/project', ['gates/**/*.ts', 'extra/*.mjs'], []),
    { message: 'No Gate modules found under /work/project for "gates/**/*.ts", "extra/*.mjs".' },
  );
});

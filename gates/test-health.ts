import { report, testing } from '@redproof/testing';
import { defineGate, defineProofs, mutate, proof } from 'redproof';
import { nodeTestSuite } from './checks/node-test-suite.ts';

const adapter = testing({
  runner: nodeTestSuite({ files: 'tests/**/*.test.ts' }),
  report: report.junitXml(),
  rules: {
    testsPass: true,
    noSkippedTests: true,
  },
});

const gate = defineGate({ id: 'test-health', adapter });

export const proofs = defineProofs(gate, [
  proof.red(
    adapter.rules.testsPass,
    'detects a collected failing test',
    mutate.createFile(
      'tests/redproof-failing-proof.test.ts',
      "import test from 'node:test';\n\ntest('redproof failing proof', () => {\n  throw new Error('intentional proof failure');\n});\n",
    ),
  ),
  proof.red(
    adapter.rules.noSkippedTests,
    'detects a collected skipped test',
    mutate.createFile(
      'tests/redproof-skipped-proof.test.ts',
      "import test from 'node:test';\n\ntest.skip('redproof skipped proof', () => {});\n",
    ),
  ),
  proof.green('accepts the current complete test suite'),
]);

export default gate;

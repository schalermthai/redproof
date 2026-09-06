import { vitest } from '@redproof/testing';
import { defineGate, defineProofs, locate, mutate, proof } from 'redproof';

const adapter = vitest({
  configFile: 'vitest.config.js',
  rules: {
    testsPass: true,
    noSkippedTests: true,
    noTodoTests: true,
  },
});

const gate = defineGate({ id: 'unit-tests', adapter });

export const proofs = defineProofs(gate, [
  proof.red(
    adapter.rules.testsPass,
    'detects broken production behavior',
    mutate.replaceText(
      locate.text({ files: 'src/calculator.js', find: 'return left + right;' }),
      'return left - right;',
    ),
  ),
  proof.red(
    adapter.rules.noSkippedTests,
    'detects a skipped test',
    mutate.replaceText(
      locate.text({ files: 'test/calculator.test.js', find: "test('adds numbers'" }),
      "test.skip('adds numbers'",
    ),
  ),
  proof.red(
    adapter.rules.noTodoTests,
    'detects a TODO test',
    mutate.replaceText(
      locate.text({ files: 'test/calculator.test.js', find: '// REDPROOF_TODO_SLOT' }),
      "test.todo('future subtraction behavior');",
    ),
  ),
  proof.green('accepts a healthy Vitest suite'),
  proof.refuse(
    'refuses when Vitest cannot load its configuration',
    mutate.writeText('vitest.config.js', 'export default { test: { include: [ } }'),
  ),
]);

export default gate;

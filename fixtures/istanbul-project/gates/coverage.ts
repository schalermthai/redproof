import { istanbul } from '@redproof/istanbul';
import { createRequire } from 'node:module';
import { defineGate, defineProofs, locate, mutate, proof } from 'redproof';

const require = createRequire(import.meta.url);

// c8 remaps V8 coverage into the Istanbul format, so this Gate exercises the
// generic producer path rather than the nyc wrapper.
//
// `lines` is deliberately not selected. v8-to-istanbul emits one statement per
// source line, so under c8 `lines` and `statements` are always the same number
// and a separate Rule would prove nothing. For the same reason an unexecuted
// line is usually an unexecuted block as well, so the statements plant below
// moves `branches` too. The branch and function plants each move one Rule
// alone, which is what shows the metrics are not aliases.
const adapter = istanbul({
  command: process.execPath,
  args: ({ reportDirectory, tempDirectory }) => [
    require.resolve('c8/bin/c8.js'),
    '--reporter=json',
    `--reports-dir=${reportDirectory}`,
    `--temp-directory=${tempDirectory}`,
    '--include=src/pricing.js',
    process.execPath,
    'test/pricing.test.js',
  ],
  expectedFiles: ['src/pricing.js'],
  rules: {
    statements: { minimum: 100, perFile: true },
    branches: { minimum: 100, perFile: true },
    functions: { minimum: 100, perFile: true },
  },
});

const gate = defineGate({ id: 'coverage', adapter });

export const proofs = defineProofs(gate, [
  proof.red(
    adapter.rules.statements,
    'detects an unexecuted statement, which c8 also counts as an unexecuted block',
    mutate.insertAfter(
      locate.text({ files: 'src/pricing.js', find: '  return total;\n' }),
      '  globalThis.redproofUnreached = 1;\n',
    ),
  ),

  proof.red(
    adapter.rules.branches,
    'detects an unexercised branch arm',
    mutate.removeText(locate.text({
      files: 'test/pricing.test.js',
      find: 'assert.equal(shipping(10), 5);\n',
    })),
  ),

  proof.red(
    adapter.rules.functions,
    'detects an uncalled function',
    mutate.appendText('src/pricing.js', '\nexport function tax(total) { return total * 0.2; }\n'),
  ),

  proof.green('accepts fully covered source'),

  proof.refuse(
    'refuses coverage from a failed test run',
    mutate.appendText('test/pricing.test.js', '\nassert.equal(discount(100, true), 0);\n'),
  ),
]);

export default gate;

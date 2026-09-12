import { istanbul } from '@redproof/istanbul';
import { defineGate, defineProofs, mutate, proof } from 'redproof';

const source = 'packages/istanbul/src/model.ts';
const adapter = istanbul({
  command: process.execPath,
  args: ({ reportDirectory, tempDirectory }) => [
    'node_modules/c8/bin/c8.js', '--reporter=json', `--reports-dir=${reportDirectory}`,
    `--temp-directory=${tempDirectory}`, `--include=${source}`, process.execPath,
    '--experimental-strip-types', '--test', 'packages/istanbul/test/model.core.test.ts',
  ],
  expectedFiles: [source],
  rules: { statements: { minimum: 90 }, branches: { minimum: 80 }, functions: { minimum: 90 }, lines: { minimum: 90 } },
});
const unusedLines = '\nexport function redproofUnusedLines() {\n' + '  console.log("uncovered receipt");\n'.repeat(40) + '}\n';
const gate = defineGate({ id: 'coverage', adapter });
export const proofs = defineProofs(gate, [
  proof.red(adapter.rules.statements, 'detects unexecuted model statements', mutate.appendText(source, unusedLines)),
  proof.red(adapter.rules.branches, 'detects unexercised model branches', mutate.appendText(source,
    '\n' + 'if (false) { console.log("uncovered branch"); }\n'.repeat(60))),
  proof.red(adapter.rules.functions, 'detects uncalled model functions', mutate.appendText(source,
    '\n' + Array.from({ length: 5 }, (_, i) => `export function redproofUnused${i}() { return ${i}; }`).join('\n'))),
  proof.red(adapter.rules.lines, 'detects uncovered model lines', mutate.appendText(source, unusedLines)),
  proof.refuse('refuses failed coverage producer', mutate.appendText('packages/istanbul/test/model.core.test.ts', '\nthrow new Error("redproof coverage producer failure");\n')),
  proof.green('accepts maintained model coverage'),
]);
export default gate;

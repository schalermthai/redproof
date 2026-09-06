import { eslint } from '@redproof/eslint';
import { defineGate, defineProofs, mutate, proof } from 'redproof';

const adapter = eslint({
  files: ['src/**/*.js'],
  rules: {
    noConsole: 'no-console',
    strictEquality: 'eqeqeq',
  },
});

const gate = defineGate({
  id: 'eslint',
  adapter,
});

export const proofs = defineProofs(gate, [
  proof.red(
    adapter.rules.noConsole,
    'detects console usage',
    mutate.appendText('src/clean.js', '\nconsole.log("redproof");\n'),
  ),

  proof.red(
    adapter.rules.strictEquality,
    'detects loose equality',
    mutate.appendText(
      'src/clean.js',
      '\nexport function looselyEqual(left, right) { return left == right; }\n',
    ),
  ),

  proof.green('accepts clean source'),

  proof.refuse(
    'refuses when ESLint configuration is unavailable',
    mutate.rename('eslint.config.mjs', 'eslint.config.off.mjs'),
  ),
]);

export default gate;

import { stryker } from '@redproof/stryker';
import { defineGate, defineProofs, locate, mutate, proof } from 'redproof';

const adapter = stryker({
  configFile: 'stryker.config.mjs',
  rules: {
    noNewUndetectedMutants: {
      acceptedMutantsFile: 'gates/mutation/accepted-mutants.json',
    },
  },
});

const gate = defineGate({
  id: 'test-strength',
  adapter,
});

export const proofs = defineProofs(gate, [
  proof.red(
    adapter.rules.noNewUndetectedMutants,
    'detects a functional-core test that stops asserting a decision',
    mutate.replaceText(
      locate.text({
        files: 'tests/run/exit-code.core.test.ts',
        find: '  assert.equal(checkExitCode([pass, fail], 2), 1);\n  assert.equal(checkExitCode([fail, pass], 7), 1);\n',
      }),
      '',
    ),
  ),
  proof.green('accepts the recorded functional-core test strength'),
]);

export default gate;

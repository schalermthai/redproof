import { stryker } from '@redproof/stryker';
import { defineGate, defineProofs, locate, mutate, proof } from 'redproof';

const adapter = stryker({
  cwd: 'project',
  configFile: 'stryker.config.mjs',
  rules: {
    mutantsDetected: true,
    mutationScore: {
      minimum: 100,
    },
  },
});

const gate = defineGate({
  id: 'test-strength',
  adapter,
});

const weakenBoundaryTest = () => mutate.removeText(
  locate.text({
    files: 'project/test/is-adult.test.js',
    find: `test('adult boundary is accepted', () => {\n  assert.equal(isAdult(18), true);\n});\n\n`,
  }),
);

export const proofs = defineProofs(gate, [
  proof.red(
    adapter.rules.mutantsDetected,
    'detects an undetected boundary mutant when the test suite is weakened',
    weakenBoundaryTest(),
  ),
  proof.red(
    adapter.rules.mutationScore,
    'detects mutation score dropping below 100%',
    weakenBoundaryTest(),
  ),
  proof.green('accepts the strong baseline test suite'),
  proof.refuse(
    'refuses when Stryker configuration is unavailable',
    mutate.rename(
      'project/stryker.config.mjs',
      'project/stryker.config.off.mjs',
    ),
  ),
]);

export default gate;

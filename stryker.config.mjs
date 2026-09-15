import { coreTestTargets } from './gates/support/effects-model.ts';
import { readSources } from './gates/support/sources.ts';

const coreTests = '{tests,packages/*/test}/**/*.core.test.ts';

export default {
  mutate: coreTestTargets(await readSources('.', coreTests)),
  testRunner: 'command',
  commandRunner: {
    command: `node --disable-warning=ExperimentalWarning --experimental-strip-types --test --test-isolation=none '${coreTests}'`,
  },
  coverageAnalysis: 'off',
  ignorePatterns: ['/fixtures', 'dist', '.claude'],
};

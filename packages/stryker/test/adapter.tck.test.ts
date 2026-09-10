import { runAdapterTck, type AdapterTckSpec, type EvidenceObservation } from '@redproof/adapter-tck';
import { defineRule } from 'redproof';
import { stryker } from '../src/index.ts';
import {
  undetectedMutantBreaches,
  type StrykerMutantResult,
} from '../src/model.ts';
import { withWorkspace } from './support/workspace.ts';

const rule = defineRule({
  id: 'stryker/mutants-detected',
  description: 'Mutants must be detected.',
});

function evidence(status: StrykerMutantResult['status'] | null): EvidenceObservation {
  const mutants: StrykerMutantResult[] = status === null ? [] : [{ id: '1', status }];
  return { kind: 'translated', breaches: undetectedMutantBreaches(mutants, rule) };
}

const spec = {
  name: 'stryker',
  kind: 'stryker',
  construction: {
    valid: () => stryker({ rules: { mutantsDetected: true } }),
    emptyRules: {
      name: 'rejects an empty Rule selection',
      run: () => stryker({ rules: {} }),
      message: /requires at least one Redproof rule/u,
    },
    unknownOption: {
      name: 'rejects an unknown top-level option',
      run: () => stryker({ rules: { mutantsDetected: true }, mystery: true } as never),
      message: /Unknown Stryker adapter option: "mystery"/u,
    },
    invalidValues: [{
      name: 'rejects an invalid mutation-score threshold',
      run: () => stryker({ rules: { mutationScore: { minimum: 101 } } }),
      message: /minimum must be between 0 and 100/u,
    }, {
      name: 'rejects an absolute config path',
      run: () => stryker({ configFile: '/outside.conf.js', rules: { mutantsDetected: true } }),
      message: /configFile must be a relative path/u,
    }],
  },
  unavailable: [{
    name: 'REFUSES when Stryker cannot enter its working directory',
    code: 'stryker-unavailable',
    run: () => withWorkspace(async root => stryker({
      cwd: 'missing',
      rules: { mutantsDetected: true },
    }).check.run({ root, rules: ['stryker/mutants-detected'] })),
  }],
  evidence: [{
    rule: 'stryker/mutants-detected',
    expectedBreaches: [{ code: 'mutant-survived' }],
    violating: () => evidence('Survived'),
    clean: () => evidence(null),
    unselected: () => evidence('Killed'),
  }],
  purity: {
    kind: 'sources',
    files: [
      'packages/stryker/src/baseline.ts',
      'packages/stryker/src/cwd.ts',
      'packages/stryker/src/model.ts',
    ],
    allowedExternalImports: ['node:path', 'redproof'],
  },
  capabilities: {
    kind: 'not-applicable',
    reason: 'Stryker returns programmatic findings rather than a selectable report format',
  },
} as const satisfies AdapterTckSpec;

runAdapterTck([spec]);

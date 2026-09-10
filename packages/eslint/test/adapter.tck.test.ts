import { runAdapterTck, type AdapterTckSpec, type EvidenceObservation } from '@redproof/adapter-tck';
import { defineRule, type Rule } from 'redproof';
import { eslint } from '../src/index.ts';
import { eslintBreaches } from '../src/model.ts';
import { withWorkspace } from './support/workspace.ts';

const rule = defineRule({ id: 'eslint/semi', description: 'Semicolons must hold.' });
const selected = new Map<string, Rule>([['semi', rule]]);

function evidence(ruleId: string | null): EvidenceObservation {
  return {
    kind: 'translated',
    breaches: eslintBreaches('/repo', [{
      filePath: '/repo/src/example.ts',
      messages: ruleId === null ? [] : [{ ruleId, message: 'lint finding', line: 1, column: 1 }],
    }], selected),
  };
}

const spec = {
  name: 'eslint',
  kind: 'eslint',
  construction: {
    valid: () => eslint({ rules: { semi: 'semi' } }),
    emptyRules: {
      name: 'rejects an empty Rule selection',
      run: () => eslint({ rules: {} }),
      message: /requires at least one Redproof rule/u,
    },
    unknownOption: {
      name: 'rejects an unknown top-level option',
      run: () => eslint({ rules: { semi: 'semi' }, mystery: true } as never),
      message: /Unknown ESLint adapter option: "mystery"/u,
    },
    invalidValues: [{
      name: 'rejects an empty foreign Rule id',
      run: () => eslint({ rules: { semi: '' } }),
      message: /must name a non-empty rule/u,
    }, {
      name: 'rejects an absolute file path',
      run: () => eslint({ files: ['/outside.ts'], rules: { semi: 'semi' } }),
      message: /relative paths/u,
    }],
  },
  unavailable: [{
    name: 'REFUSES when ESLint cannot inspect its target',
    code: 'eslint-unavailable',
    run: () => withWorkspace(async root => eslint({
      files: ['missing.ts'],
      rules: { semi: 'semi' },
    }).check.run({ root, rules: ['eslint/semi'] })),
  }],
  evidence: [{
    rule: 'eslint/semi',
    expectedBreaches: [{ code: 'semi', message: 'lint finding' }],
    violating: () => evidence('semi'),
    clean: () => evidence(null),
    unselected: () => evidence('quotes'),
  }],
  purity: {
    kind: 'sources',
    files: ['packages/eslint/src/model.ts'],
    allowedExternalImports: ['node:path', 'redproof'],
  },
  capabilities: {
    kind: 'not-applicable',
    reason: 'ESLint returns programmatic findings rather than a selectable report format',
  },
} as const satisfies AdapterTckSpec;

runAdapterTck([spec]);

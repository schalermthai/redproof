import { runAdapterTck, type AdapterTckSpec, type EvidenceObservation } from '@redproof/adapter-tck';
import { defineRule, type Rule } from 'redproof';
import { dependencyCruiser } from '../src/index.ts';
import {
  violationsToBreaches,
  type DependencyCruiserViolation,
} from '../src/model.ts';
import { withWorkspace } from './support/workspace.ts';

const rule = defineRule({
  id: 'dependency-cruiser/no-cycles',
  description: 'Cycles must not exist.',
});
const selected = new Map<string, Rule>([['no-cycles', rule]]);

function evidence(ruleName: string | null): EvidenceObservation {
  const violations: DependencyCruiserViolation[] = ruleName === null ? [] : [{
    from: 'src/a.ts',
    to: 'src/b.ts',
    rule: { name: ruleName },
  }];
  return { kind: 'translated', breaches: violationsToBreaches(violations, selected) };
}

const spec = {
  name: 'dependency-cruiser',
  kind: 'dependency-cruiser',
  construction: {
    valid: () => dependencyCruiser({ rules: { cycles: 'no-cycles' } }),
    emptyRules: {
      name: 'rejects an empty Rule selection',
      run: () => dependencyCruiser({ rules: {} }),
      message: /requires at least one Redproof rule/u,
    },
    unknownOption: {
      name: 'rejects an unknown top-level option',
      run: () => dependencyCruiser({ rules: { cycles: 'no-cycles' }, mystery: true } as never),
      message: /Unknown dependency-cruiser adapter option: "mystery"/u,
    },
    invalidValues: [{
      name: 'rejects an empty foreign Rule id',
      run: () => dependencyCruiser({ rules: { cycles: '' } }),
      message: /must name a non-empty rule/u,
    }, {
      name: 'rejects an absolute config path',
      run: () => dependencyCruiser({
        configFile: '/outside.cjs',
        rules: { cycles: 'no-cycles' },
      }),
      message: /configFile must be a relative path/u,
    }],
  },
  unavailable: [{
    name: 'REFUSES when dependency-cruiser cannot load its configuration',
    code: 'dependency-cruiser-unavailable',
    run: () => withWorkspace(async root => dependencyCruiser({
      configFile: 'missing.cjs',
      rules: { cycles: 'no-cycles' },
    }).check.run({ root, rules: ['dependency-cruiser/no-cycles'] })),
  }],
  evidence: [{
    rule: 'dependency-cruiser/no-cycles',
    violating: () => evidence('no-cycles'),
    clean: () => evidence(null),
    unselected: () => evidence('not-selected'),
  }],
  purity: {
    kind: 'sources',
    files: ['packages/dependency-cruiser/src/model.ts'],
    allowedExternalImports: ['redproof'],
  },
  capabilities: {
    kind: 'not-applicable',
    reason: 'dependency-cruiser returns programmatic findings rather than a selectable report format',
  },
} as const satisfies AdapterTckSpec;

runAdapterTck([spec]);

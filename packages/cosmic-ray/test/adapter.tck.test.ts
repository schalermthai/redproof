import { runAdapterTck, type AdapterTckSpec, type EvidenceObservation } from '@redproof/adapter-tck';
import { cosmicRay } from '../src/index.ts';
import { decideCosmicRayRun } from '../src/core/verdict.ts';
import { mutants, type FixtureName } from './support/fixtures.ts';
import { withWorkspace } from './support/workspace.ts';

const adapter = cosmicRay({ rules: { mutantsDetected: true, mutationScore: { minimum: 90 } } });
const scan = { source: 'cosmic-ray', startedAt: '', finishedAt: '', inspected: null };

function evidence(name: FixtureName, selected: 'mutantsDetected' | 'mutationScore' | 'none', minimum = 90): EvidenceObservation {
  const policies = selected === 'mutantsDetected'
    ? { mutantsDetected: adapter.rules.mutantsDetected }
    : selected === 'mutationScore'
      ? { mutationScore: { rule: adapter.rules.mutationScore, minimum } }
      : {};
  return { kind: 'checked', result: decideCosmicRayRun({ scan, root: '/p', cwd: '/p', mutants: mutants(name), timeouts: 'detected', policies }) };
}

const spec = {
  name: 'cosmic-ray',
  kind: 'cosmic-ray',
  construction: {
    valid: () => cosmicRay({ rules: { mutantsDetected: true, mutationScore: { minimum: 90 } } }),
    emptyRules: {
      name: 'rejects an empty Rule selection',
      run: () => cosmicRay({ rules: {} }),
      message: /requires at least one Redproof rule/u,
    },
    unknownOption: {
      name: 'rejects an unknown top-level option',
      run: () => cosmicRay({ rules: { mutantsDetected: true }, mystery: true } as never),
      message: /Unknown cosmic-ray adapter option: "mystery"/u,
    },
    invalidValues: [{
      name: 'rejects an invalid mutation-score threshold',
      run: () => cosmicRay({ rules: { mutationScore: { minimum: 101 } } }),
      message: /minimum must be at least 0\.000001 and at most 100/u,
    }, {
      name: 'rejects a zero mutation-score threshold, which could never go red',
      run: () => cosmicRay({ rules: { mutationScore: { minimum: 0 } } }),
      message: /could never go red/u,
    }, {
      name: 'rejects a minimum so small it rounds to zero, which could never go red',
      run: () => cosmicRay({ rules: { mutationScore: { minimum: 1e-7 } } }),
      message: /at least 0\.000001/u,
    }, {
      name: 'rejects an unknown timeouts policy',
      run: () => cosmicRay({ timeouts: 'maybe', rules: { mutantsDetected: true } } as never),
      message: /timeouts must be 'detected' or 'refuse'/u,
    }, {
      name: 'rejects an unknown rule',
      run: () => cosmicRay({ rules: { magic: true } } as never),
      message: /Unknown cosmic-ray rule/u,
    }, {
      name: 'rejects an absolute config path',
      run: () => cosmicRay({ config: '/etc/c.toml', rules: { mutantsDetected: true } }),
      message: /config must be a confined relative path/u,
    }, {
      name: 'rejects an escaping cwd',
      run: () => cosmicRay({ cwd: '../x', rules: { mutantsDetected: true } }),
      message: /cwd must be a confined relative path/u,
    }, {
      name: 'rejects a non-positive timeout',
      run: () => cosmicRay({ timeoutMs: 0, rules: { mutantsDetected: true } }),
      message: /timeoutMs must be a positive integer/u,
    }],
  },
  unavailable: [{
    name: 'REFUSES when cosmic-ray cannot enter its working directory',
    code: 'cosmic-ray-unavailable',
    run: () => withWorkspace(async root => cosmicRay({
      cwd: 'missing',
      rules: { mutantsDetected: true },
    }).check.run({ root, rules: ['cosmic-ray/mutants-detected'] })),
  }],
  evidence: [{
    rule: 'cosmic-ray/mutants-detected',
    expectedBreaches: [{ code: 'mutant-survived' }],
    violating: () => evidence('one-survivor', 'mutantsDetected'),
    clean: () => evidence('all-killed', 'mutantsDetected'),
    unselected: () => evidence('one-survivor', 'none'),
  }, {
    rule: 'cosmic-ray/mutation-score',
    expectedBreaches: [{ code: 'mutation-score-below-minimum' }],
    violating: () => evidence('survivors', 'mutationScore'),
    clean: () => evidence('all-killed', 'mutationScore'),
    unselected: () => evidence('survivors', 'none'),
  }],
  purity: {
    kind: 'sources',
    files: [
      'packages/cosmic-ray/src/core/copy.ts',
      'packages/cosmic-ray/src/core/driver.ts',
      'packages/cosmic-ray/src/core/failure.ts',
      'packages/cosmic-ray/src/core/options.ts',
      'packages/cosmic-ray/src/core/report.ts',
      'packages/cosmic-ray/src/core/verdict.ts',
    ],
    allowedExternalImports: ['node:path', 'redproof'],
  },
  capabilities: {
    kind: 'not-applicable',
    reason: 'cosmic-ray is run by the adapter and its `dump` JSON lines are the only report format',
  },
} as const satisfies AdapterTckSpec;

runAdapterTck([spec]);

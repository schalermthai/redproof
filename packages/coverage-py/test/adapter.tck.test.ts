import { runAdapterTck, type AdapterTckSpec, type EvidenceProbe } from '@redproof/adapter-tck';
import { coveragePy } from '../src/index.ts';
import { parseCoveragePy } from '../src/core/evidence.ts';
import { coveragePyBreaches, type RuleName, type Selection } from '../src/core/rules.ts';
import { report } from './support/report.ts';

const all = { lineCoverage: { minimum: 100 }, branchCoverage: { minimum: 100 }, perFileMinimum: { minimum: 100 }, noUncoveredFiles: {} };
const create = () => coveragePy({ args: ['-m', 'pytest'], rules: all });
const bad = report({ 'x.py': { lines: [0, 2], branches: [0, 2] } }), good = report({ 'x.py': { lines: [2, 0], branches: [2, 0] } });
function probe(name: RuleName, code: string, config: Record<string, unknown>): EvidenceProbe {
  const rule = create().rules[name];
  const evidence = (text: string, chosen = true) => ({ kind: 'translated' as const,
    breaches: coveragePyBreaches(parseCoveragePy(text, '/project', '/project'), (chosen ? { [name]: { rule, config } } : {}) as Selection<never>) });
  return { rule: rule.id, expectedBreaches: [{ code }], violating: () => evidence(bad), clean: () => evidence(good), unselected: () => evidence(bad, false) };
}
const invalid = (name: string, rules: object, message: RegExp) => ({ name, run: () => coveragePy({ args: ['x'], rules } as never), message });
runAdapterTck([{
  name: 'coverage-py', kind: 'coverage-py',
  construction: {
    valid: create,
    emptyRules: { name: 'rejects empty rules', run: () => coveragePy({ args: ['x'], rules: {} }), message: /at least one/ },
    unknownOption: { name: 'rejects unknown options', run: () => coveragePy({ args: ['x'], rules: all, mystery: true } as never), message: /Unknown/ },
    invalidValues: [
      invalid('rejects unknown rule', { magic: {} }, /Unknown/),
      invalid('rejects over-precise minimum', { lineCoverage: { minimum: 90.1234567 } }, /decimal places/),
      invalid('rejects invalid minimum', { lineCoverage: { minimum: 101 } }, /between 0 and 100/),
      invalid('rejects missing minimum', { lineCoverage: {} }, /between 0 and 100/),
      invalid('rejects unknown nested policy', { lineCoverage: { minimum: 90, typo: true } }, /Unknown/),
      invalid('rejects bad per-file metric', { perFileMinimum: { minimum: 90, metric: 'functions' } }, /metric/),
      { name: 'rejects branch rule when branches are off', run: () => coveragePy({ args: ['x'], branch: false, rules: { branchCoverage: { minimum: 1 } } }), message: /branch data/ },
      { name: 'rejects branch per-file metric when branches are off', run: () => coveragePy({ args: ['x'], branch: false, rules: { perFileMinimum: { minimum: 1, metric: 'branches' } } }), message: /branch data/ },
      { name: 'rejects an inherited minimum', run: () => coveragePy({ args: ['x'], rules: { lineCoverage: Object.create({ minimum: 50 }) } } as never), message: /plain object/ },
      { name: 'rejects a getter minimum', run: () => coveragePy({ args: ['x'], rules: { lineCoverage: { get minimum() { return 50; } } } } as never), message: /getters/ },
      { name: 'rejects sparse args', run: () => coveragePy({ args: new Array(2) as string[], rules: all }), message: /empty slots/ },
      { name: 'rejects expectedFiles that are the same path spelled twice', run: () => coveragePy({ args: ['x'], expectedFiles: ['a/./b.py', 'a/b.py'], rules: all }), message: /unique/ },
      { name: 'rejects empty args', run: () => coveragePy({ args: [], rules: all }), message: /non-empty/ },
      { name: 'rejects escaping rcfile', run: () => coveragePy({ args: ['x'], rcfile: '../rc', rules: all }), message: /confined relative/ },
      { name: 'rejects empty expected inventory', run: () => coveragePy({ args: ['x'], expectedFiles: [], rules: all }), message: /non-empty/ },
    ],
  },
  unavailable: [{ name: 'refuses unavailable working directory', code: 'coverage-py-evidence-unavailable', run: () => create().check.run({ root: '/redproof-nonexistent-coverage-root', rules: [] }) }],
  evidence: [probe('lineCoverage', 'line-coverage-below-minimum', { minimum: 100 }), probe('branchCoverage', 'branch-coverage-below-minimum', { minimum: 100 }),
    probe('perFileMinimum', 'file-below-minimum', { minimum: 100 }), probe('noUncoveredFiles', 'file-never-executed', {})],
  purity: { kind: 'sources', files: ['packages/coverage-py/src/core/argv.ts', 'packages/coverage-py/src/core/decide.ts', 'packages/coverage-py/src/core/evidence.ts',
      'packages/coverage-py/src/core/options.ts', 'packages/coverage-py/src/core/paths.ts', 'packages/coverage-py/src/core/refusals.ts',
      'packages/coverage-py/src/core/rules.ts', 'packages/coverage-py/src/core/thresholds.ts', 'packages/coverage-py/src/core/trust.ts'],
    allowedExternalImports: ['redproof', 'redproof/command', 'node:path'] },
  capabilities: { kind: 'not-applicable', reason: 'Only the full format-3 coverage.py JSON report is supported; the summary-only totals are cross-checked, not trusted.' },
} satisfies AdapterTckSpec]);

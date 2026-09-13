import { runAdapterTck, type AdapterTckSpec, type EvidenceProbe } from '@redproof/adapter-tck';
import { istanbul, nyc } from '../src/index.ts';
import { coverageBreaches, parseCoverage, type Metric } from '../src/model.ts';
import { sample } from './support/workspace.ts';

const selected = { statements: { minimum: 100 }, branches: { minimum: 100 }, functions: { minimum: 100 }, lines: { minimum: 100 } };
const create = () => nyc({ command: 'node', rules: selected });
function metricProbe(metric: Metric): EvidenceProbe {
  const rule = create().rules[metric];
  const evidence = (hits: number[], chosen = true) => ({ kind: 'translated' as const,
    breaches: coverageBreaches(parseCoverage(JSON.stringify(sample('source.js', hits)), '/project'),
      new Map(chosen ? [[metric, { rule, threshold: { minimum: 100 } }]] : [])) });
  return { rule: rule.id, expectedBreaches: [{ code: `${metric}-coverage-below-minimum` }],
    violating: () => evidence([0, 0]), clean: () => evidence([1, 1]), unselected: () => evidence([0, 0], false) };
}
function genericEvidence(hits: number[], chosen = true) {
  const rule = istanbul({ command: 'node', args: () => [], rules: { lines: { minimum: 90 } } }).rules.lines;
  return { kind: 'translated' as const, breaches: coverageBreaches(
    parseCoverage(JSON.stringify(sample('source.js', hits)), '/project'),
    new Map(chosen ? [['lines' as const, { rule, threshold: { minimum: 90 } }]] : []),
  ) };
}
runAdapterTck([{
  name: 'istanbul', kind: 'istanbul',
  construction: {
    valid: create,
    emptyRules: { name: 'rejects empty rules', run: () => nyc({ command: 'node', rules: {} }), message: /at least one/ },
    unknownOption: { name: 'rejects unknown options', run: () => nyc({ command: 'node', rules: selected, mystery: true } as never), message: /Unknown/ },
    invalidValues: [
      { name: 'rejects invalid minimum', run: () => nyc({ command: 'node', rules: { lines: { minimum: 101 } } }), message: /between 0 and 100/ },
      { name: 'rejects unknown nested policy', run: () => nyc({ command: 'node', rules: { lines: { minimum: 90, typo: true } } } as never), message: /Unknown/ },
      { name: 'rejects escaping config path', run: () => nyc({ command: 'node', configFile: '../config', rules: selected }), message: /confined relative/ },
      { name: 'rejects bad command', run: () => nyc({ command: '', rules: selected }), message: /must not be empty/ },
      { name: 'rejects unknown metric', run: () => nyc({ command: 'node', rules: { magic: { minimum: 90 } } } as never), message: /Unknown/ },
      { name: 'rejects empty expected inventory', run: () => nyc({ command: 'node', expectedFiles: [], rules: selected }), message: /non-empty/ },
    ],
  },
  unavailable: [{ name: 'refuses unavailable working directory', code: 'istanbul-evidence-unavailable', run: () => create().check.run({ root: '/redproof-nonexistent-coverage-root', rules: [] }) }],
  evidence: [metricProbe('statements'), metricProbe('branches'), metricProbe('functions'), metricProbe('lines')],
  purity: { kind: 'sources', files: ['packages/istanbul/src/model.ts'], allowedExternalImports: ['redproof', 'node:path'] },
  capabilities: { kind: 'not-applicable', reason: 'Only full Istanbul coverage maps are supported; summaries are explicitly rejected.' },
} satisfies AdapterTckSpec, {
  name: 'istanbul-command', kind: 'istanbul',
  construction: {
    valid: () => istanbul({ command: 'node', args: () => [], rules: { lines: { minimum: 90 } } }),
    emptyRules: { name: 'rejects empty rules', run: () => istanbul({ command: 'node', args: () => [], rules: {} }), message: /at least one/ },
    unknownOption: { name: 'rejects unknown generic options', run: () => istanbul({ command: 'node', args: () => [], rules: { lines: { minimum: 90 } }, mystery: true } as never), message: /Unknown/ },
    invalidValues: [{ name: 'requires report-aware args', run: () => istanbul({ command: 'node', args: [], rules: { lines: { minimum: 90 } } } as never), message: /report-context/ }],
  },
  unavailable: [{ name: 'refuses unavailable root', code: 'istanbul-evidence-unavailable', run: () => istanbul({ command: 'node', args: () => [], rules: { lines: { minimum: 90 } } }).check.run({ root: '/redproof-nonexistent-coverage-root', rules: [] }) }],
  evidence: [{ rule: 'istanbul/lines-coverage', expectedBreaches: [{ code: 'lines-coverage-below-minimum' }],
    violating: () => genericEvidence([0, 0]),
    clean: () => genericEvidence([1, 1]), unselected: () => genericEvidence([0, 0], false),
  }],
  purity: { kind: 'delegated', to: 'istanbul' },
  capabilities: { kind: 'not-applicable', reason: 'Uses the same full coverage-map format as the nyc wrapper.' },
} satisfies AdapterTckSpec]);

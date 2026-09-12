import { runAdapterTck, type AdapterTckSpec } from '@redproof/adapter-tck';
import { knip } from '../src/index.ts';
import { knipBreaches, type KnipFinding } from '../src/model.ts';
import { withProject } from './support/workspace.ts';

const adapter = knip({ rules: { exports: 'exports' } });
const selected = new Map([['exports' as const, adapter.rules.exports]]);
const finding: KnipFinding = { type: 'exports', file: 'receive.ts', symbol: 'unused', line: 2, column: 14, symbols: [] };
const translated = (findings: readonly KnipFinding[]) => ({ kind: 'translated' as const, breaches: knipBreaches(findings, selected) });

runAdapterTck([{
  name: 'knip', kind: 'knip',
  construction: {
    valid: () => adapter,
    emptyRules: { name: 'rejects empty rules', run: () => knip({ rules: {} }), message: /at least one/u },
    unknownOption: { name: 'rejects unknown option', run: () => knip({ rules: { exports: 'exports' }, mystery: true } as never), message: /Unknown/u },
    invalidValues: [
      { name: 'rejects unknown issue type', run: () => knip({ rules: { bad: 'unknown' } } as never), message: /Unknown Knip/u },
      { name: 'rejects absolute path', run: () => knip({ rules: { exports: 'exports' }, cwd: '/outside' }), message: /relative path/u },
      { name: 'rejects invalid timeout', run: () => knip({ rules: { exports: 'exports' }, timeoutMs: 0 }), message: /positive integer/u },
      { name: 'rejects an option masquerading as workspace', run: () => knip({ rules: { exports: 'exports' }, workspace: '--fix' }), message: /selector, not an option/u },
    ],
  },
  unavailable: [{ name: 'missing configuration REFUSES', code: 'knip-unavailable', run: () => withProject(root =>
    knip({ rules: { exports: 'exports' }, configFile: 'missing.json' }).check.run({ root, rules: ['knip/unused-exports'] })) }],
  evidence: [{ rule: 'knip/unused-exports', expectedBreaches: [{ code: 'exports' }],
    violating: () => translated([finding]), clean: () => translated([]),
    unselected: () => translated([{ ...finding, type: 'types' }]) }],
  purity: { kind: 'sources', files: ['packages/knip/src/model.ts'], allowedExternalImports: ['redproof'] },
  capabilities: { kind: 'not-applicable', reason: 'The bundled Knip reporter has one fixed protocol; runtime report flags establish category availability.' },
} satisfies AdapterTckSpec]);

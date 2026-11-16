import { runAdapterTck, type AdapterTckSpec, type EvidenceObservation } from '@redproof/adapter-tck';
import { readFileSync } from 'node:fs';
import { ruff } from '../src/index.ts';
import { fakeRuff, fixtures, ruffBinary, withProject } from './support/workspace.ts';

const adapter = ruff({ rules: { unusedImports: 'F401' } });

/**
 * Evidence goes through the whole check, so the TCK sees what a Gate sees, including REFUSE.
 * `reported` is a real captured Ruff report, replayed by a stand-in executable.
 */
const checked = (reported: string): Promise<EvidenceObservation> => withProject([], async root => {
  const text = readFileSync(`${fixtures}${reported}`, 'utf8').replaceAll('<ROOT>', root);
  const command = await fakeRuff(root, text, reported === 'clean.report.json' ? 0 : 1);
  const subject = ruff({ rules: { unusedImports: 'F401' }, command });
  return { kind: 'checked', result: await subject.check.run({ root, rules: ['ruff/F401'] }) };
});

/** A tree that violates only an unselected rule: with `--select F401`, real Ruff reports nothing. */
const unselected = (): Promise<EvidenceObservation> => withProject(['S101.py'], async root => {
  const subject = ruff({ rules: { unusedImports: 'F401' }, isolated: true, command: ruffBinary });
  return { kind: 'checked', result: await subject.check.run({ root, rules: ['ruff/F401'] }) };
});

runAdapterTck([{
  name: 'ruff', kind: 'ruff',
  construction: {
    valid: () => adapter,
    emptyRules: { name: 'rejects empty rules', run: () => ruff({ rules: {} }), message: /at least one/u },
    unknownOption: { name: 'rejects unknown option', run: () => ruff({ rules: { a: 'F401' }, mystery: true } as never), message: /Unknown/u },
    invalidValues: [
      { name: 'rejects a malformed selector', run: () => ruff({ rules: { a: 'f401' } }), message: /Unknown Ruff selector/u },
      { name: 'rejects ALL', run: () => ruff({ rules: { a: 'ALL' } }), message: /Unknown Ruff selector/u },
      { name: 'rejects overlapping selectors', run: () => ruff({ rules: { a: 'F', b: 'F401' } }), message: /must not overlap/u },
      { name: 'rejects an absolute path', run: () => ruff({ rules: { a: 'F401' }, paths: ['/etc'] }), message: /relative path/u },
      { name: 'rejects an option masquerading as a path', run: () => ruff({ rules: { a: 'F401' }, paths: ['--fix'] }), message: /relative path/u },
      { name: 'rejects isolated with configFile', run: () => ruff({ rules: { a: 'F401' }, isolated: true, configFile: 'ruff.toml' }), message: /cannot be combined/u },
      { name: 'rejects an empty command', run: () => ruff({ rules: { a: 'F401' }, command: ' ' }), message: /command must not be empty/u },
      { name: 'rejects an empty path list', run: () => ruff({ rules: { a: 'F401' }, paths: [] }), message: /non-empty list/u },
      { name: 'rejects an invalid timeout', run: () => ruff({ rules: { a: 'F401' }, timeoutMs: 0 }), message: /positive integer/u },
    ],
  },
  unavailable: [{
    name: 'a missing Ruff executable REFUSES',
    code: 'command-unavailable',
    run: () => withProject(['F401_0.py'], root =>
      ruff({ rules: { a: 'F401' }, command: 'redproof-tck-no-such-ruff' }).check.run({ root, rules: ['ruff/F401'] })),
  }],
  evidence: [{
    rule: 'ruff/F401',
    expectedBreaches: [{ code: 'F401' }],
    violating: () => checked('f401_single.report.json'),
    clean: () => checked('clean.report.json'),
    unselected,
  }],
  purity: {
    kind: 'sources',
    files: [
      'packages/ruff/src/core/decision.ts',
      'packages/ruff/src/core/model.ts',
      'packages/ruff/src/core/options.ts',
    ],
    allowedExternalImports: ['node:path', 'redproof', 'redproof/command'],
  },
  capabilities: { kind: 'not-applicable', reason: 'The JSON report carries every finding of every selected rule; no selectable rule depends on report features.' },
} satisfies AdapterTckSpec]);

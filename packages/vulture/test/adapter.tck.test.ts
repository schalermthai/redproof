import { runAdapterTck, type AdapterTckSpec, type EvidenceObservation } from '@redproof/adapter-tck';
import { readFileSync } from 'node:fs';
import { vulture } from '../src/index.ts';
import { fakeVulture, withProject } from './support/workspace.ts';

const adapter = vulture({ rules: { imports: 'unused-import' } });
const PROJECT = { 'a.py': 'import os\n' };
const fixtures = new URL('./fixtures/', import.meta.url);

/** Evidence goes through the whole check, so the TCK sees what a Gate sees, including REFUSE. `stdout` replays real captured vulture output. */
const checked = (stdout: string, exitCode: number, selected: 'unused-import' | 'unused-class' = 'unused-import'): Promise<EvidenceObservation> => withProject(PROJECT, async root => {
  const command = await fakeVulture(root, { stdout, stderr: '', exitCode });
  const subject = vulture({ rules: { r: selected }, command });
  return { kind: 'checked', result: await subject.check.run({ root, rules: [`vulture/${selected}`] }) };
});

runAdapterTck([{
  name: 'vulture', kind: 'vulture',
  construction: {
    valid: () => adapter,
    emptyRules: { name: 'rejects empty rules', run: () => vulture({ rules: {} }), message: /at least one/u },
    unknownOption: { name: 'rejects unknown option', run: () => vulture({ rules: { a: 'unused-import' }, mystery: true } as never), message: /Unknown/u },
    invalidValues: [
      { name: 'rejects a kind vulture does not report', run: () => vulture({ rules: { a: 'unused-module' } }), message: /Unknown vulture rule/u },
      { name: 'rejects the same kind twice', run: () => vulture({ rules: { a: 'unused-import', b: 'unused-import' } }), message: /selected twice/u },
      { name: 'rejects a confidence above 100', run: () => vulture({ rules: { a: 'unused-import' }, minConfidence: 101 }), message: /between 0 and 100/u },
      { name: 'rejects a fractional confidence', run: () => vulture({ rules: { a: 'unused-import' }, minConfidence: 60.5 }), message: /between 0 and 100/u },
      { name: 'rejects an absolute path', run: () => vulture({ rules: { a: 'unused-import' }, paths: ['/etc'] }), message: /relative path/u },
      { name: 'rejects a path that climbs out', run: () => vulture({ rules: { a: 'unused-import' }, cwd: '../x' }), message: /relative path/u },
      { name: 'rejects an exclude pattern with a comma', run: () => vulture({ rules: { a: 'unused-import' }, exclude: ['a,b'] }), message: /no comma/u },
      { name: 'rejects an ignore pattern that looks like an option', run: () => vulture({ rules: { a: 'unused-import' }, ignoreNames: ['--x'] }), message: /dash/u },
      { name: 'rejects an empty command', run: () => vulture({ rules: { a: 'unused-import' }, command: ' ' }), message: /command must not be empty/u },
      { name: 'rejects an invalid timeout', run: () => vulture({ rules: { a: 'unused-import' }, timeoutMs: 0 }), message: /positive integer/u },
    ],
  },
  unavailable: [{
    name: 'a missing vulture executable REFUSES',
    code: 'command-unavailable',
    run: () => withProject(PROJECT, root =>
      vulture({ rules: { a: 'unused-import' }, command: 'redproof-tck-no-such-vulture' }).check.run({ root, rules: ['vulture/unused-import'] })),
  }],
  evidence: [{
    rule: 'vulture/unused-import',
    expectedBreaches: [{ code: 'unused-import' }],
    violating: () => checked(readFileSync(new URL('a.stdout', fixtures), 'utf8').split('\n')[0] + '\n', 3),
    clean: () => checked('', 0),
    // vulture reports every kind; a tree whose only findings are classes must not fail the import Gate.
    unselected: () => checked("a.py:16: unused class 'UnusedClass' (60% confidence)\n", 3),
  }],
  purity: {
    kind: 'sources',
    files: ['packages/vulture/src/core/decision.ts', 'packages/vulture/src/core/model.ts', 'packages/vulture/src/core/options.ts'],
    allowedExternalImports: ['node:path', 'redproof', 'redproof/command'],
  },
  capabilities: { kind: 'not-applicable', reason: 'The text report carries every finding of every kind; no selectable rule depends on report features.' },
} satisfies AdapterTckSpec]);

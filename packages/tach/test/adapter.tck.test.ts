import { runAdapterTck, type AdapterTckSpec, type EvidenceObservation } from '@redproof/adapter-tck';
import { tach } from '../src/index.ts';
import { fakeTach, readFixture, tachBinary, withProject, hasTach } from './support/workspace.ts';

const rules = { undeclared: 'undeclared-dependency' } as const;
const adapter = tach({ rules });

/** Evidence goes through the whole check, so the TCK sees what a Gate sees, including REFUSE. A real captured report is replayed by a stand-in executable. */
const checked = (reported: string, exitCode: number): Promise<EvidenceObservation> => withProject('ok', async root => {
  const command = await fakeTach(root, await readFixture(reported), exitCode);
  return { kind: 'checked', result: await tach({ rules, command }).check.run({ root, rules: ['tach/undeclared-dependency'] }) };
});

/** A tree that breaks only an unselected rule: real tach reports a layer violation, which this Gate did not ask about. */
const unselected = (): Promise<EvidenceObservation> => withProject('layer', async root => {
  const command = hasTach ? tachBinary : await fakeTach(root, await readFixture('layer.report.json'), 1);
  return { kind: 'checked', result: await tach({ rules, command }).check.run({ root, rules: ['tach/undeclared-dependency'] }) };
});

runAdapterTck([{
  name: 'tach', kind: 'tach',
  construction: {
    valid: () => adapter,
    emptyRules: { name: 'rejects empty rules', run: () => tach({ rules: {} }), message: /at least one/u },
    unknownOption: { name: 'rejects unknown option', run: () => tach({ rules, mystery: true } as never), message: /Unknown/u },
    invalidValues: [
      { name: 'rejects an unknown rule', run: () => tach({ rules: { a: 'nope' } } as never), message: /Unknown tach rule/u },
      { name: 'refuses to promise unused dependencies, which the JSON does not carry', run: () => tach({ rules: { a: 'unused-dependency' } } as never), message: /text mode/u },
      { name: 'rejects a rule selected twice', run: () => tach({ rules: { a: 'layer-violation', b: 'layer-violation' } }), message: /more than once/u },
      { name: 'rejects an absolute cwd', run: () => tach({ rules, cwd: '/etc' }), message: /relative path/u },
      { name: 'rejects a cwd that climbs out', run: () => tach({ rules, cwd: '../x' }), message: /relative path/u },
      { name: 'rejects an empty command', run: () => tach({ rules, command: ' ' }), message: /command must not be empty/u },
      { name: 'rejects an invalid timeout', run: () => tach({ rules, timeoutMs: 0 }), message: /positive integer/u },
    ],
  },
  unavailable: [{
    name: 'a missing tach executable REFUSES',
    code: 'command-unavailable',
    run: () => withProject('ok', root =>
      tach({ rules, command: 'redproof-tck-no-such-tach' }).check.run({ root, rules: ['tach/undeclared-dependency'] })),
  }],
  evidence: [{
    rule: 'tach/undeclared-dependency',
    expectedBreaches: [{ code: 'UndeclaredDependency' }],
    violating: () => checked('undeclared.report.json', 1),
    clean: () => checked('ok.report.json', 0),
    unselected,
  }],
  purity: {
    kind: 'sources',
    files: [
      'packages/tach/src/core/decision.ts',
      'packages/tach/src/core/model.ts',
      'packages/tach/src/core/options.ts',
    ],
    allowedExternalImports: ['node:path', 'redproof', 'redproof/command'],
  },
  capabilities: { kind: 'not-applicable', reason: 'The JSON report carries every diagnostic of every selected rule; no selectable rule depends on report features.' },
} satisfies AdapterTckSpec]);

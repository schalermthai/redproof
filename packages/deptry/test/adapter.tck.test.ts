import { runAdapterTck, type AdapterTckSpec, type EvidenceObservation } from '@redproof/adapter-tck';
import { readFileSync } from 'node:fs';
import { deptry } from '../src/index.ts';
import { fakeDeptry, fixtures, header, withProject } from './support/workspace.ts';

const adapter = deptry({ rules: { missing: 'DEP001' } });
const PROJECT = { 'pyproject.toml': '[project]\nname="d"\nversion="0.1"\ndependencies=[]\n', 'a.py': 'import white\n' };

/**
 * Evidence goes through the whole check, so the TCK sees what a Gate sees, including REFUSE.
 * `reported` is a real captured deptry report, replayed by a stand-in executable.
 */
const checked = (reported: string, rule: 'DEP001' | 'DEP002' = 'DEP001'): Promise<EvidenceObservation> => withProject(PROJECT, async root => {
  const report = readFileSync(`${fixtures}${reported}`, 'utf8');
  const command = await fakeDeptry(root, { report, stderr: header(1), exitCode: reported === 'clean.json' ? 0 : 1 });
  const subject = deptry({ rules: { r: rule }, command, allowPerRuleIgnores: true });
  return { kind: 'checked', result: await subject.check.run({ root, rules: [`deptry/${rule}`] }) };
});

runAdapterTck([{
  name: 'deptry', kind: 'deptry',
  construction: {
    valid: () => adapter,
    emptyRules: { name: 'rejects empty rules', run: () => deptry({ rules: {} }), message: /at least one/u },
    unknownOption: { name: 'rejects unknown option', run: () => deptry({ rules: { a: 'DEP001' }, mystery: true } as never), message: /Unknown/u },
    invalidValues: [
      { name: 'rejects a rule deptry does not have', run: () => deptry({ rules: { a: 'DEP006' } }), message: /Unknown deptry rule/u },
      { name: 'rejects a lower-case code', run: () => deptry({ rules: { a: 'dep001' } }), message: /Unknown deptry rule/u },
      { name: 'rejects the same code twice', run: () => deptry({ rules: { a: 'DEP001', b: 'DEP001' } }), message: /selected twice/u },
      { name: 'rejects an absolute path', run: () => deptry({ rules: { a: 'DEP001' }, paths: ['/etc'] }), message: /relative path/u },
      { name: 'rejects an option masquerading as a path', run: () => deptry({ rules: { a: 'DEP001' }, paths: ['--ignore'] }), message: /relative path/u },
      { name: 'rejects a path that climbs out', run: () => deptry({ rules: { a: 'DEP001' }, cwd: '../x' }), message: /relative path/u },
      { name: 'rejects an empty command', run: () => deptry({ rules: { a: 'DEP001' }, command: ' ' }), message: /command must not be empty/u },
      { name: 'rejects an empty path list', run: () => deptry({ rules: { a: 'DEP001' }, paths: [] }), message: /non-empty list/u },
      { name: 'rejects an invalid timeout', run: () => deptry({ rules: { a: 'DEP001' }, timeoutMs: 0 }), message: /positive integer/u },
    ],
  },
  unavailable: [{
    name: 'a missing deptry executable REFUSES',
    code: 'command-unavailable',
    run: () => withProject(PROJECT, root =>
      deptry({ rules: { a: 'DEP001' }, command: 'redproof-tck-no-such-deptry' }).check.run({ root, rules: ['deptry/DEP001'] })),
  }],
  evidence: [{
    rule: 'deptry/DEP001',
    expectedBreaches: [{ code: 'DEP001' }],
    violating: () => checked('example.json'),
    clean: () => checked('clean.json'),
    // deptry always reports every code; a tree that breaks only DEP002 must not fail the DEP001 Gate.
    unselected: () => withProject(PROJECT, async root => {
      const report = JSON.stringify([{ error: { code: 'DEP002', message: 'm' }, module: 'x', location: { file: 'pyproject.toml', line: null, column: null } }]);
      const command = await fakeDeptry(root, { report, stderr: header(1), exitCode: 1 });
      return { kind: 'checked', result: await deptry({ rules: { r: 'DEP001' }, command }).check.run({ root, rules: ['deptry/DEP001'] }) };
    }),
  }],
  purity: {
    kind: 'sources',
    files: [
      'packages/deptry/src/core/decision.ts',
      'packages/deptry/src/core/model.ts',
      'packages/deptry/src/core/options.ts',
    ],
    allowedExternalImports: ['node:path', 'redproof', 'redproof/command'],
  },
  capabilities: { kind: 'not-applicable', reason: 'The JSON report carries every finding of every code; no selectable rule depends on report features.' },
} satisfies AdapterTckSpec]);

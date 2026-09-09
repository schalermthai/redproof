import { defineGate, defineProofs, defineRules, locate, mutate, proof } from 'redproof';
import { commands } from 'redproof/command';
import { node, stripTypes } from './support/node.ts';

const rules = defineRules({
  constructorOptions: {
    id: 'adapters/options-validated-at-construction',
    description: 'Adapters reject configuration that is already invalid before a tool runs.',
  },
  unavailableResult: {
    id: 'adapters/unavailable-execution-refuses',
    description: 'Adapters turn unavailable execution into REFUSE instead of throwing or failing.',
  },
  pureParsers: {
    id: 'adapters/parsers-and-evidence-models-are-pure',
    description: 'Adapter parsers and evidence models remain deterministic and free of I/O.',
  },
  reportCapabilities: {
    id: 'adapters/report-capabilities-are-enforced',
    description: 'Report formats reject Rules for evidence they cannot observe.',
  },
  structuredBreaches: {
    id: 'adapters/breaches-require-structured-evidence',
    description: 'Adapter evidence models create Breaches only for findings a selected Rule names.',
  },
});

function contract(file: string): string[] {
  return stripTypes('--test', file);
}

const gate = defineGate({
  id: 'adapter-contracts',
  rules,
  check: commands({
    mode: 'parallel',
    maxAtOnce: 5,
    label: 'built-in Adapter contracts',
    entries: [
      {
        rule: rules.constructorOptions,
        label: 'constructor contracts',
        command: node,
        args: contract('tests/adapters/adapter-contracts.constructor.test.ts'),
        timeoutMs: 60_000,
        maxOutputBytes: 1_000_000,
      },
      {
        rule: rules.unavailableResult,
        label: 'runner contracts',
        command: node,
        args: contract('tests/adapters/adapter-contracts.runner.test.ts'),
        timeoutMs: 60_000,
        maxOutputBytes: 1_000_000,
      },
      {
        rule: rules.pureParsers,
        label: 'parser contracts',
        command: node,
        args: contract('tests/adapters/adapter-contracts.parser.test.ts'),
        timeoutMs: 60_000,
        maxOutputBytes: 1_000_000,
      },
      {
        rule: rules.reportCapabilities,
        label: 'capability contracts',
        command: node,
        args: contract('tests/adapters/adapter-contracts.capability.test.ts'),
        timeoutMs: 60_000,
        maxOutputBytes: 1_000_000,
      },
      {
        rule: rules.structuredBreaches,
        label: 'structured-evidence contracts',
        command: node,
        args: contract('tests/adapters/adapter-contracts.structured.test.ts'),
        timeoutMs: 60_000,
        maxOutputBytes: 1_000_000,
      },
    ],
  }),
});

export const proofs = defineProofs(gate, [
  proof.red(
    rules.constructorOptions,
    'detects an Adapter that accepts unknown constructor options',
    mutate.removeText(locate.text({
      files: 'packages/eslint/src/index.ts',
      find: "  rejectUnknownKeys(options, ['files', 'rules'], 'ESLint adapter');\n",
    })),
  ),
  proof.red(
    rules.unavailableResult,
    'detects a runner exception mapped to the wrong evidence lane',
    mutate.replaceText(
      locate.text({
        files: 'packages/testing/src/index.ts',
        find: "kind: 'unavailable' as const",
      }),
      "kind: 'completed' as const",
    ),
  ),
  proof.red(
    rules.pureParsers,
    'detects a pure evidence model reaching its I/O shell',
    mutate.appendText('packages/eslint/src/model.ts', "\nimport './index.ts';\n"),
  ),
  proof.red(
    rules.pureParsers,
    'detects ambient process state inside a pure evidence model',
    mutate.appendText('packages/stryker/src/model.ts', '\nvoid process.cwd();\n'),
  ),
  proof.red(
    rules.reportCapabilities,
    'detects a report format that overstates what it can observe',
    mutate.replaceText(
      locate.text({
        files: 'packages/testing/src/reports/junit-xml.ts',
        find: 'capabilities: { todo: false, flaky: false }',
      }),
      'capabilities: { todo: true, flaky: true }',
    ),
  ),
  proof.red(
    rules.structuredBreaches,
    'detects evidence translation that drops selected structured findings',
    mutate.replaceText(
      locate.text({ files: 'packages/eslint/src/model.ts', find: 'if (!message.ruleId) continue;' }),
      'if (message.ruleId) continue;',
    ),
  ),
  proof.refuse(
    'refuses when a contract suite floods its output budget',
    mutate.appendText(
      'tests/adapters/adapter-contracts.constructor.test.ts',
      "\nprocess.stdout.write('x'.repeat(4_000_000));\n",
    ),
  ),
  proof.green('accepts all built-in Adapter contracts'),
]);

export default gate;

import { defineGate, defineProofs, defineRules, mutate, proof } from 'redproof';
import { commands } from 'redproof/command';

const rules = defineRules({
  workspaceCompiles: {
    id: 'static/workspace-compiles',
    description: 'Workspace source, tests, fixtures, and self-hosted Gates must type-check.',
  },
  docsExamplesCompile: {
    id: 'static/docs-examples-compile',
    description: 'Standalone TypeScript examples in the documentation must compile.',
  },
  docsFragmentDebt: {
    id: 'static/docs-fragment-debt-does-not-grow',
    description: 'The number of documentation fragments excluded from compilation must not grow.',
  },
});

const check = commands({
  mode: 'parallel',
  maxAtOnce: 3,
  label: 'workspace types and documentation contracts',
  entries: [
    {
      rule: rules.workspaceCompiles,
      command: process.execPath,
      args: ['node_modules/typescript/bin/tsc', '--noEmit'],
      label: 'workspace TypeScript',
    },
    {
      rule: rules.docsExamplesCompile,
      command: process.execPath,
      args: [
        '--disable-warning=ExperimentalWarning',
        '--experimental-strip-types',
        'scripts/typecheck-docs.ts',
      ],
      label: 'documentation examples',
    },
    {
      rule: rules.docsFragmentDebt,
      command: process.execPath,
      args: [
        '--disable-warning=ExperimentalWarning',
        '--experimental-strip-types',
        'gates/support/check-doc-fragment-budget.ts',
      ],
      label: 'documentation fragment budget',
    },
  ],
});

const gate = defineGate({ id: 'static-contracts', rules, check });

export const proofs = defineProofs(gate, [
  proof.red(
    rules.workspaceCompiles,
    'rejects a workspace type error',
    mutate.createFile(
      'tests/redproof-type-proof.ts',
      "const value: string = 1;\nvoid value;\n",
    ),
  ),
  proof.red(
    rules.docsExamplesCompile,
    'rejects an invalid checked documentation example',
    mutate.createFile(
      'docs/redproof-doc-example-proof.md',
      '# Proof probe\n\n```ts\nconst value: string = 1;\nvoid value;\n```\n',
    ),
  ),
  proof.red(
    rules.docsFragmentDebt,
    'rejects growth in unchecked documentation fragments',
    mutate.createFile(
      'docs/redproof-doc-fragment-proof.md',
      '# Proof probe\n\n```ts fragment\nconst fragment = true;\n```\n',
    ),
  ),
  proof.green('accepts the current workspace and documentation contracts'),
]);

export default gate;

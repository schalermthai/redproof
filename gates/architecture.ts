import { dependencyCruiser } from '@redproof/dependency-cruiser';
import { defineGate, defineProofs, defineRule, mutate, proof } from 'redproof';
import { effectBoundaries } from './checks/effect-boundaries.ts';

const dependencies = dependencyCruiser({
  configFile: '.dependency-cruiser.cjs',
  files: [
    'packages/redproof/src',
    'packages/eslint/src',
    'packages/dependency-cruiser/src',
    'packages/stryker/src',
    'packages/testing/src',
  ],
  rules: {
    noCycles: 'no-cycles',
    coreNoEffectImports: 'core-no-effect-imports',
    coreNoShell: 'core-no-shell',
    domainInwardOnly: 'domain-inward-only',
    compositionNoRuntimeOrReporters: 'composition-no-runtime-or-reporters',
    adaptersPublicCoreApiOnly: 'adapters-public-core-api-only',
    productionNoTestFixtureDependencies: 'production-no-test-fixture-dependencies',
  },
});

const rules = {
  ...dependencies.rules,

  coreNoAmbientInputs: defineRule({
    id: 'architecture/core-no-ambient-inputs',
    description: 'Functional-core modules receive ambient values from the shell.',
  }),
  effectsAllowlistedBoundaries: defineRule({
    id: 'architecture/effects-allowlisted-boundaries',
    description: 'Filesystem, process, clock, randomness, and subprocess effects stay in approved boundary modules.',
  }),
  coreTestsNoIoHelpers: defineRule({
    id: 'architecture/core-tests-no-io-helpers',
    description: 'Functional-core tests use plain values rather than filesystem, subprocess, or workspace fixtures.',
  }),
} as const;

const gate = defineGate({
  id: 'architecture',
  rules,
  check: effectBoundaries({
    dependencies,
    rules,
    sources: 'packages/*/src/**/*.ts',
    coreTests: 'tests/{core,self-hosted-policy}.test.ts',
  }),
});

export const proofs = defineProofs(gate, [
  proof.red(
    rules.noCycles,
    'detects a production dependency cycle',
    [
      mutate.createFile(
        'packages/redproof/src/domain/proof-cycle-a.ts',
        "import { cycleB } from './proof-cycle-b.ts';\nexport const cycleA = cycleB;\n",
      ),
      mutate.createFile(
        'packages/redproof/src/domain/proof-cycle-b.ts',
        "import { cycleA } from './proof-cycle-a.ts';\nexport const cycleB = cycleA;\n",
      ),
    ],
  ),
  proof.red(
    rules.coreNoEffectImports,
    'keeps effect imports out of the functional core',
    mutate.appendText('packages/redproof/src/run/core/exit-code.ts', "\nimport 'node:fs/promises';\n"),
  ),
  proof.red(
    rules.coreNoAmbientInputs,
    'keeps ambient process state out of the functional core',
    mutate.appendText('packages/redproof/src/run/core/exit-code.ts', '\nvoid process.cwd();\n'),
  ),
  proof.red(
    rules.coreNoShell,
    'keeps the imperative shell out of the functional core',
    mutate.appendText('packages/redproof/src/run/core/exit-code.ts', "\nimport '../shell/worker-process.ts';\n"),
  ),
  proof.red(
    rules.domainInwardOnly,
    'keeps domain types independent of outer layers',
    mutate.appendText('packages/redproof/src/domain/rule.ts', "\nimport '../run/core/exit-code.ts';\n"),
  ),
  proof.red(
    rules.compositionNoRuntimeOrReporters,
    'keeps declarative composition independent of runtime orchestration',
    mutate.appendText('packages/redproof/src/composition/options.ts', "\nimport '../run/core/exit-code.ts';\n"),
  ),
  proof.red(
    rules.adaptersPublicCoreApiOnly,
    'keeps adapters on the public Redproof API',
    mutate.appendText('packages/eslint/src/index.ts', "\nimport '../../redproof/src/run/core/exit-code.ts';\n"),
  ),
  proof.red(
    rules.productionNoTestFixtureDependencies,
    'keeps repository fixtures out of publishable source',
    mutate.appendText(
      'packages/redproof/src/domain/rule.ts',
      "\nimport '../../../../fixtures/pass-single/src/parser.ts';\n",
    ),
  ),
  proof.red(
    rules.effectsAllowlistedBoundaries,
    'rejects a new unapproved I/O boundary',
    mutate.createFile(
      'packages/redproof/src/composition/effect-proof.ts',
      "import { readFile } from 'node:fs/promises';\nexport const effectProof = readFile;\n",
    ),
  ),
  proof.red(
    rules.coreTestsNoIoHelpers,
    'keeps filesystem fixtures out of functional-core tests',
    mutate.appendText('tests/self-hosted-policy.test.ts', "\nimport './helpers/workspace.ts';\n"),
  ),
  proof.green('accepts the current functional-core and package boundaries'),
]);

export default gate;

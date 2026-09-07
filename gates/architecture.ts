import { glob, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { dependencyCruiser } from '@redproof/dependency-cruiser';
import {
  breach,
  counting,
  defineGate,
  defineProofs,
  defineRule,
  mutate,
  proof,
  result,
  type Breach,
} from 'redproof';
import {
  analyzeEffects,
  analyzePureTestEffects,
  type EffectFinding,
  type SourceInput,
} from './support/effects-model.ts';

const dependencyAdapter = dependencyCruiser({
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
  ...dependencyAdapter.rules,
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

type ArchitectureRuleRef = typeof rules[keyof typeof rules]['id'];

function effectBreach(
  rule: typeof rules.coreNoAmbientInputs | typeof rules.effectsAllowlistedBoundaries,
  finding: EffectFinding,
): Breach<ArchitectureRuleRef> {
  return breach(rule, {
    code: finding.category === 'import' ? 'effect-import' : 'ambient-input',
    message: `${finding.effect} is used outside its approved imperative boundary.`,
    location: {
      file: finding.file,
      line: finding.line,
      column: finding.column,
    },
  });
}

function coreTestBreach(finding: EffectFinding): Breach<ArchitectureRuleRef> {
  return breach(rules.coreTestsNoIoHelpers, {
    code: 'core-test-effect',
    message: `${finding.effect} is not available to functional-core tests.`,
    location: {
      file: finding.file,
      line: finding.line,
      column: finding.column,
    },
  });
}

async function sourceInputs(root: string, pattern: string): Promise<SourceInput[]> {
  const files: string[] = [];
  for await (const file of glob(pattern, { cwd: root })) files.push(file);
  files.sort();
  return Promise.all(files.map(async file => ({
    file,
    content: await readFile(join(root, file), 'utf8'),
  })));
}

const gate = defineGate({
  id: 'architecture',
  rules,
  check: {
    description: 'enforce source dependencies and functional-core effect boundaries',
    counting: counting.supported,

    async run(ctx) {
      const startedAt = new Date().toISOString();
      const dependencyResult = await dependencyAdapter.check.run({
        root: ctx.root,
        rules: Object.values(dependencyAdapter.rules).map(rule => rule.id),
      });
      if (dependencyResult.verdict === 'refuse') return dependencyResult;

      try {
        const sources = await sourceInputs(ctx.root, 'packages/*/src/**/*.ts');
        const coreTests = await sourceInputs(ctx.root, 'tests/{core,self-hosted-policy}.test.ts');
        const effects = analyzeEffects(sources);
        const testEffects = analyzePureTestEffects(coreTests);
        const breaches: Breach<ArchitectureRuleRef>[] = dependencyResult.verdict === 'fail'
          ? [...dependencyResult.breaches]
          : [];

        for (const finding of effects.coreAmbientInputs) {
          breaches.push(effectBreach(rules.coreNoAmbientInputs, finding));
        }
        for (const finding of effects.unapprovedBoundaries) {
          breaches.push(effectBreach(rules.effectsAllowlistedBoundaries, finding));
        }
        for (const finding of testEffects) breaches.push(coreTestBreach(finding));

        return result.fromBreaches({
          source: 'dependency-cruiser + TypeScript effect scan',
          startedAt,
          finishedAt: new Date().toISOString(),
          inspected: sources.length + coreTests.length,
        }, breaches);
      } catch (error) {
        return result.refuse({
          source: 'dependency-cruiser + TypeScript effect scan',
          startedAt,
          finishedAt: new Date().toISOString(),
          inspected: null,
        }, {
          code: 'effect-scan-unavailable',
          message: 'The source effect scan could not complete.',
          location: null,
          detail: error instanceof Error ? error.message : String(error),
        });
      }
    },
  },
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
    mutate.appendText('packages/redproof/src/runtime/core/exit-code.ts', "\nimport 'node:fs/promises';\n"),
  ),
  proof.red(
    rules.coreNoAmbientInputs,
    'keeps ambient process state out of the functional core',
    mutate.appendText('packages/redproof/src/runtime/core/exit-code.ts', '\nvoid process.cwd();\n'),
  ),
  proof.red(
    rules.coreNoShell,
    'keeps the imperative shell out of the functional core',
    mutate.appendText('packages/redproof/src/runtime/core/exit-code.ts', "\nimport '../shell/worker-process.ts';\n"),
  ),
  proof.red(
    rules.domainInwardOnly,
    'keeps domain types independent of outer layers',
    mutate.appendText('packages/redproof/src/domain/rule.ts', "\nimport '../runtime/core/exit-code.ts';\n"),
  ),
  proof.red(
    rules.compositionNoRuntimeOrReporters,
    'keeps declarative composition independent of runtime orchestration',
    mutate.appendText('packages/redproof/src/composition/options.ts', "\nimport '../runtime/core/exit-code.ts';\n"),
  ),
  proof.red(
    rules.adaptersPublicCoreApiOnly,
    'keeps adapters on the public Redproof API',
    mutate.appendText('packages/eslint/src/index.ts', "\nimport '../../redproof/src/runtime/core/exit-code.ts';\n"),
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
    mutate.appendText(
      'tests/self-hosted-policy.test.ts',
      "\nimport './helpers/workspace.ts';\n",
    ),
  ),
  proof.green('accepts the current functional-core and package boundaries'),
]);

export default gate;

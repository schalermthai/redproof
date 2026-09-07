import assert from 'node:assert/strict';
import test from 'node:test';
import { analyzeEffects, analyzePureTestEffects } from '../gates/support/effects-model.ts';
import {
  evaluateRepositoryPolicy,
  type RepositorySnapshot,
} from '../gates/support/repository-policy-model.ts';

test('effect analysis separates core imports, ambient inputs, and new boundaries', () => {
  const analysis = analyzeEffects([
    {
      file: 'packages/redproof/src/proof/core/example.ts',
      content: "import 'node:fs/promises';\nvoid process.cwd();\n",
    },
    {
      file: 'packages/redproof/src/composition/new-io.ts',
      content: "import 'node:child_process';\n",
    },
    {
      file: 'packages/redproof/src/command/shell/spawn.ts',
      content: "import 'node:child_process';\nvoid process.env;\n",
    },
  ]);

  assert.deepEqual(analysis.coreEffectImports.map(item => item.effect), ['node:fs/promises']);
  assert.deepEqual(analysis.coreAmbientInputs.map(item => item.effect), ['process']);
  assert.deepEqual(analysis.unapprovedBoundaries.map(item => item.file), [
    'packages/redproof/src/composition/new-io.ts',
  ]);
});

test('effect analysis does not confuse a property named process with the global object', () => {
  const analysis = analyzeEffects([{
    file: 'packages/redproof/src/run/core/policy.ts',
    content: "export type Policy = { readonly process: 'child' };\n",
  }]);
  assert.equal(analysis.coreAmbientInputs.length, 0);
});

test('effect analysis reads the clock only from an argument-less new Date', () => {
  const analysis = analyzeEffects([{
    file: 'packages/redproof/src/reporter/core/example.ts',
    content: 'export const epoch = new Date(0);\nexport const now = new Date();\n',
  }]);
  assert.deepEqual(analysis.coreAmbientInputs.map(item => [item.effect, item.line]), [['new Date', 2]]);
});

test('pure-test analysis rejects temporary workspace helpers', () => {
  const findings = analyzePureTestEffects([{
    file: 'tests/proof.core.test.ts',
    content: "import './helpers/workspace.ts';\n",
  }]);
  assert.deepEqual(findings.map(item => item.effect), ['temporary workspace helper']);
});

function repositorySnapshot(): RepositorySnapshot {
  const workflow = [
    'run: npm run check',
    'run: npm run build',
    'run: npm run verify:package',
  ].join('\n');
  const publishWorkflow = [
    workflow,
    'npm pack -w redproof',
    'for PKG in redproof; do',
  ].join('\n');

  return {
    rootScripts: {
      build: 'tsc -p packages/redproof/tsconfig.build.json',
      check: 'npm run self:check && npm run self:prove',
      'self:check': 'redproof check',
      'self:prove': 'redproof prove',
    },
    rootBuildScript: 'tsc -p packages/redproof/tsconfig.build.json',
    manifests: [{
      file: 'packages/redproof/package.json',
      dir: 'packages/redproof',
      name: 'redproof',
      version: '1.0.0',
      manifest: {
        types: './dist/index.d.ts',
        files: ['dist', 'schema'],
        exports: {
          '.': { types: './dist/index.d.ts', default: './dist/index.js' },
        },
      },
    }],
    setVersionSource: "const dirs = ['packages/redproof'];",
    verifyPackageSource: "const packages = [{ name: 'redproof' }];",
    ciWorkflow: workflow,
    publishWorkflow,
    existingPaths: new Set([
      'README.md',
      'docs/guide.md',
      'packages/redproof/src/index.ts',
      'packages/redproof/schema/check-report-v1.schema.json',
      'packages/redproof/schema/prove-report-v1.schema.json',
    ]),
    markdown: [{ file: 'README.md', content: '[guide](docs/)\n' }],
  };
}

test('repository policy accepts a complete value snapshot and directory documentation links', () => {
  assert.deepEqual(evaluateRepositoryPolicy(repositorySnapshot()), []);
});

test('repository automation requires an exact verification command', () => {
  const clean = repositorySnapshot();
  const findings = evaluateRepositoryPolicy({
    ...clean,
    ciWorkflow: clean.ciWorkflow.replace(
      'run: npm run verify:package',
      'run: npm run verify:package-off',
    ),
  });

  assert.deepEqual(findings.map(item => item.code), ['workflow-verification-missing']);
});

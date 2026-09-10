import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { counting, defineAdapter, defineRule, type CheckResult, type Scan } from 'redproof';
import { effectBoundaries } from '../../gates/checks/effect-boundaries.ts';
import { repositoryPolicy } from '../../gates/checks/repository-policy.ts';
import { withWorkspace } from '../helpers/workspace.ts';

const scan: Scan = { source: 'probe', startedAt: '', finishedAt: '', inspected: 1 };

async function seed(root: string, paths: Readonly<Record<string, string>>): Promise<void> {
  for (const [path, content] of Object.entries(paths)) {
    await mkdir(join(root, path, '..'), { recursive: true });
    await writeFile(join(root, path), content, 'utf8');
  }
}

// ---------- effectBoundaries ----------

const effectRules = {
  coreNoAmbientInputs: defineRule({
    id: 'probe/core-no-ambient-inputs',
    description: 'Core modules take ambient values from the shell.',
  }),
  effectsAllowlistedBoundaries: defineRule({
    id: 'probe/effects-allowlisted-boundaries',
    description: 'Effects stay in approved boundary modules.',
  }),
  coreTestsNoIoHelpers: defineRule({
    id: 'probe/core-tests-no-io-helpers',
    description: 'Core tests use plain values.',
  }),
} as const;

const dependencyRule = defineRule({ id: 'probe/dependencies', description: 'Dependency graph is clean.' });

function dependencyAdapter(answer: () => CheckResult<'probe/dependencies'>) {
  return defineAdapter({
    kind: 'probe-dependencies',
    rules: { none: dependencyRule },
    check: {
      description: 'probe dependency graph',
      counting: counting.supported,
      async run() { return answer(); },
    },
  });
}

const cleanDependencies = dependencyAdapter(() => ({ verdict: 'pass', scan }));

function effectCheck(dependencies = cleanDependencies, coreTests = 'tests/**/*.core.test.ts') {
  return effectBoundaries({
    dependencies,
    rules: effectRules,
    sources: 'packages/*/src/**/*.ts',
    coreTests,
  });
}

const effectRuleIds = [...Object.values(effectRules).map(rule => rule.id), dependencyRule.id];

test('effectBoundaries passes clean sources and counts every source and core test it read', async () => {
  await withWorkspace(async root => {
    await seed(root, {
      'packages/probe/src/clean.ts': 'export const clean = 1;\n',
      'packages/probe/src/core/pure.ts': "import { join } from 'node:path';\nexport const pure = join;\n",
      'tests/one.core.test.ts': 'export const pure = 1;\n',
      'tests/two.core.test.ts': 'export const also = 2;\n',
      'tests/skipped.md': 'not a test\n',
    });

    const result = await effectCheck().run({ root, rules: effectRuleIds });

    assert.equal(result.verdict, 'pass');
    assert.equal(result.scan.inspected, 4);
    assert.equal(result.scan.source, 'dependency-cruiser + TypeScript effect scan');
  });
});

test('effectBoundaries reports each kind of finding against its own Rule, at the offending line', async () => {
  await withWorkspace(async root => {
    await seed(root, {
      'packages/probe/src/composition/leak.ts': "import { readFile } from 'node:fs/promises';\nexport const leak = readFile;\n",
      'packages/redproof/src/proof/core/clock.ts': 'export const now = new Date();\n',
      'tests/impure.core.test.ts': "import './helpers/workspace.ts';\n",
    });

    const result = await effectCheck().run({ root, rules: effectRuleIds });

    assert.equal(result.verdict, 'fail');
    if (result.verdict !== 'fail') throw new Error('expected fail');
    assert.deepEqual(result.breaches.map(item => [item.rule, item.code, item.location?.file, item.location?.line]), [
      ['probe/core-no-ambient-inputs', 'ambient-input', 'packages/redproof/src/proof/core/clock.ts', 1],
      ['probe/effects-allowlisted-boundaries', 'effect-import', 'packages/probe/src/composition/leak.ts', 1],
      ['probe/core-tests-no-io-helpers', 'core-test-effect', 'tests/impure.core.test.ts', 1],
    ]);
    assert.deepEqual(result.breaches.map(item => item.message), [
      'new Date is used outside its approved imperative boundary.',
      'node:fs/promises is used outside its approved imperative boundary.',
      'temporary workspace helper is not available to functional-core tests.',
    ]);
  });
});

test('effectBoundaries carries the dependency breaches first, and fails on them alone', async () => {
  await withWorkspace(async root => {
    await seed(root, { 'packages/probe/src/clean.ts': 'export const clean = 1;\n', 'tests/one.core.test.ts': 'export const pure = 1;\n' });

    const failing = dependencyAdapter(() => ({
      verdict: 'fail',
      scan,
      breaches: [{ rule: dependencyRule.id, code: 'cycle', message: 'A cycle exists.', location: null }],
    }));

    const result = await effectBoundaries({
      dependencies: failing,
      rules: effectRules,
      sources: 'packages/*/src/**/*.ts',
      coreTests: 'tests/**/*.core.test.ts',
    }).run({ root, rules: effectRuleIds });

    assert.equal(result.verdict, 'fail');
    if (result.verdict !== 'fail') throw new Error('expected fail');
    assert.deepEqual(result.breaches.map(item => item.rule), ['probe/dependencies']);
    assert.equal(result.scan.inspected, 2, 'the effect scan still reports what it read');
  });
});

test('effectBoundaries REFUSES when the dependency Check refuses, without scanning sources', async () => {
  await withWorkspace(async root => {
    await seed(root, { 'packages/probe/src/composition/leak.ts': "import 'node:fs/promises';\n" });

    const refusing = dependencyAdapter(() => ({
      verdict: 'refuse',
      scan,
      why: { code: 'dependency-cruiser-unavailable', message: 'The configuration is missing.', location: null },
    }));

    const result = await effectCheck(refusing).run({ root, rules: effectRuleIds });

    assert.equal(result.verdict, 'refuse');
    if (result.verdict !== 'refuse') throw new Error('expected refuse');
    assert.equal(result.why.code, 'dependency-cruiser-unavailable');
  });
});

test('effectBoundaries REFUSES when a source it must scan cannot be read', async () => {
  await withWorkspace(async root => {
    await mkdir(join(root, 'packages/probe/src/blocked.ts'), { recursive: true });

    const result = await effectCheck().run({ root, rules: effectRuleIds });

    assert.equal(result.verdict, 'refuse');
    if (result.verdict !== 'refuse') throw new Error('expected refuse');
    assert.equal(result.why.code, 'effect-scan-unavailable');
    assert.equal(result.why.message, 'The source effect scan could not complete.');
    assert.equal(result.scan.inspected, null);
  });
});

// ---------- repositoryPolicy ----------

const policyRules = {
  packageInventory: defineRule({ id: 'probe/inventory', description: 'Inventory is consistent.' }),
  versionAlignment: defineRule({ id: 'probe/versions', description: 'Versions align.' }),
  packageBoundaries: defineRule({ id: 'probe/package-boundaries', description: 'Package boundaries hold.' }),
  publicFiles: defineRule({ id: 'probe/public-files', description: 'Public files are declared.' }),
  automationVerification: defineRule({ id: 'probe/automation', description: 'Automation verifies.' }),
  docsLinks: defineRule({ id: 'probe/docs-links', description: 'Links resolve.' }),
} as const;

const policyRuleIds = Object.values(policyRules).map(rule => rule.id);

const policyCheck = () => repositoryPolicy({
  rules: policyRules,
  documents: ['README.md', 'docs/**/*.md'],
  linkTargets: ['README.md', 'docs/**/*', 'packages/**/*'],
});

const workflow = 'run: npm run check\nrun: npm run build\nrun: npm run verify:package\n';

async function seedRepository(root: string, extra: Readonly<Record<string, string>> = {}): Promise<void> {
  await seed(root, {
    'package.json': JSON.stringify({
      scripts: {
        build: 'tsc -p packages/redproof/tsconfig.build.json',
        check: 'npm run self:check && npm run self:prove',
        'self:check': 'redproof check',
        'self:prove': 'redproof prove',
      },
    }),
    'packages/redproof/package.json': JSON.stringify({
      name: 'redproof',
      version: '1.0.0',
      types: './dist/index.d.ts',
      files: ['dist', 'schema'],
      exports: { '.': { types: './dist/index.d.ts', default: './dist/index.js' } },
    }),
    'packages/redproof/src/index.ts': 'export {};\n',
    'packages/redproof/schema/check-report-v1.schema.json': '{}',
    'packages/redproof/schema/prove-report-v1.schema.json': '{}',
    'scripts/set-version.ts': "const dirs = ['packages/redproof'];\n",
    'scripts/verify-package.ts': "const packages = [{ name: 'redproof' }];\n",
    '.github/workflows/ci.yml': workflow,
    '.github/workflows/publish.yml': `${workflow}npm pack -w redproof\nfor PKG in redproof; do\n`,
    'README.md': '[docs](docs/guide.md)\n',
    'docs/guide.md': '# Guide\n',
    ...extra,
  });
}

test('repositoryPolicy passes a healthy repository and counts the manifests and documents it read', async () => {
  await withWorkspace(async root => {
    await seedRepository(root);

    const result = await policyCheck().run({ root, rules: policyRuleIds });

    assert.equal(result.verdict, 'pass', JSON.stringify(result));
    assert.equal(result.scan.inspected, 3, 'one manifest plus two documents');
    assert.equal(result.scan.source, 'repository policy');
  });
});

test('repositoryPolicy reports each policy finding against its own Rule and file', async () => {
  await withWorkspace(async root => {
    await seedRepository(root, {
      '.github/workflows/ci.yml': 'run: npm run check\nrun: npm run build\n',
      'docs/guide.md': '# Guide\n\n[gone](missing.md)\n',
    });

    const result = await policyCheck().run({ root, rules: policyRuleIds });

    assert.equal(result.verdict, 'fail');
    if (result.verdict !== 'fail') throw new Error('expected fail');
    assert.deepEqual(result.breaches.map(item => [item.rule, item.code, item.location?.file]), [
      ['probe/automation', 'workflow-verification-missing', '.github/workflows/ci.yml'],
      ['probe/docs-links', 'broken-relative-doc-link', 'docs/guide.md'],
    ]);
    assert.deepEqual(result.breaches.map(item => [item.location?.line, item.location?.column]), [[null, null], [null, null]]);
    assert.equal(result.breaches[1]?.detail, 'missing.md', 'the breach keeps the link as written');
    assert.equal(
      result.breaches[1]?.message,
      'docs/guide.md points to missing docs/missing.md.',
      'a relative link resolves against the document that holds it',
    );
  });
});

test('a document matched by two patterns is read once', async () => {
  await withWorkspace(async root => {
    await seedRepository(root);

    const check = repositoryPolicy({
      rules: policyRules,
      documents: ['docs/**/*.md', 'docs/guide.md'],
      linkTargets: ['README.md', 'docs/**/*', 'packages/**/*'],
    });
    const result = await check.run({ root, rules: policyRuleIds });

    assert.equal(result.verdict, 'pass');
    assert.equal(result.scan.inspected, 2, 'one manifest plus one document');
  });
});

test('repositoryPolicy REFUSES when a required input file is missing', async () => {
  await withWorkspace(async root => {
    await writeFile(join(root, 'package.json'), '{"scripts":{}}\n', 'utf8');

    const result = await policyCheck().run({ root, rules: policyRuleIds });

    assert.equal(result.verdict, 'refuse');
    if (result.verdict !== 'refuse') throw new Error('expected refuse');
    assert.equal(result.why.code, 'repository-policy-unavailable');
    assert.equal(result.why.message, 'Repository policy inputs could not be read.');
    assert.ok(result.why.detail?.includes('set-version.ts'), result.why.detail);
    assert.equal(result.scan.inspected, null);
  });
});

test('repositoryPolicy REFUSES when a package manifest has no name or version', async () => {
  await withWorkspace(async root => {
    await seedRepository(root, { 'packages/one/package.json': '{"private":true}\n' });

    const result = await policyCheck().run({ root, rules: policyRuleIds });

    assert.equal(result.verdict, 'refuse');
    if (result.verdict !== 'refuse') throw new Error('expected refuse');
    assert.ok(
      result.why.detail?.includes('packages/one/package.json is missing name or version.'),
      result.why.detail,
    );
  });
});

import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { breach, defineAdapter, defineRule, counting, type CheckResult, type Scan } from 'redproof';
import { scanning } from '../gates/support/scanning.ts';
import { readSources, listPaths } from '../gates/support/sources.ts';
import { node, stripTypes, tsc } from '../gates/support/node.ts';
import { effectBoundaries } from '../gates/checks/effect-boundaries.ts';
import { repositoryPolicy } from '../gates/checks/repository-policy.ts';
import { nodeTestSuite } from '../gates/checks/node-test-suite.ts';
import { withWorkspace } from './helpers/workspace.ts';

const ruleA = defineRule({ id: 'probe/a', description: 'Rule A.' });
const ruleB = defineRule({ id: 'probe/b', description: 'Rule B.' });

const scan: Scan = { source: 'probe', startedAt: '', finishedAt: '', inspected: 1 };

function counted(inspected: number) {
  return scanning<'probe/a' | 'probe/b', number>({
    description: 'probe',
    source: 'probe scan',
    gather: async () => inspected,
    inspected: value => value,
    breaches: value => value === 0 ? [] : [breach(ruleA, { code: 'x', message: 'x', location: null })],
    whenUnavailable: { code: 'probe-unavailable', message: 'Probe inputs could not be read.' },
  });
}

// ---------- scanning: the shared plumbing ----------

test('scanning reports PASS with the inspected count and a closed scan window', async () => {
  const result = await counted(0).run({ root: '.', rules: [ruleA.id] });

  assert.equal(result.verdict, 'pass');
  assert.equal(result.scan.source, 'probe scan');
  assert.equal(result.scan.inspected, 0);
  assert.ok(result.scan.startedAt.length > 0);
  assert.ok(result.scan.finishedAt >= result.scan.startedAt);
});

test('scanning reports FAIL when the Check produces findings', async () => {
  const result = await counted(3).run({ root: '.', rules: [ruleA.id] });

  assert.equal(result.verdict, 'fail');
  assert.equal(result.scan.inspected, 3);
  assert.deepEqual(result.breaches.map(item => item.rule), ['probe/a']);
});

test('scanning REFUSES when the inputs cannot be read, and never reports PASS', async () => {
  const check = scanning<'probe/a', never>({
    description: 'probe',
    source: 'probe scan',
    gather: async () => { throw new Error('disk on fire'); },
    inspected: () => 0,
    breaches: () => [],
    whenUnavailable: { code: 'probe-unavailable', message: 'Probe inputs could not be read.' },
  });

  const result = await check.run({ root: '.', rules: [ruleA.id] });

  assert.equal(result.verdict, 'refuse');
  assert.equal(result.why.code, 'probe-unavailable');
  assert.equal(result.why.detail, 'disk on fire');
  assert.equal(result.scan.inspected, null);
});

test('scanning carries a delegate FAIL and keeps its breaches first', async () => {
  const delegated: CheckResult<'probe/b'> = {
    verdict: 'fail',
    scan,
    breaches: [breach(ruleB, { code: 'y', message: 'y', location: null })],
  };
  const check = scanning<'probe/a' | 'probe/b', number>({
    description: 'probe',
    source: 'probe scan',
    delegate: async () => delegated,
    gather: async () => 1,
    inspected: () => 1,
    breaches: () => [breach(ruleA, { code: 'x', message: 'x', location: null })],
    whenUnavailable: { code: 'probe-unavailable', message: 'unreadable' },
  });

  const result = await check.run({ root: '.', rules: [ruleA.id, ruleB.id] });

  assert.equal(result.verdict, 'fail');
  assert.deepEqual(result.breaches.map(item => item.rule), ['probe/b', 'probe/a']);
});

test('a delegate REFUSE wins, and the Check never gathers its own inputs', async () => {
  let gathered = false;
  const check = scanning<'probe/a' | 'probe/b', number>({
    description: 'probe',
    source: 'probe scan',
    delegate: async () => ({
      verdict: 'refuse',
      scan,
      why: { code: 'delegate-unavailable', message: 'delegate could not run', location: null },
    }),
    gather: async () => { gathered = true; return 1; },
    inspected: () => 1,
    breaches: () => [],
    whenUnavailable: { code: 'probe-unavailable', message: 'unreadable' },
  });

  const result = await check.run({ root: '.', rules: [ruleA.id, ruleB.id] });

  assert.equal(result.verdict, 'refuse');
  assert.equal(result.why.code, 'delegate-unavailable');
  assert.equal(gathered, false, 'a refused delegate must stop the Check');
});

test('a delegate PASS adds no breaches of its own', async () => {
  const check = scanning<'probe/a' | 'probe/b', number>({
    description: 'probe',
    source: 'probe scan',
    delegate: async () => ({ verdict: 'pass', scan }),
    gather: async () => 1,
    inspected: () => 1,
    breaches: () => [],
    whenUnavailable: { code: 'probe-unavailable', message: 'unreadable' },
  });

  assert.equal((await check.run({ root: '.', rules: [ruleA.id] })).verdict, 'pass');
});

// ---------- sources and node helpers ----------

test('readSources returns matching files in a stable order with their content', async () => {
  await withWorkspace(async root => {
    await mkdir(join(root, 'src'), { recursive: true });
    await writeFile(join(root, 'src/b.ts'), 'export const b = 2;\n', 'utf8');
    await writeFile(join(root, 'src/a.ts'), 'export const a = 1;\n', 'utf8');
    await writeFile(join(root, 'src/skip.md'), 'not source\n', 'utf8');

    const found = await readSources(root, 'src/**/*.ts');

    assert.deepEqual(found.map(file => file.file), ['src/a.ts', 'src/b.ts']);
    assert.equal(found[0]?.content, 'export const a = 1;\n');
  });
});

test('listPaths gathers every pattern and excludes dependency directories', async () => {
  await withWorkspace(async root => {
    await mkdir(join(root, 'docs'), { recursive: true });
    await mkdir(join(root, 'packages/one/node_modules/dep'), { recursive: true });
    await writeFile(join(root, 'docs/guide.md'), '#\n', 'utf8');
    await writeFile(join(root, 'packages/one/index.ts'), 'export {};\n', 'utf8');
    await writeFile(join(root, 'packages/one/node_modules/dep/index.js'), '\n', 'utf8');

    const paths = await listPaths(root, ['docs/**/*', 'packages/**/*']);

    assert.ok(paths.has('docs/guide.md'));
    assert.ok(paths.has('packages/one/index.ts'));
    for (const path of paths) {
      assert.ok(!path.includes('/node_modules/'), `${path} must be excluded`);
    }
  });
});

test('node helpers build the runtime arguments a Gate needs', () => {
  assert.equal(node, process.execPath);
  assert.deepEqual(stripTypes('scripts/run.ts'), [
    '--disable-warning=ExperimentalWarning',
    '--experimental-strip-types',
    'scripts/run.ts',
  ]);
  assert.deepEqual(tsc('--noEmit'), ['node_modules/typescript/bin/tsc', '--noEmit']);
});

test('nodeTestSuite runs the matching files with a JUnit report destination', async () => {
  await withWorkspace(async root => {
    await mkdir(join(root, 'tests'), { recursive: true });
    await writeFile(join(root, 'tests/one.test.ts'), '\n', 'utf8');
    await writeFile(join(root, 'tests/two.test.ts'), '\n', 'utf8');
    await writeFile(join(root, 'tests/helper.ts'), '\n', 'utf8');

    const built = nodeTestSuite({ files: 'tests/**/*.test.ts' });
    const args = built.argsFor?.({ root, reportFile: '/tmp/report.xml' }) ?? [];

    assert.ok(args.includes('--test'));
    assert.ok(args.includes('--test-reporter=junit'));
    assert.ok(args.includes('--test-reporter-destination=/tmp/report.xml'));
    assert.deepEqual(
      args.filter((arg: string) => arg.endsWith('.ts')),
      ['tests/one.test.ts', 'tests/two.test.ts'],
    );
  });
});

test('nodeTestSuite names the pattern it runs, so the description cannot drift', () => {
  const built = nodeTestSuite({ files: 'tests/unit/**/*.spec.ts' });

  assert.equal(
    built.description,
    'run tests/unit/**/*.spec.ts under node --test with a JUnit report',
  );
  assert.deepEqual(built.plan, { command: process.execPath });
});

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

const noDependencyFindings = defineAdapter({
  kind: 'probe-dependencies',
  rules: { none: defineRule({ id: 'probe/dependencies', description: 'Dependency graph is clean.' }) },
  check: {
    description: 'probe dependency graph',
    counting: counting.supported,
    async run() { return { verdict: 'pass', scan } as const; },
  },
});

test('effectBoundaries reports an unapproved effect import against its own Rule', async () => {
  await withWorkspace(async root => {
    await mkdir(join(root, 'packages/probe/src/composition'), { recursive: true });
    await writeFile(
      join(root, 'packages/probe/src/composition/leak.ts'),
      "import { readFile } from 'node:fs/promises';\nexport const leak = readFile;\n",
      'utf8',
    );

    const check = effectBoundaries({
      dependencies: noDependencyFindings,
      rules: effectRules,
      sources: 'packages/*/src/**/*.ts',
      coreTests: 'tests/none.test.ts',
    });

    const result = await check.run({ root, rules: Object.values(effectRules).map(rule => rule.id) });

    assert.equal(result.verdict, 'fail');
    assert.deepEqual(
      [...new Set(result.breaches.map(item => item.rule))],
      ['probe/effects-allowlisted-boundaries'],
    );
    assert.equal(result.breaches[0]?.location?.file, 'packages/probe/src/composition/leak.ts');
  });
});

test('effectBoundaries counts every source and core test it inspected', async () => {
  await withWorkspace(async root => {
    await mkdir(join(root, 'packages/probe/src'), { recursive: true });
    await mkdir(join(root, 'tests'), { recursive: true });
    await writeFile(join(root, 'packages/probe/src/clean.ts'), 'export const clean = 1;\n', 'utf8');
    await writeFile(join(root, 'tests/core.test.ts'), 'export const pure = 1;\n', 'utf8');

    const check = effectBoundaries({
      dependencies: noDependencyFindings,
      rules: effectRules,
      sources: 'packages/*/src/**/*.ts',
      coreTests: 'tests/core.test.ts',
    });

    const result = await check.run({ root, rules: Object.values(effectRules).map(rule => rule.id) });

    assert.equal(result.verdict, 'pass');
    assert.equal(result.scan.inspected, 2);
  });
});

// ---------- repositoryPolicy ----------

const policyRules = {
  packageInventory: defineRule({ id: 'probe/inventory', description: 'Inventory is consistent.' }),
  versionAlignment: defineRule({ id: 'probe/versions', description: 'Versions align.' }),
  publicFiles: defineRule({ id: 'probe/public-files', description: 'Public files are declared.' }),
  automationVerification: defineRule({ id: 'probe/automation', description: 'Automation verifies.' }),
  docsLinks: defineRule({ id: 'probe/docs-links', description: 'Links resolve.' }),
} as const;

test('repositoryPolicy REFUSES when a required input file is missing', async () => {
  await withWorkspace(async root => {
    await writeFile(join(root, 'package.json'), '{"scripts":{}}\n', 'utf8');

    const check = repositoryPolicy({
      rules: policyRules,
      documents: ['README.md'],
      linkTargets: ['README.md'],
    });

    const result = await check.run({ root, rules: Object.values(policyRules).map(rule => rule.id) });

    assert.equal(result.verdict, 'refuse');
    assert.equal(result.why.code, 'repository-policy-unavailable');
    assert.ok(result.why.detail?.includes('set-version.ts'), result.why.detail);
    assert.equal(result.scan.inspected, null);
  });
});

test('repositoryPolicy REFUSES when a package manifest has no name or version', async () => {
  await withWorkspace(async root => {
    await mkdir(join(root, 'packages/one'), { recursive: true });
    await writeFile(join(root, 'package.json'), '{"scripts":{}}\n', 'utf8');
    await writeFile(join(root, 'packages/one/package.json'), '{"private":true}\n', 'utf8');

    const check = repositoryPolicy({
      rules: policyRules,
      documents: ['README.md'],
      linkTargets: ['README.md'],
    });

    const result = await check.run({ root, rules: Object.values(policyRules).map(rule => rule.id) });

    assert.equal(result.verdict, 'refuse');
    assert.ok(
      result.why.detail?.includes('packages/one/package.json is missing name or version.'),
      result.why.detail,
    );
  });
});

import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { nodeTestSuite } from '../../gates/checks/node-test-suite.ts';
import { node, stripTypes, tsc } from '../../gates/support/node.ts';
import { listPaths, readSources } from '../../gates/support/sources.ts';
import { withWorkspace } from '../helpers/workspace.ts';

async function seed(root: string, paths: Readonly<Record<string, string>>): Promise<void> {
  for (const [path, content] of Object.entries(paths)) {
    await mkdir(join(root, path, '..'), { recursive: true });
    await writeFile(join(root, path), content, 'utf8');
  }
}

test('readSources returns every matching file in a stable order with its own content', async () => {
  await withWorkspace(async root => {
    await seed(root, {
      'src/b.ts': 'export const b = 2;\n',
      'src/a.ts': 'export const a = 1;\n',
      'src/nested/c.ts': 'export const c = 3;\n',
      'src/skip.md': 'not source\n',
    });

    const found = await readSources(root, 'src/**/*.ts');

    assert.deepEqual(found, [
      { file: 'src/a.ts', content: 'export const a = 1;\n' },
      { file: 'src/b.ts', content: 'export const b = 2;\n' },
      { file: 'src/nested/c.ts', content: 'export const c = 3;\n' },
    ]);
  });
});

test('readSources over a pattern that matches nothing returns nothing', async () => {
  await withWorkspace(async root => {
    assert.deepEqual(await readSources(root, 'src/**/*.ts'), []);
  });
});

test('listPaths gathers every pattern once and lists nothing from inside a dependency directory', async () => {
  await withWorkspace(async root => {
    await seed(root, {
      'docs/guide.md': '#\n',
      'packages/one/index.ts': 'export {};\n',
      'packages/one/node_modules/dep/index.js': '\n',
      'node_modules/top/index.js': '\n',
      'other/ignored.txt': '\n',
    });

    const paths = await listPaths(root, ['docs/**/*', 'packages/**/*', 'packages/one/index.ts']);

    assert.deepEqual(
      [...paths].sort(),
      ['docs/guide.md', 'packages/one', 'packages/one/index.ts', 'packages/one/node_modules'],
    );
    for (const path of paths) {
      assert.ok(!path.includes('/node_modules/'), `${path} must not be listed`);
    }
  });
});

test('node helpers name this runtime and build the argument lists a Gate needs', () => {
  assert.equal(node, process.execPath, 'a Gate runs the same Node that runs Redproof');
  assert.deepEqual(stripTypes('scripts/run.ts', '--flag'), [
    '--disable-warning=ExperimentalWarning',
    '--experimental-strip-types',
    'scripts/run.ts',
    '--flag',
  ]);
  assert.deepEqual(tsc('--noEmit'), ['node_modules/typescript/bin/tsc', '--noEmit']);
});

test('nodeTestSuite names the pattern it runs, so its description cannot drift', () => {
  const built = nodeTestSuite({ files: 'tests/unit/**/*.spec.ts' });

  assert.equal(built.description, 'run tests/unit/**/*.spec.ts under node --test with a JUnit report');
  assert.deepEqual(built.plan, { command: process.execPath });
});

test('nodeTestSuite runs exactly the matching files, in a stable order, reporting JUnit to the given file', async () => {
  await withWorkspace(async root => {
    await seed(root, {
      'tests/two.test.ts': '\n',
      'tests/one.test.ts': '\n',
      'tests/nested/three.test.ts': '\n',
      'tests/helper.ts': '\n',
    });

    const args = nodeTestSuite({ files: 'tests/**/*.test.ts' }).argsFor?.({ root, reportFile: '/tmp/report.xml' }) ?? [];

    assert.deepEqual(args, [
      '--disable-warning=ExperimentalWarning',
      '--experimental-strip-types',
      '--test',
      '--test-reporter=junit',
      '--test-reporter-destination=/tmp/report.xml',
      'tests/nested/three.test.ts',
      'tests/one.test.ts',
      'tests/two.test.ts',
    ]);
  });
});

test('nodeTestSuite builds its file list per run, so a new test file is picked up', async () => {
  await withWorkspace(async root => {
    const runner = nodeTestSuite({ files: 'tests/**/*.test.ts' });
    await seed(root, { 'tests/one.test.ts': '\n' });

    const before = runner.argsFor?.({ root, reportFile: 'r.xml' }) ?? [];
    await seed(root, { 'tests/two.test.ts': '\n' });
    const after = runner.argsFor?.({ root, reportFile: 'r.xml' }) ?? [];

    assert.deepEqual(before.filter(arg => arg.endsWith('.ts')), ['tests/one.test.ts']);
    assert.deepEqual(after.filter(arg => arg.endsWith('.ts')), ['tests/one.test.ts', 'tests/two.test.ts']);
  });
});

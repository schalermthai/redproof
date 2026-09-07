import assert from 'node:assert/strict';
import { lstat, mkdir, readFile, readlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';

import {
  copyGateWorkspace,
  pathInsideCopy,
  releaseGateWorkspace,
  verifyTree,
} from 'redproof';
import { withWorkspace } from './helpers/workspace.ts';

test('copies tracked nested node_modules fixtures while linking root dependencies', async () => {
  await withWorkspace(async root => {
    const nestedFixture = join(
      root,
      'test/fixtures/node_modules/example-package/package.json',
    );
    await mkdir(join(root, 'node_modules/root-package'), { recursive: true });
    await mkdir(join(root, '.git'), { recursive: true });
    await mkdir(join(root, '.redproof'), { recursive: true });
    await mkdir(join(nestedFixture, '..'), { recursive: true });
    await writeFile(
      nestedFixture,
      '{"name":"example-package","version":"1.0.0"}\n',
      'utf8',
    );

    const workspace = await copyGateWorkspace(root, 'nested-node-modules');
    try {
      assert.equal(
        await readFile(
          join(
            workspace.root,
            'test/fixtures/node_modules/example-package/package.json',
          ),
          'utf8',
        ),
        '{"name":"example-package","version":"1.0.0"}\n',
      );
      assert.equal((await lstat(join(workspace.root, 'node_modules'))).isSymbolicLink(), true);
      await assert.rejects(lstat(join(workspace.root, '.git')));
      await assert.rejects(lstat(join(workspace.root, '.redproof')));
    } finally {
      await releaseGateWorkspace(workspace);
    }
  });
});

test('nested proof copies inherit dependencies from an outer copied workspace', async () => {
  await withWorkspace(async root => {
    await mkdir(join(root, 'node_modules/root-package'), { recursive: true });
    await writeFile(
      join(root, 'node_modules/root-package/package.json'),
      '{"name":"root-package","version":"1.0.0"}\n',
      'utf8',
    );
    await mkdir(join(root, 'fixtures/project'), { recursive: true });
    await writeFile(join(root, 'fixtures/project/package.json'), '{"private":true}\n', 'utf8');

    const outer = await copyGateWorkspace(root, 'outer');
    try {
      const inner = await copyGateWorkspace(join(outer.root, 'fixtures/project'), 'inner');
      try {
        assert.equal((await lstat(join(inner.root, 'node_modules'))).isSymbolicLink(), true);
        assert.equal(
          await readFile(join(inner.root, 'node_modules/root-package/package.json'), 'utf8'),
          '{"name":"root-package","version":"1.0.0"}\n',
        );
      } finally {
        await releaseGateWorkspace(inner);
      }
    } finally {
      await releaseGateWorkspace(outer);
    }
  });
});

test('a nested copy links to the real dependencies, not to the copy above it', async () => {
  await withWorkspace(async root => {
    await mkdir(join(root, 'node_modules/root-package'), { recursive: true });
    await writeFile(
      join(root, 'node_modules/root-package/package.json'),
      '{"name":"root-package","version":"1.0.0"}\n',
      'utf8',
    );
    await mkdir(join(root, 'fixtures/project'), { recursive: true });
    await writeFile(join(root, 'fixtures/project/package.json'), '{"private":true}\n', 'utf8');

    const outer = await copyGateWorkspace(root, 'outer');
    const inner = await copyGateWorkspace(join(outer.root, 'fixtures/project'), 'inner');
    try {
      // The inner link must not point at the outer copy, or releasing the outer
      // copy first would take the inner copy's dependencies with it.
      const target = await readlink(join(inner.root, 'node_modules'));
      assert.ok(
        !target.startsWith(outer.root),
        `inner node_modules must not link through the outer copy, got ${target}`,
      );

      await releaseGateWorkspace(outer);

      assert.equal(
        await readFile(join(inner.root, 'node_modules/root-package/package.json'), 'utf8'),
        '{"name":"root-package","version":"1.0.0"}\n',
      );
    } finally {
      await releaseGateWorkspace(inner);
    }
  });
});

test('a fresh copy matches its baseline, and a changed file is reported as stale by name', async () => {
  await withWorkspace(async root => {
    await mkdir(join(root, 'src'));
    await writeFile(join(root, 'src/state.txt'), 'original\n', 'utf8');

    const workspace = await copyGateWorkspace(root, 'freshness');
    try {
      assert.deepEqual(await verifyTree(workspace.root, workspace.baseline), { kind: 'fresh' });

      await writeFile(pathInsideCopy(root, workspace.root, join(root, 'src/state.txt')), 'changed\n', 'utf8');
      const stale = await verifyTree(workspace.root, workspace.baseline);
      assert.equal(stale.kind, 'stale');
      if (stale.kind !== 'stale') throw new Error('expected stale');
      assert.match(stale.why, /changed paths: modified src\/state\.txt$/);
    } finally {
      await releaseGateWorkspace(workspace);
    }
  });
});

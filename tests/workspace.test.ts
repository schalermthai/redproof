import assert from 'node:assert/strict';
import { lstat, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';

import {
  copyGateWorkspace,
  releaseGateWorkspace,
} from '../packages/redproof/src/runtime/workspace.ts';
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

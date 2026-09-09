import assert from 'node:assert/strict';
import {
  chmod,
  lstat,
  mkdir,
  readFile,
  readlink,
  realpath,
  rm,
  symlink,
  utimes,
  writeFile,
} from 'node:fs/promises';
import { basename, join } from 'node:path';
import test from 'node:test';

import {
  copyGateWorkspace,
  pathInsideCopy,
  releaseGateWorkspace,
  stampTree,
  verifyTree,
  type GateWorkspace,
} from 'redproof';
import { withWorkspace } from '../helpers/workspace.ts';

async function seedProject(root: string): Promise<void> {
  await mkdir(join(root, 'src/nested'), { recursive: true });
  await mkdir(join(root, 'src/empty'));
  await writeFile(join(root, 'src/index.ts'), 'export const one = 1;\n');
  await writeFile(join(root, 'src/nested/two.ts'), 'export const two = 2;\n');
  await writeFile(join(root, 'src/run.sh'), '#!/bin/sh\n');
  await chmod(join(root, 'src/run.sh'), 0o755);
  await symlink('index.ts', join(root, 'src/link.ts'));

  await mkdir(join(root, 'test/fixtures/node_modules/example-package'), { recursive: true });
  await writeFile(
    join(root, 'test/fixtures/node_modules/example-package/package.json'),
    '{"name":"example-package"}\n',
  );

  await mkdir(join(root, 'node_modules/root-package'), { recursive: true });
  await writeFile(join(root, 'node_modules/root-package/package.json'), '{"name":"root-package"}\n');
  await mkdir(join(root, '.git/objects'), { recursive: true });
  await writeFile(join(root, '.git/HEAD'), 'ref: refs/heads/main\n');
  await mkdir(join(root, '.redproof'));
  await writeFile(join(root, '.redproof/report.json'), '{}\n');
}

async function withCopy(fn: (root: string, workspace: GateWorkspace) => Promise<void>): Promise<void> {
  await withWorkspace(async root => {
    await seedProject(root);
    const workspace = await copyGateWorkspace(root, 'gates/workspace test');
    try {
      await fn(root, workspace);
    } finally {
      await releaseGateWorkspace(workspace);
    }
  });
}

async function staleWhy(workspace: GateWorkspace): Promise<string> {
  const freshness = await verifyTree(workspace.root, workspace.baseline);
  assert.equal(freshness.kind, 'stale');
  if (freshness.kind !== 'stale') throw new Error('expected stale');
  return freshness.why;
}

test('a copy reproduces the project files, permission bits, symlinks, empty directories, and nested node_modules fixtures', async () => {
  await withCopy(async (root, workspace) => {
    for (const subtree of ['src', 'test']) {
      const source = await stampTree(join(root, subtree));
      const copy = await stampTree(join(workspace.root, subtree));
      assert.equal(copy.digest, source.digest, `${subtree} digest`);
      assert.equal(copy.entries, source.entries, `${subtree} entry count`);
    }

    assert.equal(await readFile(join(workspace.root, 'src/index.ts'), 'utf8'), 'export const one = 1;\n');
    assert.notEqual((await lstat(join(workspace.root, 'src/run.sh'))).mode & 0o111, 0, 'run.sh stays executable');
    assert.equal(await readlink(join(workspace.root, 'src/link.ts')), 'index.ts');
    assert.equal((await lstat(join(workspace.root, 'src/empty'))).isDirectory(), true);
    assert.equal(
      await readFile(join(workspace.root, 'test/fixtures/node_modules/example-package/package.json'), 'utf8'),
      '{"name":"example-package"}\n',
    );
  });
});

test('a copy leaves out version control and reporter output, and links the root node_modules to the real dependencies', async () => {
  await withCopy(async (root, workspace) => {
    await assert.rejects(lstat(join(workspace.root, '.git')));
    await assert.rejects(lstat(join(workspace.root, '.redproof')));

    const link = join(workspace.root, 'node_modules');
    assert.equal((await lstat(link)).isSymbolicLink(), true);
    assert.equal(await readlink(link), await realpath(join(root, 'node_modules')));
    assert.equal(await readFile(join(link, 'root-package/package.json'), 'utf8'), '{"name":"root-package"}\n');
  });
});

test('a copy lives outside the project, under a directory name taken from the Gate id', async () => {
  await withCopy(async (root, workspace) => {
    assert.equal(workspace.root.startsWith(root), false, `copy ${workspace.root} sits inside the project`);
    assert.match(basename(workspace.root), /^redproof-gates-workspace-test-/);
  });
});

test('releasing a workspace removes the whole copy', async () => {
  await withWorkspace(async root => {
    await seedProject(root);
    const workspace = await copyGateWorkspace(root, 'release');

    await releaseGateWorkspace(workspace);

    await assert.rejects(lstat(workspace.root));
  });
});

test('a nested copy of a project inside a copy links to the real dependencies and survives the release of the outer copy', async () => {
  await withCopy(async (root, outer) => {
    const inner = await copyGateWorkspace(join(outer.root, 'test'), 'inner');
    try {
      const link = join(inner.root, 'node_modules');
      assert.equal((await lstat(link)).isSymbolicLink(), true);
      assert.equal(await readlink(link), await realpath(join(root, 'node_modules')));

      await releaseGateWorkspace(outer);

      assert.equal(await readFile(join(link, 'root-package/package.json'), 'utf8'), '{"name":"root-package"}\n');
    } finally {
      await releaseGateWorkspace(inner);
    }
  });
});

test('a fresh copy passes the restore check, and reporter output under .redproof at the copy root does not count', async () => {
  await withCopy(async (_root, workspace) => {
    assert.deepEqual(await verifyTree(workspace.root, workspace.baseline), { kind: 'fresh' });

    await mkdir(join(workspace.root, '.redproof'));
    await writeFile(join(workspace.root, '.redproof/report.json'), '{"ok":true}\n');
    assert.deepEqual(await verifyTree(workspace.root, workspace.baseline), { kind: 'fresh' });

    await mkdir(join(workspace.root, 'src/.redproof'));
    assert.match(await staleWhy(workspace), /changed paths: added src\/\.redproof$/);
  });
});

test('a file added to the copy is reported by name', async () => {
  await withCopy(async (_root, workspace) => {
    await writeFile(join(workspace.root, 'src/nested/three.ts'), 'export const three = 3;\n');

    assert.match(await staleWhy(workspace), /changed paths: added src\/nested\/three\.ts$/);
  });
});

test('a file removed from the copy is reported by name', async () => {
  await withCopy(async (_root, workspace) => {
    await rm(join(workspace.root, 'src/nested/two.ts'));

    assert.match(await staleWhy(workspace), /changed paths: removed src\/nested\/two\.ts$/);
  });
});

test('a file rewritten with different content of the same size is reported as modified, at its project path', async () => {
  await withCopy(async (root, workspace) => {
    await writeFile(pathInsideCopy(root, workspace.root, join(root, 'src/index.ts')), 'export const one = 2;\n');

    assert.match(await staleWhy(workspace), /changed paths: modified src\/index\.ts$/);
  });
});

test('a file touched without a content change stays fresh', async () => {
  await withCopy(async (_root, workspace) => {
    const file = join(workspace.root, 'src/index.ts');
    await writeFile(file, 'export const one = 1;\n');
    await utimes(file, new Date('2000-01-01T00:00:00Z'), new Date('2000-01-01T00:00:00Z'));

    assert.deepEqual(await verifyTree(workspace.root, workspace.baseline), { kind: 'fresh' });
  });
});

test('an empty directory left behind is reported as added', async () => {
  await withCopy(async (_root, workspace) => {
    await mkdir(join(workspace.root, 'src/left-behind'));

    assert.match(await staleWhy(workspace), /changed paths: added src\/left-behind$/);
  });
});

test('a symlink that points somewhere else is reported as modified', async () => {
  await withCopy(async (_root, workspace) => {
    const link = join(workspace.root, 'src/link.ts');
    await rm(link);
    await symlink('nested/two.ts', link);

    assert.match(await staleWhy(workspace), /changed paths: modified src\/link\.ts$/);
  });
});

test('a symlink replaced by a regular file with the same bytes is reported as modified', async () => {
  await withCopy(async (_root, workspace) => {
    const link = join(workspace.root, 'src/link.ts');
    await rm(link);
    await writeFile(link, 'export const one = 1;\n');

    assert.match(await staleWhy(workspace), /changed paths: modified src\/link\.ts$/);
  });
});

test('a permission change is reported as modified', async () => {
  await withCopy(async (_root, workspace) => {
    await chmod(join(workspace.root, 'src/run.sh'), 0o644);

    assert.match(await staleWhy(workspace), /changed paths: modified src\/run\.sh$/);
  });
});

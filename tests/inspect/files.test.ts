import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { files } from 'redproof';
import { withWorkspace } from '../helpers/workspace.ts';

async function seed(root: string, paths: Readonly<Record<string, string>>): Promise<void> {
  for (const [path, content] of Object.entries(paths)) {
    await mkdir(join(root, path, '..'), { recursive: true });
    await writeFile(join(root, path), content, 'utf8');
  }
}

test('files.find returns sorted root-relative file paths and skips directories', async () => {
  await withWorkspace(async root => {
    await seed(root, { 'src/b.ts': '', 'src/a.ts': '', 'src/nested/c.ts': '', 'other/d.ts': '' });

    assert.deepEqual(await files.find({ root }, 'src/**'), ['src/a.ts', 'src/b.ts', 'src/nested/c.ts']);
    assert.deepEqual(await files.find({ root }, 'src/*.ts'), ['src/a.ts', 'src/b.ts']);
    assert.deepEqual(await files.find({ root }, 'missing/**'), []);
  });
});

test('files.find merges several include patterns without repeating a file', async () => {
  await withWorkspace(async root => {
    await seed(root, { 'src/a.ts': '', 'src/b.ts': '', 'docs/c.md': '' });

    assert.deepEqual(await files.find({ root }, ['src/**/*.ts', 'src/a.ts', 'docs/*.md']), ['docs/c.md', 'src/a.ts', 'src/b.ts']);
    assert.deepEqual(await files.find({ root }, { include: ['src/**/*.ts', 'src/a.ts'] }), ['src/a.ts', 'src/b.ts']);
  });
});

test('files.find drops every path that any exclude pattern matches', async () => {
  await withWorkspace(async root => {
    await seed(root, { 'src/a.ts': '', 'src/a.test.ts': '', 'src/gen/b.ts': '', 'src/c.ts': '' });

    assert.deepEqual(
      await files.find({ root }, { include: 'src/**/*.ts', exclude: 'src/**/*.test.ts' }),
      ['src/a.ts', 'src/c.ts', 'src/gen/b.ts'],
    );
    assert.deepEqual(
      await files.find({ root }, { include: 'src/**/*.ts', exclude: ['src/**/*.test.ts', 'src/gen/**'] }),
      ['src/a.ts', 'src/c.ts'],
    );
  });
});

test('files.read returns the content, and files.write creates missing parent directories', async () => {
  await withWorkspace(async root => {
    await seed(root, { 'src/a.ts': 'export const a = 1;\n' });

    assert.equal(await files.read({ root }, 'src/a.ts'), 'export const a = 1;\n');

    await files.write({ root }, 'generated/deep/b.ts', 'export const b = 2;\n');
    assert.equal(await readFile(join(root, 'generated/deep/b.ts'), 'utf8'), 'export const b = 2;\n');

    await files.write({ root }, 'src/a.ts', 'replaced\n');
    assert.equal(await files.read({ root }, 'src/a.ts'), 'replaced\n');
  });
});

test('files.read rejects for a path that does not exist', async () => {
  await withWorkspace(async root => {
    await assert.rejects(files.read({ root }, 'missing.ts'), /ENOENT/);
  });
});

test('files.exists answers for files and directories, and files.remove removes a tree or nothing', async () => {
  await withWorkspace(async root => {
    await seed(root, { 'gen/a.ts': '', 'gen/deep/b.ts': '' });

    assert.equal(await files.exists({ root }, 'gen/a.ts'), true);
    assert.equal(await files.exists({ root }, 'gen'), true);
    assert.equal(await files.exists({ root }, 'gen/missing.ts'), false);

    await files.remove({ root }, 'gen');
    assert.equal(await files.exists({ root }, 'gen'), false);

    await files.remove({ root }, 'gen');
    assert.equal(await files.exists({ root }, 'gen'), false, 'removing a missing path is not an error');
  });
});

test('files.rename moves a file into a directory that does not exist yet', async () => {
  await withWorkspace(async root => {
    await seed(root, { 'src/a.ts': 'moved\n' });

    await files.rename({ root }, 'src/a.ts', 'moved/deep/a.ts');

    assert.equal(await files.exists({ root }, 'src/a.ts'), false);
    assert.equal(await files.read({ root }, 'moved/deep/a.ts'), 'moved\n');
  });
});

test('files.rename rejects when the source does not exist', async () => {
  await withWorkspace(async root => {
    await assert.rejects(files.rename({ root }, 'missing.ts', 'moved.ts'), /ENOENT/);
  });
});

import assert from 'node:assert/strict';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { mutate } from 'redproof';
import { withWorkspace } from '../../helpers/workspace.ts';

test('createFile creates a new file and undo removes it', async () => {
  await withWorkspace(async root => {
    const mutation = mutate.createFile('src/new.ts', 'export const x = 1;\n');
    const undo = await mutation.apply(root);
    assert.equal(await readFile(join(root, 'src/new.ts'), 'utf8'), 'export const x = 1;\n');
    await undo();
    await assert.rejects(readFile(join(root, 'src/new.ts'), 'utf8'));
    await assert.rejects(stat(join(root, 'src')), 'undo should remove parent directories created only for the mutation');
  });
});

test('createFile refuses to overwrite an existing path', async () => {
  await withWorkspace(async root => {
    await mkdir(join(root, 'src'), { recursive: true });
    await writeFile(join(root, 'src/a.ts'), 'before', 'utf8');
    await assert.rejects(mutate.createFile('src/a.ts', 'after').apply(root), /already exists/);
    assert.equal(await readFile(join(root, 'src/a.ts'), 'utf8'), 'before');
  });
});

test('deleteFile removes a file and undo restores it', async () => {
  await withWorkspace(async root => {
    await mkdir(join(root, 'src'), { recursive: true });
    const path = join(root, 'src/a.ts');
    await writeFile(path, 'before', 'utf8');
    const undo = await mutate.deleteFile('src/a.ts').apply(root);
    await assert.rejects(readFile(path, 'utf8'));
    await undo();
    assert.equal(await readFile(path, 'utf8'), 'before');
  });
});

test('move relocates a path and undo restores both source and destination state', async () => {
  await withWorkspace(async root => {
    await mkdir(join(root, 'src'), { recursive: true });
    await writeFile(join(root, 'src/a.ts'), 'A', 'utf8');
    await writeFile(join(root, 'src/b.ts'), 'B', 'utf8');

    const undo = await mutate.move('src/a.ts', 'src/b.ts').apply(root);
    assert.equal(await readFile(join(root, 'src/b.ts'), 'utf8'), 'A');
    await undo();
    assert.equal(await readFile(join(root, 'src/a.ts'), 'utf8'), 'A');
    assert.equal(await readFile(join(root, 'src/b.ts'), 'utf8'), 'B');
  });
});

test('writeText overwrites existing content and restores it', async () => {
  await withWorkspace(async root => {
    await mkdir(join(root, 'src'), { recursive: true });
    const path = join(root, 'src/a.ts');
    await writeFile(path, 'before', 'utf8');
    const undo = await mutate.writeText('src/a.ts', 'after').apply(root);
    assert.equal(await readFile(path, 'utf8'), 'after');
    await undo();
    assert.equal(await readFile(path, 'utf8'), 'before');
  });
});

test('writeText to a new nested path removes created directories on undo', async () => {
  await withWorkspace(async root => {
    const undo = await mutate.writeText('generated/deep/a.txt', 'new').apply(root);
    assert.equal(await readFile(join(root, 'generated/deep/a.txt'), 'utf8'), 'new');
    await undo();
    await assert.rejects(stat(join(root, 'generated')));
  });
});

test('remove handles directories and undo restores their complete contents', async () => {
  await withWorkspace(async root => {
    await mkdir(join(root, 'generated/nested'), { recursive: true });
    await writeFile(join(root, 'generated/nested/a.txt'), 'A', 'utf8');
    const undo = await mutate.remove('generated').apply(root);
    await assert.rejects(stat(join(root, 'generated')));
    await undo();
    assert.equal(await readFile(join(root, 'generated/nested/a.txt'), 'utf8'), 'A');
  });
});

test('deleteFile rejects directories rather than recursively deleting them', async () => {
  await withWorkspace(async root => {
    await mkdir(join(root, 'src'), { recursive: true });
    await assert.rejects(mutate.deleteFile('src').apply(root), /not a file/);
    assert.ok((await stat(join(root, 'src'))).isDirectory());
  });
});

test('rename moves a path and undo restores it', async () => {
  await withWorkspace(async root => {
    await mkdir(join(root, 'src'), { recursive: true });
    await writeFile(join(root, 'src/a.ts'), 'A', 'utf8');
    const undo = await mutate.rename('src/a.ts', 'renamed/deep/a.ts').apply(root);
    assert.equal(await readFile(join(root, 'renamed/deep/a.ts'), 'utf8'), 'A');
    await undo();
    assert.equal(await readFile(join(root, 'src/a.ts'), 'utf8'), 'A');
    await assert.rejects(stat(join(root, 'renamed')));
  });
});

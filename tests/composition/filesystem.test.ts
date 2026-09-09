import assert from 'node:assert/strict';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { mutate } from 'redproof';
import { withWorkspace } from '../helpers/workspace.ts';

async function missing(path: string): Promise<boolean> {
  try {
    await stat(path);
    return false;
  } catch {
    return true;
  }
}

test('createFile creates a new file, and undo removes it with the directories made for it', async () => {
  await withWorkspace(async root => {
    const undo = await mutate.createFile('src/new.ts', 'export const x = 1;\n').apply(root);
    assert.equal(await readFile(join(root, 'src/new.ts'), 'utf8'), 'export const x = 1;\n');
    await undo();
    assert.ok(await missing(join(root, 'src/new.ts')));
    assert.ok(await missing(join(root, 'src')), 'undo removes a parent directory created only for the mutation');
  });
});

test('createFile refuses to overwrite an existing path and leaves it untouched', async () => {
  await withWorkspace(async root => {
    await mkdir(join(root, 'src'), { recursive: true });
    await writeFile(join(root, 'src/a.ts'), 'before', 'utf8');
    await assert.rejects(mutate.createFile('src/a.ts', 'after').apply(root), /Cannot create src\/a\.ts: path already exists\./);
    assert.equal(await readFile(join(root, 'src/a.ts'), 'utf8'), 'before');
  });
});

test('writeText overwrites existing content and undo restores it byte for byte', async () => {
  await withWorkspace(async root => {
    await mkdir(join(root, 'src'), { recursive: true });
    const path = join(root, 'src/a.ts');
    await writeFile(path, 'before\r\n', 'utf8');
    const undo = await mutate.writeText('src/a.ts', 'after').apply(root);
    assert.equal(await readFile(path, 'utf8'), 'after');
    await undo();
    assert.equal(await readFile(path, 'utf8'), 'before\r\n');
  });
});

test('writeText to a new nested path removes only the directories it created on undo', async () => {
  await withWorkspace(async root => {
    await mkdir(join(root, 'generated'), { recursive: true });
    const undo = await mutate.writeText('generated/deep/er/a.txt', 'new').apply(root);
    assert.equal(await readFile(join(root, 'generated/deep/er/a.txt'), 'utf8'), 'new');
    await undo();
    assert.ok(await missing(join(root, 'generated/deep')), 'created directories are removed');
    assert.ok((await stat(join(root, 'generated'))).isDirectory(), 'a directory that existed before stays');
  });
});

test('undo keeps a created directory that other work has populated since', async () => {
  await withWorkspace(async root => {
    const undo = await mutate.writeText('generated/deep/a.txt', 'new').apply(root);
    await writeFile(join(root, 'generated/other.txt'), 'kept', 'utf8');
    await undo();
    assert.ok(await missing(join(root, 'generated/deep')));
    assert.equal(await readFile(join(root, 'generated/other.txt'), 'utf8'), 'kept');
  });
});

test('deleteFile removes a file and undo restores its content', async () => {
  await withWorkspace(async root => {
    await mkdir(join(root, 'src'), { recursive: true });
    const path = join(root, 'src/a.ts');
    await writeFile(path, 'before', 'utf8');
    const undo = await mutate.deleteFile('src/a.ts').apply(root);
    assert.ok(await missing(path));
    await undo();
    assert.equal(await readFile(path, 'utf8'), 'before');
  });
});

test('deleteFile rejects a directory and a missing path', async () => {
  await withWorkspace(async root => {
    await mkdir(join(root, 'src'), { recursive: true });
    await assert.rejects(mutate.deleteFile('src').apply(root), /Cannot delete src: path is not a file\./);
    assert.ok((await stat(join(root, 'src'))).isDirectory());
    await assert.rejects(mutate.deleteFile('src/none.ts').apply(root), /Cannot delete src\/none\.ts: file does not exist\./);
  });
});

test('remove deletes a whole directory and undo restores its complete contents', async () => {
  await withWorkspace(async root => {
    await mkdir(join(root, 'generated/nested'), { recursive: true });
    await writeFile(join(root, 'generated/nested/a.txt'), 'A', 'utf8');
    await writeFile(join(root, 'generated/b.txt'), 'B', 'utf8');
    const undo = await mutate.remove('generated').apply(root);
    assert.ok(await missing(join(root, 'generated')));
    await undo();
    assert.equal(await readFile(join(root, 'generated/nested/a.txt'), 'utf8'), 'A');
    assert.equal(await readFile(join(root, 'generated/b.txt'), 'utf8'), 'B');
  });
});

test('remove rejects a path that does not exist', async () => {
  await withWorkspace(async root => {
    await assert.rejects(mutate.remove('generated').apply(root), /Cannot remove generated: path does not exist\./);
  });
});

test('rename moves a file into a new directory, and undo puts it back and removes that directory', async () => {
  await withWorkspace(async root => {
    await mkdir(join(root, 'src'), { recursive: true });
    await writeFile(join(root, 'src/a.ts'), 'A', 'utf8');
    const undo = await mutate.rename('src/a.ts', 'renamed/deep/a.ts').apply(root);
    assert.equal(await readFile(join(root, 'renamed/deep/a.ts'), 'utf8'), 'A');
    assert.ok(await missing(join(root, 'src/a.ts')));
    await undo();
    assert.equal(await readFile(join(root, 'src/a.ts'), 'utf8'), 'A');
    assert.ok(await missing(join(root, 'renamed')));
  });
});

test('move over an existing destination replaces it, and undo restores both files', async () => {
  await withWorkspace(async root => {
    await mkdir(join(root, 'src'), { recursive: true });
    await writeFile(join(root, 'src/a.ts'), 'A', 'utf8');
    await writeFile(join(root, 'src/b.ts'), 'B', 'utf8');

    const undo = await mutate.move('src/a.ts', 'src/b.ts').apply(root);
    assert.equal(await readFile(join(root, 'src/b.ts'), 'utf8'), 'A');
    assert.ok(await missing(join(root, 'src/a.ts')));
    await undo();
    assert.equal(await readFile(join(root, 'src/a.ts'), 'utf8'), 'A');
    assert.equal(await readFile(join(root, 'src/b.ts'), 'utf8'), 'B');
  });
});

test('rename and move reject a source that does not exist', async () => {
  await withWorkspace(async root => {
    await assert.rejects(mutate.rename('src/a.ts', 'src/b.ts').apply(root), /Cannot rename src\/a\.ts: path does not exist\./);
    await assert.rejects(mutate.move('src/a.ts', 'src/b.ts').apply(root), /Cannot move src\/a\.ts: path does not exist\./);
    assert.ok(await missing(join(root, 'src')), 'a refused rename creates nothing');
  });
});

test('every filesystem mutation describes itself by the path it changes', () => {
  assert.match(mutate.createFile('src/a.ts', '').description, /src\/a\.ts/);
  assert.match(mutate.writeText('src/a.ts', '').description, /src\/a\.ts/);
  assert.match(mutate.deleteFile('src/a.ts').description, /src\/a\.ts/);
  assert.match(mutate.remove('src/a.ts').description, /src\/a\.ts/);
  assert.match(mutate.rename('src/a.ts', 'src/b.ts').description, /src\/a\.ts.*src\/b\.ts/);
  assert.match(mutate.move('src/a.ts', 'src/b.ts').description, /src\/a\.ts.*src\/b\.ts/);
});

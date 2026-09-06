import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { locate, mutate } from 'redproof';
import { withWorkspace } from '../../helpers/workspace.ts';

test('text locator defaults to exactly one match so mutations fail instead of guessing', async () => {
  await withWorkspace(async root => {
    await mkdir(join(root, 'src'), { recursive: true });
    await writeFile(join(root, 'src/a.ts'), 'MARK\nMARK\n', 'utf8');
    const mutation = mutate.replaceText(locate.text({ files: 'src/a.ts', find: 'MARK' }), 'BROKEN');
    await assert.rejects(mutation.apply(root), /expected exactly one match but found 2/);
  });
});

test('insertAfter changes intended text and UndoMutation restores the file', async () => {
  await withWorkspace(async root => {
    await mkdir(join(root, 'src'), { recursive: true });
    const path = join(root, 'src/a.ts');
    const before = 'export const answer = 42;\n';
    await writeFile(path, before, 'utf8');

    const undo = await mutate.insertAfter(
      locate.text({ files: 'src/a.ts', find: 'export const answer = 42;' }),
      '\n// TODO: proof',
    ).apply(root);
    assert.match(await readFile(path, 'utf8'), /TODO: proof/);
    await undo();
    assert.equal(await readFile(path, 'utf8'), before);
  });
});

test('replaceAllText mutates all matching files and restores all of them', async () => {
  await withWorkspace(async root => {
    await mkdir(join(root, 'src'), { recursive: true });
    await writeFile(join(root, 'src/a.ts'), 'TODO TODO\n', 'utf8');
    await writeFile(join(root, 'src/b.ts'), 'TODO\n', 'utf8');

    const undo = await mutate.replaceAllText({ files: 'src/*.ts', find: 'TODO' }, 'DONE').apply(root);
    assert.equal(await readFile(join(root, 'src/a.ts'), 'utf8'), 'DONE DONE\n');
    assert.equal(await readFile(join(root, 'src/b.ts'), 'utf8'), 'DONE\n');
    await undo();
    assert.equal(await readFile(join(root, 'src/a.ts'), 'utf8'), 'TODO TODO\n');
    assert.equal(await readFile(join(root, 'src/b.ts'), 'utf8'), 'TODO\n');
  });
});

test('insertLine and removeLine use 1-based line numbers and undo exactly', async () => {
  await withWorkspace(async root => {
    await mkdir(join(root, 'src'), { recursive: true });
    const path = join(root, 'src/a.txt');
    const before = 'one\ntwo\nthree\n';
    await writeFile(path, before, 'utf8');

    const undoInsert = await mutate.insertLine('src/a.txt', 2, 'inserted').apply(root);
    assert.equal(await readFile(path, 'utf8'), 'one\ninserted\ntwo\nthree\n');
    await undoInsert();
    assert.equal(await readFile(path, 'utf8'), before);

    const undoRemove = await mutate.removeLine('src/a.txt', 2).apply(root);
    assert.equal(await readFile(path, 'utf8'), 'one\nthree\n');
    await undoRemove();
    assert.equal(await readFile(path, 'utf8'), before);
  });
});

test('appendText appends and undo restores exactly', async () => {
  await withWorkspace(async root => {
    await mkdir(join(root, 'src'), { recursive: true });
    const path = join(root, 'src/a.txt');
    await writeFile(path, 'A', 'utf8');
    const undo = await mutate.appendText('src/a.txt', 'B').apply(root);
    assert.equal(await readFile(path, 'utf8'), 'AB');
    await undo();
    assert.equal(await readFile(path, 'utf8'), 'A');
  });
});

test('replaceText, insertBefore, and removeText each restore the original source', async () => {
  await withWorkspace(async root => {
    await mkdir(join(root, 'src'), { recursive: true });
    const path = join(root, 'src/a.txt');
    const before = 'alpha MARK omega\n';
    await writeFile(path, before, 'utf8');
    const locator = () => locate.text({ files: 'src/a.txt', find: 'MARK' });

    const undoReplace = await mutate.replaceText(locator(), 'VALUE').apply(root);
    assert.equal(await readFile(path, 'utf8'), 'alpha VALUE omega\n');
    await undoReplace();
    assert.equal(await readFile(path, 'utf8'), before);

    const undoBefore = await mutate.insertBefore(locator(), 'BEFORE-').apply(root);
    assert.equal(await readFile(path, 'utf8'), 'alpha BEFORE-MARK omega\n');
    await undoBefore();
    assert.equal(await readFile(path, 'utf8'), before);

    const undoRemove = await mutate.removeText(locator()).apply(root);
    assert.equal(await readFile(path, 'utf8'), 'alpha  omega\n');
    await undoRemove();
    assert.equal(await readFile(path, 'utf8'), before);
  });
});

test('locator occurrence can intentionally select first, last, or an indexed match', async () => {
  await withWorkspace(async root => {
    await mkdir(join(root, 'src'), { recursive: true });
    const path = join(root, 'src/a.txt');
    const before = 'X X X';
    await writeFile(path, before, 'utf8');

    const undo = await mutate.replaceText(
      locate.text({ files: 'src/a.txt', find: 'X', occurrence: 1 }),
      'Y',
    ).apply(root);
    assert.equal(await readFile(path, 'utf8'), 'X Y X');
    await undo();
    assert.equal(await readFile(path, 'utf8'), before);
  });
});

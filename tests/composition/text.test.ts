import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { locate, mutate } from 'redproof';
import { withWorkspace } from '../helpers/workspace.ts';

async function withFile(
  content: string,
  fn: (root: string, read: () => Promise<string>) => Promise<void>,
): Promise<void> {
  await withWorkspace(async root => {
    await mkdir(join(root, 'src'), { recursive: true });
    const path = join(root, 'src/a.txt');
    await writeFile(path, content, 'utf8');
    await fn(root, () => readFile(path, 'utf8'));
  });
}

test('a text locator demands exactly one match, so a mutation fails instead of guessing', async () => {
  await withFile('MARK\nMARK\n', async (root, read) => {
    await assert.rejects(
      mutate.replaceText(locate.text({ files: 'src/a.txt', find: 'MARK' }), 'BROKEN').apply(root),
      /Text locator expected exactly one match but found 2\./,
    );
    assert.equal(await read(), 'MARK\nMARK\n', 'a refused mutation changes nothing');
  });
});

test('a text locator that finds nothing fails and changes nothing', async () => {
  await withFile('alpha omega\n', async (root, read) => {
    await assert.rejects(
      mutate.replaceText(locate.text({ files: 'src/a.txt', find: 'ABSENT' }), 'X').apply(root),
      /Text locator did not match anything\./,
    );
    await assert.rejects(
      mutate.replaceAllText({ files: 'src/*.txt', find: 'ABSENT' }, 'X').apply(root),
      /replaceAllText did not match anything\./,
    );
    assert.equal(await read(), 'alpha omega\n');
  });
});

test('replaceText, insertBefore, insertAfter, and removeText each change only the located span', async () => {
  await withFile('alpha MARK omega\n', async (root, read) => {
    const at = () => locate.text({ files: 'src/a.txt', find: 'MARK' });

    for (const [mutation, expected] of [
      [mutate.replaceText(at(), 'VALUE'), 'alpha VALUE omega\n'],
      [mutate.insertBefore(at(), 'BEFORE-'), 'alpha BEFORE-MARK omega\n'],
      [mutate.insertAfter(at(), '-AFTER'), 'alpha MARK-AFTER omega\n'],
      [mutate.removeText(at()), 'alpha  omega\n'],
    ] as const) {
      const undo = await mutation.apply(root);
      assert.equal(await read(), expected, mutation.description);
      await undo();
      assert.equal(await read(), 'alpha MARK omega\n', `undo after ${mutation.description}`);
    }
  });
});

test('occurrence selects a specific match: first, last, or a zero-based index', async () => {
  for (const [occurrence, expected] of [
    ['first', 'Y X X'],
    ['last', 'X X Y'],
    [1, 'X Y X'],
  ] as const) {
    await withFile('X X X', async (root, read) => {
      const undo = await mutate.replaceText(
        locate.text({ files: 'src/a.txt', find: 'X', occurrence }),
        'Y',
      ).apply(root);
      assert.equal(await read(), expected, `occurrence ${occurrence}`);
      await undo();
      assert.equal(await read(), 'X X X');
    });
  }
});

test('a regular expression locator matches by pattern and keeps its own flags', async () => {
  await withFile('todo TODO\n', async (root, read) => {
    const undo = await mutate.replaceText(
      locate.text({ files: 'src/a.txt', find: /TODO/ }),
      'DONE',
    ).apply(root);
    assert.equal(await read(), 'todo DONE\n', 'a case-sensitive pattern matches only the upper-case marker');
    await undo();

    await assert.rejects(
      mutate.replaceText(locate.text({ files: 'src/a.txt', find: /todo/i }), 'DONE').apply(root),
      /expected exactly one match but found 2/,
    );
  });
});

test('replaceAllText replaces every match in every matching file, and undo restores them all', async () => {
  await withWorkspace(async root => {
    await mkdir(join(root, 'src'), { recursive: true });
    await writeFile(join(root, 'src/a.ts'), 'TODO middle TODO\n', 'utf8');
    await writeFile(join(root, 'src/b.ts'), 'TODO\n', 'utf8');
    await writeFile(join(root, 'src/c.md'), 'TODO\n', 'utf8');

    const undo = await mutate.replaceAllText({ files: 'src/*.ts', find: 'TODO' }, 'DONE').apply(root);
    assert.equal(await readFile(join(root, 'src/a.ts'), 'utf8'), 'DONE middle DONE\n');
    assert.equal(await readFile(join(root, 'src/b.ts'), 'utf8'), 'DONE\n');
    assert.equal(await readFile(join(root, 'src/c.md'), 'utf8'), 'TODO\n', 'unselected files are untouched');
    await undo();
    assert.equal(await readFile(join(root, 'src/a.ts'), 'utf8'), 'TODO middle TODO\n');
    assert.equal(await readFile(join(root, 'src/b.ts'), 'utf8'), 'TODO\n');
  });
});

test('replaceAllText with a longer replacement still lands on every original span', async () => {
  await withFile('X-X-X', async (root, read) => {
    const undo = await mutate.replaceAllText({ files: 'src/a.txt', find: 'X' }, 'LONGER').apply(root);
    assert.equal(await read(), 'LONGER-LONGER-LONGER');
    await undo();
    assert.equal(await read(), 'X-X-X');
  });
});

test('insertLine and removeLine count lines from 1 and undo exactly', async () => {
  await withFile('one\ntwo\nthree\n', async (root, read) => {
    const undoInsert = await mutate.insertLine('src/a.txt', 2, 'inserted').apply(root);
    assert.equal(await read(), 'one\ninserted\ntwo\nthree\n');
    await undoInsert();
    assert.equal(await read(), 'one\ntwo\nthree\n');

    const undoFirst = await mutate.insertLine('src/a.txt', 1, 'first').apply(root);
    assert.equal(await read(), 'first\none\ntwo\nthree\n');
    await undoFirst();

    const undoRemove = await mutate.removeLine('src/a.txt', 2).apply(root);
    assert.equal(await read(), 'one\nthree\n');
    await undoRemove();
    assert.equal(await read(), 'one\ntwo\nthree\n');
  });
});

test('a line number outside the file, or not a positive integer, is refused', async () => {
  await withFile('one\ntwo\n', async (root, read) => {
    await assert.rejects(mutate.insertLine('src/a.txt', 0, 'x').apply(root), /Line number must be a positive 1-based integer\./);
    await assert.rejects(mutate.removeLine('src/a.txt', 1.5).apply(root), /Line number must be a positive 1-based integer\./);
    await assert.rejects(mutate.removeLine('src/a.txt', 9).apply(root), /Line 9 is out of range; file has 3 lines\./);
    assert.equal(await read(), 'one\ntwo\n');
  });
});

test('insertLine keeps the line ending style of the file and does not double one it was given', async () => {
  await withFile('one\r\ntwo\r\n', async (root, read) => {
    const undo = await mutate.insertLine('src/a.txt', 2, 'inserted').apply(root);
    assert.equal(await read(), 'one\r\ninserted\r\ntwo\r\n');
    await undo();

    const undoGiven = await mutate.insertLine('src/a.txt', 1, 'given\r\n').apply(root);
    assert.equal(await read(), 'given\r\none\r\ntwo\r\n');
    await undoGiven();
    assert.equal(await read(), 'one\r\ntwo\r\n');
  });
});

test('appendText adds to the end of the file and undo restores it exactly', async () => {
  await withFile('A', async (root, read) => {
    const undo = await mutate.appendText('src/a.txt', 'B').apply(root);
    assert.equal(await read(), 'AB');
    await undo();
    assert.equal(await read(), 'A');
  });
});

test('a text mutation describes itself by what it looks for', () => {
  const at = locate.text({ files: 'src/a.txt', find: 'MARK' });
  assert.equal(mutate.replaceText(at, 'X').description, 'replace "MARK"');
  assert.equal(mutate.removeText(at).description, 'remove "MARK"');
  assert.equal(mutate.insertBefore(at, 'X').description, 'insert text before "MARK"');
  assert.equal(mutate.insertAfter(at, 'X').description, 'insert text after "MARK"');
  assert.equal(mutate.replaceAllText({ files: 'src/a.txt', find: /TODO/g }, 'X').description, 'replace all /TODO/g');
  assert.equal(mutate.appendText('src/a.txt', 'X').description, 'append text to src/a.txt');
});

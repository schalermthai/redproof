import assert from 'node:assert/strict';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { defineMutation, mutate } from 'redproof';
import { withWorkspace } from '../helpers/workspace.ts';

async function missing(path: string): Promise<boolean> {
  try {
    await stat(path);
    return false;
  } catch {
    return true;
  }
}

async function withState(fn: (root: string, read: () => Promise<string>) => Promise<void>): Promise<void> {
  await withWorkspace(async root => {
    await mkdir(join(root, 'src'), { recursive: true });
    const path = join(root, 'src/state.txt');
    await writeFile(path, 'SAFE\n', 'utf8');
    await fn(root, () => readFile(path, 'utf8'));
  });
}

test('a captured mutation gets its undo without hand-written restore logic', async () => {
  await withState(async (root, read) => {
    const mutation = defineMutation({
      description: 'break state',
      capture: 'src/state.txt',
      async apply(ctx) {
        await ctx.files.write('src/state.txt', 'BROKEN\n');
      },
    });

    assert.equal(mutation.description, 'break state');
    const undo = await mutation.apply(root);
    assert.equal(await read(), 'BROKEN\n');
    await undo();
    assert.equal(await read(), 'SAFE\n');
  });
});

test('a captured mutation restores every captured path when apply throws', async () => {
  await withState(async (root, read) => {
    const mutation = defineMutation({
      description: 'break then throw',
      capture: ['src/state.txt', 'src/created.txt'],
      async apply(ctx) {
        await ctx.files.write('src/state.txt', 'BROKEN\n');
        await ctx.files.write('src/created.txt', 'NEW\n');
        throw new Error('boom');
      },
    });

    await assert.rejects(mutation.apply(root), { message: 'boom' });
    assert.equal(await read(), 'SAFE\n');
    assert.ok(await missing(join(root, 'src/created.txt')), 'a path that did not exist is removed again');
  });
});

test('capture restores a path that did not exist by deleting it, and one it created directories for', async () => {
  await withWorkspace(async root => {
    const mutation = defineMutation({
      description: 'create nested state',
      capture: 'generated/deep/state.txt',
      async apply(ctx) {
        await ctx.files.write('generated/deep/state.txt', 'NEW\n');
      },
    });

    const undo = await mutation.apply(root);
    assert.equal(await readFile(join(root, 'generated/deep/state.txt'), 'utf8'), 'NEW\n');
    await undo();
    assert.ok(await missing(join(root, 'generated')), 'undo removes the directories the mutation needed');
  });
});

test('capture restores a whole directory tree, including files added inside it', async () => {
  await withWorkspace(async root => {
    await mkdir(join(root, 'src/nested'), { recursive: true });
    await writeFile(join(root, 'src/nested/a.txt'), 'A\n', 'utf8');

    const undo = await defineMutation({
      description: 'rewrite the tree',
      capture: 'src',
      async apply(ctx) {
        await ctx.files.write('src/nested/a.txt', 'CHANGED\n');
        await ctx.files.write('src/nested/b.txt', 'ADDED\n');
        await ctx.files.remove('src/nested/a.txt');
      },
    }).apply(root);

    await undo();
    assert.equal(await readFile(join(root, 'src/nested/a.txt'), 'utf8'), 'A\n');
    assert.ok(await missing(join(root, 'src/nested/b.txt')), 'a file added inside a captured tree is removed');
  });
});

test('undo is safe to call twice', async () => {
  await withState(async (root, read) => {
    const undo = await defineMutation({
      description: 'break state',
      capture: 'src/state.txt',
      async apply(ctx) {
        await ctx.files.write('src/state.txt', 'BROKEN\n');
      },
    }).apply(root);

    await undo();
    await writeFile(join(root, 'src/state.txt'), 'LATER\n', 'utf8');
    await undo();
    assert.equal(await read(), 'LATER\n', 'a second undo does not overwrite later work');
  });
});

test('a manual mutation returns its own undo, which is the one that runs', async () => {
  await withState(async (root, read) => {
    let undone = 0;
    const undo = await defineMutation({
      description: 'manual mutation',
      async apply(ctx) {
        const before = await ctx.files.read('src/state.txt');
        await ctx.files.write('src/state.txt', 'BROKEN\n');
        return async () => {
          undone += 1;
          await ctx.files.write('src/state.txt', before);
        };
      },
    }).apply(root);

    assert.equal(await read(), 'BROKEN\n');
    await undo();
    assert.equal(undone, 1);
    assert.equal(await read(), 'SAFE\n');
  });
});

test('a manual mutation that throws is not undone for the author', async () => {
  await withState(async (root, read) => {
    await assert.rejects(
      defineMutation({
        description: 'manual mutation that throws',
        async apply(ctx) {
          await ctx.files.write('src/state.txt', 'BROKEN\n');
          throw new Error('boom');
        },
      }).apply(root),
      { message: 'boom' },
    );
    assert.equal(await read(), 'BROKEN\n', 'without capture, the author owns the restore');
  });
});

test('the mutation context reads, writes, searches, and queries relative to the mutation root', async () => {
  await withWorkspace(async root => {
    await mkdir(join(root, 'src'), { recursive: true });
    await writeFile(join(root, 'src/a.ts'), '// TODO: a\n', 'utf8');
    await writeFile(join(root, 'src/b.json'), '{"name":"b"}', 'utf8');

    const seen: Record<string, unknown> = {};
    const undo = await defineMutation({
      description: 'inspect through the context',
      capture: 'src',
      async apply(ctx) {
        seen.root = ctx.root === root;
        seen.files = await ctx.files.find('src/*.ts');
        seen.exists = [await ctx.files.exists('src/a.ts'), await ctx.files.exists('src/none.ts')];
        seen.read = await ctx.files.read('src/a.ts');
        seen.matches = (await ctx.text.find({ files: 'src/*.ts', find: 'TODO' })).matches.length;
        seen.first = (await ctx.text.findFirst({ files: 'src/*.ts', find: 'TODO' }))?.location;
        seen.json = (await ctx.json.query({ files: 'src/*.json', path: '$.name' })).matches[0]?.value;

        await ctx.files.rename('src/a.ts', 'src/renamed.ts');
        seen.renamed = await ctx.files.exists('src/renamed.ts');
        await ctx.files.remove('src/renamed.ts');
        seen.removed = await ctx.files.exists('src/renamed.ts');
      },
    }).apply(root);

    assert.deepEqual(seen, {
      root: true,
      files: ['src/a.ts'],
      exists: [true, false],
      read: '// TODO: a\n',
      matches: 1,
      first: { file: 'src/a.ts', line: 1, column: 4 },
      json: 'b',
      renamed: true,
      removed: false,
    });

    await undo();
    assert.equal(await readFile(join(root, 'src/a.ts'), 'utf8'), '// TODO: a\n');
  });
});

test('a manual mutation can capture several paths through the context and hand back that undo', async () => {
  await withWorkspace(async root => {
    await mkdir(join(root, 'src'), { recursive: true });
    await writeFile(join(root, 'src/a.txt'), 'A\n', 'utf8');
    await writeFile(join(root, 'src/b.txt'), 'B\n', 'utf8');

    const undo = await defineMutation({
      description: 'capture two, change two',
      async apply(ctx) {
        const restore = await ctx.capture(['src/a.txt', 'src/b.txt']);
        await ctx.files.write('src/a.txt', 'CHANGED A\n');
        await ctx.files.write('src/b.txt', 'CHANGED B\n');
        return restore;
      },
    }).apply(root);

    await undo();
    assert.equal(await readFile(join(root, 'src/a.txt'), 'utf8'), 'A\n');
    assert.equal(await readFile(join(root, 'src/b.txt'), 'utf8'), 'B\n');
  });
});

test('a built-in mutation is undone in the reverse order of a plan applied in sequence', async () => {
  await withWorkspace(async root => {
    await mkdir(join(root, 'src'), { recursive: true });
    await writeFile(join(root, 'src/a.txt'), 'A\n', 'utf8');

    const first = await mutate.writeText('src/a.txt', 'ONE\n').apply(root);
    const second = await mutate.writeText('src/a.txt', 'TWO\n').apply(root);
    assert.equal(await readFile(join(root, 'src/a.txt'), 'utf8'), 'TWO\n');

    await second();
    assert.equal(await readFile(join(root, 'src/a.txt'), 'utf8'), 'ONE\n', 'the later undo restores the state it found');
    await first();
    assert.equal(await readFile(join(root, 'src/a.txt'), 'utf8'), 'A\n');
  });
});

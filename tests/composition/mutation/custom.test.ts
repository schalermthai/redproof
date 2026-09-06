import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { defineMutation } from 'redproof';
import { withWorkspace } from '../../helpers/workspace.ts';

test('defineMutation capture provides undo without hand-written restore logic', async () => {
  await withWorkspace(async root => {
    await mkdir(join(root, 'src'), { recursive: true });
    const path = join(root, 'src/state.txt');
    await writeFile(path, 'SAFE\n', 'utf8');

    const mutation = defineMutation({
      description: 'break state',
      capture: 'src/state.txt',
      async apply(ctx) {
        await ctx.files.write('src/state.txt', 'BROKEN\n');
      },
    });

    const undo = await mutation.apply(root);
    assert.equal(await readFile(path, 'utf8'), 'BROKEN\n');
    await undo();
    assert.equal(await readFile(path, 'utf8'), 'SAFE\n');
  });
});

test('captured mutation restores paths when apply throws', async () => {
  await withWorkspace(async root => {
    await mkdir(join(root, 'src'), { recursive: true });
    const path = join(root, 'src/state.txt');
    await writeFile(path, 'SAFE\n', 'utf8');

    const mutation = defineMutation({
      description: 'break then throw',
      capture: 'src/state.txt',
      async apply(ctx) {
        await ctx.files.write('src/state.txt', 'BROKEN\n');
        throw new Error('boom');
      },
    });

    await assert.rejects(mutation.apply(root), /boom/);
    assert.equal(await readFile(path, 'utf8'), 'SAFE\n');
  });
});

test('defineMutation supports a manual UndoMutation escape hatch', async () => {
  await withWorkspace(async root => {
    await mkdir(join(root, 'src'), { recursive: true });
    const path = join(root, 'src/state.txt');
    await writeFile(path, 'SAFE\n', 'utf8');

    const mutation = defineMutation({
      description: 'manual mutation',
      async apply(ctx) {
        const before = await ctx.files.read('src/state.txt');
        await ctx.files.write('src/state.txt', 'BROKEN\n');
        return async () => ctx.files.write('src/state.txt', before);
      },
    });

    const undo = await mutation.apply(root);
    assert.equal(await readFile(path, 'utf8'), 'BROKEN\n');
    await undo();
    assert.equal(await readFile(path, 'utf8'), 'SAFE\n');
  });
});

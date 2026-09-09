import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { setTimeout } from 'node:timers/promises';
import { breach, defineRules, files, json, result, text } from 'redproof';
import { withWorkspace } from '../helpers/workspace.ts';

async function sourceWorkspace(fn: (root: string) => Promise<void>): Promise<void> {
  await withWorkspace(async root => {
    await mkdir(join(root, 'src'), { recursive: true });
    await writeFile(join(root, 'src/a.ts'), 'const a = 1;\n// TODO: a\n', 'utf8');
    await writeFile(join(root, 'src/a.test.ts'), '// TODO: test only\n', 'utf8');
    await writeFile(join(root, 'src/b.ts'), 'const b = 2;\n', 'utf8');
    await fn(root);
  });
}

test('files.find returns relative paths, sorted, honouring exclude', async () => {
  await sourceWorkspace(async root => {
    assert.deepEqual(await files.find({ root }, 'src/**/*.ts'), ['src/a.test.ts', 'src/a.ts', 'src/b.ts']);
    assert.deepEqual(
      await files.find({ root }, { include: 'src/**/*.ts', exclude: 'src/**/*.test.ts' }),
      ['src/a.ts', 'src/b.ts'],
    );
    assert.deepEqual(await files.find({ root }, 'src/**/*.json'), []);
  });
});

test('text.find reports each match with an exact source location and offset range', async () => {
  await sourceWorkspace(async root => {
    const found = await text.find({ root }, {
      files: { include: 'src/**/*.ts', exclude: 'src/**/*.test.ts' },
      find: 'TODO',
    });

    assert.equal(found.matches.length, 1, 'the excluded file must not be searched');
    assert.deepEqual(found.matches[0]?.location, { file: 'src/a.ts', line: 2, column: 4 });
    assert.deepEqual(found.matches[0]?.range, { start: 16, end: 20 });
    assert.deepEqual(found.files, ['src/a.ts', 'src/b.ts'], 'the search reports every file it read');
  });
});

test('a search describes itself as a Scan covering its own window, not the moment scan() is called', async () => {
  await sourceWorkspace(async root => {
    const before = new Date().toISOString();
    const found = await text.find({ root }, { files: 'src/*.ts', find: 'TODO' });
    const after = new Date().toISOString();

    await setTimeout(20);
    const searchScan = found.scan();

    assert.equal(searchScan.source, 'text');
    assert.equal(searchScan.inspected, 3, 'inspected counts the files read, not the matches');
    assert.ok(searchScan.startedAt >= before, 'the window cannot start before the search did');
    assert.ok(searchScan.startedAt <= after, 'the window cannot start after the search ended');
    assert.ok(searchScan.finishedAt <= after, 'the window cannot end after the search did');
    assert.ok(searchScan.startedAt <= searchScan.finishedAt);
  });
});

test('a search Scan accepts an earlier start and a different source without changing its defaults', async () => {
  await sourceWorkspace(async root => {
    const startedAt = '2020-01-01T00:00:00.000Z';
    const found = await text.find({ root }, { files: 'src/a.ts', find: 'TODO' });

    assert.equal(found.scan({ startedAt }).startedAt, startedAt);
    assert.equal(found.scan({ startedAt }).source, 'text', 'one override leaves the other default alone');
    assert.equal(found.scan({ source: 'todo-scan' }).source, 'todo-scan');
    assert.notEqual(found.scan().startedAt, startedAt, 'the override must not leak into the default');
    assert.equal(found.scan().source, 'text');
  });
});

test('json.query returns structured matches with canonical JSON paths and describes itself the same way', async () => {
  await withWorkspace(async root => {
    await mkdir(join(root, 'config'), { recursive: true });
    await writeFile(join(root, 'config/a.json'), '{"scripts":{"test":"node --test"}}', 'utf8');
    await writeFile(join(root, 'config/b.json'), '{"scripts":{"test":"vitest"}}', 'utf8');

    const found = await json.query({ root }, { files: 'config/*.json', path: '$.scripts.test' });

    assert.deepEqual(found.matches, [
      { file: 'config/a.json', path: '$.scripts.test', value: 'node --test' },
      { file: 'config/b.json', path: '$.scripts.test', value: 'vitest' },
    ]);
    assert.equal(found.scan().source, 'json');
    assert.equal(found.scan().inspected, 2);
    assert.equal(found.scan({ source: 'policy' }).source, 'policy');
  });
});

test('json.query names the file it could not parse', async () => {
  await withWorkspace(async root => {
    await writeFile(join(root, 'broken.json'), '{ nope', 'utf8');
    await assert.rejects(
      json.query({ root }, { files: 'broken.json', path: '$.x' }),
      /Could not parse JSON file broken\.json/,
    );
  });
});

test('a search Scan is a value, so a Check can pass it straight to a result', async () => {
  await sourceWorkspace(async root => {
    const rules = defineRules({ noTodo: { id: 'source/no-todo', description: 'No TODO.' } });
    const found = await text.find({ root }, { files: 'src/a.ts', find: 'TODO' });
    const checkResult = result.fromBreaches(
      found.scan(),
      found.matches.map(match => breach(rules.noTodo, {
        code: 'todo-found',
        message: 'TODO comment found.',
        location: match.location,
      })),
    );

    assert.equal(checkResult.verdict, 'fail');
    assert.equal(checkResult.scan.inspected, 1);
    if (checkResult.verdict !== 'fail') throw new Error('expected fail');
    assert.equal(checkResult.breaches[0].rule, 'source/no-todo');
    assert.deepEqual(checkResult.breaches[0].location, { file: 'src/a.ts', line: 2, column: 4 });
  });
});

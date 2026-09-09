import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { json, locate, resolveJsonLocator, resolveTextLocator, text } from 'redproof';
import { withWorkspace } from '../helpers/workspace.ts';

async function seed(root: string, paths: Readonly<Record<string, string>>): Promise<void> {
  for (const [path, content] of Object.entries(paths)) {
    await mkdir(join(root, path, '..'), { recursive: true });
    await writeFile(join(root, path), content, 'utf8');
  }
}

test('text.find lists every file it read and every match in file order, then document order', async () => {
  await withWorkspace(async root => {
    await seed(root, {
      'src/b.ts': 'TODO b1\n  TODO b2\n',
      'src/a.ts': 'clean\n',
      'src/c.ts': 'x TODO c\n',
    });

    const found = await text.find({ root }, { files: 'src/**/*.ts', find: 'TODO' });

    assert.deepEqual(found.files, ['src/a.ts', 'src/b.ts', 'src/c.ts']);
    assert.deepEqual(found.matches.map(match => [match.file, match.text, match.location.line, match.location.column, match.range]), [
      ['src/b.ts', 'TODO', 1, 1, { start: 0, end: 4 }],
      ['src/b.ts', 'TODO', 2, 3, { start: 10, end: 14 }],
      ['src/c.ts', 'TODO', 1, 3, { start: 2, end: 6 }],
    ]);
    assert.deepEqual(new Set(found.matches.map(match => match.location.file)), new Set(['src/b.ts', 'src/c.ts']));
  });
});

test('text.find honours the file selection and a regex pattern', async () => {
  await withWorkspace(async root => {
    await seed(root, { 'src/a.ts': 'todo TODO\n', 'src/a.test.ts': 'TODO\n' });

    const found = await text.find({ root }, {
      files: { include: 'src/**/*.ts', exclude: 'src/**/*.test.ts' },
      find: /todo/i,
    });

    assert.deepEqual(found.files, ['src/a.ts']);
    assert.deepEqual(found.matches.map(match => match.text), ['todo', 'TODO']);
  });
});

test('a search describes itself as a Scan of the files it read, with overridable source and start', async () => {
  await withWorkspace(async root => {
    await seed(root, { 'src/a.ts': 'clean\n', 'src/b.ts': 'TODO\n' });

    const before = new Date().toISOString();
    const found = await text.find({ root }, { files: 'src/**/*.ts', find: 'TODO' });
    const after = new Date().toISOString();

    const scan = found.scan();
    assert.equal(scan.source, 'text');
    assert.equal(scan.inspected, 2, 'inspected counts the files read, not the matches');
    assert.ok(scan.startedAt >= before && scan.startedAt <= scan.finishedAt && scan.finishedAt <= after, JSON.stringify(scan));

    const widened = found.scan({ source: 'todo-scan', startedAt: '2020-01-01T00:00:00.000Z' });
    assert.equal(widened.source, 'todo-scan');
    assert.equal(widened.startedAt, '2020-01-01T00:00:00.000Z');
    assert.equal(widened.finishedAt, scan.finishedAt);
    assert.equal(widened.inspected, 2);
    assert.deepEqual(found.scan(), scan, 'an override must not leak into the default');
  });
});

test('a search over no files inspects nothing and matches nothing', async () => {
  await withWorkspace(async root => {
    const found = await text.find({ root }, { files: 'src/**/*.ts', find: 'TODO' });

    assert.deepEqual(found.files, []);
    assert.deepEqual(found.matches, []);
    assert.equal(found.scan().inspected, 0);
  });
});

test('text.findFirst returns the first match across files, or null', async () => {
  await withWorkspace(async root => {
    await seed(root, { 'src/b.ts': 'MARK\n', 'src/a.ts': 'x\nMARK MARK\n' });

    const first = await text.findFirst({ root }, { files: 'src/**/*.ts', find: 'MARK' });
    assert.deepEqual(first?.location, { file: 'src/a.ts', line: 2, column: 1 });

    assert.equal(await text.findFirst({ root }, { files: 'src/**/*.ts', find: 'ABSENT' }), null);
  });
});

test('json.query returns each selected value with its file and canonical path, in file order', async () => {
  await withWorkspace(async root => {
    await seed(root, {
      'config/b.json': '{"scripts":{"test":"vitest","lint:fix":"eslint"}}',
      'config/a.json': '{"scripts":{"test":"node --test"}}',
      'config/c.json': '{"other":1}',
    });

    const found = await json.query({ root }, { files: 'config/*.json', path: '$.scripts.*' });

    assert.deepEqual(found.files, ['config/a.json', 'config/b.json', 'config/c.json']);
    assert.deepEqual(found.matches, [
      { file: 'config/a.json', path: '$.scripts.test', value: 'node --test' },
      { file: 'config/b.json', path: '$.scripts.test', value: 'vitest' },
      { file: 'config/b.json', path: '$.scripts["lint:fix"]', value: 'eslint' },
    ]);

    const scan = found.scan();
    assert.equal(scan.source, 'json');
    assert.equal(scan.inspected, 3, 'a file without a match is still inspected');
  });
});

test('json.query rejects an unsupported path before reading, and malformed JSON with the file name', async () => {
  await withWorkspace(async root => {
    await seed(root, { 'good.json': '{"x":1}', 'broken.json': '{ nope' });

    await assert.rejects(json.query({ root }, { files: 'good.json', path: '$..x' }), /Recursive descent/);
    await assert.rejects(json.query({ root }, { files: '*.json', path: '$.x' }), /^Error: Could not parse JSON file broken\.json: /);
  });
});

test('a text locator resolves to exactly one match unless an occurrence is chosen', async () => {
  await withWorkspace(async root => {
    await seed(root, { 'src/b.ts': 'MARK\n', 'src/a.ts': 'MARK\nMARK\n' });

    await assert.rejects(
      resolveTextLocator({ root }, locate.text({ files: 'src/**/*.ts', find: 'MARK' })),
      /^Error: Text locator expected exactly one match but found 3\.$/,
    );
    await assert.rejects(
      resolveTextLocator({ root }, locate.text({ files: 'src/**/*.ts', find: 'ABSENT' })),
      /^Error: Text locator did not match anything\.$/,
    );

    const only = await resolveTextLocator({ root }, locate.text({ files: 'src/b.ts', find: 'MARK' }));
    assert.deepEqual(only.location, { file: 'src/b.ts', line: 1, column: 1 });

    const last = await resolveTextLocator({ root }, locate.text({ files: 'src/**/*.ts', find: 'MARK', occurrence: 'last' }));
    assert.deepEqual(last.location, { file: 'src/b.ts', line: 1, column: 1 });

    const second = await resolveTextLocator({ root }, locate.text({ files: 'src/**/*.ts', find: 'MARK', occurrence: 1 }));
    assert.deepEqual(second.location, { file: 'src/a.ts', line: 2, column: 1 });
  });
});

test('a json locator resolves to the node plus what a mutation needs to change it', async () => {
  await withWorkspace(async root => {
    const original = '{"workspaces":[{"name":"a"},{"name":"b"}]}';
    await seed(root, { 'package.json': original });

    await assert.rejects(
      resolveJsonLocator({ root }, locate.json({ files: 'package.json', path: '$.workspaces[*].name' })),
      /^Error: JSON locator expected exactly one match but found 2\.$/,
    );
    await assert.rejects(
      resolveJsonLocator({ root }, locate.json({ files: 'package.json', path: '$.missing' })),
      /^Error: JSON locator did not match anything\.$/,
    );

    const resolved = await resolveJsonLocator({ root }, locate.json({ files: 'package.json', path: '$.workspaces[*].name', occurrence: 'last' }));

    assert.equal(resolved.file, 'package.json');
    assert.equal(resolved.path, '$.workspaces[1].name');
    assert.equal(resolved.value, 'b');
    assert.equal(resolved.key, 'name');
    assert.deepEqual(resolved.parent, { name: 'b' });
    assert.equal(resolved.original, original);
    assert.deepEqual(resolved.document, JSON.parse(original));
    assert.equal(
      (resolved.document as { workspaces: unknown[] }).workspaces[1],
      resolved.parent,
      'the parent is the live node inside the document, so a change through it lands in the document',
    );
  });
});

import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { json, locate, mutate, parseJsonPath } from 'redproof';
import { withWorkspace } from '../helpers/workspace.ts';

const packageJson = `{
  "scripts": {
    "test": "node --test",
    "lint:fix": "eslint . --fix"
  },
  "engines": {
    "node": ">=22"
  },
  "files": ["dist", "README.md"],
  "workspaces": [
    { "name": "core", "private": true },
    { "name": "cli", "private": false }
  ]
}\n`;

async function jsonWorkspace(
  fn: (root: string, read: () => Promise<string>) => Promise<void>,
  source = packageJson,
): Promise<void> {
  await withWorkspace(async root => {
    const path = join(root, 'package.json');
    await writeFile(path, source, 'utf8');
    await fn(root, () => readFile(path, 'utf8'));
  });
}

test('a JSONPath names properties, quoted keys, indexes, and wildcards', () => {
  assert.deepEqual(parseJsonPath('$'), []);
  assert.deepEqual(parseJsonPath('$.scripts["lint:fix"]'), [
    { kind: 'property', key: 'scripts' },
    { kind: 'property', key: 'lint:fix' },
  ]);
  assert.deepEqual(parseJsonPath('$.workspaces[0].name'), [
    { kind: 'property', key: 'workspaces' },
    { kind: 'index', index: 0 },
    { kind: 'property', key: 'name' },
  ]);
  assert.deepEqual(parseJsonPath('$.workspaces[*].name').at(-2), { kind: 'wildcard' });
  assert.deepEqual(parseJsonPath('$.scripts.*').at(-1), { kind: 'wildcard' });
  assert.throws(() => parseJsonPath('$..name'), /Recursive descent/);
});

test('json.query reports one match per selected node with its canonical path', async () => {
  await jsonWorkspace(async root => {
    const wildcard = await json.query({ root }, { files: 'package.json', path: '$.workspaces[*].name' });
    assert.deepEqual(wildcard.matches, [
      { file: 'package.json', path: '$.workspaces[0].name', value: 'core' },
      { file: 'package.json', path: '$.workspaces[1].name', value: 'cli' },
    ]);

    const quoted = await json.query({ root }, { files: 'package.json', path: '$.scripts.*' });
    assert.deepEqual(quoted.matches.map(match => match.path), ['$.scripts.test', '$.scripts["lint:fix"]']);

    const absent = await json.query({ root }, { files: 'package.json', path: '$.missing.key' });
    assert.deepEqual(absent.matches, [], 'a path that selects nothing is empty, not an error');
  });
});

test('a JSON locator demands exactly one match, so an ambiguous wildcard is refused', async () => {
  await jsonWorkspace(async (root, read) => {
    await assert.rejects(
      mutate.jsonSet(locate.json({ files: 'package.json', path: '$.workspaces[*].private' }), true).apply(root),
      /JSON locator expected exactly one match but found 2\./,
    );
    await assert.rejects(
      mutate.jsonSet(locate.json({ files: 'package.json', path: '$.missing' }), true).apply(root),
      /JSON locator did not match anything\./,
    );
    assert.equal(await read(), packageJson, 'a refused mutation changes nothing');
  });
});

test('jsonSet replaces the located value, including one addressed by a quoted key or an index', async () => {
  await jsonWorkspace(async (root, read) => {
    for (const [path, value, check] of [
      ['$.scripts.test', 'vitest run', (doc: any) => doc.scripts.test],
      ['$.scripts["lint:fix"]', 'eslint src --fix', (doc: any) => doc.scripts['lint:fix']],
      ['$.files[0]', 'build', (doc: any) => doc.files[0]],
      ['$.engines', { node: '>=24' }, (doc: any) => doc.engines],
    ] as const) {
      const undo = await mutate.jsonSet(locate.json({ files: 'package.json', path }), value).apply(root);
      assert.deepEqual(check(JSON.parse(await read())), value, path);
      await undo();
      assert.equal(await read(), packageJson, `undo after setting ${path}`);
    }
  });
});

test('jsonSet keeps the indentation and the final newline of the file it rewrote', async () => {
  await jsonWorkspace(async (root, read) => {
    const undo = await mutate.jsonSet(locate.json({ files: 'package.json', path: '$.scripts.test' }), 'vitest').apply(root);
    const after = await read();
    assert.match(after, /^\{\n {2}"scripts": \{\n {4}"test": "vitest",/, 'two-space indentation survives');
    assert.ok(after.endsWith('}\n'), 'the final newline survives');
    await undo();
  });

  const tabbed = '{\n\t"a": 1\n}';
  await jsonWorkspace(async (root, read) => {
    await mutate.jsonSet(locate.json({ files: 'package.json', path: '$.a' }), 2).apply(root);
    assert.equal(await read(), '{\n\t"a": 2\n}', 'tab indentation survives and no newline is added');
  }, tabbed);
});

test('jsonDelete removes an object property and closes an array gap', async () => {
  await jsonWorkspace(async (root, read) => {
    const undoProperty = await mutate.jsonDelete(locate.json({ files: 'package.json', path: '$.engines.node' })).apply(root);
    assert.deepEqual(JSON.parse(await read()).engines, {});
    await undoProperty();

    const undoArray = await mutate.jsonDelete(locate.json({ files: 'package.json', path: '$.files[0]' })).apply(root);
    assert.deepEqual(JSON.parse(await read()).files, ['README.md']);
    await undoArray();
    assert.equal(await read(), packageJson);
  });
});

test('jsonMerge adds and overwrites keys without dropping the rest, and jsonPush appends to the end', async () => {
  await jsonWorkspace(async (root, read) => {
    const undoMerge = await mutate.jsonMerge(
      locate.json({ files: 'package.json', path: '$.engines' }),
      { node: '>=24', npm: '>=10' },
    ).apply(root);
    assert.deepEqual(JSON.parse(await read()).engines, { node: '>=24', npm: '>=10' });
    await undoMerge();
    assert.equal(await read(), packageJson);

    const undoPush = await mutate.jsonPush(locate.json({ files: 'package.json', path: '$.files' }), 'LICENSE').apply(root);
    assert.deepEqual(JSON.parse(await read()).files, ['dist', 'README.md', 'LICENSE']);
    await undoPush();
    assert.equal(await read(), packageJson);
  });
});

test('jsonMerge and jsonPush refuse an incompatible target and leave the file unchanged', async () => {
  await jsonWorkspace(async (root, read) => {
    await assert.rejects(
      mutate.jsonMerge(locate.json({ files: 'package.json', path: '$.scripts.test' }), { x: 1 }).apply(root),
      /JSON merge target \$\.scripts\.test must be an object\./,
    );
    await assert.rejects(
      mutate.jsonMerge(locate.json({ files: 'package.json', path: '$.files' }), { x: 1 }).apply(root),
      /must be an object\./,
    );
    await assert.rejects(
      mutate.jsonPush(locate.json({ files: 'package.json', path: '$.engines' }), 'x').apply(root),
      /JSON push target \$\.engines must be an array\./,
    );
    assert.equal(await read(), packageJson);
  });
});

test('a JSON mutation refuses to rewrite the document root through a parentless path', async () => {
  await jsonWorkspace(async (root, read) => {
    await assert.rejects(
      mutate.jsonSet(locate.json({ files: 'package.json', path: '$' }), { replaced: true }).apply(root),
      /Mutating the JSON document root is not supported by this operation\./,
    );
    assert.equal(await read(), packageJson);
  });
});

test('occurrence lets a wildcard JSON locator select one match on purpose', async () => {
  await jsonWorkspace(async (root, read) => {
    const undo = await mutate.jsonSet(
      locate.json({ files: 'package.json', path: '$.workspaces[*].private', occurrence: 'last' }),
      true,
    ).apply(root);
    const parsed = JSON.parse(await read());
    assert.equal(parsed.workspaces[0].private, true, 'the first entry keeps its own value');
    assert.equal(parsed.workspaces[1].private, true, 'the last entry is the one that changed');
    await undo();
    assert.equal(await read(), packageJson);
  });
});

test('a JSON mutation describes itself by the path it changes', () => {
  const at = locate.json({ files: 'package.json', path: '$.scripts.test' });
  assert.equal(mutate.jsonSet(at, 'x').description, 'set $.scripts.test');
  assert.equal(mutate.jsonDelete(at).description, 'delete $.scripts.test');
  assert.equal(mutate.jsonMerge(at, {}).description, 'merge $.scripts.test');
  assert.equal(mutate.jsonPush(at, 'x').description, 'push into $.scripts.test');
});

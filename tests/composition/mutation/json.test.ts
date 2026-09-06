import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { json, locate, mutate, parseJsonPath } from 'redproof';
import { withWorkspace } from '../../helpers/workspace.ts';

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

async function jsonWorkspace(fn: (root: string, path: string) => Promise<void>): Promise<void> {
  await withWorkspace(async root => {
    const path = join(root, 'package.json');
    await writeFile(path, packageJson, 'utf8');
    await fn(root, path);
  });
}

test('parseJsonPath supports root, properties, quoted keys, indexes, and wildcards', () => {
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
  assert.throws(() => parseJsonPath('$..name'), /Recursive descent/);
});

test('json.query returns structured matches and canonical JSON paths', async () => {
  await jsonWorkspace(async root => {
    const result = await json.query({ root }, { files: 'package.json', path: '$.workspaces[*].name' });
    assert.deepEqual(result.matches, [
      { file: 'package.json', path: '$.workspaces[0].name', value: 'core' },
      { file: 'package.json', path: '$.workspaces[1].name', value: 'cli' },
    ]);
  });
});

test('JSON locator defaults to only and rejects ambiguous wildcard matches', async () => {
  await jsonWorkspace(async root => {
    await assert.rejects(
      mutate.jsonSet(locate.json({ files: 'package.json', path: '$.workspaces[*].private' }), true).apply(root),
      /expected exactly one match but found 2/,
    );
  });
});

test('jsonSet changes a scalar and undo restores original formatting/content', async () => {
  await jsonWorkspace(async (root, path) => {
    const before = await readFile(path, 'utf8');
    const undo = await mutate.jsonSet(
      locate.json({ files: 'package.json', path: '$.scripts.test' }),
      'vitest run',
    ).apply(root);
    assert.equal(JSON.parse(await readFile(path, 'utf8')).scripts.test, 'vitest run');
    await undo();
    assert.equal(await readFile(path, 'utf8'), before);
  });
});

test('jsonDelete removes object properties and array entries', async () => {
  await jsonWorkspace(async (root, path) => {
    const undoProperty = await mutate.jsonDelete(
      locate.json({ files: 'package.json', path: '$.engines.node' }),
    ).apply(root);
    assert.deepEqual(JSON.parse(await readFile(path, 'utf8')).engines, {});
    await undoProperty();

    const undoArray = await mutate.jsonDelete(
      locate.json({ files: 'package.json', path: '$.files[0]' }),
    ).apply(root);
    assert.deepEqual(JSON.parse(await readFile(path, 'utf8')).files, ['README.md']);
    await undoArray();
    assert.equal(await readFile(path, 'utf8'), packageJson);
  });
});

test('jsonMerge merges an object and jsonPush appends to an array, both reversible', async () => {
  await jsonWorkspace(async (root, path) => {
    const undoMerge = await mutate.jsonMerge(
      locate.json({ files: 'package.json', path: '$.engines' }),
      { npm: '>=10' },
    ).apply(root);
    assert.deepEqual(JSON.parse(await readFile(path, 'utf8')).engines, { node: '>=22', npm: '>=10' });
    await undoMerge();

    const undoPush = await mutate.jsonPush(
      locate.json({ files: 'package.json', path: '$.files' }),
      'LICENSE',
    ).apply(root);
    assert.deepEqual(JSON.parse(await readFile(path, 'utf8')).files, ['dist', 'README.md', 'LICENSE']);
    await undoPush();
    assert.equal(await readFile(path, 'utf8'), packageJson);
  });
});

test('quoted JSONPath keys address properties that cannot use dot notation', async () => {
  await jsonWorkspace(async (root, path) => {
    const undo = await mutate.jsonSet(
      locate.json({ files: 'package.json', path: '$.scripts["lint:fix"]' }),
      'eslint src --fix',
    ).apply(root);
    assert.equal(JSON.parse(await readFile(path, 'utf8')).scripts['lint:fix'], 'eslint src --fix');
    await undo();
  });
});

test('JSON wildcard locator can intentionally select an occurrence', async () => {
  await jsonWorkspace(async (root, path) => {
    const undo = await mutate.jsonSet(
      locate.json({ files: 'package.json', path: '$.workspaces[*].private', occurrence: 'last' }),
      true,
    ).apply(root);
    const parsed = JSON.parse(await readFile(path, 'utf8'));
    assert.equal(parsed.workspaces[0].private, true);
    assert.equal(parsed.workspaces[1].private, true);
    await undo();
    assert.equal(await readFile(path, 'utf8'), packageJson);
  });
});

test('jsonMerge and jsonPush reject incompatible target types without changing the file', async () => {
  await jsonWorkspace(async (root, path) => {
    const before = await readFile(path, 'utf8');
    await assert.rejects(
      mutate.jsonMerge(locate.json({ files: 'package.json', path: '$.scripts.test' }), { x: 1 }).apply(root),
      /must be an object/,
    );
    assert.equal(await readFile(path, 'utf8'), before);

    await assert.rejects(
      mutate.jsonPush(locate.json({ files: 'package.json', path: '$.engines' }), 'x').apply(root),
      /must be an array/,
    );
    assert.equal(await readFile(path, 'utf8'), before);
  });
});

test('json.query reports malformed JSON with the file name', async () => {
  await withWorkspace(async root => {
    await writeFile(join(root, 'broken.json'), '{ nope', 'utf8');
    await assert.rejects(
      json.query({ root }, { files: 'broken.json', path: '$.x' }),
      /Could not parse JSON file broken.json/,
    );
  });
});

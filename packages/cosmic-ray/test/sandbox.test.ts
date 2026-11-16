import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { copyProject } from '../src/shell/sandbox.ts';
import { withWorkspace } from './support/workspace.ts';

test('copying onto a name that already exists in the sandbox is a collision, not a silent overwrite', () => withWorkspace(async root => {
  // On a case-insensitive disk `helper.py` and `Helper.py` are one path; the second copy meets the first one's file.
  const source = join(root, 'source');
  const destination = join(root, 'sandbox');
  await mkdir(source);
  await mkdir(destination);
  await writeFile(join(source, 'helper.py'), 'x = 2\n');
  await writeFile(join(destination, 'helper.py'), 'x = 1\n');
  const outcome = await copyProject(source, destination, 1_000_000, 1_000);
  assert.equal(outcome.kind, 'collision');
  assert.equal(await readFile(join(destination, 'helper.py'), 'utf8'), 'x = 1\n');
}));

test('a plain copy reports its size and entry count', () => withWorkspace(async root => {
  const source = join(root, 'source');
  await mkdir(join(source, 'pkg'), { recursive: true });
  await writeFile(join(source, 'a.py'), 'abc');
  await writeFile(join(source, 'pkg', 'b.py'), 'de');
  assert.deepEqual(await copyProject(source, join(root, 'sandbox'), 1_000, 100), { kind: 'copied', bytes: 5, entries: 3 });
}));

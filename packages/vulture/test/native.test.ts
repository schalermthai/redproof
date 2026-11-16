import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { defineGate, runGate } from 'redproof';
import { vulture, type VultureOptions } from '../src/index.ts';
import { nativeTest as test, vultureBinary, withProject } from './support/workspace.ts';

/** Through `runGate`, as a user meets it: the Gate's verdict with only the named rule selected. */
async function judge(root: string, kind: string, options: Partial<VultureOptions> = {}): Promise<readonly string[]> {
  const verdict = await runGate(defineGate({ id: 'dead', adapter: vulture({ command: vultureBinary, rules: { r: kind }, ...options } as never) as never }), root);
  if (verdict.verdict === 'fail') return ['fail', ...verdict.breaches.map(b => `${b.rule}:${b.location?.file}:${b.location?.line}`)];
  return verdict.verdict === 'refuse' ? ['refuse', verdict.why.code] : [verdict.verdict];
}

const CASES: ReadonlyArray<{ kind: string; red: string; green: string; line: number }> = [
  { kind: 'unused-import', red: 'import os\n', green: 'import os\nprint(os.name)\n', line: 1 },
  { kind: 'unused-function', red: 'def f():\n    pass\n', green: 'def f():\n    pass\n\n\nf()\n', line: 1 },
  { kind: 'unused-class', red: 'class A:\n    pass\n', green: 'class A:\n    pass\n\n\nA()\n', line: 1 },
  { kind: 'unused-method', red: 'class A:\n    def m(self):\n        pass\n\n\nA()\n', green: 'class A:\n    def m(self):\n        pass\n\n\nA().m()\n', line: 2 },
  { kind: 'unused-variable', red: 'def f():\n    x = 1\n\n\nf()\n', green: 'def f():\n    x = 1\n    return x\n\n\nf()\n', line: 2 },
  { kind: 'unused-attribute', red: 'class A:\n    def __init__(self):\n        self.v = 1\n\n\nA()\n', green: 'class A:\n    def __init__(self):\n        self.v = 1\n\n\nprint(A().v)\n', line: 3 },
  { kind: 'unused-property', red: 'class A:\n    @property\n    def p(self):\n        return 1\n\n\nA()\n', green: 'class A:\n    @property\n    def p(self):\n        return 1\n\n\nprint(A().p)\n', line: 2 },
  { kind: 'unreachable-code', red: 'def f():\n    return 1\n    print(2)\n\n\nf()\n', green: 'def f():\n    return 1\n\n\nf()\n', line: 3 },
];

for (const { kind, red, green, line } of CASES) {
  test(`real vulture, ${kind} alone: GREEN -> RED -> GREEN`, () => withProject({ 'a.py': green }, async root => {
    assert.deepEqual(await judge(root, kind), ['pass']);
    await writeFile(join(root, 'a.py'), red);
    assert.deepEqual(await judge(root, kind), ['fail', `vulture/${kind}:a.py:${line}`]);
    await writeFile(join(root, 'a.py'), green);
    assert.deepEqual(await judge(root, kind), ['pass']);
  }));
}

test('real vulture: a tree that only breaks another kind passes the Gate that selects one kind', () => withProject({ 'a.py': CASES[1]!.red }, async root => {
  assert.deepEqual(await judge(root, 'unused-import'), ['pass']);
  assert.deepEqual(await judge(root, 'unused-function'), ['fail', 'vulture/unused-function:a.py:1']);
}));

test('real vulture: minConfidence decides which findings count (imports are 90, functions 60)', () => withProject({ 'a.py': 'import os\n\n\ndef f():\n    pass\n' }, async root => {
  assert.deepEqual(await judge(root, 'unused-import', { minConfidence: 90 }), ['fail', 'vulture/unused-import:a.py:1']);
  assert.deepEqual(await judge(root, 'unused-import', { minConfidence: 91 }), ['pass']);
  assert.deepEqual(await judge(root, 'unused-function', { minConfidence: 60 }), ['fail', 'vulture/unused-function:a.py:4']);
  assert.deepEqual(await judge(root, 'unused-function', { minConfidence: 61 }), ['pass']);
}));

test('real vulture: project configuration cannot hide a finding unless configFile asks for it', () => withProject({
  'a.py': 'import os\n', 'pyproject.toml': '[tool.vulture]\nexclude = ["a.py"]\nmin_confidence = 100\nignore_names = ["os"]\n',
}, async root => {
  assert.deepEqual(await judge(root, 'unused-import'), ['fail', 'vulture/unused-import:a.py:1']);
  // The project's own configuration is applied only on request: here its `exclude` leaves vulture nothing to read.
  assert.deepEqual(await judge(root, 'unused-import', { configFile: 'pyproject.toml' }), ['pass']);
}));

test('real vulture: exclude, ignoreNames and ignoreDecorators narrow the run only when the Gate says so', () => withProject({
  'a.py': 'import os\n', 'skip/b.py': 'import sys\n', 'c.py': '@deco\ndef f():\n    pass\n\n\ndef deco(fn):\n    return fn\n\n\ndeco(1)\n',
}, async root => {
  assert.deepEqual((await judge(root, 'unused-import')).slice(0, 1), ['fail']);
  assert.deepEqual(await judge(root, 'unused-import', { exclude: ['skip'] }), ['fail', 'vulture/unused-import:a.py:1']);
  assert.deepEqual(await judge(root, 'unused-import', { exclude: ['skip', 'a.py'] }), ['pass']);
  assert.deepEqual(await judge(root, 'unused-import', { ignoreNames: ['os', 'sys'] }), ['pass']);
  assert.deepEqual(await judge(root, 'unused-function', { paths: ['c.py'], ignoreDecorators: ['@deco'] }), ['pass']);
}));

test('real vulture: REFUSE, never PASS, for the ways vulture exits quietly or not at all', async () => {
  await withProject({ 'bad.py': 'def broken(:\n' }, async root => {
    assert.deepEqual(await judge(root, 'unused-import'), ['refuse', 'vulture-input-unread']);
  });
  await withProject({ 'bad.py': 'def broken(:\n', 'a.py': 'import os\n' }, async root => {
    assert.deepEqual(await judge(root, 'unused-import'), ['refuse', 'vulture-input-unread'], 'exit 3 must not hide the unread file');
  });
  await withProject({ 'enc.py': 'x = "\u00ff"\n' }, async root => {
    await writeFile(join(root, 'enc.py'), Buffer.from([0x78, 0x20, 0x3d, 0x20, 0x22, 0xff, 0x22, 0x0a]));
    assert.deepEqual(await judge(root, 'unused-import'), ['refuse', 'vulture-input-unread']);
  });
  await withProject({ 'notes.txt': 'x' }, async root => {
    assert.deepEqual(await judge(root, 'unused-import'), ['refuse', 'vulture-nothing-inspected']);
  });
  await withProject({ 'a.py': 'import os\n' }, async root => {
    assert.deepEqual(await judge(root, 'unused-import', { paths: ['absent'] }), ['refuse', 'vulture-path-missing']);
    assert.deepEqual(await judge(root, 'unused-import', { command: 'redproof-no-such-vulture' }), ['refuse', 'command-unavailable']);
  });
  await withProject({ 'w.py': 'import re\nre.compile("\\d")\n' }, async root => {
    assert.deepEqual(await judge(root, 'unused-import'), ['pass'], 'a SyntaxWarning is not unread input');
  });
});

test('real vulture: paths and cwd are honoured, and a whitelist module marks names as used', () => withProject({
  'app/src/a.py': 'def used_dynamically():\n    pass\n', 'app/src/other.py': 'import os\n', 'app/whitelist.py': 'used_dynamically\n',
}, async root => {
  assert.deepEqual(await judge(root, 'unused-function', { cwd: 'app', paths: ['src'] }), ['fail', 'vulture/unused-function:app/src/a.py:1']);
  assert.deepEqual(await judge(root, 'unused-function', { cwd: 'app', paths: ['src', 'whitelist.py'] }), ['pass']);
  assert.deepEqual(await judge(root, 'unused-import', { cwd: 'app', paths: ['src/a.py'] }), ['pass']);
}));

test('real vulture: an exclude that removes every file REFUSES rather than passing on nothing', () => withProject({ 'a.py': 'import os\n', 'sub/b.py': 'import sys\n' }, async root => {
  assert.deepEqual(await judge(root, 'unused-import', { exclude: ['a.py', 'sub'] }), ['refuse', 'vulture-nothing-inspected']);
  assert.deepEqual(await judge(root, 'unused-import', { exclude: ['A.PY', 'SUB'] }), ['refuse', 'vulture-nothing-inspected'], 'matching ignores case, as vulture does');
}));

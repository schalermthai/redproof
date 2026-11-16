import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import realTest from 'node:test';
import { chmod, mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { defineGate, runGate } from 'redproof';
import { vulture, type VultureOptions } from '../src/index.ts';
import { VULTURE_KINDS, excludeMatcher, parseVultureOutput } from '../src/core/model.ts';
import { nativeTest as test, tools, vultureRequired, withProject, type Tool } from './support/workspace.ts';

/** The source of every installed vulture module that can print reachability messages (older releases keep them in core.py). */
const messageSource = (python: string): string => {
  const script = 'import importlib.util as u, vulture.core as c\nfor name in ("vulture.core", "vulture.reachability"):\n    spec = u.find_spec(name)\n    print(spec.origin) if spec else None';
  return execFileSync(python, ['-c', script], { encoding: 'utf8' }).split('\n').filter(Boolean).map(file => readFileSync(file, 'utf8')).join('\n');
};

if (vultureRequired && !tools.length) {
  realTest('vulture is installed (REDPROOF_VULTURE_REQUIRED=1 says CI must run the native tests)', () => assert.fail('No vulture found: set REDPROOF_VULTURE_PYTHON to the python of a virtualenv that has it.'));
}

function suite(tool: Tool): void {
  /** Through `runGate`, as a user meets it: the Gate's verdict with only the named rule selected. */
  async function judge(root: string, kind: string, options: Partial<VultureOptions> = {}): Promise<readonly string[]> {
    const verdict = await runGate(defineGate({ id: 'dead', adapter: vulture({ command: tool.binary, rules: { r: kind }, ...options } as never) as never }), root);
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
    test(`[${tool.label}] real vulture, ${kind} alone: GREEN -> RED -> GREEN`, () => withProject({ 'a.py': green }, async root => {
      assert.deepEqual(await judge(root, kind), ['pass']);
      await writeFile(join(root, 'a.py'), red);
      assert.deepEqual(await judge(root, kind), ['fail', `vulture/${kind}:a.py:${line}`]);
      await writeFile(join(root, 'a.py'), green);
      assert.deepEqual(await judge(root, kind), ['pass']);
    }));
  }

  test(`[${tool.label}] real vulture: a tree that only breaks another kind passes the Gate that selects one kind`, () => withProject({ 'a.py': CASES[1]!.red }, async root => {
    assert.deepEqual(await judge(root, 'unused-import'), ['pass']);
    assert.deepEqual(await judge(root, 'unused-function'), ['fail', 'vulture/unused-function:a.py:1']);
  }));

  test(`[${tool.label}] real vulture: minConfidence decides which findings count (imports are 90, functions 60)`, () => withProject({ 'a.py': 'import os\n\n\ndef f():\n    pass\n' }, async root => {
    assert.deepEqual(await judge(root, 'unused-import', { minConfidence: 90 }), ['fail', 'vulture/unused-import:a.py:1']);
    assert.deepEqual(await judge(root, 'unused-import', { minConfidence: 91 }), ['pass']);
    assert.deepEqual(await judge(root, 'unused-function', { minConfidence: 60 }), ['fail', 'vulture/unused-function:a.py:4']);
    assert.deepEqual(await judge(root, 'unused-function', { minConfidence: 61 }), ['pass']);
  }));

  test(`[${tool.label}] real vulture: project configuration cannot hide a finding unless configFile asks for it`, () => withProject({
    'a.py': 'import os\n', 'pyproject.toml': '[tool.vulture]\nexclude = ["a.py"]\nmin_confidence = 100\nignore_names = ["os"]\n',
  }, async root => {
    assert.deepEqual(await judge(root, 'unused-import'), ['fail', 'vulture/unused-import:a.py:1']);
    // The project's own configuration is applied only on request: here its `exclude` leaves vulture nothing to read.
    assert.deepEqual(await judge(root, 'unused-import', { configFile: 'pyproject.toml' }), ['pass']);
  }));

  test(`[${tool.label}] real vulture: exclude, ignoreNames and ignoreDecorators narrow the run only when the Gate says so`, () => withProject({
    'a.py': 'import os\n', 'skip/b.py': 'import sys\n', 'c.py': '@deco\ndef f():\n    pass\n\n\ndef deco(fn):\n    return fn\n\n\ndeco(1)\n',
  }, async root => {
    assert.deepEqual((await judge(root, 'unused-import')).slice(0, 1), ['fail']);
    assert.deepEqual(await judge(root, 'unused-import', { exclude: ['skip'] }), ['fail', 'vulture/unused-import:a.py:1']);
    assert.deepEqual(await judge(root, 'unused-import', { exclude: ['skip', 'a.py'] }), ['pass']);
    assert.deepEqual(await judge(root, 'unused-import', { ignoreNames: ['os', 'sys'] }), ['pass']);
    assert.deepEqual(await judge(root, 'unused-function', { paths: ['c.py'], ignoreDecorators: ['@deco'] }), ['pass']);
  }));

  test(`[${tool.label}] real vulture: REFUSE, never PASS, for the ways vulture exits quietly or not at all`, async () => {
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

  test(`[${tool.label}] real vulture: paths and cwd are honoured, and a whitelist module marks names as used`, () => withProject({
    'app/src/a.py': 'def used_dynamically():\n    pass\n', 'app/src/other.py': 'import os\n', 'app/whitelist.py': 'used_dynamically\n',
  }, async root => {
    assert.deepEqual(await judge(root, 'unused-function', { cwd: 'app', paths: ['src'] }), ['fail', 'vulture/unused-function:app/src/a.py:1']);
    assert.deepEqual(await judge(root, 'unused-function', { cwd: 'app', paths: ['src', 'whitelist.py'] }), ['pass']);
    assert.deepEqual(await judge(root, 'unused-import', { cwd: 'app', paths: ['src/a.py'] }), ['pass']);
  }));

  test(`[${tool.label}] real vulture: an exclude that removes every file REFUSES rather than passing on nothing`, () => withProject({ 'a.py': 'import os\n', 'sub/b.py': 'import json\n' }, async root => {
    assert.deepEqual(await judge(root, 'unused-import', { exclude: ['a.py', 'sub'] }), ['refuse', 'vulture-nothing-inspected']);
    assert.deepEqual(await judge(root, 'unused-import', { exclude: ['A.PY', 'SUB'] }), ['fail', 'vulture/unused-import:a.py:1', 'vulture/unused-import:sub/b.py:1'], 'fnmatch is case-sensitive on POSIX, as the adapter is');
  }));

  test(`[${tool.label}] real vulture: a file name that imitates a finding cannot hide a real one (every rule alone)`, () => withProject({
    "p/a:5: unused import 'x' (90% confidence) .py": 'def f():\n    pass\n',
  }, async root => {
    const hostile = "p/a:5: unused import 'x' (90% confidence) .py";
    assert.deepEqual(await judge(root, 'unused-function'), ['fail', `vulture/unused-function:${hostile}:1`]);
    for (const kind of VULTURE_KINDS.filter(k => k !== 'unused-function')) assert.deepEqual(await judge(root, kind), ['pass'], kind);
  }));

  test(`[${tool.label}] real vulture: a syntax error cannot pass as a warning, whatever its file name or source says`, () => withProject({
    'ok.py': 'import os\n', 'a:1: Warning: .py': 'x = = 1\n',
  }, async root => {
    assert.deepEqual(await judge(root, 'unused-function'), ['refuse', 'vulture-input-unread']);
    await writeFile(join(root, 'a:1: Warning: .py'), 'x = 1\n');
    await writeFile(join(root, 'c.py'), 'y = = 2  # :1: Warning: x\n');
    assert.deepEqual(await judge(root, 'unused-function'), ['refuse', 'vulture-input-unread']);
  }));

  test(`[${tool.label}] real vulture: every reachability message of the installed vulture parses as unreachable-code`, () => {
    const messages = [...messageSource(tool.python).matchAll(/message=f?"((?:unreachable|unsatisfiable|redundant)[^"]*)"/gu)].map(m => m[1]!.replace(/\{[^}]*\}/gu, 'return'));
    assert.ok(messages.length >= 1, `found ${messages.length} reachability messages`);
    for (const message of messages) {
      const { findings, unrecognised } = parseVultureOutput(`a.py:1: ${message} (100% confidence)\n`);
      assert.deepEqual(unrecognised, [], `a new vulture message needs the parser: ${message}`);
      assert.equal(findings[0]?.kind, 'unreachable-code', message);
    }
  });

  test(`[${tool.label}] real vulture: redundant conditions are reachability findings, and they do not refuse an unrelated rule`, () => withProject({
    'a.py': 'import sys\n\nif True:\n    sys.exit(0)\n\nx = 1 if True else 2\nprint(x)\n',
  }, async root => {
    if (!messageSource(tool.python).includes('redundant if-condition')) return;
    assert.deepEqual((await judge(root, 'unreachable-code'))[0], 'fail');
    assert.deepEqual(await judge(root, 'unused-import'), ['pass']);
    assert.deepEqual(await judge(root, 'unused-variable'), ['pass']);
  }));

  test(`[${tool.label}] real vulture: the exclude guard agrees with vulture on case and on [^x] classes`, async () => {
    await withProject({ 'Mod.py': 'import os\n' }, async root => {
      const outcome = await judge(root, 'unused-import', { exclude: ['mod.py'] });
      assert.deepEqual(outcome, ['fail', 'vulture/unused-import:Mod.py:1'], 'fnmatch is case-sensitive on POSIX: nothing is excluded');
      assert.deepEqual(await judge(root, 'unused-import', { exclude: ['B.PY'], paths: ['Mod.py'] }), ['fail', 'vulture/unused-import:Mod.py:1']);
    });
    await withProject({ a: 'import os\n', 'real.py': 'x = 1\n' }, async root => {
      assert.deepEqual(await judge(root, 'unused-import', { paths: ['a'], exclude: ['*/[^a]'] }), ['refuse', 'vulture-nothing-inspected']);
    });
  });

  test(`[${tool.label}] real vulture: the exclude matcher equals Python fnmatch on a pattern/path matrix`, async () => {
    // Patterns containing a wildcard are used as written, as vulture does; the others become *pattern* in both.
    const patterns = ['*', 'a', '*.py', '?', '[abc]', '[!abc]', '[^a]', '[a-c]', '[c-a]', '[]]', '[!]]', '[', 'x[', '[a-]', '[-a]', '[a-c-e]', '*/[^a]', '[&&]', '[~~]', '[||]', '\\\\', '[\\\\]', 'a*b?c', '*/tests/*', '.venv', 'ä*'];
    const paths = ['/r/a', '/r/A', '/r/^', '/r/b', '/r/-', '/r/]', '/r/[', '/r/x[', '/r/&', '/r/~', '/r/|', '/r/a.py', '/r/tests/t.py', '/r/.venv/x.py', '/r/axbyc', '/r/ä.py', '/r/\\', '/r/d'];
    const script = `import fnmatch,json,sys
cases=json.load(sys.stdin)
prep=lambda p: p if any(c in p for c in "*?[") else "*"+p+"*"
print(json.dumps([[p,t,fnmatch.fnmatch(t,prep(p))] for p in cases["p"] for t in cases["t"]]))`;
    const out = execFileSync(tool.python, ['-c', script], { input: JSON.stringify({ p: patterns, t: paths }), encoding: 'utf8' });
    for (const [pattern, path, expected] of JSON.parse(out) as Array<[string, string, boolean]>) {
      assert.equal(excludeMatcher([pattern], false)(path), expected, `${pattern} vs ${path}`);
    }
  });

  test(`[${tool.label}] real vulture: the exclude matcher equals Python fnmatch on seeded, bracket-heavy fuzz (the shape that once hid a file)`, () => {
    let seed = 20261116;
    const next = (n: number): number => { seed = (seed * 1103515245 + 12345) % 2147483648; return Math.floor(seed / 65536) % n; };
    // Whole bracket tokens, so a class that starts with `]` or `!]` is common rather than rare.
    const alphabet = ['a', 'b', ']', '[', '[]', '[!]', '[!', '[^', '[^]', '!', '^', '-', '*', '?', '.', '/', '&', '~', '|', '\\', ']a]', '[a-b]'];
    const word = (): string => Array.from({ length: 1 + next(5) }, () => alphabet[next(alphabet.length)]!).join('');
    const patterns = Array.from({ length: 4000 }, word);
    const paths = ['/p/a.py', '/p/].py', '/p/b', '/p/a]b', '/p/!', '/p/^', '/p/-', '/p/[', '/p/&', '/p/~', '/p/|', '/p/\\', '/p/ab.py', '/p/a/b'];
    const script = [
      'import fnmatch,json,sys', 'cases=json.load(sys.stdin)', 'prep=lambda p: p if any(c in p for c in "*?[") else "*"+p+"*"',
      'print(json.dumps([[p,t,fnmatch.fnmatch(t,prep(p))] for p in cases["p"] for t in cases["t"]]))',
    ].join('\n');
    const out = JSON.parse(execFileSync(tool.python, ['-c', script], { input: JSON.stringify({ p: patterns, t: paths }), encoding: 'utf8', maxBuffer: 1 << 28 })) as Array<[string, string, boolean]>;
    const bad: string[] = [];
    for (const [pattern, path, expected] of out) {
      let got: boolean | string;
      try { got = excludeMatcher([pattern], false)(path); } catch (error) { got = `throws ${String(error)}`; }
      if (got !== expected) bad.push(`${JSON.stringify(pattern)} vs ${path}: python ${String(expected)}, matcher ${String(got)}`);
    }
    return Promise.resolve().then(() => assert.deepEqual(bad.slice(0, 5), [], `${bad.length} disagreements with fnmatch`));
  });

  test(`[${tool.label}] real vulture: a file is excluded by the adapter exactly when real vulture excludes it (a real run per pattern)`, () => withProject({ 'a.py': 'import os\n' }, async root => {
    const patterns = ['*[]a].py', '*[!]b].py', '*[]]*', '*[^a]*', '*[!a]*', '*/[a-b].py', '*/[]-a].py', '*[b]*', '*a?py', '*[]a', '[]*', '*/a.py', 'a.py', '*[]x]', '[!]]*'];
    for (const pattern of patterns) {
      const raw = spawnSync(tool.binary, ['--exclude', pattern, '--min-confidence', '60', '--', join(root, 'a.py')], { encoding: 'utf8', env: { ...process.env, PYTHONWARNINGS: 'ignore' } });
      assert.ok(raw.status === 0 || raw.status === 3, `${pattern}: vulture exited ${String(raw.status)}`);
      const excludedByVulture = raw.status === 0;
      assert.deepEqual(await judge(root, 'unused-import', { exclude: [pattern] }),
        excludedByVulture ? ['refuse', 'vulture-nothing-inspected'] : ['fail', 'vulture/unused-import:a.py:1'], pattern);
    }
  }));

  test(`[${tool.label}] real vulture: stdlib modules vulture ships whitelists for are never reported unused (pinned, so a change in vulture shows up)`, () => withProject({
    'a.py': 'import sys, logging, enum, threading, argparse\nimport os, json\n',
  }, async root => {
    assert.deepEqual(await judge(root, 'unused-import'), ['fail', 'vulture/unused-import:a.py:2', 'vulture/unused-import:a.py:2'],
      'only os and json are reported; sys, logging, enum, threading and argparse are invisible to vulture');
  }));

  test(`[${tool.label}] real vulture: a root under a directory named tests REFUSES, because test_* functions would silently count as used`, async () => {
    const outer = await mkdtemp(join(tmpdir(), 'redproof-vulture-outer-'));
    try {
      const body = { 'lib.py': 'def test_orphan():\n    pass\n' };
      const plain = join(outer, 'plain', 'proj');
      const under = join(outer, 'tests', 'proj');
      for (const dir of [plain, under]) { await mkdir(dir, { recursive: true }); for (const [name, text] of Object.entries(body)) await writeFile(join(dir, name), text); }
      assert.deepEqual(await judge(plain, 'unused-function'), ['fail', 'vulture/unused-function:lib.py:1'], 'outside a test directory the function is dead code');
      assert.deepEqual(await judge(under, 'unused-function'), ['refuse', 'vulture-root-in-test-directory']);
      assert.deepEqual(await judge(under, 'unused-function', { allowTestPathAncestors: true }), ['pass'], 'the opt-in accepts vulture\'s own behaviour');
    } finally { await rm(outer, { recursive: true, force: true }); }
  });

  test(`[${tool.label}] real vulture: a directory that cannot be read REFUSES instead of being skipped`, () => withProject({ 'ok.py': 'x = 1\n', 'sub/a.py': 'import os\n' }, async root => {
    await chmod(join(root, 'sub'), 0o000);
    try { assert.deepEqual(await judge(root, 'unused-import'), ['refuse', 'vulture-path-unreadable']); }
    finally { await chmod(join(root, 'sub'), 0o755); }
  }));

  test(`[${tool.label}] real vulture: a file name with a line break REFUSES (it can forge a line of the report)`, () => withProject({
    "x.py:1: unused import 'q' (90% confidence)\nreal.py": 'x = 1\n',
  }, async root => {
    assert.deepEqual(await judge(root, 'unused-import'), ['refuse', 'vulture-unsafe-file-name']);
  }));

  test(`[${tool.label}] real vulture: with a project configFile the count is not claimed (inspected is null), and a hollow exclude is still honoured`, () => withProject({
    'a.py': 'import os\n', 'pyproject.toml': '[tool.vulture]\nexclude = ["a.py"]\n',
  }, async root => {
    const adapter = vulture({ command: tool.binary, rules: { r: 'unused-import' }, configFile: 'pyproject.toml' });
    const result = await adapter.check.run({ root, rules: ['vulture/unused-import'] });
    assert.equal(result.verdict, 'pass');
    assert.equal(result.scan.inspected, null, 'the project file removed a.py: reporting 1 would be a lie');
    const own = await vulture({ command: tool.binary, rules: { r: 'unused-import' } }).check.run({ root, rules: ['vulture/unused-import'] });
    assert.equal(own.verdict, 'fail');
    assert.equal(own.scan.inspected, 1);
  }));

}

for (const tool of tools) suite(tool);

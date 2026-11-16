import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { mypy, type MypyOptions } from '../src/index.ts';
import { nativeTest, pinned, python, withFiles, type Files } from './support/workspace.ts';

const native = nativeTest(test);
const BAD = 'x: int = "a"\n';

async function run(root: string, options: Partial<MypyOptions> = {}, rule = 'assignment') {
  const adapter = mypy({ rules: { a: rule }, python, ...pinned, ...options } as MypyOptions);
  return adapter.check.run({ root, rules: Object.values(adapter.rules).map(r => r.id) });
}

type Outcome = 'fail' | 'pass' | string;
function outcome(result: Awaited<ReturnType<typeof run>>): Outcome {
  return result.verdict === 'refuse' ? result.why.code : result.verdict;
}

/** Things a Gate must never PASS: each one, with real mypy, that rule alone. `expected` is what the Gate must say. */
const matrix: ReadonlyArray<readonly [string, Files, Partial<MypyOptions>, Outcome, string?]> = [
  ['control: the violation is found', { 'a.py': BAD }, {}, 'fail'],
  ['control: a clean tree passes', { 'a.py': 'x: int = 1\n' }, {}, 'pass'],
  // Anything that can hide a finding
  ['ignore_errors in a section', { 'a.py': BAD, 'mypy.ini': '[mypy]\n[mypy-a]\nignore_errors = True\n' }, {}, 'mypy-setting-hides-findings'],
  ['ignore_errors in pyproject.toml', { 'a.py': BAD, 'pyproject.toml': '[tool.mypy]\n[[tool.mypy.overrides]]\nmodule = "a"\nignore_errors = true\n' }, {}, 'mypy-setting-hides-findings'],
  ['ignore_errors in setup.cfg', { 'a.py': BAD, 'setup.cfg': '[mypy]\nignore_errors = True\n' }, {}, 'mypy-setting-hides-findings'],
  ['follow_imports = skip', { 'a.py': 'from b import y\nx: int = y\n', 'b.py': 'y = "s"\n', 'mypy.ini': '[mypy]\nfollow_imports = skip\n' }, {}, 'mypy-setting-hides-findings'],
  ['follow_imports = silent', { 'a.py': BAD, 'mypy.ini': '[mypy]\nfollow_imports = silent\n' }, {}, 'mypy-setting-hides-findings'],
  ['ignore_missing_imports', { 'a.py': 'import nope_zz\n' + BAD, 'mypy.ini': '[mypy]\nignore_missing_imports = True\n' }, {}, 'mypy-setting-hides-findings'],
  ['disable_error_code in a section', { 'a.py': BAD, 'mypy.ini': '[mypy]\n[mypy-a]\ndisable_error_code = assignment\n' }, {}, 'mypy-setting-hides-findings'],
  ['disable_error_code of a parent in a section', { 'a.py': 'class A:\n    def f(self) -> None: ...\nA().f = lambda: None\n', 'mypy.ini': '[mypy]\n[mypy-a]\ndisable_error_code = assignment\n' }, { }, 'mypy-setting-hides-findings'],
  ['a section turns check_untyped_defs off', { 'a.py': 'def f():\n    x: int = "a"\n', 'mypy.ini': '[mypy]\n[mypy-a]\ncheck_untyped_defs = False\n' }, {}, 'mypy-setting-unvetted'],
  ['a section turns warn_unused_ignores off', { 'a.py': BAD, 'mypy.ini': '[mypy]\n[mypy-a]\nwarn_unused_ignores = False\n' }, {}, 'mypy-setting-unvetted'],
  ['exclude', { 'a.py': BAD, 'b.py': 'y = 1\n', 'mypy.ini': '[mypy]\nexclude = a\\.py\n' }, {}, 'mypy-setting-hides-findings'],
  ['always_false', { 'a.py': BAD, 'mypy.ini': '[mypy]\nalways_false = FLAG\n' }, {}, 'mypy-setting-hides-findings'],
  ['a plugin', { 'a.py': BAD, 'mypy.ini': '[mypy]\nplugins = nothing.here\n' }, {}, 'mypy-setting-hides-findings'],
  ['strict_optional = False', { 'a.py': BAD, 'mypy.ini': '[mypy]\nstrict_optional = False\n' }, {}, 'mypy-setting-unvetted'],
  ['implicit_optional', { 'a.py': BAD, 'mypy.ini': '[mypy]\nimplicit_optional = True\n' }, {}, 'mypy-setting-unvetted'],
  ['allow_redefinition', { 'a.py': BAD, 'mypy.ini': '[mypy]\nallow_redefinition = True\n' }, {}, 'mypy-setting-unvetted'],
  ['a report that writes into the tree', { 'a.py': BAD, 'mypy.ini': '[mypy]\njunit_xml = out.xml\n' }, {}, 'mypy-setting-unvetted'],
  ['a line-count report that writes into the tree', { 'a.py': BAD, 'mypy.ini': '[mypy]\nlinecount_report = rep\n' }, {}, 'mypy-setting-unvetted'],
  ['install_types', { 'a.py': BAD, 'mypy.ini': '[mypy]\ninstall_types = True\n' }, {}, 'mypy-setting-unvetted'],
  ['custom_typeshed_dir', { 'a.py': BAD, 'typeshed/.keep': '', 'mypy.ini': '[mypy]\ncustom_typeshed_dir = typeshed\n' }, {}, 'mypy-setting-unvetted'],
  ['an unrecognised option', { 'a.py': BAD, 'mypy.ini': '[mypy]\nignore_errros = True\n' }, {}, 'mypy-config-warning'],
  ['a mypy comment in the file', { 'a.py': '# mypy: ignore-errors\n' + BAD }, {}, 'mypy-inline-config'],
  ['a mypy comment that disables the code', { 'a.py': '# mypy: disable-error-code="assignment"\n' + BAD }, {}, 'mypy-inline-config'],
  ['a mypy comment after the code', { 'a.py': BAD + '# mypy: ignore-errors\n' }, {}, 'mypy-inline-config'],
  ['a type: ignore before the first statement', { 'a.py': '# type: ignore\n' + BAD }, {}, 'mypy-ignore-comments'],
  ['a bare type: ignore on the violation', { 'a.py': 'x: int = "a"  # type: ignore\n' }, {}, 'mypy-ignore-comments'],
  ['a type: ignore[code] on the violation', { 'a.py': 'x: int = "a"  # type: ignore[assignment]\n' }, {}, 'mypy-ignore-comments'],
  ['a stale type: ignore hides nothing', { 'a.py': 'x: int = 1  # type: ignore\n' }, {}, 'pass'],
  ['a type: ignore of another code does not hide this rule', { 'a.py': 'import os  # type: ignore[unused-import]\n' + BAD }, {}, 'fail'],
  // Vacuous passes
  ['an unannotated body is still checked', { 'a.py': 'def f():\n    x: int = "a"\n    return x\n' }, {}, 'fail'],
  ['a project with no Python files', { 'README.md': '# nothing\n' }, {}, 'mypy-nothing-inspected'],
  ['only a directory that mypy skips', { '.hidden/a.py': BAD }, {}, 'mypy-nothing-inspected'],
  ['a named path that holds nothing', { 'a.py': BAD, 'empty/.keep': '' }, { paths: ['a.py', 'empty'] }, 'mypy-nothing-inspected'],
  ['a syntax error', { 'a.py': 'def f(:\n' }, {}, 'mypy-syntax-error'],
  ['a syntax error beside a clean file', { 'a.py': 'x: int = 1\n', 'b.py': 'def f(:\n' }, {}, 'mypy-syntax-error'],
  ['an unresolved import', { 'a.py': 'import nope_zz\n' }, {}, 'mypy-imports-unresolved'],
  ['an unresolved import beside a real violation', { 'a.py': 'import nope_zz\n' + BAD }, {}, 'mypy-imports-unresolved'],
  // Review round 1: findings mypy drops without saying so
  ['one unused code in a type: ignore list does not make the whole comment unused', { 'a.py': 'x: int = "a"  # type: ignore[assignment, call-arg]\n' }, {}, 'mypy-ignore-comments'],
  ['a type: ignore list whose codes are all unused hides nothing', { 'a.py': 'x: int = 1  # type: ignore[assignment, call-arg]\n' }, {}, 'pass'],
  ['a .py beside a .pyi is never checked', { 'bad.py': BAD, 'bad.pyi': 'x: int\n' }, { paths: ['.'] }, 'mypy-files-unchecked'],
  ['a .py beside a .pyi, once the Gate accepts that', { 'bad.py': BAD, 'bad.pyi': 'x: int\n' }, { paths: ['.'], allow: ['skipped-files'] }, 'pass'],
  ['@no_type_check on a function', { 'a.py': 'from typing import no_type_check\n@no_type_check\ndef f() -> None:\n    x: int = "a"\n' }, {}, 'mypy-no-type-check'],
  ['@typing.no_type_check on a method', { 'a.py': 'import typing\nclass C:\n    @typing.no_type_check\n    def m(self) -> None:\n        x: int = "a"\n' }, {}, 'mypy-no-type-check'],
  ['@no_type_check imported under another name', { 'a.py': 'from typing import no_type_check as skip\n@skip\ndef f() -> None:\n    x: int = "a"\n' }, {}, 'mypy-no-type-check'],
  ['a hidden directory holding Python beside a checked file', { 'a.py': 'x: int = 1\n', '.hidden/h.py': BAD }, { paths: ['.'] }, 'mypy-files-unchecked'],
  ['node_modules holding Python under a named path is skipped by mypy, so it is unchecked', { 'a.py': 'x: int = 1\n', 'node_modules/n/n.py': BAD }, { paths: ['.'] }, 'mypy-files-unchecked'],
  ['site-packages holding Python under a named path is skipped by mypy, so it is unchecked', { 'a.py': 'x: int = 1\n', 'site-packages/s.py': BAD }, { paths: ['.'] }, 'mypy-files-unchecked'],
  ['a type: ignore in a file reached only through an import', { 'src/a.py': 'from lib import util\nx: int = util.v\n', 'lib/__init__.py': '', 'lib/util.py': 'v: int = "a"  # type: ignore\n' }, { paths: ['src'] }, 'mypy-ignore-comments'],
  ['a mypy comment in a file reached only through an import', { 'src/a.py': 'from lib import util\nx: int = util.v\n', 'lib/__init__.py': '', 'lib/util.py': '# mypy: ignore-errors\nv: int = "a"\n' }, { paths: ['src'] }, 'mypy-inline-config'],
  ['code mypy considers unreachable is never checked', { 'a.py': 'def f() -> int:\n    return 1\n    y: int = "a"\n' }, {}, 'mypy-unreachable-code'],
  ['unreachable code, once the Gate accepts that', { 'a.py': 'def f() -> int:\n    return 1\n    y: int = "a"\n' }, { allow: ['unreachable-code'] }, 'pass'],
  ['a platform branch the Gate pinned away is its own choice, not a refusal', { 'a.py': 'import sys\nif sys.platform == "win32":\n    z: int = "c"\n' }, {}, 'pass'],
  // Review round 2
  ['B4: ignore[assignment] hides method-assign (mypy only says: use the narrower code)', { 'a.py': 'class A:\n    def f(self) -> None: ...\n    def g(self) -> None:\n        self.f = lambda: None  # type: ignore[assignment]\n' }, {}, 'mypy-ignore-comments', 'method-assign'],
  ['B4: ignore[misc] hides overload-overlap', { 'a.py': 'from typing import overload\n@overload\ndef f(x: int) -> int: ...  # type: ignore[misc]\n@overload\ndef f(x: object) -> str: ...\ndef f(x: object) -> object:\n    return x\n' }, {}, 'mypy-ignore-comments', 'overload-overlap'],
  ['B4: ignore[import] hides import-not-found', { 'a.py': 'import nope_zz  # type: ignore[import]\n' }, {}, 'mypy-ignore-comments', 'import-not-found'],
  ['B5: ignore[] hides an error on current mypy', { 'a.py': 'x: int = "a"  # type: ignore[]\n' }, {}, 'fail|mypy-ignore-comments'],
  ['B5: ignore[ ] with a space', { 'a.py': 'x: int = "a"  # type: ignore[ ]\n' }, {}, 'fail|mypy-ignore-comments'],
  ['B6: a bare ignore on the unresolved import of a selected import-not-found rule', { 'a.py': 'import nope_zz  # type: ignore\n' }, {}, 'mypy-ignore-comments', 'import-not-found'],
  ['B6: ignore[import-not-found] on a selected import-not-found rule', { 'a.py': 'import nope_zz  # type: ignore[import-not-found]\n' }, {}, 'mypy-ignore-comments', 'import-not-found'],
  ['B6: an ignore on the dead statement of a selected unreachable rule', { 'a.py': 'def f() -> int:\n    return 1\n    y = 1  # type: ignore\n' }, {}, 'mypy-ignore-comments', 'unreachable'],
  ['I4: ignore[import-not-found] defeats the unresolved-import guard of another rule', { 'a.py': 'import nope_zz  # type: ignore[import-not-found]\n' }, {}, 'mypy-ignore-comments'],
  ['I4: ignore[unreachable] defeats the unreachable guard of another rule', { 'a.py': 'def f() -> int:\n    return 1\n    y = 1  # type: ignore[unreachable]\n' }, {}, 'mypy-ignore-comments'],
  ['B7: a type: ignore in dist-packages, which mypy checks', { 'a.py': 'x: int = 1\n', 'dist-packages/d.py': 'x: int = "a"  # type: ignore\n' }, { paths: ['.'] }, 'mypy-ignore-comments'],
  ['B7: # mypy: ignore-errors in dist-packages', { 'a.py': 'x: int = 1\n', 'dist-packages/d.py': '# mypy: ignore-errors\nx: int = "a"\n' }, { paths: ['.'] }, 'mypy-inline-config'],
  ['B8: a .py beside a .pyi in a folder holding pyvenv.cfg', { 'a.py': 'x: int = 1\n', 'pkg/pyvenv.cfg': '', 'pkg/m.py': BAD, 'pkg/m.pyi': 'x: int\n' }, { paths: ['.'] }, 'mypy-files-unchecked'],
  ['B3b: a re-exported no_type_check decorator', { 'u.py': 'from typing import no_type_check as skip\n', 'a.py': 'from u import skip\n@skip\ndef f() -> None:\n    x: int = "a"\n' }, { paths: ['.'] }, 'mypy-no-type-check'],
  ['B3b: no_type_check reached as an attribute of an own module', { 'u.py': 'from typing import no_type_check as skip\n', 'a.py': 'import u\n@u.skip\ndef f() -> None:\n    x: int = "a"\n' }, { paths: ['.'] }, 'mypy-no-type-check'],
  ['S5: warn_unused_configs is not vetted', { 'a.py': BAD, 'mypy.ini': '[mypy]\nwarn_unused_configs = True\n[mypy-zzz]\ndisallow_any_generics = True\n' }, {}, 'mypy-setting-unvetted'],
  // Missing or unusable input
  ['a missing path', { 'a.py': BAD }, { paths: ['absent.py'] }, 'mypy-path-missing'],
  ['a missing cwd', { 'a.py': BAD }, { cwd: 'nowhere' }, 'mypy-path-missing'],
  ['a missing configFile', { 'a.py': BAD }, { configFile: 'nope.ini' }, 'mypy-path-missing'],
  ['a broken configuration file', { 'a.py': BAD, 'mypy.ini': '[mypy\n' }, {}, 'mypy-config-warning'],
  ['an interpreter that does not exist', { 'a.py': BAD }, { python: '/nonexistent/python' }, 'command-unavailable'],
];
for (const [name, files, options, expected, rule] of matrix) {
  native(`real mypy: ${name} -> ${expected}`, async () => {
    await withFiles(files, async root => {
      const got = outcome(await run(root, options, rule));
      // `a|b`: either is a correct answer for this mypy version; what is never correct is `pass`.
      assert.ok(expected.split('|').includes(got), `${got} is not ${expected}`);
    });
  });
}

native('REFUSE, never PASS: a mypy that cannot import (a Python with no mypy installed)', async () => {
  await withFiles({ 'a.py': BAD }, async root => {
    assert.equal(outcome(await run(root, { python: process.env.REDPROOF_NO_MYPY_PYTHON ?? '/usr/bin/python3' })), 'mypy-unavailable');
  });
});

native('a user-level configuration outside the Gate root REFUSES instead of silently hiding findings', async () => {
  const home = await mkdtemp(join(tmpdir(), 'redproof-mypy-home-'));
  const saved = { HOME: process.env.HOME, XDG: process.env.XDG_CONFIG_HOME };
  try {
    await mkdir(join(home, 'mypy'), { recursive: true });
    await writeFile(join(home, 'mypy', 'config'), '[mypy]\ndisable_error_code = assignment\nignore_errors = True\n');
    process.env.HOME = home;
    process.env.XDG_CONFIG_HOME = home;
    await withFiles({ 'a.py': BAD }, async root => {
      assert.equal(outcome(await run(root)), 'mypy-config-outside-root');
      assert.equal(outcome(await run(root, { isolated: true })), 'fail', 'isolated ignores the user file and sees the violation');
    });
  } finally {
    if (saved.HOME === undefined) delete process.env.HOME; else process.env.HOME = saved.HOME;
    if (saved.XDG === undefined) delete process.env.XDG_CONFIG_HOME; else process.env.XDG_CONFIG_HOME = saved.XDG;
    await rm(home, { recursive: true, force: true });
  }
});

native('MYPYPATH in the environment cannot add modules to the check', async () => {
  const extra = await mkdtemp(join(tmpdir(), 'redproof-mypy-path-'));
  const saved = process.env.MYPYPATH;
  try {
    await writeFile(join(extra, 'extmod_zz.py'), 'v: int = 1\n');
    process.env.MYPYPATH = extra;
    await withFiles({ 'a.py': 'import extmod_zz\n' }, async root => {
      assert.equal(outcome(await run(root)), 'mypy-imports-unresolved', 'the module found only through MYPYPATH must stay unresolved');
    });
  } finally {
    if (saved === undefined) delete process.env.MYPYPATH; else process.env.MYPYPATH = saved;
    await rm(extra, { recursive: true, force: true });
  }
});

native('a project mypy.py or mypy/ package cannot replace the tool', async () => {
  for (const shadow of [{ 'mypy.py': 'raise SystemExit("planted")\n' }, { 'mypy/__init__.py': '', 'mypy/__main__.py': 'raise SystemExit("planted")\n' }]) {
    await withFiles({ 'a.py': BAD, ...shadow }, async root => {
      const result = await run(root, { paths: ['a.py'] });
      assert.equal(outcome(result), 'fail', JSON.stringify(result));
    });
  }
});

native('mypy_path outside the Gate root REFUSES', async () => {
  const outside = await mkdtemp(join(tmpdir(), 'redproof-mypy-outside-'));
  try {
    await withFiles({ 'a.py': BAD, 'mypy.ini': `[mypy]\nmypy_path = ${outside}\n` }, async root => {
      assert.equal(outcome(await run(root)), 'mypy-config-outside-root');
    });
  } finally {
    await rm(outside, { recursive: true, force: true });
  }
});

native('a path that links out of the Gate root REFUSES', async () => {
  const outside = await mkdtemp(join(tmpdir(), 'redproof-mypy-link-'));
  try {
    await writeFile(join(outside, 'o.py'), BAD);
    await withFiles({ 'a.py': 'x: int = 1\n' }, async root => {
      await symlink(outside, join(root, 'linked'));
      assert.equal(outcome(await run(root, { paths: ['linked'] })), 'mypy-path-outside-root');
    });
  } finally {
    await rm(outside, { recursive: true, force: true });
  }
});

native('python version and platform narrow what is checked, so the Gate must pin them', async () => {
  const files = { 'a.py': 'import sys\nif sys.platform == "win32":\n    x: int = "a"\n' };
  await withFiles(files, async root => {
    assert.equal(outcome(await run(root, { pythonVersion: undefined, platform: undefined } as never)), 'mypy-host-dependent');
    assert.equal(outcome(await run(root, { platform: 'linux' })), 'pass');
    assert.equal(outcome(await run(root, { platform: 'win32' })), 'fail', 'the same tree, another platform, another verdict, by choice and not by host');
  });
});

/** Every file and its bytes, so "byte-identical" is a fact and not a hope. */
async function snapshot(dir: string, prefix = ''): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(`${prefix}${entry.name}/`, ...await snapshot(path, `${prefix}${entry.name}/`));
    else out.push(`${prefix}${entry.name} ${createHash('sha256').update(await readFile(path)).digest('hex')}`);
  }
  return out.sort();
}

native('the tree is byte-identical after a run, a refusal, and a kill (no .mypy_cache)', async () => {
  const files = { 'a.py': BAD, 'pkg/__init__.py': '', 'pkg/m.py': 'y: str = 1\n' };
  await withFiles(files, async root => {
    const before = await snapshot(root);
    assert.equal(outcome(await run(root)), 'fail');
    assert.deepEqual(await snapshot(root), before, 'after a normal run');
    assert.equal(outcome(await run(root, { timeoutMs: 150 })), 'command-timeout');
    assert.deepEqual(await snapshot(root), before, 'after a run killed by its timeout');
    assert.equal(outcome(await run(root, { maxOutputBytes: 40 })), 'command-output-limit');
    assert.deepEqual(await snapshot(root), before, 'after a run killed for output');
    assert.ok(!before.some(entry => entry.includes('.mypy_cache')));
  });
});

const oldPython = process.env.REDPROOF_MYPY_OLD_PYTHON ?? fileURLToPath(new URL('../../../../../26-mypy/.venv-1.10.1/bin/python', import.meta.url));
(existsSync(oldPython) ? test : Object.assign(() => undefined, test) as never as typeof test)(
  'mypy 1.10.1 has no --output json and REFUSES with the version as the reason', async () => {
    await withFiles({ 'a.py': BAD }, async root => assert.equal(outcome(await run(root, { python: oldPython })), 'mypy-version-unsupported'));
  });

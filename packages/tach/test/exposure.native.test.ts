import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { defineGate, runGate } from 'redproof';
import { tach, type TachRuleKind } from '../src/index.ts';
import { nativeTest, tachBinary, withFiles } from './support/workspace.ts';

// Round 3: tach cannot say which files it read, so the adapter refuses whenever something that could make tach skip a
// file is present, and does not model tach's own rules. Real tach and real git, through runGate, selected rules alone.
const t = nativeTest(test);

async function verdict(root: string, kinds: TachRuleKind | readonly TachRuleKind[], extra: object = {}): Promise<readonly string[]> {
  const list = typeof kinds === 'string' ? [kinds] : kinds;
  const adapter = tach({ rules: Object.fromEntries(list.map(kind => [kind, kind])), command: tachBinary, ...extra } as never);
  const result = await runGate(defineGate({ id: 'exposure', adapter: adapter as never }), root);
  if (result.verdict === 'fail') return ['fail', ...result.breaches.map(b => `${b.code}@${b.location?.file}`)];
  return result.verdict === 'refuse' ? ['refuse', result.why.code] : [result.verdict];
}
const write = async (root: string, file: string, text: string): Promise<void> => {
  await mkdir(dirname(join(root, file)), { recursive: true });
  await writeFile(join(root, file), text);
};
const git = (cwd: string, ...args: string[]): void => { execFileSync('git', ['-c', 'commit.gpgsign=false', '-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd, stdio: 'ignore' }); };

const TOML = 'source_roots = ["src"]\n[[modules]]\npath = "a"\ndepends_on = []\n[[modules]]\npath = "b"\ndepends_on = ["c"]\n[[modules]]\npath = "c"\ndepends_on = []\n';
/** Module a owns src/a/legacy/impl.py, which imports the undeclared b. */
const LEGACY = {
  'src/a/__init__.py': 'x = 1\n', 'src/a/legacy/__init__.py': '', 'src/a/legacy/impl.py': 'from b import thing\n',
  'src/b/__init__.py': 'from c import y\nthing = 1\n', 'src/c/__init__.py': 'y = 1\n', 'tach.toml': TOML,
};
const RULE = 'undeclared-dependency';
const FAIL = ['fail', 'UndeclaredDependency@src/a/legacy/impl.py'];
const SOURCES = ['refuse', 'tach-ignored-sources'];
const UNKNOWN = ['refuse', 'tach-ignored-sources-unknown'];

t('B1: any exclude beyond plain environment and cache names refuses, whatever its glob syntax, because the adapter does not model tach\'s globs; no exclude, FAIL', async () => {
  const patterns = ['src/a/legacy', '**/impl.py', 'src/a/{legacy,zzz}', 'src/{a,b}/legacy', 'src/a/legacy/{impl,zz}.py', 'src/a/leg{a,b}cy',
    '**/{legacy,zz}/**', 'src/a/[!x]egacy', 'src/a/[^x]egacy', 'src/a/leg\\acy', 'src/a/legacy ', 'src/a/legacy/impl.py\n', 'zzz-matches-nothing'];
  for (const [index, pattern] of patterns.entries()) {
    await withFiles({ ...LEGACY, 'tach.toml': `exclude = [${JSON.stringify(pattern)}]\n${TOML}` }, async root => {
      assert.deepEqual(await verdict(root, RULE), SOURCES, JSON.stringify(pattern));
      if (index === 0) assert.notEqual((await verdict(root, RULE, { allowExcludedSources: true }))[0], 'refuse', 'accepted knowingly');
    });
  }
  await withFiles(LEGACY, async root => assert.deepEqual(await verdict(root, RULE), FAIL));
});

t('B2: tach reads node_modules, __pycache__, site-packages and pyvenv.cfg directories: a .gitignore hiding code in them REFUSES', async () => {
  for (const dir of ['node_modules', '__pycache__', 'site-packages', 'site_packages']) {
    await withFiles({ ...LEGACY, [`src/a/${dir}/__init__.py`]: '', [`src/a/${dir}/impl.py`]: 'from b import thing\n', 'src/a/legacy/impl.py': 'x = 1\n', '.gitignore': `${dir}/\n` }, async root => {
      git(root, 'init', '-q');
      assert.deepEqual(await verdict(root, RULE), SOURCES, dir);
      await rm(join(root, '.gitignore'));
      assert.deepEqual(await verdict(root, RULE), ['fail', `UndeclaredDependency@src/a/${dir}/impl.py`], `${dir}: tach reads it`);
    });
  }
  await withFiles({ ...LEGACY, 'src/a/legacy/pyvenv.cfg': 'home = /x\n', '.gitignore': 'legacy/\n' }, async root => {
    git(root, 'init', '-q');
    assert.deepEqual(await verdict(root, RULE), SOURCES, 'a pyvenv.cfg does not make a directory an environment to tach');
    await rm(join(root, '.gitignore'));
    assert.deepEqual(await verdict(root, RULE), FAIL);
  });
});

t('B2: a tach.domain.toml inside node_modules or __pycache__ is read by tach, so the adapter reads it too', async () => {
  for (const dir of ['node_modules', '__pycache__']) {
    await withFiles({ ...LEGACY, [`src/a/${dir}/tach.domain.toml`]: '[root]\nunchecked = true\n' }, async root => {
      assert.deepEqual(await verdict(root, RULE), ['refuse', 'tach-rule-inactive'], dir);
    });
  }
});

t('B3: a nested git repository has its own .gitignore that the outer git does not show: REFUSE unknown, in a repo or not', async () => {
  for (const outer of [true, false]) {
    await withFiles({ ...LEGACY, 'src/a/.gitignore': 'legacy/\n' }, async root => {
      if (outer) git(root, 'init', '-q');
      git(join(root, 'src/a'), 'init', '-q');
      assert.deepEqual(await verdict(root, RULE), UNKNOWN, `outer repo: ${outer}`);
      assert.deepEqual(await verdict(root, RULE, { allowIgnoredSources: true }).then(v => v[0]), 'pass');
    });
  }
  await withFiles({ ...LEGACY, 'src/a/.gitignore': 'legacy/\n' }, async root => {
    git(root, 'init', '-q');
    assert.deepEqual(await verdict(root, RULE), SOURCES, 'the same .gitignore without a nested repo is listed');
  });
});

t('B4: a .gitignore ABOVE the repository root hides files from tach and not from git: REFUSE; without it, FAIL', () => withFiles(
  Object.fromEntries(Object.entries({ ...LEGACY, '.gitignore-placeholder': '' }).map(([f, x]) => [`proj/${f}`, x])), async root => {
    git(join(root, 'proj'), 'init', '-q');
    await write(root, '.gitignore', 'legacy/\n');
    assert.deepEqual(await verdict(root, RULE, { cwd: 'proj' }), ['refuse', 'tach-ignored-sources-unknown']);
    await rm(join(root, '.gitignore'));
    assert.deepEqual(await verdict(root, RULE, { cwd: 'proj' }), ['fail', 'UndeclaredDependency@proj/src/a/legacy/impl.py']);
  }));

t('B5: git that cannot open a repository (dubious ownership) is not "no repository": REFUSE unknown; allowIgnoredSources accepts', () => withFiles(LEGACY, async root => {
  git(root, 'init', '-q');
  await write(root, '.git/info/exclude', 'legacy/\n');
  const before = process.env.GIT_TEST_ASSUME_DIFFERENT_OWNER;
  process.env.GIT_TEST_ASSUME_DIFFERENT_OWNER = '1';
  try {
    assert.deepEqual(await verdict(root, RULE), UNKNOWN);
    assert.deepEqual(await verdict(root, RULE, { allowIgnoredSources: true }).then(v => v[0]), 'pass');
  } finally {
    if (before === undefined) delete process.env.GIT_TEST_ASSUME_DIFFERENT_OWNER; else process.env.GIT_TEST_ASSUME_DIFFERENT_OWNER = before;
  }
  assert.deepEqual(await verdict(root, RULE), SOURCES, 'with normal git the same .git/info/exclude is listed');
}));

const FORBIDDEN = {
  'src/a/__init__.py': 'from b import thing\n', 'src/b/__init__.py': 'thing = 1\n',
  'tach.toml': 'source_roots = ["src"]\n[[modules]]\npath = "a"\ndepends_on = []\ncannot_depend_on = ["b"]\n[[modules]]\npath = "b"\ndepends_on = []\n',
};
const LAYERED = {
  'src/a/__init__.py': 'from b import thing\n', 'src/b/__init__.py': 'thing = 1\n',
  'tach.toml': 'source_roots = ["src"]\nlayers = ["high", "low"]\n[[modules]]\npath = "a"\nlayer = "low"\ndepends_on = []\n[[modules]]\npath = "b"\nlayer = "high"\ndepends_on = []\n',
};

// tach reports ONE kind per import (layer, then forbidden, then deprecated/undeclared). The shared adapter contract says a
// Gate ignores evidence of kinds it did not select, and telling "also undeclared" apart needs tach's own depends_on
// matching, so this is documented, not refused. The tests pin it so it cannot change by accident.
t('I1 (documented): an import tach labels forbidden or layer is not reported as undeclared, so undeclared alone PASSES it; select the higher kind too', async () => {
  await withFiles(FORBIDDEN, async root => {
    assert.deepEqual(await verdict(root, 'undeclared-dependency'), ['pass']);
    assert.deepEqual(await verdict(root, 'forbidden-dependency'), ['fail', 'ForbiddenDependency@src/a/__init__.py']);
    assert.deepEqual(await verdict(root, ['undeclared-dependency', 'forbidden-dependency']), ['fail', 'ForbiddenDependency@src/a/__init__.py']);
  });
  await withFiles(LAYERED, async root => {
    assert.deepEqual(await verdict(root, 'undeclared-dependency'), ['pass']);
    assert.deepEqual(await verdict(root, 'layer-violation'), ['fail', 'LayerViolation@src/a/__init__.py']);
  });
});

import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { cp, mkdir, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { defineGate, runGate } from 'redproof';
import { tach, type TachRuleKind } from '../src/index.ts';
import { nativeTest, tachBinary, withFiles } from './support/workspace.ts';

// Round 2 of the adversarial review: ways tach reads less than the Gate thinks. Real tach and real git, through runGate, one rule alone.
// Each case is REFUSE (or the right verdict) with the cause, and the same project without the cause gives the real FAIL.
const t = nativeTest(test);

async function verdict(root: string, kind: TachRuleKind, extra: object = {}): Promise<readonly string[]> {
  const adapter = tach({ rules: { only: kind }, command: tachBinary, ...extra } as never);
  const result = await runGate(defineGate({ id: `hidden-${kind}`, adapter: adapter as never }), root);
  if (result.verdict === 'fail') return ['fail', ...result.breaches.map(b => `${b.code}@${b.location?.file}`)];
  return result.verdict === 'refuse' ? ['refuse', result.why.code] : [result.verdict];
}
const write = async (root: string, file: string, text: string): Promise<void> => {
  await mkdir(dirname(join(root, file)), { recursive: true });
  await writeFile(join(root, file), text);
};
const git = (cwd: string, ...args: string[]): void => { execFileSync('git', ['-c', 'commit.gpgsign=false', '-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd, stdio: 'ignore' }); };

/** a (declares nothing) imports b: a real violation. b imports c, so the project still has an import to inspect when a is hidden. */
const TOML = 'source_roots = ["src"]\n[[modules]]\npath = "a"\ndepends_on = []\n[[modules]]\npath = "b"\ndepends_on = ["c"]\n[[modules]]\npath = "c"\ndepends_on = []\n';
const BASE = {
  'src/a/__init__.py': 'from b import thing\n',
  'src/b/__init__.py': 'from c import y\nthing = 1\n',
  'src/c/__init__.py': 'y = 1\n',
  'tach.toml': TOML,
};
const RULE = 'undeclared-dependency';
const FAIL = ['fail', 'UndeclaredDependency@src/a/__init__.py'];
const SOURCES = ['refuse', 'tach-ignored-sources'];
const INACTIVE = ['refuse', 'tach-rule-inactive'];

t('B1: a file git TRACKS but .gitignore now matches is still skipped by tach: REFUSE; un-ignored, the Gate FAILs', () => withFiles(BASE, async root => {
  git(root, 'init', '-q');
  git(root, 'add', '-A');
  git(root, 'commit', '-qm', 'i');
  await write(root, '.gitignore', 'src/a/\n');
  assert.deepEqual(await verdict(root, RULE), SOURCES);
  await rm(join(root, '.gitignore'));
  assert.deepEqual(await verdict(root, RULE), FAIL);
}));

t('B2: a .ignore file hides sources from tach and git does not read it: REFUSE at the root, in src/, above the project, in a git repo; removed, FAIL', async () => {
  const placements: readonly (readonly [string, string, string | undefined])[] = [
    ['root', '.ignore', undefined], ['in src', 'src/.ignore', undefined], ['file pattern', '.ignore', 'file'], ['in a git repo', '.ignore', 'repo'],
  ];
  for (const [name, file, mode] of placements) {
    await withFiles(BASE, async root => {
      if (mode === 'repo') git(root, 'init', '-q');
      await write(root, file, mode === 'file' ? '__init__.py\n' : file === 'src/.ignore' ? 'a/\n' : 'src/a/\n');
      assert.deepEqual(await verdict(root, RULE), SOURCES, name);
      await rm(join(root, file));
      assert.deepEqual(await verdict(root, RULE), FAIL, name);
    });
  }
});

t('B2: a .ignore file in the PARENT of the working directory hides it too: REFUSE', () => withFiles(Object.fromEntries(Object.entries(BASE).map(([f, x]) => [`proj/${f}`, x])), async root => {
  await write(root, '.ignore', 'proj/src/a/\n');
  assert.deepEqual(await verdict(root, RULE, { cwd: 'proj' }), SOURCES);
  await rm(join(root, '.ignore'));
  assert.deepEqual(await verdict(root, RULE, { cwd: 'proj' }), ['fail', 'UndeclaredDependency@proj/src/a/__init__.py']);
}));

t('B2: respect_gitignore = false switches .ignore off in tach, so the Gate FAILs on the real violation', () => withFiles({ ...BASE, 'tach.toml': `respect_gitignore = false\n${TOML}`, '.ignore': 'src/a/\n' }, async root => {
  assert.deepEqual(await verdict(root, RULE), FAIL);
}));

t('B3: a source root spelled src/. , ./src// or ././src names the same directory, so the hidden-source check still applies', async () => {
  for (const spelling of ['src/.', './src//', '././src', 'src/../src']) {
    await withFiles({ ...BASE, 'tach.toml': TOML.replace('"src"', JSON.stringify(spelling)), '.gitignore': 'src/a/\n' }, async root => {
      assert.deepEqual(await verdict(root, RULE), SOURCES, spelling);
      await rm(join(root, '.gitignore'));
      // tach itself cannot resolve a `..` inside a root, so only the other spellings have a real FAIL to compare with.
      if (!spelling.includes('..')) assert.deepEqual(await verdict(root, RULE), FAIL, spelling);
    });
  }
});

t('B4: tach 0.35 has no default exclude: an ignored file under tests/, docs/ or venv/ hides code and REFUSES', async () => {
  for (const dir of ['tests', 'docs', 'venv']) {
    await withFiles({ ...BASE, 'src/a/__init__.py': 'y = 1\n', [`src/a/${dir}/t.py`]: 'from b import thing\n', '.gitignore': `${dir}/\n` }, async root => {
      git(root, 'init', '-q');
      assert.deepEqual(await verdict(root, RULE), SOURCES, dir);
      await rm(join(root, '.gitignore'));
      assert.deepEqual(await verdict(root, RULE), ['fail', `UndeclaredDependency@src/a/${dir}/t.py`], dir);
    });
  }
});

t('B4: a module that happens to be called docs, tests or venv is read by tach and is not refused for it', async () => {
  for (const name of ['docs', 'tests', 'venv']) {
    await withFiles({
      [`src/${name}/__init__.py`]: 'from b import thing\n', 'src/b/__init__.py': 'from c import y\nthing = 1\n', 'src/c/__init__.py': 'y = 1\n',
      'tach.toml': TOML.replace('path = "a"', `path = "${name}"`),
    }, async root => {
      assert.deepEqual(await verdict(root, RULE), ['fail', `UndeclaredDependency@src/${name}/__init__.py`], name);
    });
  }
});

t('B5: tach.toml is read as TOML, whatever its spelling: inline tables, quoted headers and quoted keys are seen', async () => {
  const inline = 'source_roots=["src"]\nmodules = [{path="a",depends_on=[],unchecked=true},{path="b",depends_on=["c"]},{path="c",depends_on=[]}]\n';
  const quotedHeader = 'source_roots=["src"]\n[["modules"]]\npath="a"\ndepends_on=[]\nunchecked=true\n[[modules]]\npath="b"\ndepends_on=["c"]\n[[modules]]\npath="c"\ndepends_on=[]\n';
  const quotedRules = `${TOML}["rules"]\nlocal_imports="off"\n`;
  const localImport = { 'src/a/__init__.py': 'def f():\n    from b import thing\n', 'src/b/__init__.py': 'from c import y\nthing = 1\n', 'src/c/__init__.py': 'y = 1\n' };
  await withFiles({ ...BASE, 'tach.toml': inline }, async root => assert.deepEqual(await verdict(root, RULE), INACTIVE, 'inline unchecked'));
  await withFiles({ ...BASE, 'tach.toml': quotedHeader }, async root => assert.deepEqual(await verdict(root, RULE), INACTIVE, 'quoted header unchecked'));
  await withFiles({ ...localImport, 'tach.toml': quotedRules }, async root => assert.deepEqual(await verdict(root, RULE), INACTIVE, 'quoted rules header'));
  await withFiles({ ...localImport, 'tach.toml': `rules = { "local_imports" = "off" }\n${TOML}` }, async root => assert.deepEqual(await verdict(root, RULE), INACTIVE, 'inline rules'));
  // The same spellings without the cause: the real violation, so nothing here is a blanket refusal.
  const inlineClean = 'source_roots=["src"]\nmodules = [{path="a",depends_on=[]},{path="b",depends_on=["c"]},{path="c",depends_on=[]}]\n';
  await withFiles({ ...BASE, 'tach.toml': inlineClean }, async root => assert.deepEqual(await verdict(root, RULE), FAIL, 'inline clean'));
});

t('B5: inline spellings of the other settings are seen too: forbidden-dependency and interface-violation are not falsely refused', async () => {
  const files = { 'src/a/__init__.py': 'from b import thing\n', 'src/b/__init__.py': 'def public_fn(): ...\nthing = 1\n' };
  await withFiles({ ...files, 'tach.toml': 'source_roots=["src"]\nmodules = [{path="a",depends_on=["b"],cannot_depend_on=["b"]},{path="b",depends_on=[]}]\n' },
    async root => assert.deepEqual(await verdict(root, 'forbidden-dependency'), ['fail', 'ForbiddenDependency@src/a/__init__.py']));
  await withFiles({ ...files, 'tach.toml': 'source_roots=["src"]\nmodules = [{path="a",depends_on=["b"]},{path="b",depends_on=[]}]\ninterfaces = [{expose=["public_fn"],from=["b"]}]\n' },
    async root => assert.deepEqual(await verdict(root, 'interface-violation'), ['fail', 'PrivateDependency@src/a/__init__.py']));
});

t('B5: a tach.toml that is not TOML is refused before tach runs, not guessed at', () => withFiles({ ...BASE, 'tach.toml': `${TOML}[[modules\n` }, async root => {
  assert.deepEqual(await verdict(root, RULE), ['refuse', 'tach-config-unreadable']);
}));

t('B6: a symlinked module directory is skipped by tach without a word: REFUSE; a real directory FAILs', () => withFiles({ ...BASE, 'real/a/__init__.py': 'from b import thing\n' }, async root => {
  await rm(join(root, 'src/a'), { recursive: true });
  await symlink(join(root, 'real/a'), join(root, 'src/a'));
  assert.deepEqual(await verdict(root, RULE), ['refuse', 'tach-symlinked-sources']);
  await rm(join(root, 'src/a'));
  await cp(join(root, 'real/a'), join(root, 'src/a'), { recursive: true });
  assert.deepEqual(await verdict(root, RULE), FAIL);
}));

t('B6: a symlinked .py file under a source root is skipped by tach too: REFUSE; a real file FAILs', () => withFiles({ ...BASE, 'src/a/__init__.py': 'y = 1\n', 'real/x.py': 'from b import thing\n' }, async root => {
  await symlink(join(root, 'real/x.py'), join(root, 'src/a/x.py'));
  assert.deepEqual(await verdict(root, RULE), ['refuse', 'tach-symlinked-sources']);
  await rm(join(root, 'src/a/x.py'));
  await rename(join(root, 'real/x.py'), join(root, 'src/a/x.py'));
  assert.deepEqual(await verdict(root, RULE), ['fail', 'UndeclaredDependency@src/a/x.py']);
}));

t('B6: a symlink outside the source roots, or a dot-directory, is not tach input and does not refuse', () => withFiles({ ...BASE, 'real/x.py': 'x = 1\n', 'tools/note.txt': 'x\n' }, async root => {
  await symlink(join(root, 'real/x.py'), join(root, 'tools/x.py'));
  assert.deepEqual(await verdict(root, RULE), FAIL);
}));

t('a directory holding pyvenv.cfg is not special to tach: ignored .py files and symlinks inside it refuse like any others', () => withFiles({
  ...BASE, 'src/legacy/pyvenv.cfg': 'home = /x\n', 'src/legacy/bin/activate_this.py': 'x = 1\n', '.gitignore': 'legacy/\n', 'real/z.py': 'z = 1\n',
}, async root => {
  git(root, 'init', '-q');
  assert.deepEqual(await verdict(root, RULE), SOURCES);
  assert.deepEqual(await verdict(root, RULE, { allowIgnoredSources: true }), FAIL);
}));

t('I1: depends_on = ["**"] lets a module import anything, like a module with no depends_on: REFUSE', async () => {
  for (const open of ['**', '*', '**/*']) {
    await withFiles({ ...BASE, 'tach.toml': TOML.replace('path = "a"\ndepends_on = []', `path = "a"\ndepends_on = [${JSON.stringify(open)}]`) },
      async root => assert.deepEqual(await verdict(root, RULE), INACTIVE, open));
  }
});

t('I2 (superseded by round 3): any exclude refuses, because the adapter does not interpret tach\'s globs; allowExcludedSources accepts it', async () => {
  const files = { ...BASE, 'src/a/__init__.py': 'x = 1\n', 'src/a/impl.py': 'from b import thing\n' };
  for (const pattern of ['src/a/legacy', '**/impl.py', 'tests']) {
    await withFiles({ ...files, 'tach.toml': `exclude = [${JSON.stringify(pattern)}]\n${TOML}` }, async root => {
      assert.deepEqual(await verdict(root, RULE), SOURCES, pattern);
      assert.deepEqual(await verdict(root, RULE, { allowExcludedSources: true }), pattern === '**/impl.py' ? ['pass'] : ['fail', 'UndeclaredDependency@src/a/impl.py'], `${pattern}: accepted knowingly`);
    });
  }
});

t('I3: layers that no module uses enforce nothing: REFUSE; interfaces whose `from` matches no module enforce nothing: REFUSE', async () => {
  const files = { 'src/a/__init__.py': 'from b import thing\n', 'src/b/__init__.py': 'def public_fn(): ...\nthing = 1\n' };
  const mods = (a: string, b: string): string => `source_roots = ["src"]\n[[modules]]\npath = "a"\n${a}\n[[modules]]\npath = "b"\n${b}\n`;
  await withFiles({ ...files, 'tach.toml': `layers = ["high", "low"]\n${mods('depends_on = []', 'depends_on = []')}` },
    async root => assert.deepEqual(await verdict(root, 'layer-violation'), INACTIVE, 'layers, none assigned'));
  await withFiles({ ...files, 'tach.toml': `layers = ["high", "low"]\n${mods('layer = "low"', 'layer = "high"')}` },
    async root => assert.deepEqual(await verdict(root, 'layer-violation'), ['fail', 'LayerViolation@src/a/__init__.py'], 'layers, assigned'));
  await withFiles({ ...files, 'tach.toml': `${mods('depends_on = ["b"]', 'depends_on = []')}[[interfaces]]\nexpose = ["public_fn"]\nfrom = ["zzz"]\n` },
    async root => assert.deepEqual(await verdict(root, 'interface-violation'), INACTIVE, 'interface from nothing'));
  await withFiles({ ...files, 'tach.toml': `${mods('depends_on = ["b"]', 'depends_on = []')}[[interfaces]]\nexpose = ["public_fn"]\nfrom = ["b"]\n` },
    async root => assert.deepEqual(await verdict(root, 'interface-violation'), ['fail', 'PrivateDependency@src/a/__init__.py'], 'interface from b'));
});

t('B7 (found while fixing B1-B6): respect_gitignore = false does not switch off .git/info/exclude in tach: REFUSE; no such file, or no repo, FAIL', async () => {
  const off = { ...BASE, 'tach.toml': `respect_gitignore = false\n${TOML}` };
  await withFiles(off, async root => {
    git(root, 'init', '-q');
    await write(root, '.git/info/exclude', 'src/a/\n');
    assert.deepEqual(await verdict(root, RULE), SOURCES);
    assert.deepEqual(await verdict(root, RULE, { allowIgnoredSources: true }), ['pass'], 'accepted knowingly');
    await write(root, '.git/info/exclude', '# nothing\n');
    assert.deepEqual(await verdict(root, RULE), FAIL);
  });
  await withFiles({ ...off, '.gitignore': 'src/a/\n' }, async root => {
    git(root, 'init', '-q');
    assert.deepEqual(await verdict(root, RULE), FAIL, '.gitignore is off, as tach says');
  });
  await withFiles(off, async root => assert.deepEqual(await verdict(root, RULE), FAIL, 'no repository at all'));
});

import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { defineGate, runGate } from 'redproof';
import { tach, type TachRuleKind } from '../src/index.ts';
import { nativeTest, tachBinary, withFiles } from './support/workspace.ts';

// Round 4: source roots are globs and may overlap; domain files count only where tach reads them; git must see what tach
// sees; and the escape hatches are narrower. Real tach and real git, through runGate, rules selected alone.
const t = nativeTest(test);

async function verdict(root: string, kind: TachRuleKind, extra: object = {}): Promise<readonly string[]> {
  const adapter = tach({ rules: { only: kind }, command: tachBinary, ...extra } as never);
  const result = await runGate(defineGate({ id: `roots-${kind}`, adapter: adapter as never }), root);
  if (result.verdict === 'fail') return ['fail', ...result.breaches.map(b => `${b.code}@${b.location?.file}`)];
  return result.verdict === 'refuse' ? ['refuse', result.why.code] : [result.verdict];
}
const write = async (root: string, file: string, text: string): Promise<void> => {
  await mkdir(dirname(join(root, file)), { recursive: true });
  await writeFile(join(root, file), text);
};
const git = (cwd: string, ...args: string[]): void => { execFileSync('git', ['-c', 'commit.gpgsign=false', '-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd, stdio: 'ignore' }); };
const withEnv = async (env: Record<string, string>, action: () => Promise<void>): Promise<void> => {
  const before = Object.fromEntries(Object.keys(env).map(key => [key, process.env[key]]));
  Object.assign(process.env, env);
  try { await action(); } finally {
    for (const [key, value] of Object.entries(before)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  }
};

const toml = (roots: string, extra = ''): string =>
  `source_roots = ${roots}\n${extra}[[modules]]\npath = "a"\ndepends_on = []\n[[modules]]\npath = "b"\ndepends_on = ["c"]\n[[modules]]\npath = "c"\ndepends_on = []\n`;
const LEGACY = {
  'src/a/__init__.py': 'x = 1\n', 'src/a/legacy/__init__.py': '', 'src/a/legacy/impl.py': 'from b import thing\n',
  'src/b/__init__.py': 'from c import y\nthing = 1\n', 'src/c/__init__.py': 'y = 1\n', 'tach.toml': toml('["src"]'),
};
const RULE = 'undeclared-dependency';
const FAIL = ['fail', 'UndeclaredDependency@src/a/legacy/impl.py'];
const SOURCES = ['refuse', 'tach-ignored-sources'];
const UNKNOWN = ['refuse', 'tach-ignored-sources-unknown'];
const SYMLINKS = ['refuse', 'tach-symlinked-sources'];
const OVERLAP = ['refuse', 'tach-overlapping-source-roots'];

t('B1: source_roots entries are globs in tach; a glob root covers the tree, so ignored, symlinked and nested-repo files under it refuse', async () => {
  for (const roots of ['["s*"]', '["sr?"]', '["s[r]c"]']) {
    await withFiles({ ...LEGACY, 'tach.toml': toml(roots), '.gitignore': 'legacy/\n' }, async root => {
      git(root, 'init', '-q');
      assert.deepEqual(await verdict(root, RULE), SOURCES, `${roots} ignored`);
      await rm(join(root, '.gitignore'));
      assert.deepEqual(await verdict(root, RULE), FAIL, `${roots} control`);
    });
  }
  await withFiles({ ...LEGACY, 'tach.toml': toml('["s*"]'), 'real/legacy/__init__.py': '', 'real/legacy/impl.py': 'from b import thing\n' }, async root => {
    await rm(join(root, 'src/a/legacy'), { recursive: true });
    await symlink(join(root, 'real/legacy'), join(root, 'src/a/legacy'));
    assert.deepEqual(await verdict(root, RULE), SYMLINKS, 'symlink under a glob root');
  });
  await withFiles({ ...LEGACY, 'tach.toml': toml('["s*"]'), 'src/a/.gitignore': 'legacy/\n' }, async root => {
    git(join(root, 'src/a'), 'init', '-q');
    assert.deepEqual(await verdict(root, RULE), UNKNOWN, 'nested repository under a glob root');
  });
});

t('B1: a brace glob can name nested directories, which the adapter cannot tell apart: it REFUSES as overlapping, ignored files or not', () => withFiles({ ...LEGACY, 'tach.toml': toml('["{src,lib}"]'), '.gitignore': 'legacy/\n' }, async root => {
  git(root, 'init', '-q');
  assert.deepEqual(await verdict(root, RULE), OVERLAP);
}));

t('B2: overlapping source roots make tach itself nondeterministic, so they REFUSE with no opt-out', async () => {
  for (const roots of ['[".", "src"]', '["src", "src/a"]', '["src", "src"]', '["src", "./src/"]', '["s*", "src"]', '["src/**"]', '["{src,src/a}"]']) {
    await withFiles({ ...LEGACY, 'tach.toml': toml(roots) }, async root => {
      assert.deepEqual(await verdict(root, RULE), OVERLAP, roots);
      assert.deepEqual(await verdict(root, RULE, { allowIgnoredSources: true, allowInactiveRules: true }), OVERLAP, `${roots}: no opt-out`);
    });
  }
});

const DOMAIN = '[[modules]]\npath = "x"\ndepends_on = []\ncannot_depend_on = ["y"]\n';
t('I1: a tach.domain.toml tach does not read does not count toward "configured": outside the source roots it is ignored, in an ignored directory it refuses', async () => {
  const forbidden = { ...LEGACY, 'src/a/legacy/impl.py': 'from b import thing\n' };
  await withFiles({ ...forbidden, 'docs/tach.domain.toml': DOMAIN }, async root => {
    assert.deepEqual(await verdict(root, 'forbidden-dependency'), ['refuse', 'tach-rule-inactive'], 'outside the source roots');
  });
  await withFiles({ ...forbidden, 'tach.domain.toml': DOMAIN }, async root => {
    assert.deepEqual(await verdict(root, 'forbidden-dependency'), ['refuse', 'tach-rule-inactive'], 'at the project root, roots are ["src"]');
  });
  await withFiles({ ...forbidden, 'src/a/build/tach.domain.toml': DOMAIN, '.gitignore': 'build/\n' }, async root => {
    git(root, 'init', '-q');
    assert.deepEqual(await verdict(root, 'forbidden-dependency'), SOURCES, 'a domain file in an ignored directory');
  });
});

t('I2: ambient GIT_DIR and GIT_CONFIG_GLOBAL do not steer the adapter\'s git away from what tach reads', async () => {
  await withFiles(LEGACY, async root => {
    git(root, 'init', '-q');
    await write(root, '.git/info/exclude', 'legacy/\n');
    const other = await mkdtemp(join(tmpdir(), 'redproof-tach-other-'));
    try {
      git(other, 'init', '-q');
      await withEnv({ GIT_DIR: join(other, '.git') }, async () => assert.deepEqual(await verdict(root, RULE), SOURCES, 'GIT_DIR'));
      await withEnv({ GIT_DIR: join(other, '.git'), GIT_WORK_TREE: other }, async () => assert.deepEqual(await verdict(root, RULE), SOURCES, 'GIT_DIR + GIT_WORK_TREE'));
    } finally { await rm(other, { recursive: true, force: true }); }
  });
  await withFiles({ ...LEGACY, 'home/.gitconfig': '[core]\n\texcludesFile = EXCLUDES\n', 'home/excludes': 'legacy/\n' }, async root => {
    await write(root, 'home/.gitconfig', `[core]\n\texcludesFile = ${join(root, 'home/excludes')}\n`);
    git(root, 'init', '-q');
    await withEnv({ HOME: join(root, 'home'), XDG_CONFIG_HOME: join(root, 'home/xdg') }, async () => {
      assert.deepEqual(await verdict(root, RULE), SOURCES, 'a global excludesFile, normal environment');
      await withEnv({ GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' }, async () => assert.deepEqual(await verdict(root, RULE), SOURCES, 'GIT_CONFIG_GLOBAL=/dev/null'));
    });
  });
});

const SAFE = '["**/venv", "**/*__pycache__", "**/*egg-info", ".venv", "node_modules/", "/build", "dist", "**/.tox"]';
t('hatches: the entries tach init writes for environments and caches do not refuse; tests/docs do, and have their own narrow hatch', async () => {
  await withFiles({ ...LEGACY, 'tach.toml': toml('["src"]', `exclude = ${SAFE}\n`) }, async root => {
    assert.deepEqual(await verdict(root, RULE), FAIL, 'environment and cache excludes only');
  });
  for (const pattern of ['**/tests', '**/docs', 'src/a/legacy']) {
    await withFiles({ ...LEGACY, 'tach.toml': toml('["src"]', `exclude = ["**/venv", ${JSON.stringify(pattern)}]\n`) }, async root => {
      assert.deepEqual(await verdict(root, RULE), SOURCES, pattern);
      assert.deepEqual(await verdict(root, RULE, { allowIgnoredSources: true }), SOURCES, `${pattern}: the ignore hatch does not cover exclude`);
      assert.notEqual((await verdict(root, RULE, { allowExcludedSources: true }))[0], 'refuse', `${pattern}: the exclude hatch does`);
    });
  }
});

t('hatches: a gitignored virtual environment named venv (pyvenv.cfg inside) is not first-party code; a directory of another name still refuses', async () => {
  const env = { 'src/venv/pyvenv.cfg': 'home = /x\n', 'src/venv/bin/activate_this.py': 'x = 1\n', '.gitignore': 'venv/\n' };
  await withFiles({ ...LEGACY, ...env }, async root => {
    git(root, 'init', '-q');
    await symlink('bin', join(root, 'src/venv/lib64'));
    assert.deepEqual(await verdict(root, RULE), FAIL);
  });
  await withFiles({ ...LEGACY, 'src/venv/pyvenv.cfg': 'home = /x\n', 'src/venv/__init__.py': 'from b import thing\n', 'tach.toml': toml('["src"]'), '.gitignore': 'legacy/\n' }, async root => {
    git(root, 'init', '-q');
    assert.deepEqual(await verdict(root, RULE), SOURCES, 'another directory is still hidden code');
  });
});

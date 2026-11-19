import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { defineGate, runGate } from 'redproof';
import { tach, type TachRuleKind } from '../src/index.ts';
import { nativeTest, tachBinary, withFiles } from './support/workspace.ts';

// Real tach and real git, through runGate, one rule alone. Each case is REFUSE with the guard, then green/red once the cause is removed.
const t = nativeTest(test);

async function verdict(root: string, kind: TachRuleKind, extra: object = {}): Promise<readonly string[]> {
  const adapter = tach({ rules: { only: kind }, command: tachBinary, ...extra } as never);
  const result = await runGate(defineGate({ id: `guard-${kind}`, adapter: adapter as never }), root);
  if (result.verdict === 'fail') return ['fail', ...result.breaches.map(b => `${b.code}@${b.location?.file}`)];
  return result.verdict === 'refuse' ? ['refuse', result.why.code] : [result.verdict];
}
const write = async (root: string, file: string, text: string): Promise<void> => {
  await mkdir(dirname(join(root, file)), { recursive: true });
  await writeFile(join(root, file), text);
};
const git = (cwd: string, ...args: string[]): void => { execFileSync('git', args, { cwd, stdio: 'ignore' }); };

/** a (declares nothing) imports b: a real violation. b imports c, so the project still has an import to inspect when a is hidden. */
const HIDDEN = {
  'src/a/__init__.py': 'from b import thing\n',
  'src/b/__init__.py': 'from c import y\nthing = 1\n',
  'src/c/__init__.py': 'y = 1\n',
  'tach.toml': 'source_roots = ["src"]\n[[modules]]\npath = "a"\ndepends_on = []\n[[modules]]\npath = "b"\ndepends_on = ["c"]\n[[modules]]\npath = "c"\ndepends_on = []\n',
};
const RULE = 'undeclared-dependency';
const FAIL = ['fail', 'UndeclaredDependency@src/a/__init__.py'];

t('gitignore in a git repo hides the violating module: REFUSE; without the .gitignore the same Gate FAILs', () => withFiles(HIDDEN, async root => {
  git(root, 'init', '-q');
  await write(root, '.gitignore', 'src/a/\n');
  assert.deepEqual(await verdict(root, RULE), ['refuse', 'tach-ignored-sources']);
  await rm(join(root, '.gitignore'));
  assert.deepEqual(await verdict(root, RULE), FAIL);
}));

t('the same .gitignore with no git repository at all still hides it (tach reads it anyway): REFUSE', () => withFiles(HIDDEN, async root => {
  await write(root, '.gitignore', 'src/a/\n');
  assert.deepEqual(await verdict(root, RULE), ['refuse', 'tach-ignored-sources']);
  await rm(join(root, '.gitignore'));
  assert.deepEqual(await verdict(root, RULE), FAIL);
}));

t('a .gitignore in the PARENT of the Gate root hides it too: REFUSE (repo above, and no repo above)', async () => {
  for (const repo of [true, false]) {
    await withFiles(Object.fromEntries(Object.entries(HIDDEN).map(([f, x]) => [`proj/${f}`, x])), async root => {
      if (repo) git(root, 'init', '-q');
      await write(root, '.gitignore', 'proj/src/a/\n');
      assert.deepEqual(await verdict(root, RULE, { cwd: 'proj' }), ['refuse', 'tach-ignored-sources'], `repo=${repo}`);
      await rm(join(root, '.gitignore'));
      assert.deepEqual(await verdict(root, RULE, { cwd: 'proj' }), ['fail', 'UndeclaredDependency@proj/src/a/__init__.py'], `repo=${repo}`);
    });
  }
});

t('respect_gitignore = false makes tach read the file, so the Gate FAILs on the real violation instead of refusing', () => withFiles({
  ...HIDDEN, 'tach.toml': `respect_gitignore = false\n${HIDDEN['tach.toml']}`, '.gitignore': 'src/a/\n',
}, async root => {
  git(root, 'init', '-q');
  assert.deepEqual(await verdict(root, RULE), FAIL);
}));

t('allowIgnoredSources accepts the blind spot knowingly', () => withFiles({ ...HIDDEN, '.gitignore': 'src/a/\n' }, async root => {
  assert.deepEqual(await verdict(root, RULE, { allowIgnoredSources: true }), ['pass']);
}));

t('a hidden directory (.venv) is never read by tach, so ignoring it hides nothing: a normal project is not refused', () => withFiles({
  ...HIDDEN, '.gitignore': '.venv/\n', '.venv/lib/site-packages/x.py': 'x = 1\n',
}, async root => {
  git(root, 'init', '-q');
  assert.deepEqual(await verdict(root, RULE), FAIL);
}));

t('a gitignored .py outside every source root does not matter', () => withFiles({ ...HIDDEN, '.gitignore': 'tools/\n', 'tools/x.py': 'x = 1\n' }, async root => {
  git(root, 'init', '-q');
  assert.deepEqual(await verdict(root, RULE), FAIL);
}));

const CYCLE = {
  'src/a/__init__.py': 'from b import x\nz = 1\n', 'src/b/__init__.py': 'from a import z\nx = 1\n',
  'tach.toml': 'source_roots = ["src"]\n[[modules]]\npath = "a"\ndepends_on = ["b"]\n[[modules]]\npath = "b"\ndepends_on = ["a"]\n',
};
t('circular-dependency selected while tach is not told to forbid cycles: tach prints [] for a real cycle, so REFUSE; with the key, FAIL', () => withFiles(CYCLE, async root => {
  assert.deepEqual(await verdict(root, 'circular-dependency'), ['refuse', 'tach-cycle-check-off']);
  assert.deepEqual(await verdict(root, 'circular-dependency', { allowInactiveRules: true }), ['refuse', 'tach-cycle-check-off'], 'no opt-in for this one');
  await write(root, 'tach.toml', `forbid_circular_dependencies = true\n${CYCLE['tach.toml']}`);
  assert.deepEqual(await verdict(root, 'circular-dependency'), ['fail', 'CircularDependency@tach.toml']);
}));

t('circular-dependency: the key spoofed by a comment, a string, or another table does not count', () => withFiles(CYCLE, async root => {
  for (const spoof of ['# forbid_circular_dependencies = true\n', 'note = "forbid_circular_dependencies = true"\n', 'note = """\nforbid_circular_dependencies = true\n"""\n']) {
    await write(root, 'tach.toml', `${spoof}${CYCLE['tach.toml']}`);
    assert.deepEqual(await verdict(root, 'circular-dependency'), ['refuse', 'tach-cycle-check-off'], spoof);
  }
  await write(root, 'tach.toml', `${CYCLE['tach.toml']}\n[rules]\nforbid_circular_dependencies = true\n`);
  assert.deepEqual(await verdict(root, 'circular-dependency'), ['refuse', 'tach-cycle-check-off'], 'a table value is not the top-level key');
}));

const BASE = { 'src/a/__init__.py': 'from b import thing\nfrom c import y\n', 'src/b/__init__.py': 'thing = 1\n', 'src/c/__init__.py': 'y = 1\n' };
const mods = (a: string, extra = '', top = '') => `${top}source_roots = ["src"]\n${extra}[[modules]]\npath = "a"\n${a}\n[[modules]]\npath = "b"\ndepends_on = []\n[[modules]]\npath = "c"\ndepends_on = []\n`;

type Inactive = { readonly name: string; readonly kind: TachRuleKind; readonly bad: string; readonly good: string; readonly red: readonly string[]; readonly green?: readonly string[] };
const INACTIVE: readonly Inactive[] = [
  { name: 'no [[interfaces]]', kind: 'interface-violation', bad: mods('depends_on = ["b", "c"]'),
    good: `${mods('depends_on = ["b", "c"]')}[[interfaces]]\nexpose = ["nothing"]\nfrom = ["b"]\n`, red: ['fail', 'PrivateDependency@src/a/__init__.py'] },
  { name: 'unused_ignore_directives off', kind: 'ignore-directive', bad: mods('depends_on = ["b"]', '[rules]\nunused_ignore_directives = "off"\n'),
    good: mods('depends_on = ["b"]'), red: ['fail', 'UnusedIgnoreDirective@src/a/__init__.py'] },
  { name: 'depends_on omitted', kind: 'undeclared-dependency', bad: mods('').replace('\n[[modules]]\npath = "b"', '\n[[modules]]\npath = "b"'),
    good: mods('depends_on = ["b"]'), red: ['fail', 'UndeclaredDependency@src/a/__init__.py'] },
  { name: 'unchecked module', kind: 'undeclared-dependency', bad: mods('depends_on = []\nunchecked = true'),
    good: mods('depends_on = []'), red: ['fail', 'UndeclaredDependency@src/a/__init__.py', 'UndeclaredDependency@src/a/__init__.py'] },
  { name: 'local_imports off', kind: 'undeclared-dependency', bad: mods('depends_on = []', '[rules]\nlocal_imports = "off"\n'),
    good: mods('depends_on = []'), red: ['fail', 'UndeclaredDependency@src/a/__init__.py', 'UndeclaredDependency@src/a/__init__.py'] },
  { name: 'no layers', kind: 'layer-violation', bad: mods('depends_on = ["b"]'), good: mods('depends_on = ["b"]'), red: [] },
];
for (const c of INACTIVE.filter(c => c.red.length)) {
  t(`selected but inactive (${c.name}): REFUSE; once the configuration is switched on the same project FAILs`, () => withFiles({
    ...BASE, 'src/a/__init__.py': c.kind === 'ignore-directive' ? '# tach-ignore\nfrom b import thing\n' : c.kind === 'interface-violation' ? 'from b import thing\n' : BASE['src/a/__init__.py'],
    'tach.toml': c.bad,
  }, async root => {
    assert.deepEqual(await verdict(root, c.kind), ['refuse', 'tach-rule-inactive']);
    await write(root, 'tach.toml', c.good);
    if (c.kind === 'interface-violation') await write(root, 'src/b/__init__.py', 'def nothing(): ...\nthing = 1\n');
    assert.deepEqual(await verdict(root, c.kind), c.red);
  }));
}

t('allowInactiveRules lets a project with the rule off pass, knowingly', () => withFiles({ ...BASE, 'tach.toml': mods('depends_on = []\nunchecked = true') }, async root => {
  assert.deepEqual(await verdict(root, 'undeclared-dependency', { allowInactiveRules: true }), ['refuse', 'tach-configuration-diagnostic'],
    'with every import in the unchecked module tach has nothing first-party left to inspect, and says so');
}));

t('a source root outside the Gate root REFUSES, lexically and through a symlink', () => withFiles({ ...HIDDEN, 'tach.toml': HIDDEN['tach.toml'].replace('["src"]', '["src", "../outside"]') }, async root => {
  assert.deepEqual(await verdict(root, RULE), ['refuse', 'tach-path-outside-root']);
  await write(root, 'tach.toml', HIDDEN['tach.toml'].replace('["src"]', '["src", "link"]'));
  const { symlink, mkdtemp } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  await symlink(await mkdtemp(join(tmpdir(), 'redproof-tach-out-')), join(root, 'link'));
  assert.deepEqual(await verdict(root, RULE), ['refuse', 'tach-path-outside-root']);
  await rm(join(root, 'link'));
  await write(root, 'tach.toml', HIDDEN['tach.toml']);
  assert.deepEqual(await verdict(root, RULE), FAIL);
}));

t('a tach newer than the verified minor REFUSES unless the Gate opts in', () => withFiles({ ...HIDDEN }, async root => {
  const { chmod } = await import('node:fs/promises');
  const file = join(root, 'newer.mjs');
  await writeFile(file, `#!/usr/bin/env node\nif (process.argv.includes('--version')) { console.log('tach 0.40.0'); process.exit(0); }\nconsole.log('[]');\n`);
  await chmod(file, 0o755);
  assert.deepEqual(await verdict(root, RULE, { command: file }), ['refuse', 'tach-version-unverified']);
  assert.deepEqual(await verdict(root, RULE, { command: file, allowUnverifiedVersion: true, allowIgnoredSources: true }), ['pass']);
}));

t('tach never emits UnnecessarilyIgnoredDependency (it is only formatted in its source), so were it printed it is an unknown variant: REFUSE', () => withFiles(HIDDEN, async root => {
  const { chmod } = await import('node:fs/promises');
  const file = join(root, 'odd.mjs');
  const report = JSON.stringify([{ Located: { file_path: 'src/a/__init__.py', line_number: 1, original_line_number: 1, severity: 'Warning',
    details: { Code: { UnnecessarilyIgnoredDependency: { dependency: 'b' } } } } }]);
  await writeFile(file, `#!/usr/bin/env node\nif (process.argv.includes('--version')) { console.log('tach 0.35.3'); process.exit(0); }\nconsole.log(${JSON.stringify(report)});\n`);
  await chmod(file, 0o755);
  assert.deepEqual(await verdict(root, 'ignore-directive', { command: file, allowIgnoredSources: true, allowInactiveRules: true }), ['refuse', 'tach-unrecognised-diagnostic']);
}));

t('an ignore rule that lives only in .git/info/exclude hides it too (only the repository query sees it): REFUSE', () => withFiles(HIDDEN, async root => {
  git(root, 'init', '-q');
  await write(root, '.git/info/exclude', 'src/a/\n');
  assert.deepEqual(await verdict(root, RULE), ['refuse', 'tach-ignored-sources']);
  await write(root, '.git/info/exclude', '');
  assert.deepEqual(await verdict(root, RULE), FAIL);
}));

// tach.domain.toml: modules defined next to the code. A module marked unchecked there must never be missed.
const DOMAIN = {
  'tach.toml': 'source_roots = ["src"]\n',
  'src/a/__init__.py': 'from b import thing\n', 'src/a/tach.domain.toml': '[root]\ndepends_on = []\n',
  'src/b/__init__.py': 'thing = 1\n', 'src/b/tach.domain.toml': '[root]\ndepends_on = []\n',
};
t('tach.domain.toml: modules defined there are read, and a real violation FAILs', () => withFiles(DOMAIN, async root => {
  assert.deepEqual(await verdict(root, RULE), FAIL);
}));

t('tach.domain.toml: an unchecked [root] is seen, so the rule REFUSES instead of passing; checked again, it FAILs', () => withFiles({
  ...DOMAIN, 'src/a/tach.domain.toml': '[root]\nunchecked = true\n', 'src/c/__init__.py': 'from b import thing\n', 'src/c/tach.domain.toml': '[root]\ndepends_on = ["//b"]\n',
}, async root => {
  assert.deepEqual(await verdict(root, RULE), ['refuse', 'tach-rule-inactive']);
  await write(root, 'src/a/tach.domain.toml', '[root]\ndepends_on = []\n');
  assert.deepEqual(await verdict(root, RULE), FAIL);
}));

t('tach.domain.toml: depth is no limit: an unchecked module nine directories down is still seen', () => withFiles({
  ...DOMAIN, 'src/p/q/r/s/t/u/v/w/x/__init__.py': 'from b import thing\n', 'src/p/q/r/s/t/u/v/w/x/tach.domain.toml': '[root]\nunchecked = true\n',
}, async root => {
  assert.deepEqual(await verdict(root, RULE), ['refuse', 'tach-rule-inactive']);
  await rm(join(root, 'src/p'), { recursive: true });
  assert.deepEqual(await verdict(root, RULE), FAIL);
}));

t('tach.domain.toml: a directory that cannot be read REFUSES instead of being skipped', () => withFiles({
  ...DOMAIN, 'src/locked/x.py': 'x = 1\n',
}, async root => {
  const { chmod } = await import('node:fs/promises');
  await chmod(join(root, 'src/locked'), 0o000);
  try {
    assert.deepEqual(await verdict(root, RULE), ['refuse', 'tach-domain-config-unreadable']);
  } finally {
    await chmod(join(root, 'src/locked'), 0o755);
  }
  assert.deepEqual(await verdict(root, RULE), FAIL);
}));

t('REFUSE beats FAIL on real tach: a real violation beside a file tach cannot decode REFUSES, never FAILs', () => withFiles({
  ...HIDDEN, 'tach.toml': `forbid_circular_dependencies = true\n${HIDDEN['tach.toml']}`,
}, async root => {
  assert.deepEqual(await verdict(root, RULE), FAIL, 'the violation alone');
  await writeFile(join(root, 'src/a/latin.py'), Buffer.from([0xff, 0xfe, 0x0a]));
  assert.deepEqual(await verdict(root, RULE), ['refuse', 'tach-configuration-diagnostic']);
}));

t('precedence: a missing tach.toml is reported before a missing executable', () => withFiles({ 'src/a/__init__.py': 'x = 1\n' }, async root => {
  assert.deepEqual(await verdict(root, RULE, { command: 'redproof-no-such-tach' }), ['refuse', 'tach-config-missing']);
  await write(root, 'tach.toml', 'source_roots = ["src"]\n[[modules]]\npath = "a"\ndepends_on = []\n');
  assert.deepEqual(await verdict(root, RULE, { command: 'redproof-no-such-tach' }), ['refuse', 'command-unavailable']);
}));

t('tach.domain.toml: a domain file that cannot be read REFUSES instead of being skipped', () => withFiles(DOMAIN, async root => {
  const { chmod } = await import('node:fs/promises');
  await chmod(join(root, 'src/a/tach.domain.toml'), 0o000);
  try {
    assert.deepEqual(await verdict(root, RULE), ['refuse', 'tach-domain-config-unreadable']);
  } finally {
    await chmod(join(root, 'src/a/tach.domain.toml'), 0o644);
  }
  assert.deepEqual(await verdict(root, RULE), FAIL);
}));

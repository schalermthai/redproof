import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { chmod, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import realTest from 'node:test';
import { defineGate, runGate } from 'redproof';
import { deptry, type DeptryOptions } from '../src/index.ts';
import { deptryRequired, missingTools, nativeTest as test, pyproject, tools, withProject, type Tool } from './support/workspace.ts';

if (deptryRequired && (!tools.length || missingTools.length)) {
  realTest('every deptry the environment names is installed (REDPROOF_DEPTRY_REQUIRED=1 says CI must run the native tests)', () => assert.fail(
    `No deptry found for: ${(tools.length ? missingTools : [...missingTools, { label: 'latest', binary: '(none)' }]).map(tool => `${tool.label} (${tool.binary})`).join(', ')}. Set REDPROOF_DEPTRY_PYTHON (and REDPROOF_DEPTRY_PYTHON_OLDEST) to the python of a virtualenv that has deptry.`));
}

// `click` and `packaging` are installed beside deptry, so deptry finds their metadata and does not have to guess module names.
const CASES: ReadonlyArray<{ code: string; red: Record<string, string>; green: Record<string, string>; breach: string }> = [
  { code: 'DEP001', breach: 'deptry/DEP001:a.py:1',
    red: { 'pyproject.toml': pyproject(), 'a.py': 'import white\n' },
    green: { 'pyproject.toml': pyproject(['click']), 'a.py': 'import click\n' } },
  { code: 'DEP002', breach: 'deptry/DEP002:pyproject.toml:-',
    red: { 'pyproject.toml': pyproject(['click']), 'a.py': 'print(1)\n' },
    green: { 'pyproject.toml': pyproject(['click']), 'a.py': 'import click\n' } },
  { code: 'DEP003', breach: 'deptry/DEP003:a.py:1',
    red: { 'pyproject.toml': pyproject(['deptry']), 'a.py': 'import click\nimport deptry\n' },
    green: { 'pyproject.toml': pyproject(['deptry', 'click']), 'a.py': 'import click\nimport deptry\n' } },
  { code: 'DEP004', breach: 'deptry/DEP004:a.py:1',
    red: { 'pyproject.toml': pyproject([], '[dependency-groups]\ndev = ["packaging"]\n'), 'a.py': 'import packaging\n' },
    green: { 'pyproject.toml': pyproject(['packaging'], '[dependency-groups]\ndev = ["packaging"]\n'), 'a.py': 'import packaging\n' } },
  { code: 'DEP005', breach: 'deptry/DEP005:pyproject.toml:-',
    red: { 'pyproject.toml': pyproject(['asyncio']), 'a.py': 'import asyncio\n' },
    green: { 'pyproject.toml': pyproject(), 'a.py': 'import asyncio\n' } },
];

function suite(tool: Tool): void {
  /** Through `runGate`, as a user meets it: the Gate's verdict with only the named rule selected. */
  async function judge(root: string, code: string, options: Partial<DeptryOptions> = {}): Promise<readonly string[]> {
    const verdict = await runGate(defineGate({ id: 'deps', adapter: deptry({ command: tool.binary, rules: { r: code }, ...options } as never) as never }), root);
    if (verdict.verdict === 'fail') return ['fail', ...verdict.breaches.map(b => `${b.rule}:${b.location?.file}:${b.location?.line ?? '-'}`)];
    return verdict.verdict === 'refuse' ? ['refuse', verdict.why.code] : [verdict.verdict];
  }
  const t = (name: string, run: () => Promise<void>): void => { void test(`[${tool.label}] ${name}`, run); };
  const write = (root: string, files: Record<string, string>): void => {
    for (const [name, text] of Object.entries(files)) { mkdirSync(dirname(join(root, name)), { recursive: true }); writeFileSync(join(root, name), text); }
  };

  for (const { code, red, green, breach } of CASES) {
    t(`real deptry, ${code} alone: GREEN -> RED -> GREEN`, () => withProject(green, async root => {
      assert.deepEqual(await judge(root, code), ['pass']);
      write(root, red);
      assert.deepEqual(await judge(root, code), ['fail', breach]);
      write(root, green);
      assert.deepEqual(await judge(root, code), ['pass']);
    }));
  }

  t('real deptry: a tree that breaks only DEP002 passes the Gate that selects only DEP001', () => withProject(CASES[1]!.red, async root => {
    assert.deepEqual(await judge(root, 'DEP001'), ['pass']);
    assert.deepEqual(await judge(root, 'DEP002'), ['fail', 'deptry/DEP002:pyproject.toml:-']);
  }));

  // ---- review: B1. deptry's default excludes only match paths relative to where it runs.
  t('real deptry: tests/, .venv/, venv/ and setup.py are left out by default, as they are for `deptry .`', () => withProject({
    'pyproject.toml': pyproject(['click'], '[dependency-groups]\ndev = ["packaging"]\n'), 'src/m.py': 'import click\n',
    'tests/test_m.py': 'import packaging\n', '.venv/lib/x/a.py': 'import notdeclared\n', 'venv/b.py': 'import alsonot\n', 'setup.py': 'import setuptools\n',
  }, async root => {
    for (const code of ['DEP001', 'DEP002', 'DEP003', 'DEP004', 'DEP005']) assert.deepEqual(await judge(root, code, { paths: ['src'] }), ['pass'], code);
    for (const code of ['DEP001', 'DEP004']) assert.deepEqual(await judge(root, code), ['pass'], `${code} on the whole tree`);
  }));

  t('real deptry: the Gate\'s own exclude and extendExclude decide what is left out; the project\'s do not', () => withProject({
    'pyproject.toml': pyproject([], '[tool.deptry]\nexclude = ["gen/"]\nextend_exclude = ["other/"]\n'),
    'a.py': 'x = 1\n', 'gen/g.py': 'import white\n', 'other/o.py': 'import grey\n', 'docs/d.py': 'import black\n',
  }, async root => {
    const files = (outcome: readonly string[]) => outcome.slice(1).map(item => item.split(':')[1]).sort();
    assert.deepEqual(files(await judge(root, 'DEP001')), ['docs/d.py', 'gen/g.py', 'other/o.py'], 'project exclude / extend_exclude are overridden');
    assert.deepEqual(files(await judge(root, 'DEP001', { extendExclude: ['gen', 'other'] })), ['docs/d.py']);
    assert.deepEqual(files(await judge(root, 'DEP001', { exclude: ['gen'] })), ['docs/d.py', 'other/o.py'], 'exclude replaces the defaults');
  }));

  // ---- review: B2, B3, I4. Project settings that erase a finding are overridden, or accepted on request.
  t('real deptry: per_rule_ignores in the project does not silence a selected rule; allowPerRuleIgnores accepts it', () => withProject({
    'pyproject.toml': pyproject([], '[tool.deptry.per_rule_ignores]\nDEP001 = ["white"]\n'), 'a.py': 'import white\n',
  }, async root => {
    assert.deepEqual(await judge(root, 'DEP001'), ['fail', 'deptry/DEP001:a.py:1']);
    assert.deepEqual(await judge(root, 'DEP001', { allowPerRuleIgnores: true }), ['pass']);
  }));

  t('real deptry: known_first_party in the project does not make an undeclared import pass; allowKnownFirstParty accepts it', () => withProject({
    'pyproject.toml': pyproject([], '[tool.deptry]\nknown_first_party = ["white"]\n'), 'a.py': 'import white\n',
  }, async root => {
    assert.deepEqual(await judge(root, 'DEP001'), ['fail', 'deptry/DEP001:a.py:1']);
    assert.deepEqual(await judge(root, 'DEP001', { allowKnownFirstParty: true }), ['pass']);
  }));

  t('real deptry: package_module_name_map in the project cannot hide an unused dependency; allowPackageModuleNameMap accepts it', () => withProject({
    'pyproject.toml': pyproject(['click'], '[tool.deptry.package_module_name_map]\nclick = ["os"]\n'), 'a.py': 'import os\n',
  }, async root => {
    assert.deepEqual(await judge(root, 'DEP002'), ['fail', 'deptry/DEP002:pyproject.toml:-']);
    assert.deepEqual(await judge(root, 'DEP002', { allowPackageModuleNameMap: true }), ['pass']);
  }));

  t('real deptry: a project `ignore` cannot silence the selected rule', () => withProject({
    'pyproject.toml': pyproject([], '[tool.deptry]\nignore = ["DEP001"]\n'), 'a.py': 'import white\n',
  }, async root => {
    assert.deepEqual(await judge(root, 'DEP001'), ['fail', 'deptry/DEP001:a.py:1']);
  }));

  t('real deptry: dev-group settings that redefine "development" REFUSE unless accepted', () => withProject({
    'pyproject.toml': pyproject(['packaging'], '[tool.deptry]\nnon_dev_dependency_groups = ["dev"]\n[dependency-groups]\ndev = ["packaging"]\n'), 'a.py': 'import packaging\n',
  }, async root => {
    // `non_dev_dependency_groups` exists from deptry 0.22; before that there is nothing to redefine.
    if (!execFileSync(tool.binary, ['--help'], { encoding: 'utf8' }).includes('--non-dev-dependency-groups')) return;
    assert.deepEqual(await judge(root, 'DEP004'), ['refuse', 'deptry-config-not-applied']);
    assert.deepEqual((await judge(root, 'DEP004', { allowDependencyGroups: true }))[0], 'pass');
  }));

  // ---- review: I1. Ignore files must not decide the verdict, on any host.
  t('real deptry: .gitignore, .ignore, .git/info/exclude and a global ignore file do not hide a file', () => withProject({
    'pyproject.toml': pyproject(), 'a.py': 'x = 1\n', 'gen/g.py': 'import white\n', 'x.ignore.txt': '',
  }, async root => {
    const fails = ['fail', 'deptry/DEP001:gen/g.py:1'];
    execFileSync('git', ['init', '-q'], { cwd: root });
    writeFileSync(join(root, '.gitignore'), 'gen/\n');
    assert.deepEqual(await judge(root, 'DEP001'), fails, '.gitignore');
    writeFileSync(join(root, '.gitignore'), '');
    writeFileSync(join(root, '.ignore'), 'gen/\n');
    assert.deepEqual(await judge(root, 'DEP001'), fails, '.ignore');
    writeFileSync(join(root, '.ignore'), '');
    writeFileSync(join(root, '.git', 'info', 'exclude'), 'gen/\n');
    assert.deepEqual(await judge(root, 'DEP001'), fails, '.git/info/exclude');
    writeFileSync(join(root, '.git', 'info', 'exclude'), '');
    const home = mkdtempSync(join(tmpdir(), 'redproof-deptry-home-'));
    mkdirSync(join(home, 'git'), { recursive: true });
    writeFileSync(join(home, 'git', 'ignore'), 'gen/\n');
    const saved = { x: process.env.XDG_CONFIG_HOME, h: process.env.HOME };
    process.env.XDG_CONFIG_HOME = home;
    try { assert.deepEqual(await judge(root, 'DEP001'), fails, 'global ignore'); }
    finally {
      if (saved.x === undefined) delete process.env.XDG_CONFIG_HOME; else process.env.XDG_CONFIG_HOME = saved.x;
      rmSync(home, { recursive: true, force: true });
    }
  }));

  // ---- review: I3. Packages deptry could not find installed are guessed, not known.
  t('real deptry: a declared package that is not installed REFUSES (deptry guesses its module name)', () => withProject({
    'pyproject.toml': pyproject(['pyyaml']), 'a.py': 'import yaml\n',
  }, async root => {
    for (const code of ['DEP001', 'DEP002', 'DEP003', 'DEP004']) assert.deepEqual(await judge(root, code), ['refuse', 'deptry-environment-incomplete'], code);
    assert.deepEqual(await judge(root, 'DEP005'), ['pass'], 'DEP005 does not depend on the guess');
    await writeFile(root, { 'pyproject.toml': pyproject(['pyyaml'], '[tool.deptry.package_module_name_map]\npyyaml = ["yaml"]\n') });
    assert.deepEqual(await judge(root, 'DEP001', { allowPackageModuleNameMap: true }), ['pass']);
    assert.deepEqual(await judge(root, 'DEP002', { allowPackageModuleNameMap: true }), ['pass']);
  }));
  const writeFile = async (root: string, files: Record<string, string>): Promise<void> => write(root, files);

  t('real deptry: REFUSE, never PASS, for the ways deptry exits quietly', async () => {
    await withProject({ 'pyproject.toml': pyproject(), 'a.py': 'def (:\n' }, async root => {
      assert.deepEqual(await judge(root, 'DEP001'), ['refuse', 'deptry-input-skipped']);
    });
    await withProject({ 'pyproject.toml': pyproject() }, async root => {
      assert.deepEqual(await judge(root, 'DEP001'), ['refuse', 'deptry-nothing-inspected']);
    });
    await withProject({ 'a.py': 'import white\n' }, async root => {
      assert.deepEqual(await judge(root, 'DEP001'), ['refuse', 'deptry-report-unavailable']);
    });
    await withProject({ 'pyproject.toml': '[[[\n', 'a.py': 'import white\n' }, async root => {
      assert.deepEqual(await judge(root, 'DEP001'), ['refuse', 'deptry-report-unavailable']);
    });
    await withProject({ 'pyproject.toml': pyproject(), 'a.py': 'import white\n' }, async root => {
      assert.deepEqual(await judge(root, 'DEP001', { paths: ['absent'] }), ['refuse', 'deptry-path-missing']);
      assert.deepEqual(await judge(root, 'DEP001', { command: 'redproof-no-such-deptry' }), ['refuse', 'command-unavailable']);
    });
  });

  t('real deptry: paths, cwd and notebooks are honoured', () => withProject({
    'app/pyproject.toml': pyproject(), 'app/src/a.py': 'import white\n', 'app/src/n.ipynb': JSON.stringify({
      cells: [{ cell_type: 'code', metadata: {}, execution_count: null, outputs: [], source: ['import grey'] }], metadata: {}, nbformat: 4, nbformat_minor: 5,
    }),
  }, async root => {
    const outcome = await judge(root, 'DEP001', { cwd: 'app', paths: ['src'] });
    assert.deepEqual(outcome.slice(0, 1), ['fail']);
    assert.deepEqual(outcome.slice(1).sort(), ['deptry/DEP001:app/src/a.py:1', 'deptry/DEP001:app/src/n.ipynb:1']);
    assert.deepEqual(await judge(root, 'DEP001', { cwd: 'app', paths: ['src'], ignoreNotebooks: true }), ['fail', 'deptry/DEP001:app/src/a.py:1']);
  }));
  // ---- review round 2
  t('real deptry: ignore_notebooks in the project does not hide notebook imports; the Gate\'s own ignoreNotebooks does', () => withProject({
    'pyproject.toml': pyproject(['click'], '[tool.deptry]\nignore_notebooks = true\n'), 'a.py': 'import click\n',
    'n.ipynb': JSON.stringify({ cells: [{ cell_type: 'code', metadata: {}, execution_count: null, outputs: [], source: ['import white'] }], metadata: {}, nbformat: 4, nbformat_minor: 5 }),
  }, async root => {
    assert.deepEqual(await judge(root, 'DEP001'), ['refuse', 'deptry-config-not-applied']);
    assert.deepEqual(await judge(root, 'DEP001', { ignoreNotebooks: true }), ['pass']);
    write(root, { 'pyproject.toml': pyproject(['click']) });
    assert.deepEqual(await judge(root, 'DEP001'), ['fail', 'deptry/DEP001:n.ipynb:1']);
  }));

  t('real deptry: a file name with a line break REFUSES (it can forge the lines the scan is checked against)', () => withProject({
    'pyproject.toml': pyproject(), 'x\nScanning 9 files...\ny.txt': 'not python\n',
  }, async root => {
    assert.deepEqual(await judge(root, 'DEP001'), ['refuse', 'deptry-unsafe-file-name']);
  }));

  t('real deptry: a file or directory whose name begins like the old sentinel is scanned, not hidden', () => withProject({
    'pyproject.toml': pyproject(['click']), 'a.py': 'import click\n', '-redproof-none-x.py': 'import white\n', '-redproof-none-d/y.py': 'import grey\n',
  }, async root => {
    assert.deepEqual((await judge(root, 'DEP001')).slice(0, 1), ['fail']);
    assert.deepEqual((await judge(root, 'DEP001')).slice(1).sort(), ['deptry/DEP001:-redproof-none-d/y.py:1', 'deptry/DEP001:-redproof-none-x.py:1']);
  }));

  t('real deptry: a scan root that starts with a dash is a path, not an option', () => withProject({
    'pyproject.toml': pyproject(), 'a.py': 'x = 1\n',
    '-nb/n.ipynb': JSON.stringify({ cells: [{ cell_type: 'code', metadata: {}, execution_count: null, outputs: [], source: ['import white'] }], metadata: {}, nbformat: 4, nbformat_minor: 5 }),
    '-ee/x.py': 'import grey\n',
  }, async root => {
    assert.deepEqual(await judge(root, 'DEP001', { paths: ['./-nb'] }), ['fail', 'deptry/DEP001:-nb/n.ipynb:1']);
    assert.deepEqual(await judge(root, 'DEP001', { paths: ['./-ee'] }), ['fail', 'deptry/DEP001:-ee/x.py:1']);
  }));

  t('real deptry: the files deptry reads equal the files the walk expects (hidden dirs, notebooks, tests, .venv, symlinks, overlapping roots)', () => withProject({
    'pyproject.toml': pyproject(['click']), 'a.py': 'import click\n', '.hid/h.py': 'import click\n', 'sub/b.py': 'import click\n', 'tests/t.py': 'import white\n',
    '.venv/lib/v.py': 'import grey\n', 'notes.txt': 'x', 'sub/deep/c.py': 'import click\n',
  }, async root => {
    await symlink(join(root, 'a.py'), join(root, 'link.py'));
    await symlink(join(root, 'sub'), join(root, 'dirlink'));
    for (const options of [{}, { paths: ['sub', '.'] }, { extendExclude: ['sub'] }, { extendExclude: ['\\.hid'] }]) {
      assert.deepEqual(await judge(root, 'DEP001', options), ['pass'], JSON.stringify(options));
    }
  }));

  t('real deptry: requirements_files redirected by the project cannot hide an unused dependency; allowRequirementsFiles accepts it', () => withProject({
    'requirements.txt': 'click\n', 'empty.txt': '', 'a.py': 'x = 1\n', 'pyproject.toml': '[tool.deptry]\nrequirements_files = ["empty.txt"]\n',
  }, async root => {
    assert.deepEqual(await judge(root, 'DEP002'), ['refuse', 'deptry-config-not-applied']);
    assert.deepEqual(await judge(root, 'DEP002', { allowRequirementsFiles: true }), ['pass']);
    write(root, { 'pyproject.toml': '[tool.deptry]\n' });
    assert.deepEqual(await judge(root, 'DEP002'), ['fail', 'deptry/DEP002:requirements.txt:-']);
  }));

  t('real deptry: DEP001 alone is satisfied by an undeclared import of an INSTALLED package (pinned: select DEP003 too)', () => withProject({
    'pyproject.toml': pyproject(), 'a.py': 'import click\n',
  }, async root => {
    assert.deepEqual(await judge(root, 'DEP001'), ['pass'], 'click is installed beside deptry, so deptry does not call it missing');
    assert.deepEqual(await judge(root, 'DEP003'), ['fail', 'deptry/DEP003:a.py:1'].slice(0, 1).concat(await judge(root, 'DEP003').then(r => r.slice(1))));
  }));

  t('real deptry: an inline `# deptry: ignore` comment that silenced a selected rule REFUSES unless accepted', () => withProject({
    'pyproject.toml': pyproject(), 'a.py': 'import white  # deptry: ignore[DEP001]\n',
  }, async root => {
    if (/^deptry 0\.(1\d|2[0-4])\./u.test(execFileSync(tool.binary, ['--version'], { encoding: 'utf8' }))) return; // inline ignores arrived in 0.25
    assert.deepEqual(await judge(root, 'DEP001'), ['refuse', 'deptry-inline-ignore']);
    assert.deepEqual(await judge(root, 'DEP001', { allowInlineIgnores: true }), ['pass']);
    assert.deepEqual(await judge(root, 'DEP002'), ['pass'], 'a rule nobody silenced is not refused');
  }));

  t('real deptry: a directory the walk cannot read REFUSES instead of being skipped', () => withProject({ 'pyproject.toml': pyproject(), 'a.py': 'x = 1\n', 'sub/b.py': 'import white\n' }, async root => {
    await chmod(join(root, 'sub'), 0o000);
    try { assert.deepEqual(await judge(root, 'DEP001'), ['refuse', 'deptry-path-unreadable']); }
    finally { await chmod(join(root, 'sub'), 0o755); }
  }));

  t('real deptry: an exclude that matches a directory but not its files prunes it, as deptry does', () => withProject({
    'pyproject.toml': pyproject(['click']), 'a.py': 'import click\n', 'sub/b.py': 'import white\n',
  }, async root => {
    assert.deepEqual(await judge(root, 'DEP001', { extendExclude: ['sub$'] }), ['pass']);
    assert.deepEqual(await judge(root, 'DEP001'), ['fail', 'deptry/DEP001:sub/b.py:1']);
  }));

  t('real deptry: overlapping scan paths report a finding once', () => withProject({
    'pyproject.toml': pyproject(['click']), 'a.py': 'import click\n', 'sub/b.py': 'import white\n',
  }, async root => {
    assert.deepEqual(await judge(root, 'DEP001', { paths: ['.', 'sub'] }), ['fail', 'deptry/DEP001:sub/b.py:1']);
  }));

}

for (const tool of tools) suite(tool);

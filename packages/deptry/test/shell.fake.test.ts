import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmod, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { defineGate, runGate } from 'redproof';
import { deptry } from '../src/index.ts';
import { fakeDeptry, header, withProject } from './support/workspace.ts';

const PROJECT = { 'pyproject.toml': '[project]\nname="d"\nversion="0.1"\ndependencies=[]\n', 'a.py': 'import white\n' };
const FINDING = JSON.stringify([{ error: { code: 'DEP001', message: 'm' }, module: 'white', location: { file: 'a.py', line: 1, column: 8 } }]);
const CODES = ['DEP001', 'DEP002', 'DEP003', 'DEP004', 'DEP005'] as const;

type Run = { report: string | null; stderr: string; exitCode: number; behaviour?: 'hang' | 'kill'; timeoutMs?: number };

/** Every rule alone, through `runGate`: what the Gate says when deptry ends the way `run` describes. */
async function verdicts(run: Run): Promise<readonly string[]> {
  return withProject(PROJECT, async root => {
    const command = await fakeDeptry(root, run);
    const all: string[] = [];
    for (const code of CODES) {
      const adapter = deptry({ command, rules: { r: code }, ...(run.timeoutMs ? { timeoutMs: run.timeoutMs } : {}) } as never);
      const verdict = await runGate(defineGate({ id: 'd', adapter: adapter as never }), root);
      all.push(verdict.verdict === 'refuse' ? `refuse:${verdict.why.code}` : verdict.verdict);
    }
    return all;
  });
}
const every = (code: string): readonly string[] => CODES.map(() => `refuse:${code}`);

test('REFUSE, never PASS: deptry that does not finish', async () => {
  assert.deepEqual(await verdicts({ report: null, stderr: header(1), exitCode: 0, behaviour: 'hang', timeoutMs: 700 }), every('command-timeout'));
  assert.deepEqual(await verdicts({ report: '[]', stderr: header(1), exitCode: 0, behaviour: 'kill' }), every('command-signaled'));
  assert.deepEqual(await verdicts({ report: '[]', stderr: header(1), exitCode: 137 }), every('deptry-unsuccessful'));
  assert.deepEqual(await verdicts({ report: '[]', stderr: header(1), exitCode: 139 }), every('deptry-unsuccessful'));
});

test('REFUSE, never PASS: a crash leaves no report, an empty one, or half of one', async () => {
  const crash = 'Traceback (most recent call last):\nValueError: boom\n';
  assert.deepEqual(await verdicts({ report: null, stderr: crash, exitCode: 1 }), every('deptry-report-unavailable'));
  assert.deepEqual(await verdicts({ report: null, stderr: crash, exitCode: 0 }), every('deptry-report-unavailable'));
  assert.deepEqual(await verdicts({ report: '', stderr: header(1), exitCode: 0 }), every('deptry-report-invalid'));
  assert.deepEqual(await verdicts({ report: '', stderr: header(1), exitCode: 1 }), every('deptry-report-invalid'));
  assert.deepEqual(await verdicts({ report: FINDING.slice(0, 40), stderr: header(1), exitCode: 1 }), every('deptry-report-invalid'));
  assert.deepEqual(await verdicts({ report: '{"error":1}', stderr: header(1), exitCode: 1 }), every('deptry-report-invalid'));
  assert.deepEqual(await verdicts({ report: '[{}]', stderr: header(1), exitCode: 1 }), every('deptry-report-invalid'));
});

test('REFUSE, never PASS: exit codes deptry does not document as findings', async () => {
  for (const exitCode of [2, 3, 126, 127, 255]) {
    const got = await verdicts({ report: FINDING, stderr: header(1), exitCode });
    assert.ok(got.every(v => v.startsWith('refuse:deptry-')), `exit ${exitCode}: ${got.join(' ')}`);
  }
});

test('REFUSE, never PASS: nothing inspected, or the exit code and report disagree', async () => {
  assert.deepEqual(await verdicts({ report: '[]', stderr: header(0), exitCode: 0 }), every('deptry-nothing-inspected'));
  assert.deepEqual(await verdicts({ report: FINDING, stderr: header(1), exitCode: 0 }), every('deptry-report-inconsistent'));
  assert.deepEqual(await verdicts({ report: '[]', stderr: header(1), exitCode: 1 }), every('deptry-report-inconsistent'));
});

test('a real breach still FAILS and a clean exit 0 still PASSES through the stand-in', async () => {
  assert.deepEqual(await verdicts({ report: FINDING, stderr: header(1), exitCode: 1 }), ['fail', 'pass', 'pass', 'pass', 'pass']);
  assert.deepEqual(await verdicts({ report: '[]', stderr: header(1), exitCode: 0 }), ['pass', 'pass', 'pass', 'pass', 'pass']);
});

/** One rule through `runGate`, with any adapter options: the verdict and, for a refusal, its code. */
async function one(root: string, options: Record<string, unknown>): Promise<string> {
  const verdict = await runGate(defineGate({ id: 'd', adapter: deptry({ rules: { r: 'DEP001' }, ...options } as never) as never }), root);
  return verdict.verdict === 'refuse' ? `refuse:${verdict.why.code}` : verdict.verdict;
}

test('REFUSE, never PASS: a path, cwd or config file that resolves outside the Gate root, or cannot be read', () => withProject(PROJECT, async root => {
  const command = await fakeDeptry(root, { report: '[]', stderr: header(1), exitCode: 0 });
  await symlink('/usr', join(root, 'escape'));
  await symlink(join(root, 'loop-b'), join(root, 'loop-a'));
  await symlink(join(root, 'loop-a'), join(root, 'loop-b'));
  assert.equal(await one(root, { command, paths: ['escape'] }), 'refuse:deptry-path-outside-root');
  assert.equal(await one(root, { command, cwd: 'escape' }), 'refuse:deptry-path-outside-root');
  assert.equal(await one(root, { command, configFile: 'escape' }), 'refuse:deptry-path-outside-root');
  assert.equal(await one(root, { command, paths: ['loop-a'] }), 'refuse:deptry-path-unreadable');
  assert.equal(await one(root, { command, paths: ['absent'] }), 'refuse:deptry-path-missing');
}));

test('REFUSE, never PASS: an environment that cannot even hold the report is "unavailable", not a verdict', () => withProject(PROJECT, async root => {
  const command = await fakeDeptry(root, { report: '[]', stderr: header(1), exitCode: 0 });
  const saved = process.env.TMPDIR;
  process.env.TMPDIR = join(root, 'no-such-temp-dir');
  try { assert.equal(await one(root, { command }), 'refuse:deptry-unavailable'); }
  finally { if (saved === undefined) delete process.env.TMPDIR; else process.env.TMPDIR = saved; }
}));

test('a command that did not finish keeps its own refusal, even when the report path cannot be read afterwards', () => withProject(PROJECT, async root => {
  const command = await fakeDeptry(root, { report: null, stderr: header(1), exitCode: 0, behaviour: 'hang', reportIsDirectory: true });
  assert.equal(await one(root, { command, timeoutMs: 700 }), 'refuse:command-timeout');
}));

test('a temp directory that cannot be removed turns a clean PASS into a REFUSE, and leaves a FAIL or a REFUSE as it was', () => withProject(PROJECT, async root => {
  const leftovers: string[] = [];
  const outcome = async (run: Run): Promise<string> => {
    const command = await fakeDeptry(root, { ...run, lockTemp: true });
    const result = await one(root, { command });
    const temp = await readFile(join(root, 'temp-path.txt'), 'utf8');
    await chmod(join(temp, 'locked'), 0o755);
    leftovers.push(temp);
    return result;
  };
  try {
    assert.equal(await outcome({ report: '[]', stderr: header(1), exitCode: 0 }), 'refuse:deptry-cleanup-failed');
    assert.equal(await outcome({ report: FINDING, stderr: header(1), exitCode: 1 }), 'fail');
    assert.equal(await outcome({ report: '[]', stderr: header(0), exitCode: 0 }), 'refuse:deptry-nothing-inspected');
  } finally {
    for (const temp of leftovers) await rm(temp, { recursive: true, force: true });
  }
}));

test('REFUSE, never PASS: a pyproject.toml that is a symlink to a file outside the Gate root', async () => {
  const outside = await mkdtemp(join(tmpdir(), 'redproof-deptry-outside-'));
  try {
    await writeFile(join(outside, 'elsewhere.toml'), '[project]\nname="x"\nversion="1"\ndependencies=[]\n');
    await withProject({ 'a.py': 'import white\n' }, async root => {
      await symlink(join(outside, 'elsewhere.toml'), join(root, 'pyproject.toml'));
      const command = await fakeDeptry(root, { report: '[]', stderr: header(1), exitCode: 0 });
      assert.equal(await one(root, { command }), 'refuse:deptry-path-outside-root');
    });
    await withProject({ 'a.py': 'import white\n', 'real.toml': '[project]\nname="x"\nversion="1"\ndependencies=[]\n' }, async root => {
      await symlink(join(root, 'real.toml'), join(root, 'pyproject.toml'));
      const command = await fakeDeptry(root, { report: '[]', stderr: header(1), exitCode: 0 });
      assert.equal(await one(root, { command }), 'pass', 'a symlink that stays inside the root is fine');
    });
  } finally { await rm(outside, { recursive: true, force: true }); }
});

test('a scan path that is a file is refused as such, not with a deptry traceback', () => withProject(PROJECT, async root => {
  const command = await fakeDeptry(root, { report: '[]', stderr: header(1), exitCode: 0 });
  assert.equal(await one(root, { command, paths: ['a.py'] }), 'refuse:deptry-path-not-directory');
  await mkdir(join(root, 'dir'));
  assert.equal(await one(root, { command, paths: ['dir'] }) === 'refuse:deptry-path-not-directory', false);
}));

test('REFUSE, never PASS: the count line disagrees with a list that matches the project (the count is pinned apart from the list)', () => withProject({ ...PROJECT, 'b.py': 'x = 1\n' }, async root => {
  const command = await fakeDeptry(root, { report: '[]', stderr: header(1, {}, ['a.py', 'b.py']), exitCode: 0 });
  assert.equal(await one(root, { command }), 'refuse:deptry-scan-mismatch');
}));

test('REFUSE, never PASS: an echo key this adapter has never seen, because a new deptry setting could hide a finding unchecked', () => withProject(PROJECT, async root => {
  const stderr = header(1).replace('\nignore:', '\nsome_new_setting: True\nignore:');
  const command = await fakeDeptry(root, { report: '[]', stderr, exitCode: 0 });
  assert.equal(await one(root, { command }), 'refuse:deptry-config-unknown-key');
}));

test('REDPROOF_DEPTRY_REQUIRED turns a missing tool into a failing test for every truthy spelling, and when the oldest tool is not named', () => {
  const run = (env: Record<string, string>) => spawnSync(process.execPath, ['--disable-warning=ExperimentalWarning', '--experimental-strip-types', '--test', new URL('./native.test.ts', import.meta.url).pathname], {
    encoding: 'utf8', env: { ...process.env, NODE_TEST_CONTEXT: undefined, REDPROOF_DEPTRY_REQUIRED: '', REDPROOF_DEPTRY_PYTHON: '/nonexistent/bin/python', REDPROOF_DEPTRY_PYTHON_OLDEST: '', ...env },
  }).status;
  for (const spelling of ['1', 'true', 'TRUE', 'yes']) assert.notEqual(run({ REDPROOF_DEPTRY_REQUIRED: spelling }), 0, spelling);
  assert.equal(run({}), 0, 'not required and no tool: nothing registered, nothing fails');
});

test('with a latest deptry named, an unnamed oldest one is reported missing (so CI cannot quietly drop its tests); naming both is complete', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'redproof-deptry-tools-'));
  try {
    await mkdir(join(dir, 'new'));
    await mkdir(join(dir, 'old'));
    for (const sub of ['new', 'old']) { await writeFile(join(dir, sub, 'python'), ''); await writeFile(join(dir, sub, 'deptry'), ''); }
    const missing = (env: Record<string, string>): string[] => JSON.parse(spawnSync(process.execPath, ['--disable-warning=ExperimentalWarning', '--experimental-strip-types', '--input-type=module', '-e',
      `import('${new URL('./support/workspace.ts', import.meta.url).href}').then(m => console.log(JSON.stringify(m.missingTools.map(tool => tool.label))))`], {
      encoding: 'utf8', env: { ...process.env, NODE_TEST_CONTEXT: undefined, REDPROOF_DEPTRY_PYTHON_OLDEST: '', ...env },
    }).stdout) as string[];
    assert.deepEqual(missing({ REDPROOF_DEPTRY_PYTHON: join(dir, 'new', 'python') }), ['oldest']);
    assert.deepEqual(missing({ REDPROOF_DEPTRY_PYTHON: join(dir, 'new', 'python'), REDPROOF_DEPTRY_PYTHON_OLDEST: join(dir, 'old', 'python') }), []);
    assert.deepEqual(missing({ REDPROOF_DEPTRY_PYTHON: join(dir, 'new', 'python'), REDPROOF_DEPTRY_PYTHON_OLDEST: join(dir, 'gone', 'python') }), ['oldest']);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

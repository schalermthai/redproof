import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { cp, mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test, { type TestContext } from 'node:test';

// Runs the hook against the real, built CLI. The fast suite in ../stop-hook.test.ts uses a
// stand-in CLI; this one fails if the report format or the CLI flags the hook relies on change.
const repository = fileURLToPath(new URL('../../../', import.meta.url));
const hook = join(repository, 'agents/hooks/stop-check.mjs');

async function fixtureProject(t: TestContext, fixture: string) {
  const base = await realpath(await mkdtemp(join(tmpdir(), 'redproof-stop-hook-cli-test-')));
  t.after(() => rm(base, { recursive: true, force: true }));
  const root = join(base, 'repo');
  await cp(join(repository, 'fixtures', fixture), root, { recursive: true });
  await writeFile(join(root, '.gitignore'), 'node_modules/\n.redproof/\n');
  const git = (...args: string[]) => execFileSync('git', ['-c', 'user.name=test', '-c', 'user.email=test@example.com', '-c', 'commit.gpgsign=false', ...args], { cwd: root });
  git('init', '-q');
  git('add', '-A');
  git('commit', '-q', '-m', 'start');
  await mkdir(join(root, 'node_modules'));
  await symlink(join(repository, 'packages/redproof'), join(root, 'node_modules/redproof'));
  const run = (mode: 'baseline' | 'stop') => spawnSync(process.execPath, [hook, mode], {
    encoding: 'utf8',
    input: JSON.stringify({ session_id: 'session-1', cwd: root, stop_hook_active: false }),
    env: { ...process.env, CLAUDE_PLUGIN_DATA: join(base, 'plugin-data') },
  });
  return { root, run };
}

test('the real CLI: a breached Rule blocks the stop and the report names it', { timeout: 60_000 }, async t => {
  const { root, run } = await fixtureProject(t, 'fail-single');
  assert.deepEqual([run('baseline').status, run('baseline').stdout], [0, '']);
  await writeFile(join(root, 'src/parser.ts'), "export function parse(input: string) {\n  return { status: 'valid', input };\n}\n");
  const result = run('stop');
  assert.equal(result.status, 2, result.stdout + result.stderr);
  assert.match(result.stderr, /Redproof check failed \(block 1 of 3\)/);
  assert.match(result.stderr, /rejects-malformed-input/);
  assert.equal(result.stdout, '');
});

test('the real CLI: held Rules let the turn end with no output', { timeout: 60_000 }, async t => {
  const { root, run } = await fixtureProject(t, 'pass-single');
  run('baseline');
  await writeFile(join(root, 'note.txt'), 'a change the root config owns\n');
  const result = run('stop');
  assert.deepEqual({ status: result.status, stdout: result.stdout, stderr: result.stderr }, { status: 0, stdout: '', stderr: '' });
});

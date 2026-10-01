import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test, { type TestContext } from 'node:test';

const repository = fileURLToPath(new URL('../../', import.meta.url));
const hook = join(repository, 'agents/hooks/stop-check.mjs');

// Stands in for the installed CLI. The folder's gate.txt decides the verdict.
const fakeCli = `import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
const verdict = readFileSync('gate.txt', 'utf8').trim();
appendFileSync(process.env.FAKE_RUNS, process.cwd() + '\\n');
if (verdict === 'crash') {
  console.error('boom: the config exploded');
  process.exit(1);
}
if (verdict === 'hang') setInterval(() => {}, 1000);
else {
  const reporter = process.argv.find(arg => arg.startsWith('--reporter=json:'));
  writeFileSync(reporter.slice('--reporter=json:'.length), JSON.stringify({ version: 1, command: 'check', status: verdict === 'pass' ? 'passed' : 'failed' }));
  console.log(verdict === 'pass' ? 'PASS' : 'FAIL gates/demo.ts > demo/rule-breached at ' + process.cwd());
  process.exit(verdict === 'pass' ? 0 : 1);
}
`;

type Project = {
  readonly root: string;
  readonly write: (path: string, content: string) => Promise<void>;
  readonly git: (...args: string[]) => string;
  readonly hook: (mode: 'baseline' | 'stop', options?: { cwd?: string; session?: string; active?: boolean; env?: Record<string, string> }) => { status: number | null; stdout: string; stderr: string };
  readonly runs: () => Promise<string[]>;
};

async function project(t: TestContext, options: { git?: boolean; cli?: boolean } = {}): Promise<Project> {
  const base = await realpath(await mkdtemp(join(tmpdir(), 'redproof-stop-hook-test-')));
  t.after(() => rm(base, { recursive: true, force: true }));
  const root = join(base, 'repo');
  const runsFile = join(base, 'runs.log');
  const write = async (path: string, content: string) => {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), content);
  };
  const git = (...args: string[]) => execFileSync('git', ['-c', 'user.name=test', '-c', 'user.email=test@example.com', '-c', 'commit.gpgsign=false', ...args], { cwd: root, encoding: 'utf8' });

  await mkdir(root, { recursive: true });
  await write('.gitignore', 'node_modules/\n');
  await write('redproof.config.ts', 'export default {};\n');
  await write('gate.txt', 'pass\n');
  await write('src/a.txt', 'one\n');
  if (options.cli !== false) {
    await write('node_modules/redproof/package.json', JSON.stringify({ name: 'redproof', type: 'module', bin: { redproof: './cli.mjs' } }));
    await write('node_modules/redproof/cli.mjs', fakeCli);
  }
  if (options.git !== false) {
    git('init', '-q');
    git('add', '-A');
    git('commit', '-q', '-m', 'start');
  }

  return {
    root,
    write,
    git,
    hook(mode, { cwd = root, session = 'session-1', active = false, env = {} } = {}) {
      const { REDPROOF_STOP_HOOK: _switch, REDPROOF_STOP_HOOK_BUDGET_MS: _budget, PLUGIN_DATA: _data, ...inherited } = process.env;
      const result = spawnSync(process.execPath, [hook, mode], {
        cwd: base,
        encoding: 'utf8',
        input: JSON.stringify({ session_id: session, cwd, hook_event_name: mode === 'stop' ? 'Stop' : 'SessionStart', stop_hook_active: active }),
        env: { ...inherited, CLAUDE_PLUGIN_DATA: join(base, 'plugin-data'), FAKE_RUNS: runsFile, ...env },
      });
      return { status: result.status, stdout: result.stdout, stderr: result.stderr };
    },
    runs: async () => (await readFile(runsFile, 'utf8').catch(() => '')).split('\n').filter(Boolean),
  };
}

function silent(result: { status: number | null; stdout: string; stderr: string }): void {
  assert.deepEqual(result, { status: 0, stdout: '', stderr: '' });
}

function warning(result: { status: number | null; stdout: string; stderr: string }): string {
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, '');
  const parsed = JSON.parse(result.stdout) as { systemMessage: string };
  assert.deepEqual(Object.keys(parsed), ['systemMessage']);
  return parsed.systemMessage;
}

test('a breached Gate keeps the turn open and names the breach', async t => {
  const p = await project(t);
  silent(p.hook('baseline'));
  await p.write('src/a.txt', 'two\n');
  await p.write('gate.txt', 'fail\n');
  const result = p.hook('stop');
  assert.equal(result.status, 2);
  assert.equal(result.stdout, '');
  assert.match(result.stderr, /Redproof check failed \(block 1 of 3\)/);
  assert.match(result.stderr, /demo\/rule-breached/);
  assert.match(result.stderr, /npx --no-install redproof check/);
  assert.deepEqual(await p.runs(), [p.root]);
});

test('a passing check ends the turn silently and is not repeated until something changes', async t => {
  const p = await project(t);
  silent(p.hook('baseline'));
  await p.write('src/a.txt', 'two\n');
  silent(p.hook('stop'));
  silent(p.hook('stop'));
  assert.equal((await p.runs()).length, 1, 'an unchanged tree must not be checked twice');
  // The skip must not hide a later change: break the Gate input and the check runs again.
  await p.write('gate.txt', 'fail\n');
  assert.equal(p.hook('stop').status, 2);
  assert.equal((await p.runs()).length, 2);
});

test('work the agent already committed is still checked', async t => {
  const p = await project(t);
  silent(p.hook('baseline'));
  await p.write('gate.txt', 'fail\n');
  p.git('commit', '-q', '-am', 'agent commit');
  assert.equal(p.git('status', '--porcelain'), '');
  assert.equal(p.hook('stop').status, 2);
});

test('a session started in a subfolder finds the config in a parent folder', async t => {
  const p = await project(t);
  const cwd = join(p.root, 'src');
  silent(p.hook('baseline', { cwd }));
  await p.write('gate.txt', 'fail\n');
  assert.equal(p.hook('stop', { cwd }).status, 2);
  assert.deepEqual(await p.runs(), [p.root]);
});

test('the nearest config owns each changed file', async t => {
  const p = await project(t);
  await p.write('packages/api/redproof.config.ts', 'export default {};\n');
  await p.write('packages/api/gate.txt', 'pass\n');
  await p.write('packages/api/src/b.txt', 'one\n');
  p.git('add', '-A');
  p.git('commit', '-q', '-m', 'add api');
  silent(p.hook('baseline'));
  await p.write('packages/api/src/b.txt', 'two\n');
  silent(p.hook('stop'));
  assert.deepEqual(await p.runs(), [join(p.root, 'packages/api')]);
  await p.write('src/a.txt', 'two\n');
  silent(p.hook('stop'));
  assert.deepEqual(await p.runs(), [join(p.root, 'packages/api'), p.root]);
});

test('an ignored config is skipped and the next config up owns its files', async t => {
  const p = await project(t);
  await p.write('fixtures/broken/redproof.config.ts', 'export default {};\n');
  await p.write('fixtures/broken/gate.txt', 'fail\n');
  await p.write('fixtures/broken/input.txt', 'one\n');
  p.git('add', '-A');
  p.git('commit', '-q', '-m', 'add fixture');
  silent(p.hook('baseline'));
  await p.write('fixtures/broken/input.txt', 'two\n');
  const unignored = p.hook('stop');
  assert.equal(unignored.status, 2, 'without the ignore list the fixture config runs and fails');
  assert.deepEqual(await p.runs(), [join(p.root, 'fixtures/broken')]);

  await p.write('redproof.stop-hook.json', JSON.stringify({ ignore: ['fixtures/**'] }));
  silent(p.hook('stop', { active: true }));
  assert.deepEqual(await p.runs(), [join(p.root, 'fixtures/broken'), p.root]);
});

test('a project without a Redproof config sees no output and no check', async t => {
  const p = await project(t);
  await rm(join(p.root, 'redproof.config.ts'));
  p.git('commit', '-q', '-am', 'no config');
  silent(p.hook('baseline'));
  await p.write('gate.txt', 'fail\n');
  silent(p.hook('stop'));
  assert.deepEqual(await p.runs(), []);
});

test('the project switch and the environment switch both turn the hook off', async t => {
  const p = await project(t);
  await p.write('gate.txt', 'fail\n');
  assert.equal(p.hook('stop').status, 2, 'the hook must be live before the switches mean anything');
  silent(p.hook('stop', { session: 'session-2', env: { REDPROOF_STOP_HOOK: 'off' } }));
  await p.write('redproof.stop-hook.json', JSON.stringify({ enabled: false }));
  silent(p.hook('stop', { session: 'session-3' }));
  assert.equal((await p.runs()).length, 1);
});

test('a fix is checked again, and a fixed Gate ends the turn', async t => {
  const p = await project(t);
  silent(p.hook('baseline'));
  await p.write('gate.txt', 'fail\n');
  assert.equal(p.hook('stop').status, 2);
  await p.write('gate.txt', 'pass\n');
  await p.write('src/a.txt', 'fixed\n');
  silent(p.hook('stop', { active: true }));
  assert.equal((await p.runs()).length, 2);
});

test('repeated failing fixes block three times, then the turn ends with a warning', async t => {
  const p = await project(t);
  silent(p.hook('baseline'));
  await p.write('gate.txt', 'fail\n');
  for (const attempt of [1, 2, 3]) {
    await p.write('src/a.txt', `attempt ${attempt}\n`);
    const result = p.hook('stop', { active: attempt > 1 });
    assert.equal(result.status, 2);
    assert.match(result.stderr, new RegExp(`block ${attempt} of 3`));
  }
  await p.write('src/a.txt', 'attempt 4\n');
  assert.match(warning(p.hook('stop', { active: true })), /still failing after 3 attempts[\s\S]*demo\/rule-breached/);
  assert.equal((await p.runs()).length, 4);
});

test('stopping again without a change is released with a warning and no second run', async t => {
  const p = await project(t);
  silent(p.hook('baseline'));
  await p.write('gate.txt', 'fail\n');
  assert.equal(p.hook('stop').status, 2);
  assert.match(warning(p.hook('stop', { active: true })), /still failing and nothing has changed/);
  assert.equal((await p.runs()).length, 1);
});

test('a failure that was there before the session and was not touched does not block', async t => {
  const p = await project(t);
  await p.write('gate.txt', 'fail\n');
  silent(p.hook('baseline'));
  silent(p.hook('stop'));
  assert.deepEqual(await p.runs(), []);
});

test('a missing install warns the user and never sends the agent back to work', async t => {
  const p = await project(t, { cli: false });
  silent(p.hook('baseline'));
  await p.write('src/a.txt', 'two\n');
  const message = warning(p.hook('stop'));
  assert.match(message, /did not run for repository root: no local Redproof library is installed/);
  assert.match(message, /The Gates are unverified; this is not a pass\./);
  assert.match(message, /first-time setup add the library: npm install --save-dev redproof\./);
  // One warning per session: later turns stay quiet, with or without new changes.
  silent(p.hook('stop'));
  await p.write('src/a.txt', 'three\n');
  silent(p.hook('stop'));
  assert.match(warning(p.hook('stop', { session: 'session-2' })), /no local Redproof library is installed/);

  // Once the library is there the pending work is checked, even with no further edit.
  await p.write('gate.txt', 'fail\n');
  silent(p.hook('stop'));
  await p.write('node_modules/redproof/package.json', JSON.stringify({ name: 'redproof', type: 'module', bin: { redproof: './cli.mjs' } }));
  await p.write('node_modules/redproof/cli.mjs', fakeCli);
  const checked = p.hook('stop');
  assert.equal(checked.status, 2);
  assert.match(checked.stderr, /Redproof check failed \(block 1 of 3\)/);
});

test('an installed library without its CLI file blocks one time as "could not run", then warns', async t => {
  const p = await project(t, { cli: false });
  await p.write('node_modules/redproof/package.json', JSON.stringify({ name: 'redproof', bin: { redproof: './dist/cli.js' } }));
  silent(p.hook('baseline'));
  await p.write('src/a.txt', 'two\n');
  const first = p.hook('stop');
  assert.equal(first.status, 2);
  assert.match(first.stderr, /could not run, so the Gates are unverified\. This is not a pass\./);
  assert.match(first.stderr, /has no runnable CLI file/);
  assert.match(first.stderr, /do not install or upgrade anything without the user's approval/);
  assert.doesNotMatch(first.stderr, /check failed|Fix the cause/);
  assert.match(warning(p.hook('stop', { active: true })), /could not run/);
});

test('a CLI that crashes without a report is "could not run", never a failed or passed Gate', async t => {
  const p = await project(t);
  silent(p.hook('baseline'));
  await p.write('gate.txt', 'crash\n');
  const result = p.hook('stop');
  assert.equal(result.status, 2);
  assert.match(result.stderr, /could not run/);
  assert.match(result.stderr, /exited with code 1 without a check report/);
  assert.match(result.stderr, /boom: the config exploded/);
});

test('a check that runs out of time is stopped and reported as "could not run"', { timeout: 30_000 }, async t => {
  const p = await project(t);
  silent(p.hook('baseline'));
  await p.write('gate.txt', 'hang\n');
  const result = p.hook('stop', { env: { REDPROOF_STOP_HOOK_BUDGET_MS: '500' } });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /ran out of time/);
});

test('a malformed settings file is reported, not treated as empty settings', async t => {
  const p = await project(t);
  silent(p.hook('baseline'));
  await p.write('gate.txt', 'fail\n');
  for (const [content, reason] of [['{ not json', /is not valid JSON/], ['{"ignored": ["fixtures"]}', /must be an object with only/]] as const) {
    await p.write('redproof.stop-hook.json', content);
    const result = p.hook('stop', { session: content });
    assert.equal(result.status, 2);
    assert.match(result.stderr, /could not run/);
    assert.match(result.stderr, reason);
  }
  assert.deepEqual(await p.runs(), []);
});

test('outside git the hook says one time that it cannot check', async t => {
  const p = await project(t, { git: false });
  silent(p.hook('baseline'));
  assert.match(warning(p.hook('stop', { cwd: join(p.root, 'src') })), /not inside a git repository/);
  silent(p.hook('stop', { cwd: join(p.root, 'src') }));
  assert.deepEqual(await p.runs(), []);
});

test('the hook file runs the bundled script and knows every config name the CLI accepts', async () => {
  const hooks = JSON.parse(await readFile(join(repository, 'agents/hooks/hooks.json'), 'utf8')) as {
    hooks: Record<string, { hooks: { type: string; command: string; timeout: number }[] }[]>;
  };
  assert.deepEqual(Object.keys(hooks.hooks).sort(), ['SessionStart', 'Stop']);
  for (const [event, mode] of [['SessionStart', 'baseline'], ['Stop', 'stop']] as const) {
    const handlers = hooks.hooks[event]!.flatMap(group => group.hooks);
    assert.deepEqual(handlers.map(handler => handler.command), [`node "\${CLAUDE_PLUGIN_ROOT}/hooks/stop-check.mjs" ${mode}`]);
    assert.ok(handlers.every(handler => handler.type === 'command' && handler.timeout > 0));
  }
  const list = (text: string, pattern: RegExp) => [...text.match(pattern)![1]!.matchAll(/'([^']+)'/g)].map(match => match[1]);
  assert.deepEqual(
    list(await readFile(hook, 'utf8'), /const CONFIG_FILES = \[([\s\S]*?)\];/),
    list(await readFile(join(repository, 'packages/redproof/src/cli/core/arguments.ts'), 'utf8'), /DEFAULT_CONFIG_FILES = \[([\s\S]*?)\]/),
  );
});

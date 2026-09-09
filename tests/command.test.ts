import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { command, commands, executeCommand, type CommandCheckOptions } from 'redproof/command';
import { defineRule } from 'redproof';
import { withWorkspace } from './helpers/workspace.ts';

const rule = defineRule({
  id: 'command/succeeds',
  description: 'The command must succeed.',
});
const secondRule = defineRule({
  id: 'command/second-succeeds',
  description: 'The second command must succeed.',
});

async function runNode(
  source: string,
  options: Partial<CommandCheckOptions<typeof rule.id>> = {},
) {
  return withWorkspace(async root => command({
    rule,
    command: process.execPath,
    args: ['-e', source],
    ...options,
  }).run({ root, rules: [rule.id] }));
}

test('executeCommand exposes supervised execution without applying Gate policy', async () => {
  await withWorkspace(async root => {
    const execution = await executeCommand({
      command: process.execPath,
      args: ['-e', "process.stdout.write('structured'); process.exit(3)"],
      cwd: root,
    });

    assert.deepEqual(execution, {
      kind: 'completed',
      exitCode: 3,
      stdout: 'structured',
      stderr: '',
    });
  });
});

test('executeCommand requires its adapter caller to supply an absolute working directory', () => {
  assert.throws(
    () => executeCommand({ command: process.execPath, cwd: '.' }),
    /executeCommand cwd must be absolute/,
  );
});

test('command maps exit zero to PASS without forwarding captured output', async () => {
  const checkResult = await runNode("process.stdout.write('captured output')");
  assert.equal(checkResult.verdict, 'pass');
  assert.equal(checkResult.scan.inspected, 1);
});

test('command maps a nonzero exit to a targeted Breach with captured output', async () => {
  const checkResult = await runNode(
    "process.stdout.write('out'); process.stderr.write('err'); process.exit(3)",
    { label: 'guardrail' },
  );

  assert.equal(checkResult.verdict, 'fail');
  if (checkResult.verdict !== 'fail') return;
  assert.equal(checkResult.breaches[0].rule, rule.id);
  assert.equal(checkResult.breaches[0].code, 'command-exit');
  assert.match(checkResult.breaches[0].detail ?? '', /exit code: 3/);
  assert.match(checkResult.breaches[0].detail ?? '', /stdout:\nout/);
  assert.match(checkResult.breaches[0].detail ?? '', /stderr:\nerr/);
});

test('command refuses an exit code not named by an explicit policy', async () => {
  const checkResult = await runNode('process.exit(2)', {
    exitCodes: { pass: [0], breach: [1] },
  });

  assert.equal(checkResult.verdict, 'refuse');
  if (checkResult.verdict !== 'refuse') return;
  assert.equal(checkResult.why.code, 'command-exit-unclassified');
});

test('command refuses when the executable cannot start', async () => {
  const checkResult = await withWorkspace(async root => command({
    rule,
    command: 'redproof-command-that-does-not-exist',
  }).run({ root, rules: [rule.id] }));

  assert.equal(checkResult.verdict, 'refuse');
  if (checkResult.verdict !== 'refuse') return;
  assert.equal(checkResult.why.code, 'command-unavailable');
});

test('command refuses when execution exceeds its timeout', async () => {
  const checkResult = await runNode('setInterval(() => {}, 1_000)', { timeoutMs: 30 });

  assert.equal(checkResult.verdict, 'refuse');
  if (checkResult.verdict !== 'refuse') return;
  assert.equal(checkResult.why.code, 'command-timeout');
});

function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function eventually(condition: () => boolean, withinMs: number): Promise<boolean> {
  const deadline = Date.now() + withinMs;
  while (!condition() && Date.now() < deadline) await delay(20);
  return condition();
}

async function pidFrom(file: string): Promise<number> {
  const found = await eventually(() => {
    try { return Number(readFileSync(file, 'utf8')) > 0; } catch { return false; }
  }, 5_000);
  if (!found) throw new Error(`${file} was never written`);
  return Number(await readFile(file, 'utf8'));
}

function killQuietly(pid: number | undefined): void {
  if (pid === undefined) return;
  try { process.kill(pid, 'SIGKILL'); } catch {}
}

function stubbornDescendant(pidFile: string): string {
  return `process.on('SIGTERM', () => {}); require('node:fs').writeFileSync(${JSON.stringify(pidFile)}, String(process.pid)); setTimeout(() => {}, 10_000)`;
}

function parentOf(descendant: string, pidFile?: string): string {
  const record = pidFile ? `require('node:fs').writeFileSync(${JSON.stringify(pidFile)}, String(process.pid)); ` : '';
  return `${record}require('node:child_process').spawn(process.execPath, ['-e', ${JSON.stringify(descendant)}], { stdio: 'ignore' }); setTimeout(() => {}, 10_000)`;
}

test('command timeout terminates a SIGTERM-resistant descendant before the Check returns', async () => {
  await withWorkspace(async root => {
    const pidFile = join(root, 'descendant.pid');
    let descendant: number | undefined;
    try {
      const checkResult = await command({
        rule,
        command: process.execPath,
        args: ['-e', parentOf(stubbornDescendant(pidFile), undefined)],
        timeoutMs: 5_000,
      }).run({ root, rules: [rule.id] });

      assert.equal(checkResult.verdict, 'refuse');
      if (checkResult.verdict !== 'refuse') return;
      assert.equal(checkResult.why.code, 'command-timeout');
      descendant = await pidFrom(pidFile);
      assert.equal(await eventually(() => !processAlive(descendant!), 500), true, 'the descendant outlived the Check');
    } finally {
      killQuietly(descendant);
    }
  });
});

test('a parent SIGINT reaches a supervised command and its descendants', async () => {
  await withWorkspace(async root => {
    const childPidFile = join(root, 'child.pid');
    const descendantPidFile = join(root, 'descendant.pid');
    const child = parentOf(stubbornDescendant(descendantPidFile), childPidFile);
    const host = `import { executeCommand } from 'redproof/command'; await executeCommand({ command: process.execPath, args: ['-e', ${JSON.stringify(child)}], cwd: ${JSON.stringify(root)} });`;
    const hostProcess = spawn(process.execPath, ['--input-type=module', '-e', host], { cwd: process.cwd(), stdio: 'ignore', detached: true });
    const hostExit = new Promise<NodeJS.Signals | null>(resolve => hostProcess.once('exit', (_, signal) => resolve(signal)));
    let pids: number[] = [];
    try {
      pids = [await pidFrom(childPidFile), await pidFrom(descendantPidFile)];
      process.kill(-hostProcess.pid!, 'SIGINT');

      assert.equal(await hostExit, 'SIGINT');
      assert.equal(await eventually(() => pids.every(pid => !processAlive(pid)), 1_000), true, 'a command outlived its interrupted host');
    } finally {
      for (const pid of pids) killQuietly(pid);
      killQuietly(hostProcess.pid);
    }
  });
});

async function pidIfWritten(file: string): Promise<number | undefined> {
  const found = await eventually(() => {
    try { return Number(readFileSync(file, 'utf8')) > 0; } catch { return false; }
  }, 1_000);
  return found ? Number(await readFile(file, 'utf8')) : undefined;
}

function pipeHoldingDescendant(pidFile: string): string {
  return `require('node:fs').writeFileSync(${JSON.stringify(pidFile)}, String(process.pid)); setTimeout(() => {}, 10_000)`;
}

/** Spawn the descendant, wait until it has written its pid, then run `thenDo`. */
function parentWaitingFor(descendant: string, pidFile: string, stdio: string, thenDo: string): string {
  return `require('node:child_process').spawn(process.execPath, ['-e', ${JSON.stringify(descendant)}], { stdio: '${stdio}', detached: ${stdio === 'inherit'} }).unref(); const tick = () => { if (require('node:fs').existsSync(${JSON.stringify(pidFile)})) { ${thenDo} } else setTimeout(tick, 5); }; tick();`;
}

test('a timeout resolves even when a detached descendant keeps the output pipes', async () => {
  await withWorkspace(async root => {
    const pidFile = join(root, 'holder.pid');
    let holder: number | undefined;
    try {
      const started = Date.now();
      const checkResult = await command({
        rule,
        command: process.execPath,
        args: ['-e', parentWaitingFor(pipeHoldingDescendant(pidFile), pidFile, 'inherit', 'process.exit(0)')],
        timeoutMs: 3_000,
      }).run({ root, rules: [rule.id] });
      holder = await pidIfWritten(pidFile);

      assert.equal(checkResult.verdict, 'refuse');
      if (checkResult.verdict !== 'refuse') return;
      assert.equal(checkResult.why.code, 'command-timeout');
      assert.ok(Date.now() - started < 6_000, 'the Check waited for the descendant instead of the timeout');
    } finally {
      killQuietly(holder);
    }
  });
});

test('a signalled command resolves without a timeout when a detached descendant keeps the output pipes', async () => {
  await withWorkspace(async root => {
    const pidFile = join(root, 'holder.pid');
    let holder: number | undefined;
    try {
      const started = Date.now();
      const checkResult = await command({
        rule,
        command: process.execPath,
        args: ['-e', parentWaitingFor(pipeHoldingDescendant(pidFile), pidFile, 'inherit', "process.kill(process.pid, 'SIGTERM')")],
      }).run({ root, rules: [rule.id] });
      holder = await pidIfWritten(pidFile);

      assert.equal(checkResult.verdict, 'refuse');
      if (checkResult.verdict !== 'refuse') return;
      assert.equal(checkResult.why.code, 'command-signaled');
      assert.ok(Date.now() - started < 6_000, 'the Check waited for the descendant instead of the signal');
    } finally {
      killQuietly(holder);
    }
  });
});

test('a signal that arrives before the timeout keeps its own refusal code', async () => {
  await withWorkspace(async root => {
    const pidFile = join(root, 'descendant.pid');
    let descendant: number | undefined;
    try {
      const timeoutMs = 5_000;
      const signalAt = Date.now() + timeoutMs - 150;
      const checkResult = await command({
        rule,
        command: process.execPath,
        args: ['-e', parentWaitingFor(stubbornDescendant(pidFile), pidFile, 'ignore', `if (Date.now() >= ${signalAt}) process.kill(process.pid, 'SIGTERM'); else setTimeout(tick, 5);`)],
        timeoutMs,
      }).run({ root, rules: [rule.id] });
      descendant = await pidIfWritten(pidFile);

      assert.equal(checkResult.verdict, 'refuse');
      if (checkResult.verdict !== 'refuse') return;
      assert.equal(checkResult.why.code, 'command-signaled');
    } finally {
      killQuietly(descendant);
    }
  });
});

test('command refuses when execution is terminated by a signal', async () => {
  const checkResult = await runNode("process.kill(process.pid, 'SIGTERM')");

  assert.equal(checkResult.verdict, 'refuse');
  if (checkResult.verdict !== 'refuse') return;
  assert.equal(checkResult.why.code, 'command-signaled');
});

test('command refuses when combined output exceeds its bound', async () => {
  const checkResult = await runNode("process.stdout.write('x'.repeat(1_024))", {
    maxOutputBytes: 32,
  });

  assert.equal(checkResult.verdict, 'refuse');
  if (checkResult.verdict !== 'refuse') return;
  assert.equal(checkResult.why.code, 'command-output-limit');
  assert.match(checkResult.why.detail ?? '', new RegExp(`stdout:\\n${'x'.repeat(32)}`));
});

test('command refuses a working directory outside the Gate root', async () => {
  const checkResult = await runNode('process.exit(0)', { cwd: '..' });

  assert.equal(checkResult.verdict, 'refuse');
  if (checkResult.verdict !== 'refuse') return;
  assert.equal(checkResult.why.code, 'command-cwd-outside-root');
});

test('command resolves cwd inside the Gate root and merges environment overrides', async () => {
  await withWorkspace(async root => {
    const cwd = join(root, 'nested');
    await mkdir(cwd);
    const checkResult = await command({
      rule,
      command: process.execPath,
      args: [
        '-e',
        "if (!process.cwd().endsWith('nested') || process.env.GUARDRAIL !== 'enabled') process.exit(1)",
      ],
      cwd: 'nested',
      env: { GUARDRAIL: 'enabled' },
    }).run({ root, rules: [rule.id] });

    assert.equal(checkResult.verdict, 'pass');
  });
});

test('command validates ambiguous and unsafe options at composition time', () => {
  assert.throws(
    () => command({ rule, command: process.execPath, exitCodes: { pass: [0, 1], breach: [1] } }),
    /cannot produce both PASS and a Breach/,
  );
  assert.throws(
    () => command({ rule, command: process.execPath, timeoutMs: 0 }),
    /timeoutMs must be a positive integer/,
  );
  assert.throws(
    () => command({ rule, command: ' ' }),
    /command must not be empty/,
  );
});

test('commands runs sequential entries in declaration order', async () => {
  await withWorkspace(async root => {
    const append = (value: string): CommandCheckOptions<typeof rule.id> => ({
      rule,
      command: process.execPath,
      args: ['-e', `require('node:fs').appendFileSync('order.txt', '${value}')`],
    });
    const checkResult = await commands({
      entries: [append('A'), append('B')],
    }).run({ root, rules: [rule.id] });

    assert.equal(checkResult.verdict, 'pass');
    assert.equal(await readFile(join(root, 'order.txt'), 'utf8'), 'AB');
    assert.equal(checkResult.scan.inspected, 2);
  });
});

test('commands stops sequential execution when an entry refuses', async () => {
  await withWorkspace(async root => {
    const checkResult = await commands({
      entries: [
        { rule, command: 'redproof-command-that-does-not-exist', label: 'missing' },
        {
          rule,
          command: process.execPath,
          args: ['-e', "require('node:fs').writeFileSync('should-not-exist.txt', '')"],
        },
      ],
    }).run({ root, rules: [rule.id] });

    assert.equal(checkResult.verdict, 'refuse');
    assert.equal(checkResult.scan.inspected, 1);
    await assert.rejects(readFile(join(root, 'should-not-exist.txt')));
  });
});

test('commands starts entries concurrently in parallel mode', async () => {
  await withWorkspace(async root => {
    const rendezvous = `
      const { existsSync, writeFileSync } = require('node:fs');
      const [own, other] = process.argv.slice(1);
      writeFileSync(own, '');
      const deadline = Date.now() + 2_000;
      const timer = setInterval(() => {
        if (existsSync(other)) process.exit(0);
        if (Date.now() > deadline) process.exit(1);
      }, 10);
    `;
    const checkResult = await commands({
      mode: 'parallel',
      maxAtOnce: 2,
      entries: [
        { rule, command: process.execPath, args: ['-e', rendezvous, 'a.started', 'b.started'] },
        { rule, command: process.execPath, args: ['-e', rendezvous, 'b.started', 'a.started'] },
      ],
    }).run({ root, rules: [rule.id] });

    assert.equal(checkResult.verdict, 'pass');
    assert.equal(checkResult.scan.inspected, 2);
  });
});

test('commands respects the parallel maxAtOnce bound', async () => {
  await withWorkspace(async root => {
    const checkResult = await commands({
      mode: 'parallel',
      maxAtOnce: 1,
      entries: [
        {
          rule,
          command: process.execPath,
          args: [
            '-e',
            "setTimeout(() => require('node:fs').appendFileSync('bounded.txt', 'A'), 80)",
          ],
        },
        {
          rule,
          command: process.execPath,
          args: ['-e', "require('node:fs').appendFileSync('bounded.txt', 'B')"],
        },
      ],
    }).run({ root, rules: [rule.id] });

    assert.equal(checkResult.verdict, 'pass');
    assert.equal(await readFile(join(root, 'bounded.txt'), 'utf8'), 'AB');
  });
});

test('commands keeps parallel Breaches in declaration order', async () => {
  await withWorkspace(async root => {
    const checkResult = await commands({
      mode: 'parallel',
      maxAtOnce: 2,
      entries: [
        {
          rule,
          label: 'slow first',
          command: process.execPath,
          args: ['-e', 'setTimeout(() => process.exit(1), 60)'],
        },
        {
          rule: secondRule,
          label: 'fast second',
          command: process.execPath,
          args: ['-e', 'process.exit(1)'],
        },
      ],
    }).run({ root, rules: [rule.id, secondRule.id] });

    assert.equal(checkResult.verdict, 'fail');
    if (checkResult.verdict !== 'fail') return;
    assert.deepEqual(
      checkResult.breaches.map(item => [item.rule, item.message]),
      [
        [rule.id, 'slow first exited with code 1.'],
        [secondRule.id, 'fast second exited with code 1.'],
      ],
    );
  });
});

test('commands makes REFUSE dominate parallel Breaches', async () => {
  await withWorkspace(async root => {
    const checkResult = await commands({
      mode: 'parallel',
      entries: [
        { rule, command: process.execPath, args: ['-e', 'process.exit(1)'] },
        { rule: secondRule, command: 'redproof-command-that-does-not-exist' },
      ],
    }).run({ root, rules: [rule.id, secondRule.id] });

    assert.equal(checkResult.verdict, 'refuse');
    if (checkResult.verdict !== 'refuse') return;
    assert.equal(checkResult.why.code, 'command-unavailable');
  });
});

test('commands validates its execution policy at composition time', () => {
  assert.throws(
    () => commands({ entries: [] as never }),
    /requires at least one entry/,
  );
  assert.throws(
    () => commands({ mode: 'parallel', maxAtOnce: 0, entries: [{ rule, command: 'node' }] }),
    /maxAtOnce must be a positive integer/,
  );
});

test('a command Check describes the real invocation, not an absolute path', () => {
  const rule = defineRule({ id: 'probe/lint', description: 'Lint must pass.' });
  const check = command({ rule, command: '/usr/local/bin/npm', args: ['run', 'lint'] });

  assert.equal(check.description, 'run npm run lint');
  assert.doesNotMatch(check.description, /\//, 'a description must not carry a machine path');
});

test('a command group names the commands it will run', () => {
  const lint = defineRule({ id: 'probe/lint', description: 'Lint must pass.' });
  const types = defineRule({ id: 'probe/types', description: 'Types must pass.' });

  const check = commands({
    mode: 'parallel',
    maxAtOnce: 2,
    entries: [
      { rule: lint, command: 'npm', args: ['run', 'lint'], label: 'lint' },
      { rule: types, command: '/usr/local/bin/tsc', args: ['--noEmit'] },
    ],
  });

  assert.equal(check.description, 'run 2 commands: lint, tsc');
});

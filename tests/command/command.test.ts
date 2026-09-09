import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { command, commands, executeCommand, type CommandCheckOptions } from 'redproof/command';
import { PIPE_RELEASE_GRACE_MS } from '../../packages/redproof/src/command/shell/spawn.ts';
import { defineRule } from 'redproof';
import { withWorkspace } from '../helpers/workspace.ts';

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

/** Records its pid, ignores SIGTERM, and lives 10 s. */
function stubbornDescendant(pidFile: string): string {
  return `process.on('SIGTERM', () => {}); require('node:fs').writeFileSync(${JSON.stringify(pidFile)}, String(process.pid)); setTimeout(() => {}, 10_000)`;
}

/** Records its pid and lives 10 s; when spawned with inherited stdio it keeps the command's output pipes open. */
function pipeHoldingDescendant(pidFile: string): string {
  return `require('node:fs').writeFileSync(${JSON.stringify(pidFile)}, String(process.pid)); setTimeout(() => {}, 10_000)`;
}

/** Records its own pid, spawns the descendant in its own process group, and lives 10 s. */
function parentOf(descendant: string, pidFile: string): string {
  return `require('node:fs').writeFileSync(${JSON.stringify(pidFile)}, String(process.pid)); require('node:child_process').spawn(process.execPath, ['-e', ${JSON.stringify(descendant)}], { stdio: 'ignore' }); setTimeout(() => {}, 10_000)`;
}

/** Spawn the descendant, wait until it has written its pid, then run `thenDo`. A detached descendant starts its own session. */
function parentWaitingFor(
  descendant: string,
  pidFile: string,
  stdio: 'ignore' | 'inherit',
  thenDo: string,
  detached = stdio === 'inherit',
): string {
  return `require('node:child_process').spawn(process.execPath, ['-e', ${JSON.stringify(descendant)}], { stdio: '${stdio}', detached: ${detached} }).unref(); const tick = () => { if (require('node:fs').existsSync(${JSON.stringify(pidFile)})) { ${thenDo} } else setTimeout(tick, 5); }; tick();`;
}

test('executeCommand returns the raw exit code and both captured streams without applying Gate policy', async () => {
  await withWorkspace(async root => {
    const execution = await executeCommand({
      command: process.execPath,
      args: ['-e', "process.stdout.write('structured'); process.stderr.write('warning'); process.exit(3)"],
      cwd: root,
    });

    assert.deepEqual(execution, {
      kind: 'completed',
      exitCode: 3,
      stdout: 'structured',
      stderr: 'warning',
    });
  });
});

test('bad options throw at composition time, before any process starts', () => {
  assert.throws(
    () => command({ rule, command: process.execPath, exitCodes: { pass: [0, 1], breach: [1] } }),
    /cannot produce both PASS and a Breach/,
  );
  assert.throws(
    () => commands({ mode: 'parallel', maxAtOnce: 0, entries: [{ rule, command: process.execPath }] }),
    /maxAtOnce must be a positive integer/,
  );
  assert.throws(
    () => executeCommand({ command: process.execPath, cwd: '.' }),
    /executeCommand cwd must be absolute/,
  );
});

test('command maps exit zero to PASS and counts one inspected target', async () => {
  const checkResult = await runNode("process.stdout.write('captured output')");

  assert.equal(checkResult.verdict, 'pass');
  assert.equal(checkResult.scan.inspected, 1);
});

test('command maps a nonzero exit to a Breach of its Rule that carries the captured output', async () => {
  const checkResult = await runNode(
    "process.stdout.write('out'); process.stderr.write('err'); process.exit(3)",
    { label: 'guardrail' },
  );

  assert.equal(checkResult.verdict, 'fail');
  if (checkResult.verdict !== 'fail') return;
  assert.equal(checkResult.breaches.length, 1);
  assert.equal(checkResult.breaches[0].rule, rule.id);
  assert.equal(checkResult.breaches[0].code, 'command-exit');
  assert.equal(checkResult.breaches[0].message, 'guardrail exited with code 3.');
  assert.equal(checkResult.breaches[0].detail, 'exit code: 3\n\nstdout:\nout\n\nstderr:\nerr');
});

test('command applies an explicit exit-code policy, so an unlisted code is REFUSE', async () => {
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
    label: 'missing tool',
  }).run({ root, rules: [rule.id] }));

  assert.equal(checkResult.verdict, 'refuse');
  if (checkResult.verdict !== 'refuse') return;
  assert.equal(checkResult.why.code, 'command-unavailable');
  assert.equal(checkResult.why.message, 'Could not start missing tool.');
});

test('command refuses when the process outlives its timeout', async () => {
  const checkResult = await runNode('setInterval(() => {}, 1_000)', { timeoutMs: 30, label: 'hang' });

  assert.equal(checkResult.verdict, 'refuse');
  if (checkResult.verdict !== 'refuse') return;
  assert.equal(checkResult.why.code, 'command-timeout');
  assert.equal(checkResult.why.message, 'hang exceeded its 30ms timeout.');
});

test('command refuses when a signal terminates the process', async () => {
  const checkResult = await runNode("process.kill(process.pid, 'SIGTERM')", { label: 'signalled' });

  assert.equal(checkResult.verdict, 'refuse');
  if (checkResult.verdict !== 'refuse') return;
  assert.equal(checkResult.why.code, 'command-signaled');
  assert.equal(checkResult.why.message, 'signalled was terminated by SIGTERM.');
});

test('command refuses when combined output exceeds its bound, and keeps only the bytes within it', async () => {
  const checkResult = await runNode("process.stdout.write('x'.repeat(1_024))", {
    maxOutputBytes: 32,
  });

  assert.equal(checkResult.verdict, 'refuse');
  if (checkResult.verdict !== 'refuse') return;
  assert.equal(checkResult.why.code, 'command-output-limit');
  assert.equal(checkResult.why.detail, `stdout:\n${'x'.repeat(32)}`);
});

test('a timeout stops a SIGTERM-resistant descendant before the Check returns', async () => {
  await withWorkspace(async root => {
    const pidFile = join(root, 'descendant.pid');
    let descendant: number | undefined;
    try {
      const checkResult = await command({
        rule,
        command: process.execPath,
        args: ['-e', parentWaitingFor(stubbornDescendant(pidFile), pidFile, 'ignore', 'setTimeout(() => {}, 10_000)')],
        timeoutMs: 2_000,
      }).run({ root, rules: [rule.id] });
      descendant = await pidFrom(pidFile);

      assert.equal(checkResult.verdict, 'refuse');
      if (checkResult.verdict !== 'refuse') return;
      assert.equal(checkResult.why.code, 'command-timeout');
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

test('a host that exits takes a supervised command and its descendants with it', async () => {
  await withWorkspace(async root => {
    const childPidFile = join(root, 'child.pid');
    const descendantPidFile = join(root, 'descendant.pid');
    const child = parentOf(stubbornDescendant(descendantPidFile), childPidFile);
    const host = `import { executeCommand } from 'redproof/command'; import { existsSync } from 'node:fs'; void executeCommand({ command: process.execPath, args: ['-e', ${JSON.stringify(child)}], cwd: ${JSON.stringify(root)} }); const tick = () => { if (existsSync(${JSON.stringify(descendantPidFile)})) process.exit(0); else setTimeout(tick, 5); }; tick();`;
    const hostProcess = spawn(process.execPath, ['--input-type=module', '-e', host], { cwd: process.cwd(), stdio: 'ignore' });
    const hostExit = new Promise<number | null>(resolve => hostProcess.once('exit', code => resolve(code)));
    let pids: number[] = [];
    try {
      assert.equal(await hostExit, 0);
      pids = [await pidFrom(childPidFile), await pidFrom(descendantPidFile)];

      assert.equal(await eventually(() => pids.every(pid => !processAlive(pid)), 1_000), true, 'a command outlived its exited host');
    } finally {
      for (const pid of pids) killQuietly(pid);
    }
  });
});

test('a timeout returns while a detached descendant still holds the output pipes', async () => {
  await withWorkspace(async root => {
    const pidFile = join(root, 'holder.pid');
    let holder: number | undefined;
    try {
      const checkResult = await command({
        rule,
        command: process.execPath,
        args: ['-e', parentWaitingFor(pipeHoldingDescendant(pidFile), pidFile, 'inherit', 'setTimeout(() => {}, 10_000)')],
        timeoutMs: 1_500,
      }).run({ root, rules: [rule.id] });
      holder = await pidFrom(pidFile);

      assert.equal(checkResult.verdict, 'refuse');
      if (checkResult.verdict !== 'refuse') return;
      assert.equal(checkResult.why.code, 'command-timeout');
      assert.equal(processAlive(holder), true, 'the Check waited for the pipe holder instead of the timeout');
    } finally {
      killQuietly(holder);
    }
  });
});

test('a signalled command returns while a detached descendant still holds the output pipes', async () => {
  await withWorkspace(async root => {
    const pidFile = join(root, 'holder.pid');
    let holder: number | undefined;
    try {
      const checkResult = await command({
        rule,
        command: process.execPath,
        args: ['-e', parentWaitingFor(pipeHoldingDescendant(pidFile), pidFile, 'inherit', "process.kill(process.pid, 'SIGTERM')")],
      }).run({ root, rules: [rule.id] });
      holder = await pidFrom(pidFile);

      assert.equal(checkResult.verdict, 'refuse');
      if (checkResult.verdict !== 'refuse') return;
      assert.equal(checkResult.why.code, 'command-signaled');
      assert.equal(processAlive(holder), true, 'the Check waited for the pipe holder instead of the signal');
    } finally {
      killQuietly(holder);
    }
  });
});

test('a normal exit keeps its verdict while a detached descendant still holds the output pipes', async () => {
  await withWorkspace(async root => {
    const pidFile = join(root, 'holder.pid');
    let holder: number | undefined;
    try {
      const checkResult = await command({
        rule,
        command: process.execPath,
        args: ['-e', parentWaitingFor(pipeHoldingDescendant(pidFile), pidFile, 'inherit', 'process.exit(0)')],
      }).run({ root, rules: [rule.id] });
      holder = await pidFrom(pidFile);

      assert.equal(checkResult.verdict, 'pass');
      assert.equal(processAlive(holder), true, 'the Check waited for the pipe holder instead of the exit');
    } finally {
      killQuietly(holder);
    }
  });
});

test('a direct exit before its deadline is not rewritten as a timeout while the pipes are released', async () => {
  await withWorkspace(async root => {
    const pidFile = join(root, 'holder.pid');
    let holder: number | undefined;
    try {
      const timeoutMs = 2_000;
      // The deadline must land inside the pipe-release grace, or the bug cannot show.
      const exitAt = Date.now() + timeoutMs - Math.round(PIPE_RELEASE_GRACE_MS / 2);
      const started = Date.now();
      const checkResult = await command({
        rule,
        command: process.execPath,
        args: ['-e', parentWaitingFor(
          pipeHoldingDescendant(pidFile),
          pidFile,
          'inherit',
          `if (Date.now() >= ${exitAt}) process.exit(0); else setTimeout(tick, 5);`,
        )],
        timeoutMs,
      }).run({ root, rules: [rule.id] });
      holder = await pidFrom(pidFile);

      assert.equal(checkResult.verdict, 'pass');
      assert.ok(Date.now() - started < timeoutMs + 2_000, 'the Check waited for the pipe holder instead of releasing');
      assert.equal(processAlive(holder), true, 'the Check stopped a holder that was outside its group');
    } finally {
      killQuietly(holder);
    }
  });
});

test('a parent signal during pipe release still reaches the surviving command group', async () => {
  await withWorkspace(async root => {
    const childPidFile = join(root, 'child.pid');
    const descendantPidFile = join(root, 'descendant.pid');
    const signalFile = join(root, 'descendant.signal');
    const descendant = [
      `process.on('SIGINT', () => { require('node:fs').writeFileSync(${JSON.stringify(signalFile)}, 'SIGINT'); process.exit(0); });`,
      `process.on('SIGTERM', () => { require('node:fs').writeFileSync(${JSON.stringify(signalFile)}, 'SIGTERM'); process.exit(0); });`,
      pipeHoldingDescendant(descendantPidFile),
    ].join(' ');
    const child = [
      `require('node:fs').writeFileSync(${JSON.stringify(childPidFile)}, String(process.pid));`,
      parentWaitingFor(descendant, descendantPidFile, 'inherit', 'process.exit(0)', false),
    ].join(' ');
    const host = `import { executeCommand } from 'redproof/command'; await executeCommand({ command: process.execPath, args: ['-e', ${JSON.stringify(child)}], cwd: ${JSON.stringify(root)} });`;
    const hostProcess = spawn(process.execPath, ['--input-type=module', '-e', host], { cwd: process.cwd(), stdio: 'ignore', detached: true });
    const hostExit = new Promise<NodeJS.Signals | null>(resolve => hostProcess.once('exit', (_, signal) => resolve(signal)));
    let pids: number[] = [];
    try {
      pids = [await pidFrom(childPidFile), await pidFrom(descendantPidFile)];
      assert.equal(await eventually(() => !processAlive(pids[0]!), 1_000), true, 'the direct command never exited');
      assert.equal(processAlive(hostProcess.pid!), true, 'the host settled before the pipes were released');
      process.kill(-hostProcess.pid!, 'SIGINT');

      assert.equal(await hostExit, 'SIGINT');
      assert.equal(await eventually(() => {
        try { return readFileSync(signalFile, 'utf8').length > 0; } catch { return false; }
      }, 1_000), true, 'the descendant received no signal at all');
      assert.equal(readFileSync(signalFile, 'utf8'), 'SIGINT', 'the descendant was stopped by a group kill, not the host signal');
      assert.equal(await eventually(() => !processAlive(pids[1]!), 1_000), true, 'the descendant outlived its interrupted host');
    } finally {
      for (const pid of pids) killQuietly(pid);
      killQuietly(hostProcess.pid);
    }
  });
});

test('command refuses a working directory that resolves outside the Gate root', async () => {
  const checkResult = await runNode('process.exit(0)', { cwd: '..' });

  assert.equal(checkResult.verdict, 'refuse');
  if (checkResult.verdict !== 'refuse') return;
  assert.equal(checkResult.why.code, 'command-cwd-outside-root');
});

test('command runs in the resolved working directory with the merged environment', async () => {
  await withWorkspace(async root => {
    const cwd = join(root, 'nested');
    await mkdir(cwd);
    const checkResult = await command({
      rule,
      command: process.execPath,
      args: [
        '-e',
        "if (!process.cwd().endsWith('nested') || process.env.GUARDRAIL !== 'enabled' || !process.env.PATH) process.exit(1)",
      ],
      cwd: 'nested',
      env: { GUARDRAIL: 'enabled' },
    }).run({ root, rules: [rule.id] });

    assert.equal(checkResult.verdict, 'pass');
  });
});

test('commands runs sequential entries in declaration order and counts each one', async () => {
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

test('commands stops sequential execution at the first REFUSE', async () => {
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
    if (checkResult.verdict !== 'refuse') return;
    assert.equal(checkResult.why.code, 'command-unavailable');
    assert.equal(checkResult.scan.inspected, 1);
    await assert.rejects(readFile(join(root, 'should-not-exist.txt')));
  });
});

test('commands starts parallel entries together', async () => {
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

test('commands runs no more than maxAtOnce parallel entries at a time', async () => {
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

test('commands keeps parallel Breaches in declaration order even when they finish out of order', async () => {
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

test('a Check describes itself from its command line, by base name', () => {
  const lint = defineRule({ id: 'probe/lint', description: 'Lint must pass.' });
  const types = defineRule({ id: 'probe/types', description: 'Types must pass.' });

  assert.equal(command({ rule: lint, command: '/usr/local/bin/npm', args: ['run', 'lint'] }).description, 'run npm run lint');
  assert.equal(commands({
    mode: 'parallel',
    entries: [
      { rule: lint, command: 'npm', args: ['run', 'lint'], label: 'lint' },
      { rule: types, command: '/usr/local/bin/tsc', args: ['--noEmit'] },
    ],
  }).description, 'run 2 commands: lint, tsc');
});

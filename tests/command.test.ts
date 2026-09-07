import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { command, type CommandCheckOptions } from 'redproof/command';
import { defineRule } from 'redproof';
import { withWorkspace } from './helpers/workspace.ts';

const rule = defineRule({
  id: 'command/succeeds',
  description: 'The command must succeed.',
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

import assert from 'node:assert/strict';
import test from 'node:test';
import { mypy } from '../src/index.ts';
import { chmod, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { closureOf, readFixture, scriptedPython, withFiles } from './support/workspace.ts';

/**
 * Runs that did not finish, through the whole shell with a stand-in interpreter: none may PASS, and none may be
 * mistaken for a clean run just because the report so far looks empty.
 */
const probe = async (root: string): Promise<string> => (await readFixture('probe-clean.json')).replaceAll('<ROOT>', root);
const row = JSON.stringify({ file: 'a.py', line: 1, column: 0, message: 'm', hint: null, code: 'assignment', severity: 'error' });

async function verdictOf(body: string, extra: Record<string, unknown> = {}): Promise<{ verdict: string; code?: string }> {
  return withFiles({ 'a.py': 'x: int = 1\n' }, async root => {
    const command = await scriptedPython(root, await probe(root), body);
    const adapter = mypy({ rules: { a: 'assignment' }, python: command, pythonVersion: '3.13', platform: 'linux', ...extra } as never) as unknown as { check: { run: (ctx: { root: string; rules: string[] }) => Promise<{ verdict: string; why: { code: string } }> } };
    const result = await adapter.check.run({ root, rules: ['mypy/assignment'] });
    return result.verdict === 'refuse' ? { verdict: 'refuse', code: result.why.code } : { verdict: result.verdict };
  });
}

const cases: ReadonlyArray<readonly [string, string, string, Record<string, unknown>?]> = [
  ['killed by SIGKILL with an empty report', "process.kill(process.pid, 'SIGKILL');", 'command-signaled'],
  ['killed after printing half a finding', `process.stdout.write(${JSON.stringify(row.slice(0, 30))}); process.kill(process.pid, 'SIGKILL');`, 'command-signaled'],
  ['exit 137 reported as a plain code', 'process.exit(137);', 'mypy-unsuccessful'],
  ['a traceback and exit 1', "process.stderr.write('Traceback (most recent call last):\\n'); process.exit(1);", 'mypy-unexpected-stderr'],
  ['a traceback and exit 2', "process.stderr.write('Traceback (most recent call last):\\n'); process.exit(2);", 'mypy-crashed'],
  ['an internal error banner and exit 2', "process.stdout.write('a.py: error: INTERNAL ERROR\\n'); process.exit(2);", 'mypy-crashed'],
  ['exit 0 after a partial report', `process.stdout.write(${JSON.stringify(row.slice(0, 30))}); process.exit(0);`, 'mypy-report-unavailable'],
  ['exit 1 after a partial report', `process.stdout.write(${JSON.stringify(row.slice(0, 30))}); process.exit(1);`, 'mypy-report-unavailable'],
  ['an unknown exit code', 'process.exit(42);', 'mypy-unsuccessful'],
  ['a hang', 'setInterval(() => undefined, 1000);', 'command-timeout', { timeoutMs: 400 }],
  ['a flood of output', "setInterval(() => process.stdout.write('x'.repeat(100000)), 1);", 'command-output-limit', { maxOutputBytes: 500_000 }],
  ['a clean run that wrote warnings to stderr', "process.stderr.write('warning: something\\n'); process.exit(0);", 'mypy-unexpected-stderr'],
];
for (const [name, body, code, extra] of cases) {
  test(`REFUSE, never PASS: ${name}`, async () => {
    assert.deepEqual(await verdictOf(body, extra), { verdict: 'refuse', code });
  });
}

test('control: the same stand-in, finishing cleanly, passes', async () => {
  assert.deepEqual(await verdictOf('process.exit(0);'), { verdict: 'pass' });
});

test('control: the same stand-in, finishing with a finding, fails', async () => {
  assert.deepEqual(await verdictOf(`process.stdout.write(${JSON.stringify(row + '\n')}); process.exit(1);`), { verdict: 'fail' });
});

test('a probe, or the closure probe, that is killed REFUSES before the check runs', async () => {
  for (const victim of ['"kind": "facts"', '"kind": "closure"']) {
    await withFiles({ 'a.py': 'x: int = 1\n' }, async root => {
      const file = join(root, 'killer.mjs');
      const probeText = (await probe(root));
      await writeFile(file, `#!/usr/bin/env node
const args = process.argv.slice(2);
if (args.includes('-c')) {
  const closure = args[args.indexOf('-c') + 1].includes('"kind": "closure"');
  if (closure === (${JSON.stringify(victim)}.includes('closure'))) process.kill(process.pid, 'SIGKILL');
  process.stdout.write(closure ? ${JSON.stringify(closureOf(root))} : ${JSON.stringify(probeText)});
  process.exit(0);
}
process.exit(0);
`);
      await chmod(file, 0o755);
      const adapter = mypy({ rules: { a: 'assignment' }, python: file, pythonVersion: '3.13', platform: 'linux' });
      const result = await adapter.check.run({ root, rules: ['mypy/assignment'] });
      assert.equal(result.verdict, 'refuse', victim);
      if (result.verdict === 'refuse') assert.equal(result.why.code, 'command-signaled');
    });
  }
});

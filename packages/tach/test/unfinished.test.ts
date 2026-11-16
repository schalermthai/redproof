import assert from 'node:assert/strict';
import test from 'node:test';
import { defineGate, runGate } from 'redproof';
import { tach, type TachRuleKind } from '../src/index.ts';
import { projects } from './support/projects.ts';
import { nativeTest, readFixture, scriptedTach, tachBinary, withProject, withFiles } from './support/workspace.ts';

// A run that did not finish must never PASS. Every case goes through runGate with each rule selected alone.
const KINDS: readonly TachRuleKind[] = ['undeclared-dependency', 'forbidden-dependency', 'deprecated-dependency', 'layer-violation',
  'interface-violation', 'ignore-directive', 'circular-dependency', 'visibility-violation'];

async function gate(root: string, kind: TachRuleKind, command: string, extra: object = {}) {
  const adapter = tach({ rules: { only: kind }, command, allowInactiveRules: true, allowIgnoredSources: true, ...extra } as never);
  return runGate(defineGate({ id: `unfinished-${kind}`, adapter: adapter as never }), root);
}
async function refusesEveryRule(body: string, code: string | readonly string[], extra: object = {}): Promise<void> {
  await withFiles({ ...projects.ok, 'tach.toml': `forbid_circular_dependencies = true\n${projects.ok['tach.toml']}` }, async root => {
    const command = await scriptedTach(root, body);
    for (const kind of KINDS) {
      const result = await gate(root, kind, command, extra);
      assert.equal(result.verdict, 'refuse', `${kind}: ${JSON.stringify(result)}`);
      if (result.verdict === 'refuse') assert.ok([code].flat().includes(result.why.code), `${kind}: ${result.why.code}`);
    }
  });
}

const real = await readFixture('undeclared.report.json');
const unfinished: ReadonlyArray<readonly [string, string, string | readonly string[], object?]> = [
  ['killed by SIGKILL (exit 137 from the shell, a signal from node)', `process.kill(process.pid, 'SIGKILL');`, ['command-signaled', 'tach-unsuccessful']],
  ['exits 137 with an empty report', `process.exit(137);`, 'tach-unsuccessful'],
  ['exits 137 with a complete clean report', `process.stdout.write('[]'); process.exit(137);`, 'tach-unsuccessful'],
  ['a Python traceback, exit 1, nothing on stdout', `process.stderr.write('Traceback (most recent call last):\\nRuntimeError'); process.exit(1);`, 'tach-report-unavailable'],
  ['a Python traceback, exit 0, nothing on stdout', `process.stderr.write('Traceback (most recent call last):'); process.exit(0);`, 'tach-report-unavailable'],
  ['a crash after printing half a report', `process.stdout.write(${JSON.stringify(real.slice(0, real.length >> 1))}); process.exit(1);`, 'tach-report-unavailable'],
  ['a clean-looking but truncated array', `process.stdout.write('['); process.exit(0);`, 'tach-report-unavailable'],
  ['exit 0 with empty output', `process.exit(0);`, 'tach-report-unavailable'],
  ['exit 0 with whitespace only', `process.stdout.write('  \\n'); process.exit(0);`, 'tach-report-unavailable'],
  ['exit 2 (usage error) with a clean report', `process.stdout.write('[]'); process.exit(2);`, 'tach-unsuccessful'],
  ['exit 3, 126, 127, 255 are not findings', `process.stdout.write('[]'); process.exit(255);`, 'tach-unsuccessful'],
  ['a generic error object with exit 1', `process.stdout.write('{"error": "boom"}'); process.exit(1);`, 'tach-error'],
  ['a generic error object with exit 0', `process.stdout.write('{"error": "boom"}'); process.exit(0);`, 'tach-error'],
  ['a report that is a JSON null', `process.stdout.write('null'); process.exit(0);`, 'tach-report-unavailable'],
  ['a report that is a string', `process.stdout.write('"ok"'); process.exit(0);`, 'tach-report-unavailable'],
  ['nothing to inspect: only NoFirstPartyImportsFound', `process.stdout.write(${JSON.stringify(JSON.stringify([{ Global: { severity: 'Warning', details: { Configuration: { NoFirstPartyImportsFound: [] } } } }]))}); process.exit(0);`, 'tach-configuration-diagnostic'],
  ['output limit exceeded', `process.stdout.write('x'.repeat(5000)); process.exit(0);`, 'command-output-limit', { maxOutputBytes: 1000 }],
  ['timeout', `setTimeout(() => {}, 60000);`, 'command-timeout', { timeoutMs: 300 }],
];
for (const [name, body, code, extra] of unfinished) {
  test(`unfinished run, every rule alone REFUSES: ${name}`, () => refusesEveryRule(body, code, extra));
}

test('a version probe that is killed or timed out REFUSES before any check runs', () => withProject('ok', async root => {
  const { writeFile, chmod } = await import('node:fs/promises');
  const file = `${root}/hung-version.mjs`;
  await writeFile(file, `#!/usr/bin/env node\nsetTimeout(() => {}, 60000);\n`);
  await chmod(file, 0o755);
  const result = await gate(root, 'layer-violation', file, { timeoutMs: 300 });
  assert.equal(result.verdict, 'refuse');
  if (result.verdict === 'refuse') assert.equal(result.why.code, 'command-timeout');
}));

test('a project directory that vanished REFUSES', () => withFiles({}, async root => {
  const result = await gate(root, 'layer-violation', 'tach', { cwd: 'gone' });
  assert.equal(result.verdict, 'refuse');
}));

const t = nativeTest(test);
t('real tach: a project whose exclude removes every file REFUSES for every rule (nothing was inspected)', () => withFiles({
  ...projects.undeclared, 'tach.toml': `forbid_circular_dependencies = true\nexclude = ["src"]\n${projects.undeclared['tach.toml']}`,
}, async root => {
  for (const kind of KINDS) {
    const result = await gate(root, kind, tachBinary, { allowIgnoredSources: false, allowInactiveRules: true });
    assert.equal(result.verdict, 'refuse', kind);
    if (result.verdict === 'refuse') assert.equal(result.why.code, 'tach-configuration-diagnostic');
  }
}));

t('real tach: a real timeout against real tach REFUSES, never passes', () => withProject('ok', async root => {
  const result = await gate(root, 'layer-violation', tachBinary, { timeoutMs: 1 });
  assert.equal(result.verdict, 'refuse');
}));

const hidden = { ...projects.ok, 'tach.toml': `forbid_circular_dependencies = true\n${projects.ok['tach.toml']}` };
t('real tach: a file tach cannot decode is skipped with a warning and exit 0, so every rule REFUSES', () => withFiles({
  ...hidden, 'src/a/latin.py': 'from c import y\n',
}, async root => {
  const { writeFile } = await import('node:fs/promises');
  await writeFile(`${root}/src/a/latin.py`, Buffer.from([0xff, 0xfe, 0x0a, ...Buffer.from('from c import y\n')]));
  for (const kind of KINDS) {
    const result = await gate(root, kind, tachBinary, { allowIgnoredSources: false, allowInactiveRules: true });
    assert.equal(result.verdict, 'refuse', `${kind}: ${JSON.stringify(result)}`);
    if (result.verdict === 'refuse') assert.equal(result.why.code, 'tach-configuration-diagnostic');
  }
}));

t('real tach: a source root that does not exist REFUSES for every rule', () => withFiles({
  ...hidden, 'tach.toml': hidden['tach.toml'].replace('"src"', '"elsewhere"'),
}, async root => {
  for (const kind of KINDS) {
    const result = await gate(root, kind, tachBinary, { allowIgnoredSources: false, allowInactiveRules: true });
    assert.equal(result.verdict, 'refuse', kind);
  }
}));

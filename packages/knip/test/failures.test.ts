import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { chmod, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { defineGate, runGate } from 'redproof';
import { knip } from '../src/index.ts';
import { issueTypes } from '../src/core/model.ts';
import { withProject } from './support/workspace.ts';

function envelope() {
  return { version: 1, hasConfigLoadErrors: false, hasBlockingHints: false, hintDetails: [],
    report: Object.fromEntries(issueTypes.map(type => [type, true])),
    counters: { ...Object.fromEntries(issueTypes.map(type => [type, 0])), processed: 3 },
    issues: Object.fromEntries(issueTypes.map(type => [type, []])),
  };
}
const writeReport = (value: unknown) => `import {writeFileSync} from 'node:fs'; writeFileSync(process.env.REDPROOF_KNIP_REPORT, ${JSON.stringify(JSON.stringify(value))});`;
const rules = { exports: 'exports' } as const;

for (const [name, code, script] of [
  ['missing report', 'knip-report-unavailable', ''],
  ['malformed report', 'knip-report-unavailable', writeReport({})],
  ['unexplained exit', 'knip-unsuccessful', `${writeReport(envelope())} process.exitCode=1;`],
  ['configuration error with clean report', 'knip-unsuccessful', `${writeReport(envelope())} process.exitCode=2;`],
  ['partial configuration report', 'knip-config-unavailable', writeReport({ ...envelope(), hasConfigLoadErrors: true })],
  ['blocking configuration hints', 'knip-config-hints', writeReport({ ...envelope(), hasBlockingHints: true, hintDetails: ['ignore: obsolete'] })],
  ['signal', 'command-signaled', "process.kill(process.pid, 'SIGTERM');"],
  ['output overflow', 'command-output-limit', "process.stdout.write('x'.repeat(10000));"],
] as const) test(`${name} REFUSES`, async () => withProject(async root => {
  await writeFile(join(root, 'cli.mjs'), script);
  const adapter = knip({ cli: 'cli.mjs', rules, maxOutputBytes: 5000 });
  const outcome = await adapter.check.run({ root, rules: ['knip/unused-exports'] });
  assert.equal(outcome.verdict, 'refuse', JSON.stringify(outcome));
  if (outcome.verdict === 'refuse') assert.equal(outcome.why.code, code);
}));

test('empty inspection reaches Gate emptyEvidence policy', async () => withProject(async root => {
  const data = envelope(); data.counters.processed = 0;
  await writeFile(join(root, 'cli.mjs'), writeReport(data));
  const adapter = knip({ cli: 'cli.mjs', rules });
  assert.equal((await runGate(defineGate({ id: 'empty', adapter }), root)).verdict, 'refuse');
  assert.equal((await runGate(defineGate({ id: 'empty', adapter, policies: { emptyEvidence: 'allow' } }), root)).verdict, 'pass');
}));

test('parallel reports cannot cross-attribute and config stdout is harmless', async () => withProject(async root => {
  await writeFile(join(root, 'clean.mjs'), `${writeReport(envelope())} console.log('configuration logging');`);
  await writeFile(join(root, 'missing.mjs'), '');
  const outcomes = await Promise.all(['clean.mjs', 'missing.mjs', 'clean.mjs'].map(cli => {
    const adapter = knip({ cli, rules });
    return adapter.check.run({ root, rules: ['knip/unused-exports'] });
  }));
  assert.deepEqual(outcomes.map(value => value.verdict), ['pass', 'refuse', 'pass']);
}));

test('cwd and configuration symlinks cannot escape root', async () => withProject(async root => {
  await symlink('..', join(root, 'outside'), 'dir');
  for (const options of [{ cwd: 'outside' }, { configFile: 'outside' }]) {
    const adapter = knip({ rules, ...options });
    assert.equal((await adapter.check.run({ root, rules: ['knip/unused-exports'] })).verdict, 'refuse');
  }
}));

test('nested cwd preserves Gate-relative evidence locations', async () => withProject(async root => {
  await mkdir(join(root, 'nested'));
  await writeFile(join(root, 'nested/package.json'), '{"name":"nested"}');
  await writeFile(join(root, 'nested/knip.json'), '{"entry":["index.ts"],"project":["*.ts"]}');
  await writeFile(join(root, 'nested/index.ts'), "import './unused.ts';");
  await writeFile(join(root, 'nested/unused.ts'), 'export const unused = 1;');
  const adapter = knip({ cwd: 'nested', configFile: 'nested/knip.json', rules });
  const outcome = await adapter.check.run({ root, rules: ['knip/unused-exports'] });
  assert.equal(outcome.verdict, 'fail', JSON.stringify(outcome));
  if (outcome.verdict === 'fail') assert.equal(outcome.breaches[0].location?.file, 'nested/unused.ts');
}));

test('an installed Knip without required metadata is explicitly unsupported', async () => withProject(async root => {
  await mkdir(join(root, 'nested/node_modules/knip/dist'), { recursive: true });
  await writeFile(join(root, 'nested/package.json'), '{"name":"older-consumer"}');
  await writeFile(join(root, 'nested/node_modules/knip/package.json'),
    '{"name":"knip","version":"6.33.0","main":"dist/index.js"}');
  await writeFile(join(root, 'nested/node_modules/knip/dist/index.js'), '');
  const adapter = knip({ cwd: 'nested', rules });
  const outcome = await adapter.check.run({ root, rules: ['knip/unused-exports'] });
  assert.equal(outcome.verdict, 'refuse');
  if (outcome.verdict === 'refuse') {
    assert.equal(outcome.why.code, 'knip-version-unsupported');
    assert.equal(outcome.why.detail, 'Installed: 6.33.0');
  }
}));

const lockReportDirectory = "import {chmodSync as lockMode, writeFileSync as lockNote} from 'node:fs';"
  + " import {dirname as lockDir, join as lockJoin} from 'node:path';"
  + " const locked = lockDir(process.env.REDPROOF_KNIP_REPORT);"
  + " lockNote(lockJoin(process.env.REDPROOF_KNIP_ROOT, 'locked.txt'), locked); lockMode(locked, 0o500);";

/**
 * A timeout that fires before the fake CLI locks the directory still REFUSES with
 * `command-timeout`, so the assertions below would pass with nothing locked. This
 * budget must outlast the CLI's start, measured at 26-54 ms on an idle 14-core
 * Mac and 36-53 ms under 42 busy loops; the `locked.txt` assertion makes a lost
 * race a named failure instead of a silent pass.
 */
const LOCK_THEN_HANG_TIMEOUT_MS = 2_000;

/** Release the directory the fake CLI locked, so the run leaves no undeletable temporary tree. */
async function releaseLocked(root: string): Promise<void> {
  const locked = await readFile(join(root, 'locked.txt'), 'utf8');
  await chmod(locked, 0o700);
  await rm(locked, { recursive: true, force: true });
}

test('an undeletable evidence directory REFUSES only when nothing else was found', async () => withProject(async root => {
  await writeFile(join(root, 'clean.mjs'), `${writeReport(envelope())} ${lockReportDirectory}`);
  const clean = await knip({ cli: 'clean.mjs', rules }).check.run({ root, rules: ['knip/unused-exports'] });
  assert.equal(clean.verdict, 'refuse', JSON.stringify(clean));
  if (clean.verdict === 'refuse') assert.equal(clean.why.code, 'knip-cleanup-unavailable');
  await releaseLocked(root);
}));

test('an undeletable evidence directory cannot erase a real breach', async () => withProject(async root => {
  const base = envelope();
  const found = {
    ...base,
    counters: { ...base.counters, exports: 1 },
    issues: { ...base.issues, exports: [{ type: 'exports', file: 'src/a.ts', symbol: 'unused', line: 1, col: 1 }] },
  };
  await writeFile(join(root, 'found.mjs'), `${writeReport(found)} ${lockReportDirectory}`);
  const outcome = await knip({ cli: 'found.mjs', rules }).check.run({ root, rules: ['knip/unused-exports'] });
  assert.equal(outcome.verdict, 'fail', JSON.stringify(outcome));
  if (outcome.verdict === 'fail') assert.equal(outcome.breaches[0].rule, 'knip/unused-exports');
  await releaseLocked(root);
}));

test('an undeletable evidence directory cannot relabel a timeout', async () => withProject(async root => {
  await writeFile(join(root, 'slow.mjs'), `${writeReport(envelope())} ${lockReportDirectory} setInterval(() => {}, 1_000);`);
  const outcome = await knip({ cli: 'slow.mjs', rules, timeoutMs: LOCK_THEN_HANG_TIMEOUT_MS })
    .check.run({ root, rules: ['knip/unused-exports'] });
  assert.equal(outcome.verdict, 'refuse', JSON.stringify(outcome));
  if (outcome.verdict === 'refuse') assert.equal(outcome.why.code, 'command-timeout');
  assert.ok(existsSync(join(root, 'locked.txt')),
    'the fake CLI was killed before it locked the evidence directory; raise LOCK_THEN_HANG_TIMEOUT_MS');
  await releaseLocked(root);
}));

/** An installed Knip whose CLI runs but whose manifest states an unsupported version. */
async function installOldKnip(root: string, version = '5.0.0'): Promise<void> {
  await mkdir(join(root, 'app/node_modules/knip/bin'), { recursive: true });
  await writeFile(join(root, 'app/package.json'), '{"name":"consumer"}');
  await writeFile(join(root, 'app/node_modules/knip/package.json'),
    `{"name":"knip","version":"${version}","main":"bin/knip.js"}`);
  await writeFile(join(root, 'app/node_modules/knip/bin/knip.js'), writeReport(envelope()));
}

test('an unsupported installed version REFUSES whether or not cli names it', async () => withProject(async root => {
  await installOldKnip(root);
  for (const options of [{ cwd: 'app' }, { cwd: 'app', cli: 'app/node_modules/knip/bin/knip.js' }]) {
    const outcome = await knip({ ...options, rules }).check.run({ root, rules: ['knip/unused-exports'] });
    assert.equal(outcome.verdict, 'refuse', JSON.stringify({ options, outcome }));
    if (outcome.verdict === 'refuse') {
      assert.equal(outcome.why.code, 'knip-version-unsupported');
      assert.equal(outcome.why.detail, 'Installed: 5.0.0');
    }
  }
}));

test('a wrapper script outside an installed Knip carries no version to judge', async () => withProject(async root => {
  await writeFile(join(root, 'wrapper.mjs'), writeReport(envelope()));
  const outcome = await knip({ cli: 'wrapper.mjs', rules }).check.run({ root, rules: ['knip/unused-exports'] });
  assert.equal(outcome.verdict, 'pass', JSON.stringify(outcome));
}));

for (const version of ['6.35.0', '7.0.0']) test(`installed Knip ${version} sits outside the range and REFUSES`, async () => withProject(async root => {
  await installOldKnip(root, version);
  const outcome = await knip({ cwd: 'app', rules }).check.run({ root, rules: ['knip/unused-exports'] });
  assert.equal(outcome.verdict, 'refuse', JSON.stringify(outcome));
  if (outcome.verdict === 'refuse') {
    assert.equal(outcome.why.code, 'knip-version-unsupported');
    assert.equal(outcome.why.detail, `Installed: ${version}`);
  }
}));

test('a cli path that does not exist REFUSES as unavailable', async () => withProject(async root => {
  const outcome = await knip({ cli: 'absent.mjs', rules }).check.run({ root, rules: ['knip/unused-exports'] });
  assert.equal(outcome.verdict, 'refuse', JSON.stringify(outcome));
  if (outcome.verdict === 'refuse') assert.equal(outcome.why.code, 'knip-unavailable');
}));

test('an evidence file larger than maxOutputBytes REFUSES before it is parsed', async () => withProject(async root => {
  await writeFile(join(root, 'cli.mjs'), writeReport({ ...envelope(), padding: 'x'.repeat(6_000) }));
  const outcome = await knip({ cli: 'cli.mjs', rules, maxOutputBytes: 5_000 }).check.run({ root, rules: ['knip/unused-exports'] });
  assert.equal(outcome.verdict, 'refuse', JSON.stringify(outcome));
  if (outcome.verdict === 'refuse') {
    assert.equal(outcome.why.code, 'knip-report-unavailable');
    assert.match(outcome.why.detail ?? '', /exceeds maxOutputBytes/u);
  }
}));

test('every boolean flag and the workspace selector reach the CLI argv', async () => withProject(async root => {
  await writeFile(join(root, 'cli.mjs'), `${writeReport(envelope())} writeFileSync('argv.json', JSON.stringify(process.argv.slice(2)));`);
  const adapter = knip({ cli: 'cli.mjs', rules, workspace: 'packages/app', production: true, strict: true,
    includeEntryExports: true, treatConfigHintsAsErrors: true });
  const outcome = await adapter.check.run({ root, rules: ['knip/unused-exports'] });
  assert.equal(outcome.verdict, 'pass', JSON.stringify(outcome));
  const argv = JSON.parse(await readFile(join(root, 'argv.json'), 'utf8')) as string[];
  for (const flag of ['--workspace=packages/app', '--production', '--strict', '--include-entry-exports', '--treat-config-hints-as-errors']) {
    assert.ok(argv.includes(flag), `${flag} missing from ${JSON.stringify(argv)}`);
  }
}));

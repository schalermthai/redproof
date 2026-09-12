import assert from 'node:assert/strict';
import { mkdir, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { defineGate, runGate } from 'redproof';
import { knip } from '../src/index.ts';
import { issueTypes } from '../src/model.ts';
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
  const outcome = await adapter.check.run({ root, rules: ['knip/exports'] });
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
    return adapter.check.run({ root, rules: ['knip/exports'] });
  }));
  assert.deepEqual(outcomes.map(value => value.verdict), ['pass', 'refuse', 'pass']);
}));

test('cwd and configuration symlinks cannot escape root', async () => withProject(async root => {
  await symlink('..', join(root, 'outside'), 'dir');
  for (const options of [{ cwd: 'outside' }, { configFile: 'outside' }]) {
    const adapter = knip({ rules, ...options });
    assert.equal((await adapter.check.run({ root, rules: ['knip/exports'] })).verdict, 'refuse');
  }
}));

test('nested cwd preserves Gate-relative evidence locations', async () => withProject(async root => {
  await mkdir(join(root, 'nested'));
  await writeFile(join(root, 'nested/package.json'), '{"name":"nested"}');
  await writeFile(join(root, 'nested/knip.json'), '{"entry":["index.ts"],"project":["*.ts"]}');
  await writeFile(join(root, 'nested/index.ts'), "import './unused.ts';");
  await writeFile(join(root, 'nested/unused.ts'), 'export const unused = 1;');
  const adapter = knip({ cwd: 'nested', configFile: 'nested/knip.json', rules });
  const outcome = await adapter.check.run({ root, rules: ['knip/exports'] });
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
  const outcome = await adapter.check.run({ root, rules: ['knip/exports'] });
  assert.equal(outcome.verdict, 'refuse');
  if (outcome.verdict === 'refuse') {
    assert.equal(outcome.why.code, 'knip-version-unsupported');
    assert.equal(outcome.why.detail, 'Installed: 6.33.0');
  }
}));

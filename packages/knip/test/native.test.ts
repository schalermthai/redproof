import assert from 'node:assert/strict';
import { appendFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { knip, type KnipOptions } from '../src/index.ts';
import { withProject } from './support/workspace.ts';

function run(root: string, options: KnipOptions = { rules: { exports: 'exports' } }) {
  const adapter = knip(options);
  return adapter.check.run({ root, rules: Object.values(adapter.rules).map(rule => rule.id) });
}

test('native Knip baseline, export mutation, selected-only parity and repeat restoration', async () => {
  await withProject(async root => {
    const healthy = await run(root);
    assert.equal(healthy.verdict, 'pass', JSON.stringify(healthy));
    assert.equal(healthy.scan.inspected, 2);
    await appendFile(join(root, 'receive.ts'), 'export const unusedReceipt = 2;\n');
    const red = await run(root);
    assert.equal(red.verdict, 'fail', JSON.stringify(red));
    if (red.verdict === 'fail') {
      assert.equal(red.breaches.length, 1);
      assert.equal(red.breaches[0]?.rule, 'knip/exports');
      assert.equal(red.breaches[0]?.location?.file, 'receive.ts');
      assert.equal(red.breaches[0]?.location?.line, 2);
    }
    assert.equal((await run(root, { rules: { files: 'files' } })).verdict, 'pass');
    await writeFile(join(root, 'receive.ts'), 'export function receive() { return 1; }\n');
    assert.equal((await run(root)).verdict, 'pass');
  });
});

test('warn findings breach even when native Knip exits zero; off and exclude REFUSE', async () => {
  await withProject(async root => {
    await appendFile(join(root, 'receive.ts'), 'export const unusedReceipt = 2;\n');
    for (const [configuration, status] of [
      [{ rules: { exports: 'warn' } }, 'fail'],
      [{ rules: { exports: 'off' } }, 'refuse'],
      [{ exclude: ['exports'] }, 'refuse'],
    ] as const) {
      await writeFile(join(root, 'knip.json'), JSON.stringify({ entry: ['index.ts'], project: ['*.ts'], ...configuration }));
      const outcome = await run(root);
      assert.equal(outcome.verdict, status, JSON.stringify(outcome));
      if (outcome.verdict === 'refuse') assert.equal(outcome.why.code, 'knip-rule-inactive');
    }
  });
});

test('missing config and timeout are REFUSE', async () => {
  await withProject(async root => {
    const missing = await run(root, { configFile: 'missing.json', rules: { exports: 'exports' } });
    assert.equal(missing.verdict, 'refuse');
    await writeFile(join(root, 'hang.mjs'), 'setInterval(() => {}, 1000);');
    const timed = await run(root, { cli: 'hang.mjs', timeoutMs: 100, rules: { exports: 'exports' } });
    assert.equal(timed.verdict, 'refuse');
    if (timed.verdict === 'refuse') assert.equal(timed.why.code, 'command-timeout');
  });
});

test('enabled native cycles are warning breaches with member locations', async () => {
  await withProject(async root => {
    await writeFile(join(root, 'knip.json'), '{"entry":["index.ts"],"project":["*.ts"],"include":["cycles"]}');
    await writeFile(join(root, 'receive.ts'), "import './index.ts';\nexport function receive() { return 1; }\n");
    const outcome = await run(root, { rules: { cycles: 'cycles' } });
    assert.equal(outcome.verdict, 'fail', JSON.stringify(outcome));
    if (outcome.verdict === 'fail') {
      assert.equal(outcome.breaches.length, 1);
      assert.equal(outcome.breaches[0].location?.line, 1);
      assert.match(outcome.breaches[0].detail ?? '', /index.ts:1:/u);
      assert.match(outcome.breaches[0].detail ?? '', /receive.ts:1:/u);
    }
  });
});

test('production cannot pretend to inspect dev dependencies', async () => {
  await withProject(async root => {
    const outcome = await run(root, { production: true, rules: { dev: 'devDependencies' } });
    assert.equal(outcome.verdict, 'refuse', JSON.stringify(outcome));
    if (outcome.verdict === 'refuse') assert.equal(outcome.why.code, 'knip-rule-inactive');
  });
});

test('native blocking hints remain actionable even alongside unselected findings', async () => {
  await withProject(async root => {
    await writeFile(join(root, 'knip.json'), JSON.stringify({ entry: ['index.ts'], project: ['*.ts'],
      ignoreDependencies: ['redproof-nonexistent-dependency'] }));
    await appendFile(join(root, 'receive.ts'), 'export const unusedReceipt = 2;');
    const outcome = await run(root, { treatConfigHintsAsErrors: true, rules: { files: 'files' } });
    assert.equal(outcome.verdict, 'refuse', JSON.stringify(outcome));
    if (outcome.verdict === 'refuse') {
      assert.equal(outcome.why.code, 'knip-config-hints');
      assert.match(outcome.why.detail ?? '', /redproof-nonexistent-dependency/u);
    }
  });
});

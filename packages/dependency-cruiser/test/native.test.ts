import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { dependencyCruiser } from '../src/index.ts';
import { withWorkspace } from './support/workspace.ts';

const rule = {
  name: 'no-infrastructure',
  severity: 'error',
  from: { path: '^src/domain' },
  to: { path: '^src/infrastructure' },
};
const configuration = { forbidden: [rule] };

function configSource(extension: string, config: unknown): string {
  const value = JSON.stringify(config);
  if (extension === 'json') return value;
  return ['cjs', 'cts'].includes(extension)
    ? `module.exports = ${value};\n`
    : `export default ${value};\n`;
}

async function writeProject(root: string): Promise<void> {
  await mkdir(join(root, 'src/domain'), { recursive: true });
  await mkdir(join(root, 'src/infrastructure'), { recursive: true });
  await writeFile(join(root, 'package.json'), '{"type":"module"}');
  await writeFile(join(root, 'src/domain/order.js'), "import '../infrastructure/db.js';\n");
  await writeFile(join(root, 'src/infrastructure/db.js'), 'export const db = {};\n');
}

function check(root: string, configFile: string) {
  const adapter = dependencyCruiser({
    configFile,
    rules: { boundary: 'no-infrastructure' },
  });
  return () => adapter.check.run({ root, rules: [adapter.rules.boundary.id] });
}

for (const extension of ['cjs', 'mjs', 'js', 'ts', 'cts', 'mts', 'json']) {
  test(`consecutive checks reload .${extension} configuration mutations and restoration`, async t => {
    await withWorkspace(async root => {
      await writeProject(root);
      const configFile = `.dependency-cruiser.${extension}`;
      const path = join(root, configFile);
      const original = configSource(extension, configuration);
      const run = check(root, configFile);
      await writeFile(path, original);
      const baseline = await run();
      assert.equal(baseline.verdict, 'fail', JSON.stringify(baseline));
      if (baseline.verdict === 'fail') {
        assert.deepEqual(baseline.breaches.map(item => item.rule), ['dependency-cruiser/no-infrastructure']);
      }

      const mutations = [
        { name: 'corrupt config', content: 'invalid config {', verdict: 'refuse', code: 'dependency-cruiser-unavailable' },
        { name: 'disabled rule', config: { forbidden: [{ ...rule, severity: 'ignore' }] }, verdict: 'refuse', code: 'dependency-cruiser-rule-inactive' },
        { name: 'removed rule', config: { forbidden: [] }, verdict: 'refuse', code: 'dependency-cruiser-rule-missing' },
        { name: 'changed boundary', config: { forbidden: [{ ...rule, to: { path: '^src/other' } }] }, verdict: 'pass' },
        { name: 'changed cruise options', config: { ...configuration, options: { exclude: '^src/infrastructure' } }, verdict: 'pass' },
      ] as const;

      for (const mutation of mutations) {
        await t.test(mutation.name, async () => {
          await writeFile(path, 'content' in mutation ? mutation.content : configSource(extension, mutation.config));
          const result = await run();
          assert.equal(result.verdict, mutation.verdict, JSON.stringify(result));
          if (result.verdict === 'refuse' && 'code' in mutation) {
            assert.equal(result.why.code, mutation.code);
          }
        });
      }

      await writeFile(path, original);
      const restored = await run();
      assert.equal(restored.verdict, 'fail', JSON.stringify(restored));
    });
  });
}

for (const reference of ['extends', 'import', 'require']) {
  test(`consecutive checks reload relative config ${reference} without changing its location`, async () => {
    await withWorkspace(async root => {
      await writeProject(root);
      await mkdir(join(root, 'config'));
      const commonJs = reference === 'require';
      const extension = commonJs ? 'cjs' : 'mjs';
      const configFile = `config/architecture.${extension}`;
      const base = join(root, `config/base.${extension}`);
      const source = reference === 'extends'
        ? "export default { extends: './base.mjs' };\n"
        : commonJs
          ? "module.exports = require('./base.cjs');\n"
          : "export { default } from './base.mjs';\n";
      await writeFile(join(root, configFile), source);
      await writeFile(base, configSource(extension, configuration));
      const run = check(root, configFile);
      const baseline = await run();
      assert.equal(baseline.verdict, 'fail', JSON.stringify(baseline));

      await writeFile(base, configSource(extension, { forbidden: [] }));
      const removed = await run();
      assert.equal(removed.verdict, 'refuse', JSON.stringify(removed));
      if (removed.verdict === 'refuse') assert.equal(removed.why.code, 'dependency-cruiser-rule-missing');

      await writeFile(base, configSource(extension, configuration));
      const restored = await run();
      assert.equal(restored.verdict, 'fail', JSON.stringify(restored));
    });
  });
}

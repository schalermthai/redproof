import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { knip, type KnipOptions } from '@redproof/knip';
import { defineGate, mutate, proof, proofEstablished, runProof } from 'redproof';
import { executeCommand } from 'redproof/command';

const expert = resolve(process.argv[2] ?? '../11-knip');
const eslint = resolve(process.argv[3] ?? '../06-eslint');
const vitest = resolve(process.argv[4] ?? '../05-vitest');
const cli = 'packages/knip/src/cli.ts';

async function compare(root: string, options: KnipOptions, nativeArgs: string[]) {
  const adapter = knip(options);
  const outcome = await adapter.check.run({ root, rules: Object.values(adapter.rules).map(rule => rule.id) });
  const execution = await executeCommand({ command: process.execPath,
    args: [resolve(root, options.cli ?? 'node_modules/knip/bin/knip.js'), ...nativeArgs, '--reporter', 'json', '--no-progress'],
    cwd: resolve(root, options.cwd ?? '.'), timeoutMs: 60_000 });
  assert.equal(execution.kind, 'completed');
  if (execution.kind !== 'completed') throw new Error(JSON.stringify(execution));
  if (execution.exitCode === 2) assert.equal(outcome.verdict, 'refuse');
  else {
    const native = JSON.parse(execution.stdout) as { issues: Record<string, unknown>[] };
    const expected = native.issues.flatMap(row => Object.values(options.rules).flatMap(type => {
      const items = row[type];
      assert.ok(Array.isArray(items));
      return items.map(item => {
        const first = Array.isArray(item) ? item[0] : item;
        return [type, [options.cwd, row.file].filter(Boolean).join('/'), first.line ?? null, first.col ?? null];
      });
    }));
    assert.notEqual(outcome.verdict, 'refuse', JSON.stringify(outcome));
    const actual = outcome.verdict === 'fail' ? outcome.breaches.map(item =>
      [item.code, item.location?.file, item.location?.line, item.location?.column]) : [];
    const sorted = (items: unknown[]) => items.map(item => JSON.stringify(item)).sort();
    assert.deepEqual(sorted(actual), sorted(expected));
  }
  console.log(JSON.stringify({ root, options, nativeExit: execution.exitCode, outcome }));
  return outcome;
}

for (const [cwd, type] of [
  ['packages/knip/fixtures/exports/duplicate-exports-alias', 'duplicates'],
  ['packages/knip/fixtures/dependencies/catalog-pnpm', 'catalog'],
  ['packages/knip/fixtures/dependencies/catalog-references', 'catalogReferences'],
] as const) await compare(expert, { cli, cwd, rules: { selected: type } }, []);

const cycleCwd = 'packages/knip/fixtures/imports/circular-dependencies';
const cycleConfig = `${cycleCwd}/redproof-knip.json`;
const undo = await mutate.writeText(cycleConfig, '{"include":["cycles"]}').apply(expert);
try {
  await compare(expert, { cli, cwd: cycleCwd, configFile: cycleConfig, rules: { cycles: 'cycles' } },
    ['--config', resolve(expert, cycleConfig)]);
} finally { await undo(); }

await compare(expert, { cli, production: true, strict: true,
  rules: { files: 'files', exports: 'exports', dependencies: 'dependencies' } }, ['--production', '--strict']);

const eslintRules = { files: 'files', exports: 'exports', dependencies: 'dependencies', unlisted: 'unlisted' } as const;
await compare(eslint, { workspace: '.', rules: eslintRules }, ['--workspace', '.']);
const eslintAdapter = knip({ workspace: '.', rules: eslintRules });
const gate = defineGate({ id: 'eslint-knip', adapter: eslintAdapter });
for (const specimen of [
  proof.red(eslintAdapter.rules.files, 'unused ESLint source', mutate.writeText('lib/redproof-unused-receipt.js', 'module.exports = 1;')),
  proof.green('ESLint root workspace native baseline'),
]) {
  const outcome = await runProof(gate, specimen, eslint);
  assert.ok(proofEstablished(outcome), JSON.stringify(outcome));
  console.log(JSON.stringify(outcome));
}
await compare(eslint, { rules: { files: 'files' } }, []);
const vitestAdapter = knip({ rules: { files: 'files' } });
const installed = await vitestAdapter.check.run({ root: vitest, rules: ['knip/unused-files'] });
console.log(JSON.stringify({ vitestInstalled: installed }));
const bridge = 'node_modules/.redproof-knip-cli.mjs';
const restoreBridge = await mutate.writeText(bridge,
  `import ${JSON.stringify(pathToFileURL(resolve(expert, cli)).href)};\n`).apply(vitest);
try {
  await compare(vitest, { cli: bridge, treatConfigHintsAsErrors: true,
    rules: { files: 'files', exports: 'exports', devDependencies: 'devDependencies' } }, ['--treat-config-hints-as-errors']);
} finally { await restoreBridge(); }

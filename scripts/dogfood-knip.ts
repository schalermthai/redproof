import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { knip } from '@redproof/knip';
import { defineGate, mutate, proof, proofEstablished, runGate, runProof } from 'redproof';
import { executeCommand } from 'redproof/command';

// Run explicitly against the independent expert checkout, outside normal CI.
const root = resolve(process.argv[2] ?? '../11-knip');
const cli = 'packages/knip/src/cli.ts';
const source = 'packages/knip/src/util/string.ts';
const rules = { files: 'files', exports: 'exports', types: 'types',
  unresolved: 'unresolved', devDependencies: 'devDependencies' } as const;
const adapter = knip({ cli, configFile: 'knip.json', rules });
let comparisons = 0;
const gate = defineGate({
  id: 'knip-expert-self', rules: adapter.rules,
  check: { ...adapter.check, async run(ctx) {
    const outcome = await adapter.check.run(ctx);
    const native = await executeCommand({ command: process.execPath,
      args: [resolve(root, cli), '--config', resolve(root, 'knip.json'), '--reporter', 'json', '--no-progress'],
      cwd: ctx.root, timeoutMs: 60_000 });
    assert.equal(native.kind, 'completed');
    if (native.kind !== 'completed') throw new Error('Native control unavailable.');
    if (native.exitCode === 2) {
      assert.equal(outcome.verdict, 'refuse');
    } else {
      assert.ok(native.stdout.trim(), `Native control produced no JSON: ${native.stderr}`);
      const json = JSON.parse(native.stdout) as { issues: Record<string, unknown>[] };
      const expected = json.issues.flatMap(row => Object.keys(rules).flatMap(type => {
        const items = row[type];
        assert.ok(Array.isArray(items));
        return items.map(() => `${type}:${row.file}`);
      })).sort();
      assert.notEqual(outcome.verdict, 'refuse', JSON.stringify(outcome));
      const actual = outcome.verdict === 'fail'
        ? outcome.breaches.map(item => `${item.code}:${item.location?.file}`).sort() : [];
      assert.deepEqual(actual, expected, 'Adapter/native Knip JSON parity');
    }
    comparisons++;
    return outcome;
  } },
});

const before = await readFile(resolve(root, source), 'utf8');
const configBefore = await readFile(resolve(root, 'knip.json'), 'utf8');
const packageBefore = await readFile(resolve(root, 'package.json'), 'utf8');
const baseline = await runGate(gate, root);
assert.equal(baseline.verdict, 'pass', JSON.stringify(baseline));
console.log(JSON.stringify({ baseline, root }));
const manifest = JSON.parse(packageBefore);
const proofs = [
  proof.red(adapter.rules.files, 'unused source file', mutate.writeText('packages/knip/src/redproof-unused.ts', 'export const orphanReceipt = 1;\n')),
  proof.red(adapter.rules.exports, 'unused value export', mutate.appendText(source, '\nexport const redproofUnusedReceipt = 1;\n')),
  proof.red(adapter.rules.types, 'unused type export', mutate.appendText(source, '\nexport type RedproofUnusedReceipt = { quantity: number };\n')),
  proof.red(adapter.rules.unresolved, 'unresolved import', mutate.appendText(source, "\nfunction redproofUnresolved() { return import('./redproof-missing-receipt.ts'); }\n")),
  proof.red(adapter.rules.devDependencies, 'unused declared dependency', mutate.writeText('package.json', JSON.stringify({
    ...manifest, devDependencies: { ...manifest.devDependencies, 'redproof-unused-receipt': '1.0.0' },
  }))),
  proof.refuse('invalid config', mutate.writeText('knip.json', '{ invalid json')),
  proof.green('native self-check unchanged'),
];
for (const specimen of proofs) {
  const outcome = await runProof(gate, specimen, root);
  console.log(JSON.stringify(outcome));
  assert.ok(proofEstablished(outcome), specimen.name);
}
assert.equal(await readFile(resolve(root, source), 'utf8'), before);
assert.equal(await readFile(resolve(root, 'knip.json'), 'utf8'), configBefore);
assert.equal(await readFile(resolve(root, 'package.json'), 'utf8'), packageBefore);
console.log(JSON.stringify({ proofs: proofs.length, nativeComparisons: comparisons, restored: true }));

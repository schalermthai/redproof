import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { nyc } from '@redproof/istanbul';
import { defineGate, mutate, proof, proofEstablished, runGate, runProof } from 'redproof';
import { executeCommand } from 'redproof/command';

const root = resolve(process.argv[2] ?? '../12-istanbul/packages/istanbul-lib-coverage');
const require = createRequire(join(root, 'package.json'));
const source = 'lib/percent.js';
const before = await readFile(join(root, source), 'utf8');
const adapter = nyc({ command: process.execPath, args: ['node_modules/mocha/bin/mocha'],
  expectedFiles: ['index.js', 'lib/coverage-map.js', 'lib/coverage-summary.js', 'lib/data-properties.js', 'lib/file-coverage.js', source],
  rules: { statements: { minimum: 100 }, branches: { minimum: 100 }, functions: { minimum: 100 }, lines: { minimum: 100 } },
});
let comparisons = 0;
const gate = defineGate({ id: 'istanbul-expert-self', rules: adapter.rules, check: { ...adapter.check, async run(ctx) {
  const actual = await adapter.check.run(ctx);
  const temp = await mkdtemp(join(tmpdir(), 'redproof-istanbul-native-'));
  try {
    const native = await executeCommand({ command: process.execPath,
      args: [require.resolve('nyc/bin/nyc.js'), '--all', '--cache=false', '--check-coverage=false', '--reporter=json-summary',
        `--report-dir=${temp}`, `--temp-dir=${join(temp, 'raw')}`, '--', process.execPath, 'node_modules/mocha/bin/mocha'],
      cwd: root, timeoutMs: 60_000 });
    assert.equal(native.kind, 'completed');
    if (native.kind !== 'completed') throw new Error(JSON.stringify(native));
    if (native.exitCode !== 0) assert.equal(actual.verdict, 'refuse');
    else {
      const summary = JSON.parse(await readFile(join(temp, 'coverage-summary.json'), 'utf8'));
      const expected = ['statements', 'branches', 'functions', 'lines'].filter(metric => summary.total[metric].pct < 100)
        .map(metric => `istanbul/${metric}-coverage`).sort();
      assert.notEqual(actual.verdict, 'refuse', JSON.stringify(actual));
      assert.deepEqual(actual.verdict === 'fail' ? actual.breaches.map(item => item.rule).sort() : [], expected);
      assert.equal(actual.scan.inspected, Object.keys(summary).length - 1);
    }
    comparisons++;
    return actual;
  } finally { await rm(temp, { recursive: true, force: true }); }
} } });
const baseline = await runGate(gate, root);
assert.equal(baseline.verdict, 'pass', JSON.stringify(baseline));
console.log(JSON.stringify({ baseline, root }));
const specimens = [
  proof.red(adapter.rules.statements, 'detects an unexecuted statement', mutate.appendText(source, '\nif (false) { console.log("uncovered receipt"); }\n')),
  proof.red(adapter.rules.branches, 'detects an unexercised branch', mutate.appendText(source, '\nmodule.exports.redproofFlag = process.env.REDPROOF_MISSING_FLAG ? 1 : 2;\n')),
  proof.red(adapter.rules.functions, 'detects an uncalled function', mutate.appendText(source, '\nmodule.exports.redproofUnused = function () { return 1; };\n')),
  proof.red(adapter.rules.lines, 'detects an uncovered line', mutate.appendText(source, '\nif (false) {\n  console.log("uncovered receipt");\n}\n')),
  proof.refuse('test failure cannot certify coverage', mutate.appendText('test/percent.test.js', '\nthrow new Error("redproof producer failure");\n')),
  proof.green('unchanged native library dogfood'),
];
for (const specimen of specimens) {
  const outcome = await runProof(gate, specimen, root);
  console.log(JSON.stringify(outcome)); assert.ok(proofEstablished(outcome), specimen.name);
}
assert.equal(await readFile(join(root, source), 'utf8'), before);
console.log(JSON.stringify({ proofs: specimens.length, nativeComparisons: comparisons, restored: true }));

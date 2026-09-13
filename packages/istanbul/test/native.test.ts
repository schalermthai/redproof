import assert from 'node:assert/strict';
import test from 'node:test';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { defineGate, runGate } from 'redproof';
import { nyc } from '../src/index.ts';
import { withWorkspace } from './support/workspace.ts';

test('native nyc GREEN, targeted branch RED, restored GREEN, with unexecuted file inventory', () => withWorkspace(async root => {
  await writeFile(join(root, 'package.json'), '{"private":true}');
  await writeFile(join(root, 'source.cjs'), 'module.exports = function choose(x) { return x ? 1 : 2; };');
  const healthy = "const choose = require('./source.cjs'); choose(true); choose(false);";
  await writeFile(join(root, 'test.cjs'), healthy);
  const adapter = nyc({ command: process.execPath, args: ['test.cjs'], include: ['source.cjs'],
    expectedFiles: ['source.cjs'], rules: { branches: { minimum: 100 }, statements: { minimum: 100 } } });
  const gate = defineGate({ id: 'coverage', adapter });
  assert.equal((await runGate(gate, root)).verdict, 'pass');
  await writeFile(join(root, 'test.cjs'), "require('./source.cjs')(true);");
  const red = await runGate(gate, root);
  assert.equal(red.verdict, 'fail', JSON.stringify(red));
  if (red.verdict === 'fail') assert.deepEqual(red.breaches.map(item => item.rule), ['istanbul/branches-coverage']);
  await writeFile(join(root, 'test.cjs'), healthy);
  assert.equal((await runGate(gate, root)).verdict, 'pass');
  await writeFile(join(root, 'test.cjs'), '');
  const uncovered = await runGate(gate, root);
  assert.equal(uncovered.verdict, 'fail'); assert.equal(uncovered.scan.inspected, 1);
}));
test('missing expected file from a valid report REFUSES; failed tests REFUSE despite report', () => withWorkspace(async root => {
  await writeFile(join(root, 'source.cjs'), 'module.exports = 1;');
  await writeFile(join(root, 'other.cjs'), 'module.exports = 2;');
  const adapter = nyc({ command: process.execPath, args: ['-e', "require('./source.cjs')"], include: ['source.cjs'], expectedFiles: ['other.cjs'], rules: { lines: { minimum: 0 } } });
  const absent = await adapter.check.run({ root, rules: [adapter.rules.lines.id] });
  assert.equal(absent.verdict, 'refuse'); if (absent.verdict === 'refuse') assert.equal(absent.why.code, 'istanbul-incomplete-inventory');
  const failing = nyc({ command: process.execPath, args: ['-e', "require('./source.cjs'); process.exit(1)"], include: ['source.cjs'], rules: { lines: { minimum: 0 } } });
  const failed = await failing.check.run({ root, rules: [failing.rules.lines.id] });
  assert.equal(failed.verdict, 'refuse'); if (failed.verdict === 'refuse') assert.equal(failed.why.code, 'istanbul-producer-unsuccessful');
}));

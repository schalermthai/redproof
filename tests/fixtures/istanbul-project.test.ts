import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import test from 'node:test';
import { checkProject, proveProject } from 'redproof';
import { breachedRules, configOf, proofSummary } from './project.ts';

/**
 * The Istanbul fixture runs real c8, the second producer of Istanbul-format
 * reports. The package's own tests drive the generic `istanbul()` producer with
 * hand-written JSON, so this file is the only place a real remapping tool
 * supplies the evidence.
 */
const config = configOf('istanbul-project');
const source = resolve('fixtures/istanbul-project/src/pricing.js');
const suite = resolve('fixtures/istanbul-project/test/pricing.test.js');

test('real c8 coverage of the clean fixture holds every per-file threshold', async () => {
  const run = await checkProject(config);

  assert.equal(run.exitCode, 0);
  assert.equal(run.results[0]?.result.verdict, 'pass');
  assert.equal(run.results[0]?.result.scan.inspected, 1);
});

test('each metric is proved red on its own, green when restored, and refused when the tests fail', async () => {
  const run = await proveProject(config);

  assert.equal(run.exitCode, 0);
  assert.deepEqual(proofSummary(run), [
    ['red', true, 'fail'],
    ['red', true, 'fail'],
    ['red', true, 'fail'],
    ['green', true, 'pass'],
    ['refuse', true, 'refuse'],
  ]);
});

test('the branch and function plants each move one Rule alone, so the metrics are not aliases', async () => {
  const run = await proveProject(config);

  // c8 maps one statement per source line, so an unexecuted line is also an
  // unexecuted block. The statements plant therefore moves branches too.
  assert.deepEqual(breachedRules(run, 0),
    ['istanbul/statements-coverage', 'istanbul/branches-coverage']);
  assert.deepEqual(breachedRules(run, 1), ['istanbul/branches-coverage']);
  assert.deepEqual(breachedRules(run, 2), ['istanbul/functions-coverage']);
});

test('a proof run leaves the fixture tree exactly as it found it', async () => {
  const before = await Promise.all([readFile(source, 'utf8'), readFile(suite, 'utf8')]);

  await proveProject(config);

  assert.deepEqual(await Promise.all([readFile(source, 'utf8'), readFile(suite, 'utf8')]), before);
});

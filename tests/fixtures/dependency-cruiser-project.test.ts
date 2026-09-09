import assert from 'node:assert/strict';
import test from 'node:test';
import { checkProject, proveProject } from 'redproof';
import { breachedRules, configOf, proofSummary, refusalCodes } from './project.ts';

/**
 * What only the real tool can prove: dependency-cruiser's own report shape,
 * read through the adapter, and a proof cycle that plants a real forbidden
 * import and takes it away again.
 */
const config = configOf('dependency-cruiser-project');

test('the fixture architecture passes, and every cruised module counts as inspected', async () => {
  const run = await checkProject(config);

  assert.equal(run.exitCode, 0);
  assert.equal(run.results[0]?.result.verdict, 'pass');
  assert.equal(run.results[0]?.result.scan.inspected, 4);
});

test('each mapped rule is proven red by a real forbidden import, and a missing configuration refuses', async () => {
  const run = await proveProject(config);

  assert.equal(run.exitCode, 0);
  assert.deepEqual(proofSummary(run), [
    ['red', true, 'fail'],
    ['red', true, 'fail'],
    ['green', true, 'pass'],
    ['refuse', true, 'refuse'],
  ]);
  assert.deepEqual(breachedRules(run, 0), ['dependency-cruiser/domain-no-infrastructure']);
  assert.deepEqual(breachedRules(run, 1), ['dependency-cruiser/application-no-adapters']);
  assert.deepEqual(refusalCodes(run), ['dependency-cruiser-unavailable']);
});

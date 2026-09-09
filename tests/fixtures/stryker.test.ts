import assert from 'node:assert/strict';
import test from 'node:test';
import { checkProject, proveProject } from 'redproof';
import { breachedRules, configOf, proofSummary, refusalCodes } from './project.ts';

/**
 * What only a real mutation run can prove: Stryker's own mutant results, the
 * three policies judged together from one run, and the refusals that need a
 * real Stryker to produce them.
 */
const config = configOf('stryker-project');

test('a test suite that detects every mutant passes, with each mutant counted as inspected', async () => {
  const run = await checkProject(config);

  assert.equal(run.exitCode, 0);
  assert.equal(run.results[0]?.result.verdict, 'pass');
  assert.equal(run.results[0]?.result.scan.inspected, 5);
});

test('weakening one test breaches every selected mutation policy in a single run', async () => {
  const run = await proveProject(config);

  assert.equal(run.exitCode, 0);
  assert.deepEqual(proofSummary(run), [
    ['red', true, 'fail'],
    ['red', true, 'fail'],
    ['red', true, 'fail'],
    ['green', true, 'pass'],
    ['refuse', true, 'refuse'],
    ['refuse', true, 'refuse'],
    ['refuse', true, 'refuse'],
  ]);

  // Two of the five mutants survive the weakened suite, so each policy speaks
  // once per surviving mutant and the score speaks once for the whole run.
  for (const index of [0, 1, 2]) {
    assert.deepEqual(breachedRules(run, index), [
      'stryker/mutants-detected',
      'stryker/mutants-detected',
      'stryker/no-new-undetected-mutants',
      'stryker/no-new-undetected-mutants',
      'stryker/mutation-score',
    ], `proof ${index}`);
  }

  assert.deepEqual(refusalCodes(run), [
    'stryker-accepted-mutants-stale',
    'stryker-unavailable',
    'stryker-unavailable',
  ], 'a stale baseline, a failing test suite, and a missing configuration each refuse for their own reason');
});

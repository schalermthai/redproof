import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import test from 'node:test';
import { checkProject, proofEstablished, proveProject } from 'redproof';

const configOf = (name: string) => resolve(`fixtures/${name}/redproof.config.ts`);

test('dependency-cruiser adapter passes clean architecture and proves both mapped rules plus refusal', async () => {
  const check = await checkProject(configOf('dependency-cruiser-project'));
  assert.equal(check.exitCode, 0);
  assert.equal(check.results[0]?.result.verdict, 'pass');

  const proof = await proveProject(configOf('dependency-cruiser-project'));
  assert.equal(proof.exitCode, 0);
  assert.deepEqual(
    proof.outcomes.map(outcome => [
      outcome.expected,
      proofEstablished(outcome),
      outcome.status === 'completed' ? outcome.result.verdict : outcome.error.code,
    ]),
    [
      ['red', true, 'fail'],
      ['red', true, 'fail'],
      ['green', true, 'pass'],
      ['refuse', true, 'refuse'],
    ],
  );
});

test('Vitest adapter preserves a nested project report while proving test policies', async () => {
  const config = configOf('testing-vitest');
  const sentinel = resolve('fixtures/testing-vitest/project/results.json');
  const check = await checkProject(config);
  assert.equal(check.exitCode, 0);
  assert.equal(check.results[0]?.result.verdict, 'pass');
  assert.equal(await readFile(sentinel, 'utf8'), '{"sentinel":true}\n');

  const proof = await proveProject(config);
  assert.equal(proof.exitCode, 0);
  assert.deepEqual(
    proof.outcomes.map(outcome => [
      outcome.expected,
      proofEstablished(outcome),
      outcome.status === 'completed' ? outcome.result.verdict : outcome.error.code,
    ]),
    [
      ['red', true, 'fail'],
      ['red', true, 'fail'],
      ['red', true, 'fail'],
      ['green', true, 'pass'],
      ['refuse', true, 'refuse'],
    ],
  );
  assert.equal(await readFile(sentinel, 'utf8'), '{"sentinel":true}\n');
});

test('Stryker adapter passes strong tests and proves strict, baseline, score, and refusal policies', async () => {
  const check = await checkProject(configOf('stryker-project'));
  assert.equal(check.exitCode, 0);
  assert.equal(check.results[0]?.result.verdict, 'pass');

  const proof = await proveProject(configOf('stryker-project'));
  assert.equal(proof.exitCode, 0);
  assert.deepEqual(
    proof.outcomes.map(outcome => [
      outcome.expected,
      proofEstablished(outcome),
      outcome.status === 'completed' ? outcome.result.verdict : outcome.error.code,
    ]),
    [
      ['red', true, 'fail'],
      ['red', true, 'fail'],
      ['red', true, 'fail'],
      ['green', true, 'pass'],
      ['refuse', true, 'refuse'],
      ['refuse', true, 'refuse'],
      ['refuse', true, 'refuse'],
    ],
  );
  assert.deepEqual(
    proof.outcomes.slice(4).map(outcome =>
      outcome.status === 'completed' && outcome.result.verdict === 'refuse' ? outcome.result.why.code : outcome.status),
    ['stryker-accepted-mutants-stale', 'stryker-unavailable', 'stryker-unavailable'],
  );

  const firstRed = proof.outcomes[0];
  if (!firstRed || firstRed.status !== 'completed' || firstRed.result.verdict !== 'fail') {
    throw new Error('expected completed RED failure');
  }
  assert.ok(firstRed.result.breaches.some(item => item.rule === 'stryker/mutants-detected'));

  const secondRed = proof.outcomes[1];
  if (!secondRed || secondRed.status !== 'completed' || secondRed.result.verdict !== 'fail') {
    throw new Error('expected completed RED failure');
  }
  assert.ok(secondRed.result.breaches.some(
    item => item.rule === 'stryker/no-new-undetected-mutants',
  ));

  const thirdRed = proof.outcomes[2];
  if (!thirdRed || thirdRed.status !== 'completed' || thirdRed.result.verdict !== 'fail') {
    throw new Error('expected completed RED failure');
  }
  assert.ok(thirdRed.result.breaches.some(item => item.rule === 'stryker/mutation-score'));
});

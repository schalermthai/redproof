import assert from 'node:assert/strict';
import { lstat, mkdir, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import test from 'node:test';
import { checkProject, proofEstablished, proveProject } from 'redproof';

const configOf = (name: string) => resolve(`fixtures/${name}/redproof.config.ts`);

/** A fixture precondition: the Vitest fixture runs in copies mode, so a committed
 * `reports/` directory would stop it from exercising the missing-directory path.
 * Cleanup itself is proven end to end by the workspace check after each proof. */
async function assertMissing(path: string): Promise<void> {
  const entry = await lstat(path).catch((error: NodeJS.ErrnoException) => error);
  assert.equal(entry instanceof Error && entry.code, 'ENOENT');
}

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

test('Vitest adapter cleans a nested project report while proving test policies', async () => {
  const config = configOf('testing-vitest');
  const reports = resolve('fixtures/testing-vitest/project/reports');
  const check = await checkProject(config);
  assert.equal(check.exitCode, 0);
  assert.equal(check.results[0]?.result.verdict, 'pass');
  await assertMissing(reports);

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
      ['red', true, 'fail'],
      ['green', true, 'pass'],
      ['refuse', true, 'refuse'],
    ],
  );
  await assertMissing(reports);
});

test('Vitest proofs restore a workspace that has a nested node_modules directory', async () => {
  const nested = resolve('fixtures/testing-vitest/project/node_modules');
  await mkdir(nested, { recursive: true });
  try {
    const proof = await proveProject(configOf('testing-vitest'));
    assert.deepEqual(
      proof.outcomes.map(outcome => [outcome.status, proofEstablished(outcome)]),
      Array.from({ length: 6 }, () => ['completed', true]),
    );
  } finally {
    await rm(nested, { recursive: true, force: true });
  }
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

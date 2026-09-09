import assert from 'node:assert/strict';
import { lstat, mkdir, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import test from 'node:test';
import { checkProject, proofEstablished, proveProject } from 'redproof';
import { configOf, proofSummary } from './project.ts';

const config = configOf('testing-vitest');
const reports = resolve('fixtures/testing-vitest/project/reports');

/** A fixture precondition: the Vitest fixture runs in copies mode, so a committed
 * `reports/` directory would stop it from exercising the missing-directory path.
 * Cleanup itself is proven end to end by the workspace check after each proof. */
async function assertMissing(path: string): Promise<void> {
  const entry = await lstat(path).catch((error: NodeJS.ErrnoException) => error);
  assert.equal(entry instanceof Error && entry.code, 'ENOENT');
}

test('the Vitest adapter cleans a nested project report while proving the test policies', async () => {
  const check = await checkProject(config);
  assert.equal(check.exitCode, 0);
  assert.equal(check.results[0]?.result.verdict, 'pass');
  await assertMissing(reports);

  const run = await proveProject(config);

  assert.equal(run.exitCode, 0);
  assert.deepEqual(proofSummary(run), [
    ['red', true, 'fail'],
    ['red', true, 'fail'],
    ['red', true, 'fail'],
    ['red', true, 'fail'],
    ['green', true, 'pass'],
    ['refuse', true, 'refuse'],
  ]);
  await assertMissing(reports);
});

test('Vitest proofs restore a workspace that has a nested node_modules directory', async () => {
  const nested = resolve('fixtures/testing-vitest/project/node_modules');
  const created = await mkdir(nested, { recursive: true });

  try {
    const run = await proveProject(config);

    assert.deepEqual(
      run.outcomes.map(outcome => [outcome.status, proofEstablished(outcome)]),
      Array.from({ length: 6 }, () => ['completed', true]),
    );
  } finally {
    if (created !== undefined) await rm(nested, { recursive: true, force: true });
  }
});

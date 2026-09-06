import assert from 'node:assert/strict';
import test from 'node:test';
import { buildJsonProveReport, formatJsonProofs, type ProveProjectRun } from 'redproof';

const baseProject = {
  root: '/repo',
  refusalExit: 2,
  execution: { mode: 'in-place' as const },
  modules: [],
};

test('prove JSON distinguishes proved and infrastructure-error outcomes', () => {
  const run: ProveProjectRun = {
    project: baseProject,
    exitCode: 1,
    outcomes: [
      {
        status: 'completed',
        gate: 'architecture',
        proof: 'detects forbidden import',
        expected: 'red',
        ok: true,
        result: {
          verdict: 'fail',
          scan: { source: 'test', startedAt: '2026-01-01T00:00:00.000Z', finishedAt: '2026-01-01T00:00:01.000Z', inspected: 1 },
          breaches: [{
            rule: 'architecture/no-infra',
            code: 'forbidden-import',
            message: 'forbidden import',
            location: null,
          }],
        },
        workerPid: 10,
      },
      {
        status: 'error',
        gate: 'workspace',
        proof: 'restores mutation',
        expected: 'green',
        ok: false,
        workerPid: 11,
        error: {
          code: 'workspace-not-restored',
          message: 'workspace changed',
        },
      },
    ],
  };

  const report = buildJsonProveReport(run);
  assert.equal(report.version, 1);
  assert.equal(report.command, 'prove');
  assert.equal(report.status, 'failed');
  assert.equal(report.proofs[0]?.status, 'proved');
  assert.equal(report.proofs[1]?.status, 'infrastructure-error');

  const parsed = JSON.parse(formatJsonProofs(run));
  assert.equal(parsed.proofs[1].error.code, 'workspace-not-restored');
});

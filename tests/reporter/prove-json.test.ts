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
        reason: { kind: 'proved', target: 'architecture/no-infra' },
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
  assert.equal(parsed.proofs[1].reason, undefined);
});

test('prove JSON says why a proof was judged and what the Check found', () => {
  const scan = { source: 'test', startedAt: '', finishedAt: '', inspected: 1 };
  const run: ProveProjectRun = {
    project: baseProject,
    exitCode: 1,
    outcomes: [
      {
        status: 'completed',
        gate: 'lint',
        proof: 'a var in src is flagged',
        expected: 'red',
        ok: false,
        reason: { kind: 'target-rule-not-breached', target: 'lint/no-var', breached: ['lint/no-let'] },
        result: {
          verdict: 'fail',
          scan,
          breaches: [{ rule: 'lint/no-let', code: 'no-let', message: 'src/a.mjs:3: use const', location: { file: 'src/a.mjs', line: 3, column: null } }],
        },
        workerPid: 1,
      },
      {
        status: 'completed',
        gate: 'policy',
        proof: 'refuses without input',
        expected: 'refuse',
        ok: true,
        reason: { kind: 'proved' },
        result: { verdict: 'refuse', scan, why: { code: 'unavailable', message: 'No input', location: null } },
        workerPid: 1,
      },
    ],
  };

  const report = buildJsonProveReport(run);
  assert.deepEqual(report.proofs[0]?.reason, { kind: 'target-rule-not-breached', target: 'lint/no-var', breached: ['lint/no-let'] });
  assert.deepEqual(report.proofs[0]?.check?.breaches?.map(item => [item.rule, item.message]), [['lint/no-let', 'src/a.mjs:3: use const']]);
  assert.deepEqual(report.proofs[1]?.check, { verdict: 'refuse', refusal: { code: 'unavailable', message: 'No input', location: null } });
});

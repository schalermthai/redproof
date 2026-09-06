import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import test from 'node:test';
import { buildJsonCheckReport, checkProject, formatJsonRun } from 'redproof';

test('JSON reporter preserves Redproof PASS/FAIL/REFUSE semantics', async () => {
  const run = await checkProject(resolve('fixtures/mixed/redproof.config.ts'));
  const report = buildJsonCheckReport(run);

  assert.equal(report.version, 1);
  assert.equal(report.command, 'check');
  assert.equal(report.status, 'failed');
  assert.deepEqual(report.summary.gates, { passed: 1, failed: 1, refused: 1, total: 3 });
  assert.deepEqual(report.summary.rules, { held: 4, breached: 1, undecided: 2, unknown: 0, total: 7 });
  assert.deepEqual(report.summary.breaches, { kind: 'exact', count: 2 });

  const refused = report.gates.find(gate => gate.verdict === 'refuse');
  assert.ok(refused?.refusal);
  assert.ok(refused.rules.every(rule => rule.status === 'undecided'));

  const failed = report.gates.find(gate => gate.verdict === 'fail');
  assert.ok(failed);
  const breached = failed.rules.find(rule => rule.status === 'breached');
  assert.ok(breached);
  assert.equal(breached.breaches.length, 2);
  assert.equal(breached.breaches[0]?.rule, breached.id);
});

test('JSON reporter does not invent an exact breach count for non-countable Checks', async () => {
  const run = await checkProject(resolve('fixtures/non-countable/redproof.config.ts'));
  const report = buildJsonCheckReport(run);

  assert.deepEqual(report.summary.breaches, { kind: 'not-countable' });
  assert.equal(report.gates[0]?.rules[0]?.status, 'breached');
  assert.equal(report.gates[0]?.rules[0]?.breachCount, null);
  assert.equal(report.gates[0]?.rules[1]?.status, 'unknown');
});

test('formatted JSON is a stable versioned machine document', async () => {
  const run = await checkProject(resolve('fixtures/pass-single/redproof.config.ts'));
  const parsed = JSON.parse(formatJsonRun(run));
  assert.equal(parsed.version, 1);
  assert.equal(parsed.command, 'check');
  assert.equal(parsed.status, 'passed');
});

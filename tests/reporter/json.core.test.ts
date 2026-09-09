import assert from 'node:assert/strict';
import test from 'node:test';
import { buildJsonCheckReport } from '../../packages/redproof/src/reporter/core/check-report.ts';
import { formatJsonRun } from '../../packages/redproof/src/reporter/core/json.ts';
import { ROOT, UNSUPPORTED_REASON, at, breach, fail, gate, pass, refuse, rule, run, unsupported } from './runs.ts';

const R1 = rule('parser/rejects-malformed-input', 'rejects malformed input');
const R2 = rule('parser/preserves-whitespace', 'preserves whitespace');

const why = { code: 'eslint-config', message: 'ESLint configuration could not be loaded.', location: null };

test('the report carries its version, command, and the wall-clock facts of the run', () => {
  const report = buildJsonCheckReport(run(
    [gate({ id: 'parser', rules: [R1], result: pass(), durationMs: 12 })],
    { startedAt: new Date('2026-01-02T03:04:05.000Z'), durationMs: 40 },
  ));

  assert.equal(report.version, 1);
  assert.equal(report.command, 'check');
  assert.equal(report.startedAt, '2026-01-02T03:04:05.000Z');
  assert.equal(report.durationMs, 40);
  assert.equal(report.gates[0]?.durationMs, 12);
});

test('the run status is failed when any Gate failed, refused when any refused, else passed', () => {
  const passing = gate({ id: 'a', rules: [R1], result: pass() });
  const failing = gate({ id: 'b', rules: [R1], result: fail(breach(R1, 'x')) });
  const refusing = gate({ id: 'c', rules: [R1], result: refuse(why) });

  assert.equal(buildJsonCheckReport(run([passing])).status, 'passed');
  assert.equal(buildJsonCheckReport(run([passing, refusing])).status, 'refused');
  assert.equal(buildJsonCheckReport(run([passing, failing, refusing])).status, 'failed');
});

test('a Gate is identified by its id, its project-relative file, its adapter, and its Check', () => {
  const [gateJson] = buildJsonCheckReport(run([
    gate({ id: 'parser', rules: [R1], result: pass(), file: `${ROOT}/nested/gates/parser.ts` }),
  ])).gates;

  assert.equal(gateJson?.id, 'parser');
  assert.equal(gateJson?.file, 'nested/gates/parser.ts');
  assert.equal(gateJson?.adapter, 'unit');
  assert.equal(gateJson?.check, 'unit check');
  assert.deepEqual(gateJson?.counting, { kind: 'supported' });
  assert.deepEqual(gateJson?.scan, { source: 'unit', startedAt: '', finishedAt: '', inspected: 1 });
});

test('a PASS holds every Rule with a breach count of zero and no breaches', () => {
  const [gateJson] = buildJsonCheckReport(run([gate({ id: 'parser', rules: [R1, R2], result: pass() })])).gates;

  assert.equal(gateJson?.verdict, 'pass');
  assert.deepEqual(gateJson?.rules, [
    { id: R1.id, description: R1.description, status: 'held', breachCount: 0, breaches: [] },
    { id: R2.id, description: R2.description, status: 'held', breachCount: 0, breaches: [] },
  ]);
  assert.equal(gateJson && 'refusal' in gateJson, false);
});

test('a FAIL reports each Breach under its own Rule, with the full diagnostic', () => {
  const malformed = breach(R1, 'Malformed input was accepted.', at('src/parser.ts', 2, 30), {
    code: 'unexpected-status',
    comparison: { expected: 'invalid', actual: 'valid' },
    detail: 'The parser returned a value.',
    hint: 'Reject malformed tokens first.',
  });
  const second = breach(R1, 'Second one.', null, { code: 'unexpected-status' });

  const [gateJson] = buildJsonCheckReport(run([
    gate({ id: 'parser', rules: [R1, R2], result: fail(malformed, second) }),
  ])).gates;

  assert.equal(gateJson?.verdict, 'fail');
  assert.deepEqual(gateJson?.rules[0], {
    id: R1.id,
    description: R1.description,
    status: 'breached',
    breachCount: 2,
    breaches: [
      {
        rule: R1.id,
        code: 'unexpected-status',
        message: 'Malformed input was accepted.',
        location: { file: 'src/parser.ts', line: 2, column: 30 },
        comparison: { expected: 'invalid', actual: 'valid' },
        detail: 'The parser returned a value.',
        hint: 'Reject malformed tokens first.',
      },
      { rule: R1.id, code: 'unexpected-status', message: 'Second one.', location: null },
    ],
  });
  assert.deepEqual(gateJson?.rules[1]?.status, 'held');
});

test('a REFUSE leaves every Rule undecided with an unknown breach count and states why', () => {
  const [gateJson] = buildJsonCheckReport(run([
    gate({ id: 'eslint', rules: [R1, R2], result: refuse({ ...why, hint: 'Add a config.' }) }),
  ])).gates;

  assert.equal(gateJson?.verdict, 'refuse');
  assert.deepEqual(gateJson?.refusal, {
    code: 'eslint-config',
    message: 'ESLint configuration could not be loaded.',
    location: null,
    hint: 'Add a config.',
  });
  assert.deepEqual(gateJson?.rules.map(item => [item.status, item.breachCount, item.breaches.length]), [
    ['undecided', null, 0],
    ['undecided', null, 0],
  ]);
});

test('a non-countable FAIL reports no exact count, for the Rule or for the run', () => {
  const report = buildJsonCheckReport(run([
    gate({ id: 'stryker', rules: [R1, R2], counting: unsupported, result: fail(breach(R1, 'a mutant survived')) }),
  ]));

  assert.deepEqual(report.gates[0]?.counting, { kind: 'unsupported', reason: UNSUPPORTED_REASON });
  assert.deepEqual(report.gates[0]?.rules.map(item => [item.status, item.breachCount]), [
    ['breached', null],
    ['unknown', null],
  ]);
  assert.deepEqual(report.summary.breaches, { kind: 'not-countable' });
});

test('the summary totals Gates by verdict and Rules by state over the whole run', () => {
  const report = buildJsonCheckReport(run([
    gate({ id: 'a', rules: [R1, R2], result: pass() }),
    gate({ id: 'b', rules: [R1, R2], result: fail(breach(R1, 'x'), breach(R1, 'y')) }),
    gate({ id: 'c', rules: [R1, R2], result: refuse(why) }),
  ]));

  assert.deepEqual(report.summary.gates, { passed: 1, failed: 1, refused: 1, total: 3 });
  assert.deepEqual(report.summary.rules, { held: 3, breached: 1, undecided: 2, unknown: 0, total: 6 });
  assert.deepEqual(report.summary.breaches, { kind: 'exact', count: 2 });
});

test('the formatted document is the report, indented by default and compact on request', () => {
  const source = run([gate({ id: 'parser', rules: [R1], result: pass() })]);
  const report = buildJsonCheckReport(source);

  const pretty = formatJsonRun(source);
  assert.deepEqual(JSON.parse(pretty), report);
  assert.match(pretty, /^\{\n  "version": 1,\n/);

  const compact = formatJsonRun(source, { pretty: false });
  assert.deepEqual(JSON.parse(compact), report);
  assert.equal(compact.includes('\n'), false);
});

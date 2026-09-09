import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildGateReportModel,
  countBreachedRules,
  countBreaches,
  summarizeGateReports,
} from '../../packages/redproof/src/reporter/core/model.ts';
import { adapter, breach, fail, pass, refuse, rule, unsupported } from './runs.ts';

const R1 = rule('unit/r1');
const R2 = rule('unit/r2');
const R3 = rule('unit/r3');

const why = { code: 'unavailable', message: 'Unavailable', location: null };

function states(model: ReturnType<typeof buildGateReportModel>) {
  return model.rules.map(item => [item.rule.id, item.state.kind]);
}

test('a PASS holds every Rule of the Adapter, in catalog order', () => {
  const model = buildGateReportModel(adapter([R2, R1, R3]), pass());

  assert.equal(model.verdict, 'pass');
  assert.deepEqual(states(model), [['unit/r2', 'held'], ['unit/r1', 'held'], ['unit/r3', 'held']]);
});

test('a REFUSE leaves every Rule undecided rather than held or breached', () => {
  const model = buildGateReportModel(adapter([R1, R2]), refuse(why));

  assert.equal(model.verdict, 'refuse');
  assert.deepEqual(states(model), [['unit/r1', 'undecided'], ['unit/r2', 'undecided']]);
  assert.equal(countBreachedRules(model), 0);
  assert.equal(countBreaches(model), 0);
});

test('a countable FAIL groups Breaches under their Rule in arrival order and holds the rest', () => {
  const first = breach(R1, 'first');
  const other = breach(R3, 'other');
  const second = breach(R1, 'second');
  const model = buildGateReportModel(adapter([R1, R2, R3]), fail(first, other, second));

  assert.equal(model.verdict, 'fail');
  assert.deepEqual(model.rules[0]?.state, { kind: 'breached', breaches: [first, second] });
  assert.deepEqual(model.rules[1]?.state, { kind: 'held' });
  assert.deepEqual(model.rules[2]?.state, { kind: 'breached', breaches: [other] });
  assert.equal(countBreachedRules(model), 2);
  assert.equal(countBreaches(model), 3);
});

test('a non-countable FAIL does not claim the silent Rules hold', () => {
  const model = buildGateReportModel(adapter([R1, R2], unsupported), fail(breach(R1, 'seen')));

  assert.deepEqual(states(model), [['unit/r1', 'breached'], ['unit/r2', 'unknown']]);
  assert.equal(model.counting.kind, 'unsupported');
});

test('a run summary counts Gates by verdict and Rules by state across mixed Gates', () => {
  const passed = buildGateReportModel(adapter([R1, R2]), pass());
  const failed = buildGateReportModel(adapter([R1, R2, R3]), fail(breach(R1, 'a'), breach(R1, 'b')));
  const refused = buildGateReportModel(adapter([R1, R2]), refuse(why));

  assert.deepEqual(summarizeGateReports([passed, failed, refused]), {
    passedGates: 1,
    failedGates: 1,
    refusedGates: 1,
    heldRules: 4,
    breachedRules: 1,
    undecidedRules: 2,
    unknownRules: 0,
    totalRules: 7,
    breaches: { kind: 'exact', count: 2 },
  });
});

test('one non-countable failing Gate makes the whole breach total not countable', () => {
  const exact = buildGateReportModel(adapter([R1]), fail(breach(R1, 'a')));
  const vague = buildGateReportModel(adapter([R1, R2], unsupported), fail(breach(R1, 'b')));

  const summary = summarizeGateReports([exact, vague]);
  assert.deepEqual(summary.breaches, { kind: 'not-countable' });
  assert.equal(summary.breachedRules, 2);
  assert.equal(summary.unknownRules, 1);
});

test('a non-countable Gate that passed or refused keeps the breach total exact', () => {
  const exact = buildGateReportModel(adapter([R1]), fail(breach(R1, 'a')));
  const quietPass = buildGateReportModel(adapter([R1], unsupported), pass());
  const quietRefuse = buildGateReportModel(adapter([R1], unsupported), refuse(why));

  assert.deepEqual(summarizeGateReports([exact, quietPass, quietRefuse]).breaches, { kind: 'exact', count: 1 });
});

test('an empty run summarizes to zero everywhere with an exact zero breach total', () => {
  assert.deepEqual(summarizeGateReports([]), {
    passedGates: 0,
    failedGates: 0,
    refusedGates: 0,
    heldRules: 0,
    breachedRules: 0,
    undecidedRules: 0,
    unknownRules: 0,
    totalRules: 0,
    breaches: { kind: 'exact', count: 0 },
  });
});

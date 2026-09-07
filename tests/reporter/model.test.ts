import assert from 'node:assert/strict';
import test from 'node:test';
import {
  breach,
  buildGateReportModel,
  counting,
  defineAdapter,
  fail,
  pass,
  refuse,
  summarizeGateReports,
  type CountingCapability,
  type Scan,
} from 'redproof';

const scan: Scan = {
  source: 'unit',
  startedAt: '',
  finishedAt: '',
  inspected: 1,
};

const R1 = { id: 'r1', description: 'R1' } as const;
const R2 = { id: 'r2', description: 'R2' } as const;

function adapter(countingCapability: CountingCapability = counting.supported) {
  return defineAdapter({
    kind: 'unit',
    rules: { r1: R1, r2: R2 },
    check: {
      description: 'not executed by these tests',
      counting: countingCapability,
      async run() { return pass(scan); },
    },
  });
}

test('report model does not claim unknown Rules hold for non-countable failures', () => {
  const model = buildGateReportModel(
    adapter(counting.unsupported('only first finding is observable')),
    fail(scan, [breach(R1.id, { code: 'r1', message: 'R1 failed', location: null })]),
  );

  assert.deepEqual(model.rules.map(item => [item.rule.id, item.state.kind]), [
    ['r1', 'breached'],
    ['r2', 'unknown'],
  ]);
});

test('run summary is derived from Gate report models without I/O', () => {
  const a = buildGateReportModel(adapter(), pass(scan));
  const b = buildGateReportModel(adapter(), fail(scan, [
    breach(R1.id, { code: 'r1', message: 'R1 failed', location: null }),
  ]));
  const c = buildGateReportModel(adapter(), refuse(scan, {
    code: 'unavailable', message: 'Unavailable', location: null,
  }));

  assert.deepEqual(summarizeGateReports([a, b, c]), {
    passedGates: 1,
    failedGates: 1,
    refusedGates: 1,
    heldRules: 3,
    breachedRules: 1,
    undecidedRules: 2,
    unknownRules: 0,
    totalRules: 6,
    breaches: 1,
    exactBreachCount: true,
  });
});

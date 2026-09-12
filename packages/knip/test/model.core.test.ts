import assert from 'node:assert/strict';
import test from 'node:test';
import { defineRule } from 'redproof';
import { issueTypes, knipBreaches, parseKnipEvidence } from '../src/model.ts';

function report() {
  return {
    version: 1, hasConfigLoadErrors: false, hasBlockingHints: false, hintDetails: [],
    report: Object.fromEntries(issueTypes.map(type => [type, true])),
    counters: { ...Object.fromEntries(issueTypes.map(type => [type, 0])), processed: 3 } as Record<string, number>,
    issues: Object.fromEntries(issueTypes.map(type => [type, [] as unknown[]])),
  };
}

test('clean evidence counts inspected files, not findings', () => {
  assert.equal(parseKnipEvidence(JSON.stringify(report())).inspected, 3);
});

for (const type of issueTypes) test(`translates ${type} only to the selected Rule`, () => {
  const data = report();
  data.counters[type] = 1;
  data.issues[type] = [{ type, file: 'src/orders.ts', symbol: 'unusedReceipt', line: 4, col: 8,
    severity: 'warn', ...(type === 'cycles' || type === 'duplicates'
      ? { symbols: [{ symbol: 'first' }, { symbol: 'second' }] } : {}) }];
  const evidence = parseKnipEvidence(JSON.stringify(data));
  const rule = defineRule({ id: `knip/${type}`, description: 'No issues.' });
  const breaches = knipBreaches(evidence.findings, new Map([[type, rule]]));
  assert.equal(breaches.length, 1);
  assert.deepEqual(breaches[0]?.location, { file: 'src/orders.ts', line: 4, column: 8 });
  assert.equal(knipBreaches(evidence.findings, new Map()).length, 0);
});

for (const [name, change] of Object.entries({
  'missing categories': (data: ReturnType<typeof report>) => { delete data.report.files; },
  'contradictory totals': (data: ReturnType<typeof report>) => { data.counters.files = 1; },
  'invalid processed count': (data: ReturnType<typeof report>) => { data.counters.processed = -1; },
  'missing config status': (data: ReturnType<typeof report>) => { delete (data as Partial<typeof data>).hasConfigLoadErrors; },
})) test(`rejects ${name}`, () => {
  const data = report(); change(data);
  assert.throws(() => parseKnipEvidence(JSON.stringify(data)));
});

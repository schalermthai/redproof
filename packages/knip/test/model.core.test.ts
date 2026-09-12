import assert from 'node:assert/strict';
import test from 'node:test';
import { knip } from '../src/index.ts';
import { issueTypes, knipBreaches, parseKnipEvidence } from '../src/model.ts';

// Independent expectations: catch accidental public ID changes, not just internal consistency.
const expectedNames = {
  files: 'unused-files', dependencies: 'unused-dependencies', devDependencies: 'unused-dev-dependencies',
  optionalPeerDependencies: 'referenced-optional-peer-dependencies', unlisted: 'undeclared-dependencies',
  binaries: 'undeclared-command-dependencies', unresolved: 'unresolved-imports', exports: 'unused-exports',
  types: 'unused-exported-types', nsExports: 'unreferenced-exports-in-used-namespaces',
  nsTypes: 'unreferenced-types-in-used-namespaces', duplicates: 'duplicate-exports',
  enumMembers: 'unused-exported-enum-members', namespaceMembers: 'unused-exported-namespace-members',
  catalog: 'unused-catalog-entries', catalogReferences: 'unresolved-catalog-references', cycles: 'circular-imports',
} as const;

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
  const rule = knip({ rules: { selected: type } }).rules.selected;
  assert.equal(rule.id, `knip/${expectedNames[type]}`);
  assert.ok(rule.description.includes('must'));
  const breaches = knipBreaches(evidence.findings, new Map([[type, rule]]));
  assert.equal(breaches.length, 1);
  assert.equal(breaches[0]?.rule, `knip/${expectedNames[type]}`);
  assert.equal(breaches[0]?.code, type);
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

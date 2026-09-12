import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { defineRule } from 'redproof';
import { coverageBreaches, metrics, parseCoverage } from '../src/model.ts';
import { sample } from './support/workspace.ts';
const native = createRequire(import.meta.url)('istanbul-lib-coverage');
const root = '/project';

test('all four metrics agree with independent Istanbul library, globally and per file', () => {
  const input = { ...sample('/project/one.js', [2, 0]), ...sample('/project/two.js', [1, 3]) };
  const parsed = parseCoverage(JSON.stringify(input), root), map = native.createCoverageMap(input);
  for (const metric of metrics) {
    const expected = map.getCoverageSummary().data[metric];
    assert.deepEqual(parsed.total[metric], { covered: expected.covered, total: expected.total, pct: expected.pct });
    for (const file of parsed.files) {
      const expectedFile = map.fileCoverageFor(`${root}/${file.file}`).toSummary().data[metric];
      assert.equal(file.counts[metric].pct, expectedFile.pct);
    }
  }
});
test('line coverage uses maximum statement hits on a line, not average statement coverage', () => {
  const input = sample(); input['source.js']!.statementMap['1'].start.line = 1; input['source.js']!.statementMap['1'].end.line = 1;
  const parsed = parseCoverage(JSON.stringify(input), root);
  assert.equal(parsed.total.statements.pct, 50); assert.equal(parsed.total.lines.pct, 100);
});
test('empty maps count zero files and empty metrics follow native 100% convention', () => {
  const parsed = parseCoverage('{}', root); assert.equal(parsed.files.length, 0); assert.equal(parsed.total.branches.pct, 100);
});
for (const metric of metrics) test(`${metric} threshold targets only its Rule and supports per-file checks`, () => {
  const parsed = parseCoverage(JSON.stringify({ ...sample('one.js', [0, 0]), ...sample('two.js', [1, 1]) }), root);
  const rule = defineRule({ id: `istanbul/${metric}-coverage`, description: 'Coverage must hold.' });
  assert.equal(coverageBreaches(parsed, new Map([[metric, { rule, threshold: { minimum: 50 } }]])).length, 0);
  const breaches = coverageBreaches(parsed, new Map([[metric, { rule, threshold: { minimum: 50, perFile: true } }]]));
  assert.equal(breaches.length, 1); assert.equal(breaches[0]?.rule, rule.id); assert.equal(breaches[0]?.location?.file, 'one.js');
  assert.equal(coverageBreaches(parsed, new Map()).length, 0);
});
test('fractional percentages truncate rather than round before threshold comparison', () => {
  const input = sample(); const item = input['source.js']!;
  Object.assign(item.s, { '2': 1 }); Object.assign(item.statementMap, { '2': item.statementMap['1'] });
  assert.equal(parseCoverage(JSON.stringify(input), root).total.statements.pct, 66.66);
});
for (const [name, mutate] of Object.entries({
  'negative hits': (data: any) => { data['source.js'].s['0'] = -1; },
  'fractional hits': (data: any) => { data['source.js'].f['0'] = 0.5; },
  'orphan hits': (data: any) => { data['source.js'].s['2'] = 1; },
  'missing hits': (data: any) => { delete data['source.js'].s['0']; },
  'missing branch arm': (data: any) => { data['source.js'].b['0'] = [1]; },
  'invalid position': (data: any) => { data['source.js'].statementMap['0'].start.line = 0; },
  'reversed position': (data: any) => { data['source.js'].statementMap['0'].end.column = -1; },
  'mismatched identity': (data: any) => { data['source.js'].path = 'another.js'; },
  'outside path': (data: any) => { data['../outside.js'] = { ...data['source.js'], path: '../outside.js' }; },
  'duplicate identity': (data: any) => { data['./source.js'] = data['source.js']; },
})) test(`REFUSE parser rejects ${name}`, () => {
  const data = sample(); mutate(data); assert.throws(() => parseCoverage(JSON.stringify(data), root));
});
test('rejects summary-only JSON instead of trusting percentages', () => {
  assert.throws(() => parseCoverage('{"total":{"lines":{"pct":100}}}', root));
});
test('implicit else locations and c8 unknown columns preserve native branch totals', () => {
  const input = sample();
  (input['source.js']!.branchMap['0'].locations as unknown[])[1] = { start: {}, end: {} };
  input['source.js']!.branchMap['0'].locations[0]!.start.column = -1;
  const actual = parseCoverage(JSON.stringify(input), root);
  assert.equal(actual.total.branches.pct, native.createCoverageMap(input).getCoverageSummary().branches.pct);
  assert.equal(actual.total.branches.total, 2);
  assert.equal(actual.total.branches.covered, 1);
});

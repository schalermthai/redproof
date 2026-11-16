import assert from 'node:assert/strict';
import test from 'node:test';
import { fixture } from './support/fixture.ts';
import { parseCoveragePy } from '../src/core/evidence.ts';
import { coveragePyBreaches, type Selection } from '../src/core/rules.ts';
import { percent } from '../src/core/thresholds.ts';
import { report } from './support/report.ts';

const rule = (id: string) => ({ id }) as never;
const select = (config: Record<string, Record<string, unknown>>): Selection<never> => Object.fromEntries(
  Object.entries(config).map(([name, c]) => [name, { rule: rule(`coverage-py/${name}`), config: c }]));
const codes = (evidence: ReturnType<typeof parseCoveragePy>, config: Record<string, Record<string, unknown>>) =>
  coveragePyBreaches(evidence, select(config)).map(b => b.code);

test('real report: a.py 3/4 lines + 1/2 branches, unrun.py never executed, run.py clean', () => {
  const evidence = parseCoveragePy(fixture('cov.json'), '/w', '/w');
  assert.equal(evidence.branch, true);
  assert.deepEqual(evidence.files.map(f => [f.file, f.lines.covered, f.lines.total, f.branches.covered, f.branches.total]),
    [['a.py', 3, 4, 1, 2], ['run.py', 2, 2, 0, 0], ['unrun.py', 0, 2, 0, 0]]);
  assert.equal(percent(evidence.lines), 62.5);
  assert.deepEqual(codes(evidence, { lineCoverage: { minimum: 62.5 }, branchCoverage: { minimum: 50 } }), []);
  assert.deepEqual(codes(evidence, { lineCoverage: { minimum: 62.51 } }), ['line-coverage-below-minimum']);
  assert.deepEqual(codes(evidence, { branchCoverage: { minimum: 50.01 } }), ['branch-coverage-below-minimum']);
  const perFile = coveragePyBreaches(evidence, select({ perFileMinimum: { minimum: 75 } }));
  assert.deepEqual(perFile.map(b => b.location?.file), ['unrun.py']);
  assert.deepEqual(coveragePyBreaches(evidence, select({ perFileMinimum: { minimum: 75, metric: 'branches' } })).map(b => b.location?.file), ['a.py']);
  const never = coveragePyBreaches(evidence, select({ noUncoveredFiles: {} }));
  assert.deepEqual(never.map(b => [b.code, b.location?.file]), [['file-never-executed', 'unrun.py']]);
});
test('coverage.py uses percent_statements_covered for lines, not the blended percent_covered', () => {
  const real = JSON.parse(fixture('cov.json')).totals;
  assert.notEqual(real.percent_covered, real.percent_statements_covered);
  const evidence = parseCoveragePy(fixture('cov.json'), '/w', '/w');
  assert.equal(percent(evidence.lines), real.percent_statements_covered);
});
test('real report without --branch parses, has no branch data', () => {
  const evidence = parseCoveragePy(fixture('cov-nobranch.json'), '/w', '/w');
  assert.equal(evidence.branch, false);
  assert.deepEqual(evidence.branches, { total: 0, covered: 0 });
});
test('an empty file is 100% and is not an uncovered file', () => {
  const evidence = parseCoveragePy(report({ '__init__.py': { lines: [0, 0] }, 'x.py': { lines: [1, 0] } }), '/w', '/w');
  assert.deepEqual(codes(evidence, { perFileMinimum: { minimum: 100 }, noUncoveredFiles: {} }), []);
});
test('percent floors to two decimals and never rounds a failing number up into a pass', () => {
  const big = parseCoveragePy(report({ 'x.py': { lines: [99_999, 1] } }), '/w', '/w');
  assert.equal(percent(big.lines), 99.99);
  assert.deepEqual(codes(big, { lineCoverage: { minimum: 100 } }), ['line-coverage-below-minimum']);
});
test('paths resolve against the run directory and must stay inside the root', () => {
  const evidence = parseCoveragePy(report({ 'pkg/x.py': { lines: [1, 0] } }), '/w', '/w/sub');
  assert.equal(evidence.files[0]?.file, 'sub/pkg/x.py');
  assert.throws(() => parseCoveragePy(report({ '../x.py': { lines: [1, 0] } }), '/w', '/w'), /outside the Gate root/);
  assert.throws(() => parseCoveragePy(report({ '/etc/x.py': { lines: [1, 0] } }), '/w', '/w'), /outside the Gate root/);
});
test('rejects reports it cannot trust', () => {
  const good = JSON.parse(report({ 'x.py': { lines: [1, 1], branches: [1, 1] } }));
  const bad = (edit: (r: any) => void, message: RegExp) => { const r = structuredClone(good); edit(r); assert.throws(() => parseCoveragePy(JSON.stringify(r), '/w', '/w'), message); };
  bad(r => { r.meta.format = 2; }, /format 2/);
  bad(r => { delete r.meta.branch_coverage; }, /branch_coverage/);
  bad(r => { r.files['x.py'].summary.covered_lines = 2; }, /disagrees with line lists/);
  bad(r => { r.files['x.py'].missing_branches = []; }, /disagrees with branch lists/);
  bad(r => { r.totals.covered_lines = 2; }, /totals disagree/);
  bad(r => { delete r.files['x.py'].summary; }, /summary/);
  assert.throws(() => parseCoveragePy('{', '/w', '/w'));
  assert.throws(() => parseCoveragePy('[]', '/w', '/w'), /report object/);
});
test('dogfood: coverage.py measuring itself (44 files, 7378 statements, 2616 branches) parses and matches its own totals', () => {
  const text = fixture('dogfood-coveragepy.json'), raw = JSON.parse(text).totals;
  const evidence = parseCoveragePy(text, '/w', '/w');
  assert.equal(evidence.files.length, 44);
  assert.deepEqual(evidence.lines, { total: raw.num_statements, covered: raw.covered_lines });
  assert.deepEqual(evidence.branches, { total: raw.num_branches, covered: raw.covered_branches });
  // Same number coverage.py prints for lines; branches differ only by our floor vs its rounding.
  assert.equal(percent(evidence.lines), 43.33);
  assert.equal(percent(evidence.branches), 43.53); assert.equal(raw.percent_branches_covered.toFixed(2), '43.54');
  // Modules imported before tracing starts (coverage.py's own entry path) really show as never executed.
  const never = coveragePyBreaches(evidence, select({ noUncoveredFiles: {} })).map(b => b.location?.file);
  assert.ok(never.includes('coverage/__init__.py') && never.includes('coverage/env.py'), String(never));
});

import assert from 'node:assert/strict';
import test from 'node:test';
import { decide } from '../src/core/decide.ts';
import { parseCoveragePy } from '../src/core/evidence.ts';
import { coveragePyBreaches, metricOf, needsBranches, type Selection } from '../src/core/rules.ts';
import { below, percent } from '../src/core/thresholds.ts';
import { report, type FileSpec } from './support/report.ts';

// Seeded generator: failures are reproducible from the printed seed.
function prng(seed: number): () => number {
  return () => { seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const SEED = 20261116;
const rule = (id: string) => ({ id }) as never;
const select = (config: Record<string, Record<string, unknown>>): Selection<never> => Object.fromEntries(
  Object.entries(config).map(([name, c]) => [name, { rule: rule(`coverage-py/${name}`), config: c }]));
const all = select({ lineCoverage: { minimum: 80 }, branchCoverage: { minimum: 60 }, perFileMinimum: { minimum: 70 }, noUncoveredFiles: {} });
const keys = (e: ReturnType<typeof parseCoveragePy>, s: Selection<never> = all) =>
  coveragePyBreaches(e, s).map(b => `${b.rule}|${b.code}|${b.location?.file ?? ''}`);
const parse = (files: Record<string, FileSpec>, branch = true) => parseCoveragePy(report(files, branch), '/w', '/w');
function randomFiles(next: () => number, branch = true): Record<string, FileSpec> {
  const files: Record<string, FileSpec> = {}, n = 1 + Math.floor(next() * 6);
  for (let i = 0; i < n; i++) files[`f${i}.py`] = { lines: [Math.floor(next() * 12), Math.floor(next() * 12)],
    ...(branch ? { branches: [Math.floor(next() * 6), Math.floor(next() * 6)] as [number, number] } : {}) };
  return files;
}

test('law: a threshold is met exactly when covered/total >= minimum, including exact ties (float products got 13 of 3920 wrong)', () => {
  let ties = 0;
  for (let total = 1; total <= 400; total++) for (let covered = 0; covered <= total; covered++) {
    const hundredths = covered * 10_000 / total; // exact tie only when this is an integer
    if (!Number.isInteger(hundredths)) continue;
    ties++;
    const count = { total, covered };
    assert.equal(below(count, hundredths / 100), false, `${covered}/${total} meets ${hundredths / 100}`);
    if (hundredths < 10_000) assert.equal(below(count, (hundredths + 1) / 100), true, `${covered}/${total} misses ${(hundredths + 1) / 100}`);
  }
  assert.ok(ties > 3000);
  assert.equal(below({ total: 250, covered: 161 }, 64.4), false); // first float counterexample, pinned by name
  assert.equal(below({ total: 0, covered: 0 }, 100), false); // nothing to cover is 100 %
});
test('law: a reported breach is honest: below(count, m) implies the floored percent is under m', () => {
  const next = prng(SEED);
  for (let i = 0; i < 2000; i++) {
    const total = 1 + Math.floor(next() * 500), covered = Math.floor(next() * (total + 1)), m = Math.round(next() * 10_000) / 100;
    if (below({ total, covered }, m)) assert.ok(percent({ total, covered }) < m, `${covered}/${total} vs ${m}`);
  }
});
test('law: raising coverage never adds a breach (monotone)', () => {
  const next = prng(SEED + 1);
  for (let i = 0; i < 300; i++) {
    const files = randomFiles(next), name = Object.keys(files)[Math.floor(next() * Object.keys(files).length)]!;
    const spec = files[name]!, [c, m] = spec.lines;
    if (!m) continue;
    const better = { ...files, [name]: { ...spec, lines: [c + 1, m - 1] as [number, number] } };
    const before = new Set(keys(parse(files)));
    for (const k of keys(parse(better))) assert.ok(before.has(k), `new breach ${k} after improving ${name} (seed ${SEED + 1}, run ${i})`);
  }
});
test('law: the order of files in the report never changes evidence or breaches', () => {
  const next = prng(SEED + 2);
  for (let i = 0; i < 200; i++) {
    const files = randomFiles(next), entries = Object.entries(files);
    const shuffled = Object.fromEntries([...entries].sort(() => next() - 0.5));
    assert.deepEqual(parse(shuffled), parse(files));
    assert.deepEqual(keys(parse(shuffled)), keys(parse(files)));
  }
});
test('law: every never-executed file also breaches per-file-minimum for any positive minimum', () => {
  const next = prng(SEED + 3);
  for (let i = 0; i < 300; i++) {
    const evidence = parse(randomFiles(next));
    const never = new Set(keys(evidence, select({ noUncoveredFiles: {} })).map(k => k.split('|')[2]));
    const perFile = new Set(keys(evidence, select({ perFileMinimum: { minimum: 0.01 } })).map(k => k.split('|')[2]));
    for (const file of never) assert.ok(perFile.has(file), file);
  }
});
test('decide: precedence is unusable evidence, then missing inventory, then breaches', () => {
  const noBranch = parse({ 'x.py': { lines: [0, 2] } }, false), withBranch = parse({ 'x.py': { lines: [0, 2], branches: [0, 2] } });
  const refusalCode = (d: ReturnType<typeof decide>) => d.kind === 'refused' ? d.refusal.code : d.breaches.map(b => b.code).join();
  const everything = select({ lineCoverage: { minimum: 100 }, branchCoverage: { minimum: 100 } });
  assert.equal(refusalCode(decide(noBranch, ['missing.py'], everything)), 'coverage-py-evidence-unavailable');
  assert.equal(refusalCode(decide(withBranch, ['missing.py'], everything)), 'coverage-py-incomplete-inventory');
  assert.equal(refusalCode(decide(withBranch, ['x.py'], everything)), 'line-coverage-below-minimum,branch-coverage-below-minimum');
  // Branch-less evidence is fine when no selected rule needs branches, and the per-file branches metric does need them.
  assert.equal(refusalCode(decide(noBranch, [], select({ lineCoverage: { minimum: 100 } }))), 'line-coverage-below-minimum');
  assert.equal(refusalCode(decide(noBranch, [], select({ perFileMinimum: { minimum: 100, metric: 'branches' } }))), 'coverage-py-evidence-unavailable');
  assert.equal(refusalCode(decide(noBranch, [], select({ perFileMinimum: { minimum: 100 } }))), 'file-below-minimum');
});
test('decide: a report that measures nothing is refused, never passed', () => {
  const empty = parse({ 'a.py': { lines: [0, 0] }, 'b.py': { lines: [0, 0] } });
  const d = decide(empty, [], select({ lineCoverage: { minimum: 100 }, noUncoveredFiles: {} }));
  assert.equal(d.kind, 'refused'); if (d.kind === 'refused') assert.match(d.refusal.detail ?? '', /zero statements/);
  assert.equal(decide(parse({ 'a.py': { lines: [0, 0] }, 'b.py': { lines: [1, 0] } }), [], select({ lineCoverage: { minimum: 100 } })).kind, 'decided');
  // Precedence: missing inventory is reported before the vacuous report.
  const both = decide(empty, ['gone.py'], select({ lineCoverage: { minimum: 100 } }));
  assert.equal(both.kind === 'refused' && both.refusal.code, 'coverage-py-incomplete-inventory');
});
test('needsBranches truth table', () => {
  assert.deepEqual([
    needsBranches({ lineCoverage: { minimum: 1 }, noUncoveredFiles: {} }), needsBranches({ branchCoverage: { minimum: 1 } }),
    needsBranches({ perFileMinimum: { minimum: 1, metric: 'branches' } }), needsBranches({ perFileMinimum: { minimum: 1, metric: 'lines' } }),
    needsBranches({ perFileMinimum: { minimum: 1 } }),
  ], [false, true, true, false, false]);
  assert.equal(metricOf({ minimum: 1 }), 'lines'); // the one place the default lives
});
test('the core refuses relative paths instead of silently reading process.cwd()', () => {
  assert.throws(() => parseCoveragePy(report({ 'x.py': { lines: [1, 0] } }), 'w', '/w'), /absolute/);
  assert.throws(() => parseCoveragePy(report({ 'x.py': { lines: [1, 0] } }), '/w', 'w'), /absolute/);
});

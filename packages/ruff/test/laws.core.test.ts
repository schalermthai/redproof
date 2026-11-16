import assert from 'node:assert/strict';
import test from 'node:test';
import { defineRule, type Rule } from 'redproof';
import { evaluateLint, judgeListing, type RuffDecision } from '../src/core/decision.ts';
import { attribute, parseRuffReport, ruffVersionSupported, selectorCovers } from '../src/core/model.ts';
const selectorMatches = selectorCovers;

/** Deterministic generator, so a failing case is reproducible from its seed. */
function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const pick = <T>(r: () => number, items: readonly T[]): T => items[Math.floor(r() * items.length)]!;
const shuffled = <T>(r: () => number, items: readonly T[]): T[] =>
  items.map(item => [r(), item] as const).sort((a, b) => a[0] - b[0]).map(([, item]) => item);

const SELECTORS = ['F', 'F4', 'F40', 'F401', 'F402', 'F8', 'S', 'S1', 'S101', 'S2', 'SIM', 'SIM1', 'SIM110', 'SLF', 'PL', 'PLR', 'PLC', 'PLR0913', 'PLE', 'P', 'PYI', 'PT', 'PTH', 'PERF', 'PIE', 'PD', 'PGH',
  'E', 'E4', 'E401', 'EM', 'ERA', 'T', 'T20', 'T201', 'TC', 'TID', 'TRY', 'A', 'AIR', 'ASYNC', 'D', 'DJ', 'DTZ', 'UP', 'UP0'];
const CODES = ['F401', 'F402', 'F811', 'F841', 'S101', 'S201', 'SIM110', 'SIM101', 'SLF001', 'PLR0913', 'PLC0414', 'PLW0602', 'PLE0100', 'PYI001', 'PT001', 'PTH100', 'PERF101', 'PIE790', 'PD002', 'PGH003', 'E401', 'E501', 'EM101',
  'ERA001', 'T201', 'T100', 'TC001', 'TID252', 'TRY003', 'A001', 'AIR001', 'ASYNC100', 'D100', 'DJ001', 'DTZ001', 'UP006', 'UP035'];
const rule = (id: string): Rule<string> => defineRule({ id, description: id });

test('LAW selectorCovers is a partial order: reflexive, antisymmetric, transitive', () => {
  for (const a of SELECTORS) {
    assert.ok(selectorCovers(a, a), `${a} covers itself`);
    for (const b of SELECTORS) {
      if (selectorCovers(a, b) && selectorCovers(b, a)) assert.equal(a, b, `${a} and ${b} cover each other`);
      for (const c of SELECTORS) {
        if (selectorCovers(a, b) && selectorCovers(b, c)) assert.ok(selectorCovers(a, c), `${a} > ${b} > ${c}`);
      }
    }
  }
});

test('LAW a code matches a selector exactly when it is the selector or lies under it (never a longer sibling)', () => {
  for (const code of CODES) {
    const letters = /^[A-Z]+/u.exec(code)![0];
    for (const selector of SELECTORS) {
      const sel = /^([A-Z]+)([0-9]*)$/u.exec(selector)!;
      const expected = (sel[1] === letters || (sel[1] === 'PL' && letters.startsWith('PL'))) && code.slice(letters.length).startsWith(sel[2]!);
      assert.equal(selectorMatches(selector, code), expected, `${selector} vs ${code}`);
    }
  }
});

function finding(code: string | null, n: number) {
  return { code, message: `m${n}`, filename: `/p/f${n % 3}.py`, location: { row: n + 1, column: 1 }, name: null, cell: null, fix: null };
}
const report = (codes: readonly (string | null)[]) => JSON.stringify(codes.map((code, n) => finding(code, n)));

/** A random set of selectors that cover nothing of each other, as the options validator guarantees. */
function disjointSelectors(r: () => number): string[] {
  const chosen: string[] = [];
  for (const selector of shuffled(r, SELECTORS)) {
    if (chosen.length < 1 + Math.floor(r() * 6) && chosen.every(c => !selectorCovers(c, selector) && !selectorCovers(selector, c))) chosen.push(selector);
  }
  return chosen;
}

test('LAW attribution: each finding lands on at most one Rule; order and selector order do not matter; counts are conserved', () => {
  for (let seed = 1; seed <= 300; seed++) {
    const r = prng(seed);
    const selectors = disjointSelectors(r);
    const codes = Array.from({ length: Math.floor(r() * 25) }, () => pick(r, [...CODES, null]));
    const findings = parseRuffReport(report(codes));
    const as = (order: readonly string[]) => new Map(order.map(s => [s, rule(`ruff/${s}`)]));
    const breaches = attribute(findings, as(selectors), f => f).breaches;

    const covered = codes.filter(code => code !== null && selectors.some(s => selectorMatches(s, code)));
    const placed = attribute(findings, as(selectors), f => f);
    assert.equal(placed.unanalysed.length, codes.filter(c => c === null).length, `seed ${seed}: syntax errors are reported, never dropped`);
    assert.deepEqual([...placed.strangers].sort(),
      [...new Set(codes.filter(c => c !== null && !selectors.some(s => selectorMatches(s, c))))].sort(), `seed ${seed}: strangers are reported, never dropped`);
    assert.equal(breaches.length, covered.length, `seed ${seed}: conservation`);
    assert.deepEqual(breaches.map(b => b.code), covered, `seed ${seed}: input order kept, syntax errors and strangers dropped`);
    for (const b of breaches) assert.ok(selectorMatches(b.rule.slice('ruff/'.length), b.code), `seed ${seed}: ${b.code} under ${b.rule}`);

    const permuted = attribute(findings, as(shuffled(r, selectors)), f => f).breaches;
    assert.deepEqual(permuted, breaches, `seed ${seed}: selector order is irrelevant for disjoint selectors`);

    const doubled = attribute([...findings, ...findings], as(selectors), f => f).breaches;
    assert.equal(doubled.length, 2 * breaches.length, `seed ${seed}: breaches of concatenated reports are the concatenation`);
  }
});

test('LAW version support is monotone and equals tuple order against the floor 0.4.10', () => {
  const grid: [number, number, number][] = [];
  for (const major of [0, 1]) for (const minor of [0, 3, 4, 5, 17]) for (const patch of [0, 9, 10, 11]) grid.push([major, minor, patch]);
  const floor = [0, 4, 10];
  const cmp = (a: readonly number[], b: readonly number[]) => a[0]! - b[0]! || a[1]! - b[1]! || a[2]! - b[2]!;
  for (const v of grid) {
    assert.equal(ruffVersionSupported(v), cmp(v, floor) >= 0, `v${v.join('.')}`);
    for (const w of grid) if (ruffVersionSupported(v) && cmp(w, v) >= 0) assert.ok(ruffVersionSupported(w), `${v} supported so ${w}`);
  }
});

const done = (exitCode: number, stdout: string, stderr = '') => Object.freeze({ kind: 'completed' as const, exitCode, stdout, stderr });
const decide = (inspected: number, exec: ReturnType<typeof done>, selectors: readonly string[]): RuffDecision<string> =>
  evaluateLint(inspected, exec, new Map(selectors.map(s => [s, rule(`ruff/${s}`)])), f => f);

test('LAW verdict precedence: REFUSE dominates FAIL, FAIL dominates PASS, and no input is mutated', () => {
  for (let seed = 1; seed <= 300; seed++) {
    const r = prng(seed * 7919);
    const selectors = disjointSelectors(r);
    const codes = Array.from({ length: Math.floor(r() * 12) }, () => pick(r, [...CODES, null, 'invalid-syntax']));
    const stdout = report(codes);
    const exit = codes.length ? 1 : 0;
    const frozen = Object.freeze([...selectors]);
    const d = decide(5, done(exit, stdout), frozen);

    const syntax = codes.some(c => c === null || c === 'invalid-syntax');
    const strangers = codes.some(c => c !== null && c !== 'invalid-syntax' && !selectors.some(s => selectorMatches(s, c)));
    const covered = codes.filter(c => c !== null && c !== 'invalid-syntax' && selectors.some(s => selectorMatches(s, c)));
    if (syntax) assert.deepEqual([d.kind, d.kind === 'refuse' && d.code], ['refuse', 'ruff-syntax-error'], `seed ${seed}`);
    else if (strangers) assert.deepEqual([d.kind, d.kind === 'refuse' && d.code], ['refuse', 'ruff-unattributed-finding'], `seed ${seed}`);
    else if (covered.length) assert.ok(d.kind === 'evidence' && d.breaches.length === covered.length, `seed ${seed}`);
    else assert.ok(d.kind === 'evidence' && d.breaches.length === 0 && d.inspected === 5, `seed ${seed}: PASS`);
  }
});

test('LAW exit code and report must tell the same story', () => {
  const one = report(['F401']);
  assert.equal(decide(1, done(0, one), ['F401']).kind, 'refuse');
  assert.equal(decide(1, done(1, '[]'), ['F401']).kind, 'refuse');
  assert.equal(decide(1, done(1, one), ['F401']).kind, 'evidence');
  assert.equal(decide(1, done(0, '[]'), ['F401']).kind, 'evidence');
  for (const exit of [2, 3, 101, 137, 139]) assert.equal(decide(1, done(exit, '[]'), ['F401']).kind, 'refuse', `exit ${exit}`);
});

test('LAW a listing that lists only settings files inspects nothing', () => {
  const j = (stdout: string) => judgeListing(done(0, stdout));
  assert.equal(j('/p/ruff.toml\n/p/pyproject.toml\n/p/.ruff.toml\n').kind, 'refuse');
  assert.equal(j('/p/ruff.toml\n').kind, 'refuse');
  assert.equal(j('').kind, 'refuse');
  assert.deepEqual(j('/p/ruff.toml\n/p/a.py\n/p/b.pyi\n'), { kind: 'continue', inspected: 2 });
});

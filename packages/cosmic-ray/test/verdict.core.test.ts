import assert from 'node:assert/strict';
import test from 'node:test';
import { defineRule } from 'redproof';
import { decideCosmicRayRun, cosmicRayMetrics } from '../src/core/verdict.ts';
import { mutants, type FixtureName } from './support/fixtures.ts';

const detected = defineRule({ id: 'cosmic-ray/mutants-detected', description: 'd' });
const score = defineRule({ id: 'cosmic-ray/mutation-score', description: 's' });
const scan = { source: 'cosmic-ray', startedAt: '', finishedAt: '', inspected: null };

function decide(name: FixtureName, policies: Parameters<typeof decideCosmicRayRun>[0]['policies']) {
  return decideCosmicRayRun({ scan, root: '/p', cwd: '/p', mutants: mutants(name), policies });
}

test('every mutant killed passes both rules', () => {
  const verdict = decide('all-killed', { mutantsDetected: detected, mutationScore: { rule: score, minimum: 100 } });
  assert.equal(verdict.verdict, 'pass');
});

test('survivors are breaches with file, line and column', () => {
  const verdict = decide('survivors', { mutantsDetected: detected });
  assert.equal(verdict.verdict, 'fail');
  if (verdict.verdict !== 'fail') return;
  assert.equal(verdict.breaches.length, 7);
  assert.equal(verdict.breaches[0]?.code, 'mutant-survived');
  assert.deepEqual(verdict.breaches[0]?.location, { file: 'mod.py', line: 2, column: 14 });
  assert.match(verdict.breaches[0]?.detail ?? '', /ReplaceBinaryOperator_Add_\w+ — .*return a/u);
});

test('score is killed over killed+survived (4/11)', () => {
  assert.ok(Math.abs((cosmicRayMetrics(mutants('survivors')).score ?? 0) - 36.3636) < 0.001);
  const verdict = decide('survivors', { mutationScore: { rule: score, minimum: 50 } });
  assert.equal(verdict.verdict, 'fail');
  if (verdict.verdict !== 'fail') return;
  assert.deepEqual(verdict.breaches.map(item => item.code), ['mutation-score-below-minimum']);
  assert.equal(decide('survivors', { mutationScore: { rule: score, minimum: 36 } }).verdict, 'pass');
});

test('a score rule alone does not report each survivor', () => {
  const verdict = decide('survivors', { mutationScore: { rule: score, minimum: 90 } });
  assert.equal(verdict.verdict === 'fail' && verdict.breaches.length, 1);
});

for (const name of ['pending', 'timeout', 'worker-exception', 'incompetent', 'skipped', 'partial'] as const) {
  test(`${name} mutants refuse instead of passing`, () => {
    const verdict = decide(name, { mutantsDetected: detected, mutationScore: { rule: score, minimum: 0 } });
    assert.equal(verdict.verdict, 'refuse');
    if (verdict.verdict === 'refuse') assert.equal(verdict.why.code, 'cosmic-ray-incomplete');
  });
}

test('zero mutants refuse', () => {
  const verdict = decideCosmicRayRun({ scan, root: '/p', cwd: '/p', mutants: [], policies: { mutantsDetected: detected } });
  assert.equal(verdict.verdict === 'refuse' && verdict.why.code, 'cosmic-ray-no-mutants');
});

test('a partly finished session (exec killed) refuses even when the finished jobs were all kills', () => {
  const verdict = decide('partial', { mutationScore: { rule: score, minimum: 0 } });
  assert.equal(verdict.verdict === 'refuse' && verdict.why.code, 'cosmic-ray-incomplete');
});

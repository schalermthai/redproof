import assert from 'node:assert/strict';
import test from 'node:test';
import { defineRule } from 'redproof';
import { decideCosmicRayRun, cosmicRayMetrics, scoreBelowMinimum } from '../src/core/verdict.ts';
import { mutants, type FixtureName } from './support/fixtures.ts';

const detected = defineRule({ id: 'cosmic-ray/mutants-detected', description: 'd' });
const score = defineRule({ id: 'cosmic-ray/mutation-score', description: 's' });
const scan = { source: 'cosmic-ray', startedAt: '', finishedAt: '', inspected: null };

function decide(name: FixtureName, policies: Parameters<typeof decideCosmicRayRun>[0]['policies'], timeouts: 'detected' | 'refuse' = 'refuse') {
  return decideCosmicRayRun({ scan, root: '/p', cwd: '/p', mutants: mutants(name), timeouts, policies });
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

for (const name of ['pending', 'worker-exception', 'no-test', 'incompetent', 'skipped', 'partial'] as const) {
  test(`${name} mutants refuse instead of passing`, () => {
    const verdict = decide(name, { mutantsDetected: detected, mutationScore: { rule: score, minimum: 0 } });
    assert.equal(verdict.verdict, 'refuse');
    if (verdict.verdict === 'refuse') assert.equal(verdict.why.code, 'cosmic-ray-incomplete');
  });
}

test('zero mutants refuse', () => {
  const verdict = decideCosmicRayRun({ scan, root: '/p', cwd: '/p', mutants: [], timeouts: 'refuse', policies: { mutantsDetected: detected } });
  assert.equal(verdict.verdict === 'refuse' && verdict.why.code, 'cosmic-ray-no-mutants');
});

test('a partly finished session (exec killed) refuses even when the finished jobs were all kills', () => {
  const verdict = decide('partial', { mutationScore: { rule: score, minimum: 0 } });
  assert.equal(verdict.verdict === 'refuse' && verdict.why.code, 'cosmic-ray-incomplete');
});

test('timeouts: refuse refuses a run with any timed-out mutant', () => {
  const verdict = decide('one-timeout', { mutantsDetected: detected }, 'refuse');
  assert.equal(verdict.verdict === 'refuse' && verdict.why.code, 'cosmic-ray-incomplete');
});

test('timeouts: detected counts an infinite-loop mutant as a kill (a healthy suite passes both rules)', () => {
  const policies = { mutantsDetected: detected, mutationScore: { rule: score, minimum: 100 } };
  assert.equal(decide('one-timeout', policies, 'detected').verdict, 'pass');
});

test('timeouts: detected still lists a timed-out mutant when the score is breached', () => {
  const verdict = decide('timeout-and-survivors', { mutationScore: { rule: score, minimum: 100 } }, 'detected');
  assert.equal(verdict.verdict, 'fail');
  if (verdict.verdict !== 'fail') return;
  assert.match(verdict.breaches[0]?.detail ?? '', /including 1 timed out: mod\.py:2/u);
  // 1 killed + 1 timeout of 4 judged is 50%; leaving the timeout out of the score would read 1 of 3 (33.33%).
  assert.equal(verdict.breaches[0]?.comparison?.actual, '50.00%');
});

test('more than half of the mutants timing out refuses even when timeouts are detected', () => {
  for (const name of ['timeout', 'many-timeouts'] as const) {
    const verdict = decide(name, { mutationScore: { rule: score, minimum: 1 } }, 'detected');
    assert.equal(verdict.verdict === 'refuse' && verdict.why.code, 'cosmic-ray-timeouts-excessive', name);
  }
});

test('timeouts: refuse also refuses the all-timeout run', () => {
  const verdict = decide('timeout', { mutantsDetected: detected }, 'refuse');
  assert.equal(verdict.verdict === 'refuse' && verdict.why.code, 'cosmic-ray-incomplete');
});

test('the score law is decided in integers: 29 of 50 meets a minimum of 58', () => {
  assert.ok((29 / 50) * 100 < 58, 'in floats this reads 57.99999999999999 and would breach');
  assert.equal(scoreBelowMinimum(29, 50, 58), false);
  assert.equal(scoreBelowMinimum(29, 50, 58.000001), true);
  assert.equal(scoreBelowMinimum(28, 50, 58), true);
});

test('for every small run and whole minimum, the score law equals exact integer arithmetic', () => {
  for (let valid = 1; valid <= 200; valid += 1) {
    for (let killed = 0; killed <= valid; killed += 1) {
      for (const minimum of [1, 25, 33, 50, 57, 58, 66, 87, 90, 99, 100]) {
        assert.equal(scoreBelowMinimum(killed, valid, minimum), killed * 100 < minimum * valid, `${killed}/${valid} at ${minimum}`);
      }
    }
  }
});

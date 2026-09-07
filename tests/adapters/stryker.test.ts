import assert from 'node:assert/strict';
import test from 'node:test';
import { defineRule } from 'redproof';
import { stryker } from '@redproof/stryker';
import {
  mutationMetrics,
  mutationScoreBreach,
  undetectedMutantBreaches,
  type StrykerMutantResult,
} from '../../packages/stryker/src/model.ts';

const detectedRule = defineRule({
  id: 'stryker/mutants-detected',
  description: 'All valid mutants must be detected.',
});
const scoreRule = defineRule({
  id: 'stryker/mutation-score',
  description: 'Mutation score must hold.',
});

const mutant = (
  id: string,
  status: StrykerMutantResult['status'],
): StrykerMutantResult => ({
  id,
  status,
  fileName: 'src/parser.ts',
  mutatorName: 'EqualityOperator',
  replacement: '>',
  location: {
    start: { line: 4, column: 10 },
  },
});

test('Stryker metrics follow detected/undetected/valid semantics', () => {
  const metrics = mutationMetrics([
    mutant('1', 'Killed'),
    mutant('2', 'Timeout'),
    mutant('3', 'Survived'),
    mutant('4', 'NoCoverage'),
    mutant('5', 'CompileError'),
    mutant('6', 'RuntimeError'),
    mutant('7', 'Ignored'),
  ]);

  assert.deepEqual(metrics, {
    detected: 2,
    undetected: 2,
    valid: 4,
    invalid: 2,
    ignored: 1,
    pending: 0,
    score: 50,
  });
});

test('mutantsDetected creates one Breach per Survived or NoCoverage mutant', () => {
  const breaches = undetectedMutantBreaches([
    mutant('1', 'Killed'),
    mutant('2', 'Survived'),
    mutant('3', 'NoCoverage'),
    mutant('4', 'Timeout'),
  ], detectedRule);

  assert.equal(breaches.length, 2);
  assert.deepEqual(breaches.map(item => item.code), [
    'mutant-survived',
    'mutant-no-coverage',
  ]);
  assert.deepEqual(breaches[0]?.location, {
    file: 'src/parser.ts',
    line: 4,
    column: 10,
  });
});

test('mutationScore emits one global comparison Breach below the minimum', () => {
  const below = mutationScoreBreach({
    detected: 3,
    undetected: 1,
    valid: 4,
    invalid: 0,
    ignored: 0,
    pending: 0,
    score: 75,
  }, 80, scoreRule);

  assert.equal(below?.rule, scoreRule.id);
  assert.deepEqual(below?.comparison, {
    expected: '>= 80.00%',
    actual: '75.00%',
  });
  assert.equal(below?.location, null);

  assert.equal(mutationScoreBreach({
    detected: 4,
    undetected: 0,
    valid: 4,
    invalid: 0,
    ignored: 0,
    pending: 0,
    score: 100,
  }, 80, scoreRule), null);
});

test('mutation score is unavailable when there are no valid mutants', () => {
  const metrics = mutationMetrics([
    mutant('1', 'CompileError'),
    mutant('2', 'RuntimeError'),
  ]);
  assert.equal(metrics.score, null);
});

test('the Stryker adapter rejects a rule name it does not know', () => {
  assert.throws(
    () => stryker({ rules: { mutantsDetected: true, mutantsKilled: true } as never }),
    /Unknown Stryker rule option: "mutantsKilled"\. Known options: mutantsDetected, mutationScore\./,
  );
});

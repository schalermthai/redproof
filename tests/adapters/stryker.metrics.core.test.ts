import assert from 'node:assert/strict';
import test from 'node:test';
import {
  mutationMetrics,
  mutationScoreBreach,
  strykerProgrammaticOptions,
  undetectedMutantBreaches,
  type MutationMetrics,
  type StrykerMutantResult,
} from '../../packages/stryker/src/model.ts';

test('the programmatic producer cannot write beside the Redproof reporter', () => {
  assert.deepEqual(strykerProgrammaticOptions('stryker.config.mjs'), {
    configFile: 'stryker.config.mjs',
    reporters: [],
    cleanTempDir: 'always',
    logLevel: 'off',
    fileLogLevel: 'off',
  });

  assert.deepEqual(strykerProgrammaticOptions(), {
    reporters: [],
    cleanTempDir: 'always',
    logLevel: 'off',
    fileLogLevel: 'off',
  });
});

const detectedRule = {
  id: 'stryker/mutants-detected',
  description: 'All valid mutants must be detected.',
} as const;
const scoreRule = {
  id: 'stryker/mutation-score',
  description: 'Mutation score must hold.',
} as const;

const mutant = (
  id: string,
  status: StrykerMutantResult['status'],
  extra: Partial<StrykerMutantResult> = {},
): StrykerMutantResult => ({
  id,
  status,
  fileName: 'src/parser.ts',
  mutatorName: 'EqualityOperator',
  replacement: '>',
  location: {
    start: { line: 4, column: 10 },
    end: { line: 4, column: 12 },
  },
  ...extra,
});

const metricsOf = (counts: Partial<MutationMetrics>): MutationMetrics => ({
  detected: 0,
  undetected: 0,
  valid: 0,
  invalid: 0,
  ignored: 0,
  pending: 0,
  score: null,
  ...counts,
});

test('a killed or timed-out mutant counts as detected, a survivor or an uncovered mutant as undetected', () => {
  const metrics = mutationMetrics([
    mutant('1', 'Killed'),
    mutant('2', 'Timeout'),
    mutant('3', 'Survived'),
    mutant('4', 'NoCoverage'),
    mutant('5', 'CompileError'),
    mutant('6', 'RuntimeError'),
    mutant('7', 'Ignored'),
    mutant('8', 'Pending'),
  ]);

  assert.deepEqual(metrics, {
    detected: 2,
    undetected: 2,
    valid: 4,
    invalid: 2,
    ignored: 1,
    pending: 1,
    score: 50,
  });
});

test('the mutation score is the detected share of valid mutants, and is unavailable without one', () => {
  assert.equal(mutationMetrics([
    mutant('1', 'Killed'),
    mutant('2', 'Killed'),
    mutant('3', 'Killed'),
    mutant('4', 'Survived'),
  ]).score, 75);

  assert.equal(mutationMetrics([
    mutant('1', 'CompileError'),
    mutant('2', 'RuntimeError'),
    mutant('3', 'Ignored'),
  ]).score, null);

  assert.equal(mutationMetrics([]).score, null);
});

test('every undetected mutant becomes one Breach that says how it escaped and where', () => {
  const breaches = undetectedMutantBreaches([
    mutant('1', 'Killed'),
    mutant('2', 'Survived'),
    mutant('3', 'NoCoverage'),
    mutant('4', 'Timeout'),
    mutant('5', 'Ignored'),
  ], detectedRule);

  assert.deepEqual(breaches.map(item => item.code), [
    'mutant-survived',
    'mutant-no-coverage',
  ]);
  assert.deepEqual(breaches.map(item => item.rule), [
    detectedRule.id,
    detectedRule.id,
  ]);
  assert.equal(breaches[0]?.message, 'Stryker mutant survived the test suite.');
  assert.equal(breaches[1]?.message, 'Stryker mutant had no test coverage.');
  assert.deepEqual(breaches[0]?.location, {
    file: 'src/parser.ts',
    line: 4,
    column: 10,
  });
});

test('a mutant Breach carries the mutator, the replacement, and the reason Stryker gave', () => {
  const [described] = undetectedMutantBreaches([
    mutant('1', 'Survived', { description: 'age >= 18 becomes age > 18' }),
  ], detectedRule);
  assert.equal(described?.detail, 'EqualityOperator — age >= 18 becomes age > 18');

  const [plain] = undetectedMutantBreaches([
    mutant('2', 'Survived', { statusReason: 'test timed out late' }),
  ], detectedRule);
  assert.equal(plain?.detail, 'EqualityOperator — replacement: > — test timed out late');

  const [anonymous] = undetectedMutantBreaches([
    { id: '3', status: 'Survived' },
  ], detectedRule);
  assert.equal(anonymous?.location, null);
  assert.equal(anonymous?.detail, undefined);
});

test('a baseline Breach says the mutant is outside the accepted baseline', () => {
  const [outside] = undetectedMutantBreaches(
    [mutant('1', 'Survived')],
    detectedRule,
    'outside the accepted baseline',
  );

  assert.equal(
    outside?.message,
    'Stryker mutant survived the test suite, outside the accepted baseline.',
  );
});

test('a mutation score at the minimum is accepted and a lower one is a single comparison Breach', () => {
  assert.equal(
    mutationScoreBreach(
      metricsOf({ detected: 4, undetected: 1, valid: 5, score: 80 }),
      80,
      scoreRule,
    ),
    null,
  );

  const below = mutationScoreBreach(
    metricsOf({ detected: 3, undetected: 1, valid: 4, score: 75 }),
    80,
    scoreRule,
  );
  assert.equal(below?.rule, scoreRule.id);
  assert.equal(below?.code, 'mutation-score-below-minimum');
  assert.deepEqual(below?.comparison, { expected: '>= 80.00%', actual: '75.00%' });
  assert.equal(below?.location, null);
  assert.equal(below?.detail, '3 detected, 1 undetected, 4 valid mutants.');
});

test('an unavailable mutation score is never reported as a score Breach', () => {
  assert.equal(
    mutationScoreBreach(metricsOf({ invalid: 2 }), 80, scoreRule),
    null,
  );
});

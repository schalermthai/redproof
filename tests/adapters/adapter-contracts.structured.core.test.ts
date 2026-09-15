import assert from 'node:assert/strict';
import test from 'node:test';
import { defineRule, type Rule } from 'redproof';
import {
  violationsToBreaches,
  type DependencyCruiserViolation,
} from '../../packages/dependency-cruiser/src/core/model.ts';
import { eslintBreaches } from '../../packages/eslint/src/core/model.ts';
import {
  undetectedMutantBreaches,
  type StrykerMutantResult,
} from '../../packages/stryker/src/core/model.ts';
import { testRunBreaches } from '../../packages/testing/src/core/model.ts';

const eslintRule = defineRule({ id: 'eslint/semi', description: 'Semicolons must hold.' });
const dependencyRule = defineRule({
  id: 'dependency-cruiser/no-cycles',
  description: 'Cycles must not exist.',
});
const strykerRule = defineRule({
  id: 'stryker/mutants-detected',
  description: 'Mutants must be detected.',
});
const testingRule = defineRule({ id: 'testing/tests-pass', description: 'Tests must pass.' });

test('structured: every Adapter creates Breaches only from selected structured findings', () => {
  const eslintFindings = eslintBreaches('/repo', [{
    filePath: '/repo/src/a.ts',
    messages: [
      { ruleId: 'semi', message: 'Missing semicolon.', line: 1, column: 10 },
      { ruleId: 'quotes', message: 'Wrong quotes.', line: 2, column: 1 },
    ],
  }], new Map<string, Rule>([['semi', eslintRule]]));
  assert.deepEqual(
    eslintFindings.map(item => [item.rule, item.message, item.location?.line]),
    [['eslint/semi', 'Missing semicolon.', 1]],
  );
  assert.equal(eslintFindings[0]?.location?.file, 'src/a.ts');

  const suppressed = eslintBreaches('/repo', [{
    filePath: '/repo/src/a.ts',
    messages: [],
    suppressedMessages: [{ ruleId: 'semi', message: 'Suppressed semicolon.', line: 3, column: 1 }],
  }], new Map<string, Rule>([['semi', eslintRule]]));
  assert.deepEqual(
    suppressed.map(item => [item.rule, item.message, item.location?.line]),
    [['eslint/semi', 'Suppressed semicolon.', 3]],
  );

  const dependencyFindings: DependencyCruiserViolation[] = [
    { from: 'src/a.ts', to: 'src/b.ts', rule: { name: 'no-cycles' } },
    { from: 'src/a.ts', to: 'src/c.ts', rule: { name: 'not-selected' } },
  ];
  assert.deepEqual(
    violationsToBreaches(
      dependencyFindings,
      new Map<string, Rule>([['no-cycles', dependencyRule]]),
    ).map(item => [item.rule, item.message]),
    [['dependency-cruiser/no-cycles', 'Dependency src/a.ts -> src/b.ts violates dependency-cruiser rule no-cycles.']],
  );

  const mutants: StrykerMutantResult[] = [
    { id: '1', status: 'Killed', fileName: 'src/killed.ts' },
    { id: '2', status: 'Survived', fileName: 'src/survived.ts' },
    { id: '3', status: 'NoCoverage', fileName: 'src/uncovered.ts' },
  ];
  assert.deepEqual(
    undetectedMutantBreaches(mutants, strykerRule)
      .map(item => [item.rule, item.code, item.location?.file]),
    [
      ['stryker/mutants-detected', 'mutant-survived', 'src/survived.ts'],
      ['stryker/mutants-detected', 'mutant-no-coverage', 'src/uncovered.ts'],
    ],
  );

  assert.deepEqual(testRunBreaches({
    tests: [
      { name: 'passes', suite: [], file: null, status: 'passed', location: null },
      { name: 'fails', suite: [], file: null, status: 'failed', location: null },
    ],
  }, { testsPass: testingRule }).map(item => [item.rule, item.code, item.message]), [
    ['testing/tests-pass', 'test-failed', 'fails'],
  ]);
});

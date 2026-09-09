import assert from 'node:assert/strict';
import test from 'node:test';
import { defineRule } from 'redproof';
import { testCounts, testRunBreaches, type TestCase, type TestRun } from '../../packages/testing/src/model.ts';

const testsPass = defineRule({ id: 'testing/tests-pass', description: 'tests pass' });
const noFlakyTests = defineRule({ id: 'testing/no-flaky-tests', description: 'no flaky' });
const noSkippedTests = defineRule({ id: 'testing/no-skipped-tests', description: 'no skip' });
const noTodoTests = defineRule({ id: 'testing/no-todo-tests', description: 'no todo' });
const allRules = { testsPass, noFlakyTests, noSkippedTests, noTodoTests };

function testCase(overrides: Partial<TestCase> & { readonly name: string; readonly status: TestCase['status'] }): TestCase {
  return { suite: ['Parser'], file: 'test/parser.test.ts', location: null, ...overrides };
}

const location = { file: 'test/parser.test.ts', line: 20, column: 5 } as const;

const run: TestRun = {
  tests: [
    testCase({ name: 'passes', status: 'passed' }),
    testCase({ name: 'fails', status: 'failed', location, failure: { message: 'expected valid to be invalid' } }),
    testCase({ name: 'later', status: 'todo' }),
    testCase({ name: 'elsewhere', status: 'skipped', location }),
    testCase({ name: 'eventually', status: 'passed', failure: { message: 'passed after 2 invocations' } }),
  ],
};

test('each test status breaches exactly the Rule that names it', () => {
  const breaches = testRunBreaches(run, allRules);

  assert.deepEqual(
    breaches.map(item => [item.rule, item.code, item.message]),
    [
      ['testing/tests-pass', 'test-failed', 'Parser > fails'],
      ['testing/no-flaky-tests', 'test-flaky', 'Parser > eventually'],
      ['testing/no-skipped-tests', 'test-skipped', 'Parser > elsewhere'],
      ['testing/no-todo-tests', 'test-todo', 'Parser > later'],
    ],
  );
});

test('a Rule that was not selected produces no breaches, even when the run has matching tests', () => {
  assert.deepEqual(testRunBreaches(run, {}), []);
  assert.deepEqual(testRunBreaches(run, { noTodoTests }).map(item => item.code), ['test-todo']);
  assert.deepEqual(testRunBreaches(run, { testsPass, noSkippedTests }).map(item => item.code), ['test-failed', 'test-skipped']);
});

test('a failed test carries its location, its failure detail, and any comparison into the breach', () => {
  const [detailed, compared, bare] = testRunBreaches({
    tests: [
      testCase({ name: 'a', status: 'failed', location, failure: { message: 'short', detail: 'long stack' } }),
      testCase({
        name: 'b',
        status: 'failed',
        failure: { message: 'mismatch', comparison: { expected: '1', actual: '2' } },
      }),
      testCase({ name: 'c', status: 'failed' }),
    ],
  }, { testsPass });

  assert.deepEqual(detailed?.location, location);
  assert.equal(detailed?.detail, 'long stack');
  assert.equal(detailed?.comparison, undefined);

  assert.equal(compared?.detail, 'mismatch');
  assert.deepEqual(compared?.comparison, { expected: '1', actual: '2' });

  assert.equal(bare?.location, null);
  assert.equal(bare?.detail, undefined);
});

test('a test is flaky only when it passed while keeping failure evidence', () => {
  const breaches = testRunBreaches({
    tests: [
      testCase({ name: 'retried', status: 'passed', location, failure: { message: 'attempt 1 failed' } }),
      testCase({ name: 'clean', status: 'passed' }),
      testCase({ name: 'broken', status: 'failed', failure: { message: 'still failing' } }),
      testCase({ name: 'skipped with note', status: 'skipped', failure: { message: 'never ran' } }),
    ],
  }, { noFlakyTests });

  assert.equal(breaches.length, 1);
  assert.equal(breaches[0]?.message, 'Parser > retried');
  assert.equal(breaches[0]?.detail, 'attempt 1 failed');
  assert.deepEqual(breaches[0]?.location, location);
});

test('a breach names the test by its suite path and title, skipping blank segments', () => {
  const breaches = testRunBreaches({
    tests: [
      testCase({ name: 'leaf', status: 'todo', suite: ['', 'outer', 'inner'] }),
      testCase({ name: 'alone', status: 'todo', suite: [] }),
    ],
  }, { noTodoTests });

  assert.deepEqual(breaches.map(item => item.message), ['outer > inner > leaf', 'alone']);
});

test('skipped and todo breaches point at the test location and carry no failure detail', () => {
  const [skipped, todo] = testRunBreaches({
    tests: [
      testCase({ name: 's', status: 'skipped', location, failure: { message: 'ignored' } }),
      testCase({ name: 't', status: 'todo', location }),
    ],
  }, { noSkippedTests, noTodoTests });

  assert.deepEqual(skipped?.location, location);
  assert.equal(skipped?.detail, undefined);
  assert.deepEqual(todo?.location, location);
  assert.equal(todo?.detail, undefined);
});

test('a run without breaches yields an empty list', () => {
  assert.deepEqual(testRunBreaches({ tests: [testCase({ name: 'ok', status: 'passed' })] }, allRules), []);
  assert.deepEqual(testRunBreaches({ tests: [] }, allRules), []);
});

test('test counts tally every status, and a retried pass still counts as passed', () => {
  assert.deepEqual(testCounts(run), { passed: 2, failed: 1, skipped: 1, todo: 1 });
  assert.deepEqual(testCounts({ tests: [] }), { passed: 0, failed: 0, skipped: 0, todo: 0 });
});

import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import test from 'node:test';
import { testing, report, parseJestJson, parseJunitXml, testRunBreaches, type TestRunner } from '@redproof/testing';
import { defineRule } from 'redproof';
import { withWorkspace } from '../helpers/workspace.ts';

const jestSample = JSON.stringify({
  success: false,
  testResults: [
    {
      name: '/workspace/test/parser.test.ts',
      assertionResults: [
        {
          ancestorTitles: ['', 'Parser'],
          title: 'accepts valid input',
          fullName: 'Parser accepts valid input',
          status: 'passed',
          duration: 2,
          failureMessages: [],
          location: { line: 10, column: 3 },
        },
        {
          ancestorTitles: ['', 'Parser'],
          title: 'rejects malformed input',
          fullName: 'Parser rejects malformed input',
          status: 'failed',
          duration: 1,
          failureMessages: ['expected valid to be invalid'],
          location: { line: 20, column: 5 },
        },
        {
          ancestorTitles: ['Parser'],
          title: 'future behavior',
          status: 'todo',
          failureMessages: [],
        },
        {
          ancestorTitles: ['Parser'],
          title: 'platform-specific behavior',
          status: 'pending',
          failureMessages: [],
        },
      ],
    },
  ],
});

const junitSample = `<?xml version="1.0" encoding="utf-8"?>
<testsuites name="pytest tests">
  <testsuite name="pytest" failures="1" skipped="1" tests="3">
    <testcase classname="test_parser" name="test_ok" time="0.001" />
    <testcase classname="test_parser" name="test_bad" time="0.002">
      <failure message="assert 1 == 2">test_parser.py:8: AssertionError</failure>
    </testcase>
    <testcase classname="test_parser" name="test_skip" time="0.000">
      <skipped type="pytest.skip" message="later">later</skipped>
    </testcase>
  </testsuite>
</testsuites>`;

test('Jest-compatible JSON normalizes pass/fail/todo/skipped and locations', () => {
  const run = parseJestJson(jestSample);
  assert.deepEqual(run.tests.map(item => item.status), ['passed', 'failed', 'todo', 'skipped']);
  assert.deepEqual(run.tests[1]?.location, {
    file: '/workspace/test/parser.test.ts',
    line: 20,
    column: 5,
  });
  assert.equal(run.tests[1]?.failure?.message, 'expected valid to be invalid');
});

test('JUnit XML normalizes passed, failed and skipped tests', () => {
  const run = parseJunitXml(junitSample);
  assert.deepEqual(run.tests.map(item => item.status), ['passed', 'failed', 'skipped']);
  assert.equal(run.tests[1]?.failure?.message, 'assert 1 == 2');
  assert.deepEqual(run.tests[1]?.suite, ['test_parser']);
});

test('JUnit XML decodes named, decimal, and hexadecimal character references', () => {
  const run = parseJunitXml(`<testsuite name="entities">
    <testcase classname="suite" name="it&#x27;s safe">
      <failure message="&#60;bad&#62; &amp; &#128640;">at &#x3C;anonymous&#x3E;</failure>
    </testcase>
  </testsuite>`);

  assert.equal(run.tests[0]?.name, "it's safe");
  assert.equal(run.tests[0]?.failure?.message, '<bad> & 🚀');
  assert.equal(run.tests[0]?.failure?.detail, 'at <anonymous>');
});

test('JUnit XML leaves out-of-range and surrogate references undecoded', () => {
  const run = parseJunitXml(`<testsuite name="entities">
    <testcase classname="suite" name="over &#x110000; and lone &#xD800;"/>
  </testsuite>`);

  assert.equal(run.tests[0]?.name, 'over &#x110000; and lone &#xD800;');
});

test('JUnit XML does not decode an escaped character reference twice', () => {
  const run = parseJunitXml(`<testsuite name="entities">
    <testcase classname="suite" name="literal &amp;#60;tag&amp;#62;"/>
  </testsuite>`);

  assert.equal(run.tests[0]?.name, 'literal &#60;tag&#62;');
});

test('generic test semantics map statuses to distinct Redproof rules', () => {
  const testsPass = defineRule({ id: 'testing/tests-pass', description: 'tests pass' });
  const noSkippedTests = defineRule({ id: 'testing/no-skipped-tests', description: 'no skip' });
  const noTodoTests = defineRule({ id: 'testing/no-todo-tests', description: 'no todo' });
  const run = parseJestJson(jestSample);

  const breaches = testRunBreaches(run, { testsPass, noSkippedTests, noTodoTests });
  assert.deepEqual(breaches.map(item => item.rule), [
    'testing/tests-pass',
    'testing/no-skipped-tests',
    'testing/no-todo-tests',
  ]);
});

test('JUnit refuses noTodoTests at composition time because the format cannot distinguish TODO', () => {
  const runner: TestRunner = {
    description: 'fake',
    async run() { return { kind: 'completed', exitCode: 0, stdout: '', stderr: '' }; },
  };

  assert.throws(() => testing({
    runner,
    report: report.junitXml(),
    rules: { noTodoTests: true },
  }), /cannot distinguish TODO tests/);
});

test('testing adapter trusts structured failures over the command exit code', async () => {
  await withWorkspace(async root => {
    const runner: TestRunner = {
      description: 'write Jest JSON',
      async run(ctx) {
        await writeFile(ctx.reportFile, jestSample, 'utf8');
        return { kind: 'completed', exitCode: 1, stdout: '', stderr: '' };
      },
    };

    const adapter = testing({
      runner,
      report: report.jestJson(),
      rules: { testsPass: true, noSkippedTests: true, noTodoTests: true },
    });

    const result = await adapter.check.run({
      root,
      rules: Object.values(adapter.rules).map(rule => rule.id),
    });

    assert.equal(result.verdict, 'fail');
    if (result.verdict !== 'fail') return;
    assert.deepEqual(result.breaches.map(item => item.rule), [
      'testing/tests-pass',
      'testing/no-skipped-tests',
      'testing/no-todo-tests',
    ]);
  });
});

test('testing adapter refuses when a command completes without a readable report', async () => {
  await withWorkspace(async root => {
    const runner: TestRunner = {
      description: 'broken runner',
      async run() {
        return { kind: 'completed', exitCode: 2, stdout: '', stderr: 'configuration failed' };
      },
    };

    const adapter = testing({
      runner,
      report: report.jestJson(),
      rules: { testsPass: true },
    });

    const result = await adapter.check.run({ root, rules: ['testing/tests-pass'] });
    assert.equal(result.verdict, 'refuse');
    if (result.verdict !== 'refuse') return;
    assert.equal(result.why.code, 'test-report-unavailable');
    assert.match(result.why.detail ?? '', /configuration failed/);
  });
});


test('testing adapter refuses an unexplained non-zero exit even when an empty report exists', async () => {
  await withWorkspace(async root => {
    const runner: TestRunner = {
      description: 'empty failing runner',
      async run(ctx) {
        await writeFile(ctx.reportFile, JSON.stringify({ testResults: [] }), 'utf8');
        return { kind: 'completed', exitCode: 5, stdout: 'no tests collected', stderr: '' };
      },
    };

    const adapter = testing({
      runner,
      report: report.jestJson(),
      rules: { testsPass: true },
    });

    const result = await adapter.check.run({ root, rules: ['testing/tests-pass'] });
    assert.equal(result.verdict, 'refuse');
    if (result.verdict !== 'refuse') return;
    assert.equal(result.why.code, 'test-runner-unsuccessful');
    assert.match(result.why.detail ?? '', /exit code: 5/);
  });
});

test('the testing adapter rejects a rule name it does not know', () => {
  assert.throws(
    () => testing({
      runner: { kind: 'test', async run() { return { exitCode: 0, reportFile: 'x' }; } } as never,
      report: report.junitXml(),
      rules: { testsPass: true, noPurpleTests: true } as never,
    }),
    /Unknown testing rule option: "noPurpleTests"\. Known options: testsPass, noSkippedTests, noTodoTests\./,
  );
});

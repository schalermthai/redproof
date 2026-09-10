import assert from 'node:assert/strict';
import test from 'node:test';
import {
  parseJestJson,
  parseJunitXml,
  report,
  testing,
  type TestRunner,
} from '../../packages/testing/src/index.ts';

const completedRunner: TestRunner = {
  description: 'contract probe',
  async run() {
    return { kind: 'completed', exitCode: 0, stdout: '', stderr: '' };
  },
};

test('capability: report formats reject Rules for evidence they cannot observe', () => {
  assert.deepEqual(report.junitXml().capabilities, { todo: false, flaky: false });
  assert.throws(
    () => testing({
      runner: completedRunner,
      report: report.junitXml(),
      rules: { noTodoTests: true },
    }),
    /cannot distinguish TODO tests/u,
  );
  assert.throws(
    () => testing({
      runner: completedRunner,
      report: report.junitXml(),
      rules: { noFlakyTests: true },
    }),
    /cannot distinguish flaky tests/u,
  );
});

test('capability: a capable report format exposes the Rules it can support', () => {
  assert.deepEqual(report.jestJson().capabilities, { todo: true, flaky: true });
  const adapter = testing({
    runner: completedRunner,
    report: report.jestJson(),
    rules: { noTodoTests: true, noFlakyTests: true },
  });

  assert.deepEqual(Object.keys(adapter.rules).sort(), ['noFlakyTests', 'noTodoTests']);
});

test('capability: a declared capability matches what the parser can still observe', () => {
  const jestRun = parseJestJson(JSON.stringify({
    testResults: [{
      assertionResults: [
        { title: 'planned', status: 'todo' },
        { title: 'retried', status: 'passed', failureMessages: ['flaked once'] },
      ],
    }],
  }));
  assert.deepEqual(
    jestRun.tests.map(item => [item.name, item.status, Boolean(item.failure)]),
    [['planned', 'todo', false], ['retried', 'passed', true]],
  );

  const junitRun = parseJunitXml(
    '<testsuite><testcase name="planned"><skipped/></testcase></testsuite>',
  );
  assert.deepEqual(
    junitRun.tests.map(item => [item.name, item.status, Boolean(item.failure)]),
    [['planned', 'skipped', false]],
  );
});

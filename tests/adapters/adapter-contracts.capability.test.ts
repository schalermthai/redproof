import assert from 'node:assert/strict';
import test from 'node:test';
import {
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

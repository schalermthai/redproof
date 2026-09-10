import assert from 'node:assert/strict';
import { join } from 'node:path';
import test from 'node:test';
import { dependencyCruiser } from '../../packages/dependency-cruiser/src/index.ts';
import { eslint } from '../../packages/eslint/src/index.ts';
import { stryker } from '../../packages/stryker/src/index.ts';
import {
  report,
  runner,
  testing,
  vitest,
  type TestRunner,
} from '../../packages/testing/src/index.ts';
import { withWorkspace } from '../helpers/workspace.ts';

test('runner: every Adapter maps unavailable execution to one REFUSE result', async () => {
  await withWorkspace(async root => {
    const eslintResult = await eslint({
      files: ['missing.ts'],
      rules: { semi: 'semi' },
    }).check.run({ root, rules: ['eslint/semi'] });
    assert.equal(eslintResult.verdict, 'refuse');
    if (eslintResult.verdict === 'refuse') assert.equal(eslintResult.why.code, 'eslint-unavailable');

    const dependencyResult = await dependencyCruiser({
      configFile: 'missing.cjs',
      rules: { cycles: 'no-cycles' },
    }).check.run({ root, rules: ['dependency-cruiser/no-cycles'] });
    assert.equal(dependencyResult.verdict, 'refuse');
    if (dependencyResult.verdict === 'refuse') {
      assert.equal(dependencyResult.why.code, 'dependency-cruiser-unavailable');
    }

    const strykerResult = await stryker({
      cwd: 'missing',
      rules: { mutantsDetected: true },
    }).check.run({ root, rules: ['stryker/mutants-detected'] });
    assert.equal(strykerResult.verdict, 'refuse');
    if (strykerResult.verdict === 'refuse') assert.equal(strykerResult.why.code, 'stryker-unavailable');

    const vitestResult = await vitest({
      command: 'redproof-no-such-vitest',
      rules: { testsPass: true },
    }).check.run({ root, rules: ['testing/tests-pass'] });
    assert.equal(vitestResult.verdict, 'refuse');
    if (vitestResult.verdict === 'refuse') {
      assert.equal(vitestResult.why.code, 'test-runner-unavailable');
    }

    const throwingRunner: TestRunner = {
      description: 'throw from a custom runner',
      async run() {
        throw new Error('runner exploded');
      },
    };
    const testingResult = await testing({
      runner: throwingRunner,
      report: report.jestJson(),
      rules: { testsPass: true },
    }).check.run({ root, rules: ['testing/tests-pass'] });
    assert.equal(testingResult.verdict, 'refuse');
    if (testingResult.verdict === 'refuse') {
      assert.equal(testingResult.why.code, 'test-runner-unavailable');
      assert.equal(testingResult.why.message, 'The test runner could not complete the check.');
      assert.match(testingResult.why.detail ?? '', /runner exploded/u);
    }

    const badArguments = await runner.command({
      command: 'test',
      args() {
        throw new Error('arguments exploded');
      },
    }).run({ root, reportFile: 'unused.json' });
    assert.equal(badArguments.kind, 'unavailable');
    if (badArguments.kind === 'unavailable') {
      assert.match(badArguments.detail ?? '', /arguments exploded/u);
    }

    const beforeTemp = process.env.TMPDIR;
    process.env.TMPDIR = join(root, 'missing-temp-root');
    try {
      const unavailableTemp = await testing({
        runner: {
          description: 'completed runner',
          async run() {
            return { kind: 'completed', exitCode: 0, stdout: '', stderr: '' };
          },
        },
        report: report.jestJson(),
        rules: { testsPass: true },
      }).check.run({ root, rules: ['testing/tests-pass'] });
      assert.equal(unavailableTemp.verdict, 'refuse');
      if (unavailableTemp.verdict === 'refuse') {
        assert.equal(unavailableTemp.why.code, 'test-runner-unavailable');
        assert.equal(
          unavailableTemp.why.message,
          'The testing Adapter could not prepare its report directory.',
        );
      }
    } finally {
      if (beforeTemp === undefined) delete process.env.TMPDIR;
      else process.env.TMPDIR = beforeTemp;
    }
  });
});

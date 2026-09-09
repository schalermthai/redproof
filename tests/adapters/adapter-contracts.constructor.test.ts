import assert from 'node:assert/strict';
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

const completedRunner: TestRunner = {
  description: 'contract probe',
  async run() {
    return { kind: 'completed', exitCode: 0, stdout: '', stderr: '' };
  },
};

test('constructor: every Adapter rejects an empty Rule selection', () => {
  assert.throws(() => eslint({ rules: {} }), /requires at least one Redproof rule/u);
  assert.throws(() => dependencyCruiser({ rules: {} }), /requires at least one Redproof rule/u);
  assert.throws(() => stryker({ rules: {} }), /requires at least one Redproof rule/u);
  assert.throws(
    () => testing({ runner: completedRunner, report: report.jestJson(), rules: {} }),
    /requires at least one Redproof rule/u,
  );
});

test('constructor: every Adapter rejects unknown top-level options', () => {
  assert.throws(
    () => eslint({ rules: { semi: 'semi' }, mystery: true } as never),
    /Unknown ESLint adapter option: "mystery"/u,
  );
  assert.throws(
    () => dependencyCruiser({ rules: { cycles: 'no-cycles' }, mystery: true } as never),
    /Unknown dependency-cruiser adapter option: "mystery"/u,
  );
  assert.throws(
    () => stryker({ rules: { mutantsDetected: true }, mystery: true } as never),
    /Unknown Stryker adapter option: "mystery"/u,
  );
  assert.throws(
    () => testing({
      runner: completedRunner,
      report: report.jestJson(),
      rules: { testsPass: true },
      mystery: true,
    } as never),
    /Unknown testing adapter option: "mystery"/u,
  );
  assert.throws(
    () => vitest({ rules: { testsPass: true }, mystery: true } as never),
    /Unknown Vitest adapter option: "mystery"/u,
  );
});

test('constructor: values that are invalid without running are rejected immediately', () => {
  assert.throws(
    () => eslint({ rules: { semi: '' } }),
    /ESLint rule "semi" must name a non-empty rule/u,
  );
  assert.throws(
    () => dependencyCruiser({ rules: { cycles: '' } }),
    /dependency-cruiser rule "cycles" must name a non-empty rule/u,
  );
  assert.throws(
    () => dependencyCruiser({ configFile: '/outside.cjs', rules: { cycles: 'no-cycles' } }),
    /configFile must be a relative path/u,
  );
  assert.throws(
    () => stryker({ configFile: '/outside.conf.js', rules: { mutantsDetected: true } }),
    /configFile must be a relative path/u,
  );
  assert.throws(
    () => stryker({
      rules: { mutationScore: { minimum: 80, mystery: true } as never },
    }),
    /Unknown Stryker mutationScore option: "mystery"/u,
  );
  assert.throws(
    () => vitest({ reportFile: '/outside.json', rules: { testsPass: true } }),
    /reportFile must be relative/u,
  );
  assert.throws(
    () => runner.command({ command: '' }),
    /command must not be empty/u,
  );
});

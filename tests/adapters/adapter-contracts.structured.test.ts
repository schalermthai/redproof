import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import test from 'node:test';
import { defineRule, type Rule } from 'redproof';
import {
  violationsToBreaches,
  type DependencyCruiserViolation,
} from '../../packages/dependency-cruiser/src/model.ts';
import { eslintBreaches } from '../../packages/eslint/src/model.ts';
import {
  undetectedMutantBreaches,
  type StrykerMutantResult,
} from '../../packages/stryker/src/model.ts';
import {
  report,
  testing,
  testRunBreaches,
  type TestRunner,
} from '../../packages/testing/src/index.ts';
import { withWorkspace } from '../helpers/workspace.ts';

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
  assert.deepEqual(eslintFindings.map(item => item.rule), ['eslint/semi']);
  assert.equal(eslintFindings[0]?.location?.file, 'src/a.ts');

  const dependencyFindings: DependencyCruiserViolation[] = [
    { from: 'src/a.ts', to: 'src/b.ts', rule: { name: 'no-cycles' } },
    { from: 'src/a.ts', to: 'src/c.ts', rule: { name: 'not-selected' } },
  ];
  assert.deepEqual(
    violationsToBreaches(
      dependencyFindings,
      new Map<string, Rule>([['no-cycles', dependencyRule]]),
    ).map(item => item.rule),
    ['dependency-cruiser/no-cycles'],
  );

  const mutants: StrykerMutantResult[] = [
    { id: '1', status: 'Killed' },
    { id: '2', status: 'Survived' },
  ];
  assert.deepEqual(
    undetectedMutantBreaches(mutants, strykerRule).map(item => item.rule),
    ['stryker/mutants-detected'],
  );

  assert.deepEqual(testRunBreaches({
    tests: [
      { name: 'passes', suite: [], file: null, status: 'passed', location: null },
      { name: 'fails', suite: [], file: null, status: 'failed', location: null },
    ],
  }, { testsPass: testingRule }).map(item => item.rule), ['testing/tests-pass']);
});
test('structured: an unexplained nonzero exit REFUSES instead of creating a Breach', async () => {
  await withWorkspace(async root => {
    const runner: TestRunner = {
      description: 'unexplained nonzero contract probe',
      async run(ctx) {
        await writeFile(ctx.reportFile, JSON.stringify({ testResults: [] }), 'utf8');
        return { kind: 'completed', exitCode: 9, stdout: '', stderr: 'tool failed' };
      },
    };
    const adapter = testing({
      runner,
      report: report.jestJson(),
      rules: { testsPass: true },
    });

    const result = await adapter.check.run({ root, rules: [adapter.rules.testsPass.id] });
    assert.equal(result.verdict, 'refuse');
    if (result.verdict === 'refuse') assert.equal(result.why.code, 'test-runner-unsuccessful');
  });
});

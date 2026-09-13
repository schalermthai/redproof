import assert from 'node:assert/strict';
import { mkdir, realpath, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import type { StrykerMutantResult } from '@redproof/stryker';
import { createStrykerAdapter } from '../../packages/stryker/src/shell/adapter.ts';
import { withWorkspace } from '../helpers/workspace.ts';

/**
 * Every case here is decided after Stryker reports, so a fake engine stands in
 * for the mutation run and the adapter is judged on what it makes of the result.
 */
const span = { start: { line: 4, column: 10 }, end: { line: 4, column: 12 } } as const;

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
  location: span,
  ...extra,
});

const acceptedParserMutant = JSON.stringify([{
  fileName: 'src/parser.ts',
  mutatorName: 'EqualityOperator',
  replacement: '>',
  location: span,
}]);

const engineOf = (mutants: readonly StrykerMutantResult[]) => async () => mutants;

const runBaseline = async (root: string, mutants: readonly StrykerMutantResult[]) => {
  const adapter = createStrykerAdapter(
    { cwd: 'project', rules: { noNewUndetectedMutants: { acceptedMutantsFile: 'accepted-mutants.json' } } },
    engineOf(mutants),
  );
  return adapter.check.run({ root, rules: [adapter.rules.noNewUndetectedMutants.id] });
};

const runScore = async (root: string, minimum: number, mutants: readonly StrykerMutantResult[]) => {
  const adapter = createStrykerAdapter({ rules: { mutationScore: { minimum } } }, engineOf(mutants));
  return adapter.check.run({ root, rules: [adapter.rules.mutationScore.id] });
};

test('a run that leaves mutants pending REFUSES as incomplete, with every mutant counted as inspected', async () => {
  await withWorkspace(async root => {
    const adapter = createStrykerAdapter(
      { rules: { mutantsDetected: true } },
      engineOf([mutant('1', 'Killed'), mutant('2', 'Pending'), mutant('3', 'Pending')]),
    );

    const result = await adapter.check.run({ root, rules: [adapter.rules.mutantsDetected.id] });

    assert.equal(result.verdict, 'refuse');
    if (result.verdict !== 'refuse') return;
    assert.equal(result.why.code, 'stryker-incomplete');
    assert.equal(result.why.detail, '2 mutant(s) remained pending.');
    assert.equal(result.scan.inspected, 3);
  });
});

test('a run with no valid mutant REFUSES a score policy, and passes a detection policy', async () => {
  const mutants = [mutant('1', 'CompileError'), mutant('2', 'RuntimeError'), mutant('3', 'Ignored')];

  await withWorkspace(async root => {
    const scored = await runScore(root, 50, mutants);

    assert.equal(scored.verdict, 'refuse');
    if (scored.verdict !== 'refuse') return;
    assert.equal(scored.why.code, 'mutation-score-unavailable');
    assert.equal(scored.scan.inspected, 3);

    const adapter = createStrykerAdapter({ rules: { mutantsDetected: true } }, engineOf(mutants));
    const detected = await adapter.check.run({ root, rules: [adapter.rules.mutantsDetected.id] });
    assert.equal(detected.verdict, 'pass');
  });
});

test('an accepted mutant the suite now detects REFUSES as stale, naming the baseline file from the Gate root', async () => {
  await withWorkspace(async root => {
    await mkdir(join(root, 'project'));
    await writeFile(join(root, 'project', 'accepted-mutants.json'), acceptedParserMutant, 'utf8');

    const result = await runBaseline(root, [mutant('1', 'Killed')]);

    assert.equal(result.verdict, 'refuse');
    if (result.verdict !== 'refuse') return;
    assert.equal(result.why.code, 'stryker-accepted-mutants-stale');
    assert.equal(result.why.message, 'Accepted mutants are now detected. Remove them from the baseline.');
    assert.deepEqual(result.why.location, { file: 'project/accepted-mutants.json', line: null, column: null });
    assert.equal(result.scan.inspected, 1);
  });
});

test('an undetected mutant without a stable identity REFUSES the baseline comparison', async () => {
  await withWorkspace(async root => {
    await mkdir(join(root, 'project'));
    await writeFile(join(root, 'project', 'accepted-mutants.json'), '[]', 'utf8');

    const result = await runBaseline(root, [mutant('1', 'Survived', { location: { start: span.start } })]);

    assert.equal(result.verdict, 'refuse');
    if (result.verdict !== 'refuse') return;
    assert.equal(result.why.code, 'stryker-mutant-identity-unavailable');
    assert.equal(result.why.message, 'Stryker produced an undetected mutant without a stable identity.');
    assert.equal(result.why.location?.file, 'project/accepted-mutants.json');
    assert.match(result.why.detail ?? '', /mutant 1 is missing stable identity fields/u);
  });
});

test('two undetected mutants that share one identity REFUSE the baseline comparison', async () => {
  await withWorkspace(async root => {
    await mkdir(join(root, 'project'));
    await writeFile(join(root, 'project', 'accepted-mutants.json'), '[]', 'utf8');

    const result = await runBaseline(root, [mutant('1', 'Survived'), mutant('2', 'NoCoverage')]);

    assert.equal(result.verdict, 'refuse');
    if (result.verdict !== 'refuse') return;
    assert.equal(result.why.code, 'stryker-mutant-identity-ambiguous');
    assert.equal(result.why.message, 'Stryker reported two undetected mutants with one identity.');
    assert.equal(result.why.location?.file, 'project/accepted-mutants.json');
  });
});

test('a mutation score exactly at the minimum passes, and one detected mutant fewer fails with the numbers', async () => {
  const detectedFour = [
    mutant('1', 'Killed'),
    mutant('2', 'Killed'),
    mutant('3', 'Killed'),
    mutant('4', 'Timeout'),
    mutant('5', 'Survived'),
  ];

  await withWorkspace(async root => {
    const atMinimum = await runScore(root, 80, detectedFour);
    assert.equal(atMinimum.verdict, 'pass');

    const below = await runScore(root, 80, detectedFour.slice(1));
    assert.equal(below.verdict, 'fail');
    if (below.verdict !== 'fail') return;
    assert.equal(below.breaches.length, 1);
    assert.equal(below.breaches[0].rule, 'stryker/mutation-score');
    assert.equal(below.breaches[0].code, 'mutation-score-below-minimum');
    assert.deepEqual(below.breaches[0].comparison, { expected: '>= 80.00%', actual: '75.00%' });
    assert.equal(below.breaches[0].detail, '3 detected, 1 undetected, 4 valid mutants.');
  });
});

test('every undetected mutant is reported at a file path relative to the Gate root, once per selected policy', async () => {
  await withWorkspace(async root => {
    await mkdir(join(root, 'project'));
    await writeFile(join(root, 'project', 'accepted-mutants.json'), '[]', 'utf8');

    const adapter = createStrykerAdapter(
      {
        cwd: 'project',
        rules: {
          mutantsDetected: true,
          noNewUndetectedMutants: { acceptedMutantsFile: 'accepted-mutants.json' },
        },
      },
      async () => [
        mutant('1', 'Survived'),
        mutant('2', 'NoCoverage', { fileName: join(process.cwd(), 'src', 'other.ts') }),
        mutant('3', 'Killed'),
      ],
    );
    const result = await adapter.check.run({
      root,
      rules: [adapter.rules.mutantsDetected.id, adapter.rules.noNewUndetectedMutants.id],
    });

    assert.equal(result.verdict, 'fail');
    if (result.verdict !== 'fail') return;
    assert.deepEqual(
      result.breaches.map(item => [item.rule, item.code, item.location?.file, item.message]),
      [
        ['stryker/mutants-detected', 'mutant-survived', 'project/src/parser.ts', 'Stryker mutant survived the test suite.'],
        ['stryker/mutants-detected', 'mutant-no-coverage', 'project/src/other.ts', 'Stryker mutant had no test coverage.'],
        ['stryker/no-new-undetected-mutants', 'mutant-survived', 'project/src/parser.ts', 'Stryker mutant survived the test suite, outside the accepted baseline.'],
        ['stryker/no-new-undetected-mutants', 'mutant-no-coverage', 'project/src/other.ts', 'Stryker mutant had no test coverage, outside the accepted baseline.'],
      ],
    );
    assert.deepEqual(result.breaches[0].location, { file: 'project/src/parser.ts', line: 4, column: 10 });
  });
});

test('the engine runs inside the working directory without the test-runner env, and the process is restored after it', async () => {
  const testContextBefore = process.env.NODE_TEST_CONTEXT;
  if (testContextBefore === undefined) process.env.NODE_TEST_CONTEXT = 'redproof-test';

  try {
    await withWorkspace(async root => {
      await mkdir(join(root, 'project'));
      const cwdBefore = process.cwd();
      const exitCodeBefore = process.exitCode;
      let seen: unknown;

      const adapter = createStrykerAdapter(
        { cwd: 'project', configFile: 'stryker.config.mjs', rules: { mutantsDetected: true } },
        async options => {
          seen = { options, cwd: process.cwd(), testContext: process.env.NODE_TEST_CONTEXT };
          process.exitCode = 1;
          return [mutant('1', 'Killed')];
        },
      );
      const result = await adapter.check.run({ root, rules: [adapter.rules.mutantsDetected.id] });

      assert.equal(result.verdict, 'pass');
      assert.deepEqual(seen, {
        options: {
          configFile: 'stryker.config.mjs',
          reporters: [],
          cleanTempDir: 'always',
          logLevel: 'off',
          fileLogLevel: 'off',
        },
        cwd: await realpath(join(root, 'project')),
        testContext: undefined,
      });
      assert.equal(process.cwd(), cwdBefore);
      assert.equal(process.exitCode, exitCodeBefore);
      assert.equal(process.env.NODE_TEST_CONTEXT, testContextBefore ?? 'redproof-test');
    });
  } finally {
    if (testContextBefore === undefined) delete process.env.NODE_TEST_CONTEXT;
    else process.env.NODE_TEST_CONTEXT = testContextBefore;
  }
});

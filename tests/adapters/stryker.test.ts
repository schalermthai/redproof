import assert from 'node:assert/strict';
import { symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { defineRule } from 'redproof';
import { stryker } from '@redproof/stryker';
import {
  confineCanonicalStrykerCwd,
  resolveStrykerCwd,
} from '../../packages/stryker/src/cwd.ts';
import {
  assessStrykerBaseline,
  parseAcceptedStrykerMutants,
  strykerMutantIdentity,
} from '../../packages/stryker/src/baseline.ts';
import {
  mutationMetrics,
  mutationScoreBreach,
  undetectedMutantBreaches,
  type StrykerMutantResult,
} from '../../packages/stryker/src/model.ts';
import { withWorkspace } from '../helpers/workspace.ts';

const detectedRule = defineRule({
  id: 'stryker/mutants-detected',
  description: 'All valid mutants must be detected.',
});
const scoreRule = defineRule({
  id: 'stryker/mutation-score',
  description: 'Mutation score must hold.',
});

const mutant = (
  id: string,
  status: StrykerMutantResult['status'],
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
});

const acceptedMutant = {
  fileName: 'src/parser.ts',
  mutatorName: 'EqualityOperator',
  replacement: '>',
  location: {
    start: { line: 4, column: 10 },
    end: { line: 4, column: 12 },
  },
  reason: 'Equivalent for the supported input domain.',
} as const;

test('Stryker metrics follow detected/undetected/valid semantics', () => {
  const metrics = mutationMetrics([
    mutant('1', 'Killed'),
    mutant('2', 'Timeout'),
    mutant('3', 'Survived'),
    mutant('4', 'NoCoverage'),
    mutant('5', 'CompileError'),
    mutant('6', 'RuntimeError'),
    mutant('7', 'Ignored'),
  ]);

  assert.deepEqual(metrics, {
    detected: 2,
    undetected: 2,
    valid: 4,
    invalid: 2,
    ignored: 1,
    pending: 0,
    score: 50,
  });
});

test('mutantsDetected creates one Breach per Survived or NoCoverage mutant', () => {
  const breaches = undetectedMutantBreaches([
    mutant('1', 'Killed'),
    mutant('2', 'Survived'),
    mutant('3', 'NoCoverage'),
    mutant('4', 'Timeout'),
  ], detectedRule);

  assert.equal(breaches.length, 2);
  assert.deepEqual(breaches.map(item => item.code), [
    'mutant-survived',
    'mutant-no-coverage',
  ]);
  assert.deepEqual(breaches[0]?.location, {
    file: 'src/parser.ts',
    line: 4,
    column: 10,
  });
});

test('mutationScore emits one global comparison Breach below the minimum', () => {
  const below = mutationScoreBreach({
    detected: 3,
    undetected: 1,
    valid: 4,
    invalid: 0,
    ignored: 0,
    pending: 0,
    score: 75,
  }, 80, scoreRule);

  assert.equal(below?.rule, scoreRule.id);
  assert.deepEqual(below?.comparison, {
    expected: '>= 80.00%',
    actual: '75.00%',
  });
  assert.equal(below?.location, null);

  assert.equal(mutationScoreBreach({
    detected: 4,
    undetected: 0,
    valid: 4,
    invalid: 0,
    ignored: 0,
    pending: 0,
    score: 100,
  }, 80, scoreRule), null);
});

test('mutation score is unavailable when there are no valid mutants', () => {
  const metrics = mutationMetrics([
    mutant('1', 'CompileError'),
    mutant('2', 'RuntimeError'),
  ]);
  assert.equal(metrics.score, null);
});

test('the Stryker adapter rejects a rule name it does not know', () => {
  assert.throws(
    () => stryker({ rules: { mutantsDetected: true, mutantsKilled: true } as never }),
    /Unknown Stryker rule option: "mutantsKilled"\. Known options: mutantsDetected, noNewUndetectedMutants, mutationScore\./,
  );
});

test('Stryker working-directory policy is a pure lexical and canonical boundary', () => {
  const root = join(tmpdir(), 'gate');
  assert.deepEqual(resolveStrykerCwd(root, 'packages/parser'), {
    kind: 'inside',
    path: join(root, 'packages/parser'),
  });
  assert.equal(resolveStrykerCwd(root, '..').kind, 'outside');
  assert.equal(confineCanonicalStrykerCwd(root, tmpdir()).kind, 'outside');
});

test('the Stryker adapter refuses a working directory outside the Gate root', async () => {
  await withWorkspace(async root => {
    const checkResult = await stryker({
      cwd: '..',
      rules: { mutantsDetected: true },
    }).check.run({ root, rules: ['stryker/mutants-detected'] });

    assert.equal(checkResult.verdict, 'refuse');
    if (checkResult.verdict !== 'refuse') return;
    assert.equal(checkResult.why.code, 'stryker-cwd-outside-root');
  });
});

test('the Stryker adapter refuses a working-directory symlink outside the Gate root', async () => {
  await withWorkspace(async root => {
    await symlink(
      tmpdir(),
      join(root, 'escape'),
      process.platform === 'win32' ? 'junction' : 'dir',
    );
    const checkResult = await stryker({
      cwd: 'escape',
      rules: { mutantsDetected: true },
    }).check.run({ root, rules: ['stryker/mutants-detected'] });

    assert.equal(checkResult.verdict, 'refuse');
    if (checkResult.verdict !== 'refuse') return;
    assert.equal(checkResult.why.code, 'stryker-cwd-outside-root');
  });
});

test('the Stryker adapter rejects an empty accepted-mutants path', () => {
  assert.throws(
    () => stryker({
      rules: {
        noNewUndetectedMutants: { acceptedMutantsFile: ' ' },
      },
    }),
    /acceptedMutantsFile must be a non-empty string/u,
  );
});

test('accepted-mutant baselines are structured, normalized, and uniquely identified', () => {
  const parsed = parseAcceptedStrykerMutants(JSON.stringify([
    { ...acceptedMutant, fileName: '.\\src\\parser.ts' },
  ]));
  assert.ok(!(parsed instanceof Error));
  assert.equal(parsed[0]?.fileName, 'src/parser.ts');
  assert.equal(
    strykerMutantIdentity(parsed[0]!),
    'src/parser.ts@4:10-4:12\nEqualityOperator: >',
  );

  const duplicate = parseAcceptedStrykerMutants(JSON.stringify([
    acceptedMutant,
    { ...acceptedMutant, reason: 'A second explanation cannot duplicate an identity.' },
  ]));
  assert.ok(duplicate instanceof Error);
  assert.match(duplicate.message, /duplicates/u);
});

test('accepted-mutant baselines reject malformed or escaping entries', () => {
  const malformed = parseAcceptedStrykerMutants('{');
  assert.ok(malformed instanceof Error);
  assert.match(malformed.message, /not valid JSON/u);

  const escaping = parseAcceptedStrykerMutants(JSON.stringify([
    { ...acceptedMutant, fileName: '../outside.ts' },
  ]));
  assert.ok(escaping instanceof Error);
  assert.match(escaping.message, /inside the working directory/u);
});

test('the mutation baseline accepts the exact undetected identity across copied roots', () => {
  const root = join(tmpdir(), 'redproof-copy');
  const assessment = assessStrykerBaseline(root, [
    { ...mutant('1', 'Survived'), fileName: join(root, 'src/parser.ts') },
  ], [acceptedMutant]);

  assert.deepEqual(assessment, { kind: 'compared', newUndetected: [] });
});

test('the mutation baseline detects identity replacement even when the count is unchanged', () => {
  const root = join(tmpdir(), 'redproof-copy');
  const assessment = assessStrykerBaseline(root, [
    {
      ...mutant('2', 'Survived'),
      fileName: join(root, 'src/parser.ts'),
      replacement: '<',
    },
  ], [acceptedMutant]);

  assert.equal(assessment.kind, 'compared');
  if (assessment.kind !== 'compared') return;
  assert.equal(assessment.newUndetected.length, 1);
  assert.equal(assessment.newUndetected[0]?.replacement, '<');
  assert.equal(assessment.newUndetected[0]?.fileName, 'src/parser.ts');
});

test('the mutation baseline refuses a stale accepted identity', () => {
  const assessment = assessStrykerBaseline(
    join(tmpdir(), 'redproof-copy'),
    [mutant('1', 'Killed')],
    [acceptedMutant],
  );

  assert.equal(assessment.kind, 'invalid');
  if (assessment.kind !== 'invalid') return;
  assert.equal(assessment.code, 'stryker-accepted-mutants-stale');
});

test('the mutation baseline refuses an undetected mutant without a stable identity', () => {
  const assessment = assessStrykerBaseline(
    join(tmpdir(), 'redproof-copy'),
    [{ id: '1', status: 'Survived' }],
    [],
  );

  assert.equal(assessment.kind, 'invalid');
  if (assessment.kind !== 'invalid') return;
  assert.equal(assessment.code, 'stryker-mutant-identity-unavailable');
});

test('the mutation baseline refuses two undetected mutants that share one identity', () => {
  const root = join(tmpdir(), 'redproof-copy');
  const assessment = assessStrykerBaseline(root, [
    { ...mutant('1', 'Survived'), fileName: join(root, 'src/parser.ts') },
    { ...mutant('2', 'NoCoverage'), fileName: join(root, 'src/parser.ts') },
  ], []);

  assert.equal(assessment.kind, 'invalid');
  if (assessment.kind !== 'invalid') return;
  assert.equal(assessment.code, 'stryker-mutant-identity-ambiguous');
});

test('the Stryker adapter refuses an accepted-mutants file outside the Gate root', async () => {
  await withWorkspace(async root => {
    const check = await stryker({
      rules: { noNewUndetectedMutants: { acceptedMutantsFile: '../accepted-mutants.json' } },
    }).check.run({ root, rules: ['stryker/no-new-undetected-mutants'] });

    assert.equal(check.verdict, 'refuse');
    if (check.verdict !== 'refuse') return;
    assert.equal(check.why.code, 'stryker-accepted-mutants-outside-root');
  });
});

test('the Stryker adapter refuses an accepted-mutants symlink that leaves the Gate root', async () => {
  const outside = join(tmpdir(), `redproof-outside-accepted-${process.pid}.json`);
  await writeFile(outside, '[]', 'utf8');
  await withWorkspace(async root => {
    await symlink(outside, join(root, 'accepted-mutants.json'));
    const check = await stryker({
      rules: { noNewUndetectedMutants: { acceptedMutantsFile: 'accepted-mutants.json' } },
    }).check.run({ root, rules: ['stryker/no-new-undetected-mutants'] });

    assert.equal(check.verdict, 'refuse');
    if (check.verdict !== 'refuse') return;
    assert.equal(check.why.code, 'stryker-accepted-mutants-outside-root');
  });
});

test('the Stryker adapter refuses an invalid accepted-mutants file before mutation testing', async () => {
  await withWorkspace(async root => {
    await writeFile(join(root, 'accepted-mutants.json'), '{}', 'utf8');
    const adapter = stryker({
      rules: {
        noNewUndetectedMutants: {
          acceptedMutantsFile: 'accepted-mutants.json',
        },
      },
    });
    const check = await adapter.check.run({
      root,
      rules: [adapter.rules.noNewUndetectedMutants.id],
    });

    assert.equal(check.verdict, 'refuse');
    if (check.verdict !== 'refuse') return;
    assert.equal(check.why.code, 'stryker-accepted-mutants-invalid');
  });
});

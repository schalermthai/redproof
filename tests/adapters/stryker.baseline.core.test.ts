import assert from 'node:assert/strict';
import { join } from 'node:path';
import test from 'node:test';
import {
  assessStrykerBaseline,
  parseAcceptedStrykerMutants,
  relativizeStrykerMutants,
  strykerMutantIdentity,
  type AcceptedStrykerMutant,
} from '../../packages/stryker/src/baseline.ts';
import type { StrykerMutantResult } from '../../packages/stryker/src/model.ts';

const workingDirectory = join('/', 'gate', 'project');

const acceptedMutant: AcceptedStrykerMutant = {
  fileName: 'src/parser.ts',
  mutatorName: 'EqualityOperator',
  replacement: '>',
  location: {
    start: { line: 4, column: 10 },
    end: { line: 4, column: 12 },
  },
  reason: 'Equivalent for the supported input domain.',
};

const survivor = (extra: Partial<StrykerMutantResult> = {}): StrykerMutantResult => ({
  id: '1',
  status: 'Survived',
  fileName: join(workingDirectory, 'src', 'parser.ts'),
  mutatorName: 'EqualityOperator',
  replacement: '>',
  location: {
    start: { line: 4, column: 10 },
    end: { line: 4, column: 12 },
  },
  ...extra,
});

const parseOne = (entry: unknown) => parseAcceptedStrykerMutants(JSON.stringify([entry]));

test('mutant diagnostics are relative to the Gate root, not a disposable copy or nested cwd', () => {
  const gateRoot = join('/', 'copies', 'gate-1');
  const cwd = join(gateRoot, 'packages', 'parser');
  const [absolute, alreadyRelative] = relativizeStrykerMutants(gateRoot, cwd, [
    survivor({ fileName: join(cwd, 'src', 'parser.ts') }),
    survivor({ id: '2', fileName: 'src/scanner.ts' }),
  ]);

  assert.equal(absolute?.fileName, 'packages/parser/src/parser.ts');
  assert.equal(alreadyRelative?.fileName, 'packages/parser/src/scanner.ts');
});

test('a baseline entry is identified by file, span, mutator, and replacement together', () => {
  assert.equal(
    strykerMutantIdentity(acceptedMutant),
    'src/parser.ts@4:10-4:12\nEqualityOperator: >',
  );
  assert.notEqual(
    strykerMutantIdentity({ ...acceptedMutant, replacement: '<' }),
    strykerMutantIdentity(acceptedMutant),
  );
  assert.notEqual(
    strykerMutantIdentity({
      ...acceptedMutant,
      location: { start: { line: 5, column: 10 }, end: { line: 5, column: 12 } },
    }),
    strykerMutantIdentity(acceptedMutant),
  );
});

test('a baseline file name is stored in one portable form whatever separator it arrived with', () => {
  const parsed = parseOne({ ...acceptedMutant, fileName: '.\\src\\parser.ts' });
  assert.ok(!(parsed instanceof Error), String(parsed));
  assert.equal(parsed[0]?.fileName, 'src/parser.ts');
  assert.equal(parsed[0]?.reason, acceptedMutant.reason);
});

test('a baseline entry that could name a file outside the working directory is rejected', () => {
  for (const fileName of ['../outside.ts', '/etc/passwd', 'src/../../outside.ts', '', '..']) {
    const parsed = parseOne({ ...acceptedMutant, fileName });
    assert.ok(parsed instanceof Error, `${fileName} must be rejected`);
    assert.match(parsed.message, /relative fileName inside the working directory/u);
  }
});

test('a baseline entry without a complete, ordered, one-based location is rejected', () => {
  const missingEnd = parseOne({
    ...acceptedMutant,
    location: { start: { line: 4, column: 10 } },
  });
  assert.ok(missingEnd instanceof Error);
  assert.match(missingEnd.message, /one-based start and end positions/u);

  const zeroBased = parseOne({
    ...acceptedMutant,
    location: { start: { line: 0, column: 10 }, end: { line: 4, column: 12 } },
  });
  assert.ok(zeroBased instanceof Error);
  assert.match(zeroBased.message, /one-based start and end positions/u);

  const reversed = parseOne({
    ...acceptedMutant,
    location: { start: { line: 4, column: 12 }, end: { line: 4, column: 10 } },
  });
  assert.ok(reversed instanceof Error);
  assert.match(reversed.message, /ends before it starts/u);
});

test('a baseline entry without a mutator, a replacement, or a real reason is rejected', () => {
  const noMutator = parseOne({ ...acceptedMutant, mutatorName: '' });
  assert.ok(noMutator instanceof Error);
  assert.match(noMutator.message, /non-empty mutatorName/u);

  const noReplacement = parseOne({ ...acceptedMutant, replacement: 42 });
  assert.ok(noReplacement instanceof Error);
  assert.match(noReplacement.message, /string replacement/u);

  const blankReason = parseOne({ ...acceptedMutant, reason: '  ' });
  assert.ok(blankReason instanceof Error);
  assert.match(blankReason.message, /reason must be a non-empty string/u);
});

test('a baseline that is not a JSON array of objects is rejected before any comparison', () => {
  const malformed = parseAcceptedStrykerMutants('{');
  assert.ok(malformed instanceof Error);
  assert.match(malformed.message, /not valid JSON/u);

  const notAnArray = parseAcceptedStrykerMutants('{"accepted":[]}');
  assert.ok(notAnArray instanceof Error);
  assert.match(notAnArray.message, /must be a JSON array/u);

  const notAnObject = parseAcceptedStrykerMutants('["src/parser.ts"]');
  assert.ok(notAnObject instanceof Error);
  assert.match(notAnObject.message, /must be a JSON object/u);

  const empty = parseAcceptedStrykerMutants('[]');
  assert.deepEqual(empty, []);
});

test('one accepted identity cannot be listed twice, even with a different reason', () => {
  const duplicate = parseAcceptedStrykerMutants(JSON.stringify([
    acceptedMutant,
    { ...acceptedMutant, reason: 'A second explanation cannot duplicate an identity.' },
  ]));

  assert.ok(duplicate instanceof Error);
  assert.match(duplicate.message, /duplicates src\/parser\.ts@4:10-4:12/u);
});

test('an accepted survivor is matched by identity, whatever absolute root it was reported from', () => {
  assert.deepEqual(
    assessStrykerBaseline(workingDirectory, [survivor()], [acceptedMutant]),
    { kind: 'compared', newUndetected: [] },
  );

  const copied = join('/', 'copies', 'gate-1', 'project');
  assert.deepEqual(
    assessStrykerBaseline(
      copied,
      [survivor({ fileName: join(copied, 'src', 'parser.ts') })],
      [acceptedMutant],
    ),
    { kind: 'compared', newUndetected: [] },
  );
});

test('a survivor that replaces an accepted one is new, although the count did not change', () => {
  const assessment = assessStrykerBaseline(
    workingDirectory,
    [survivor({ id: '2', replacement: '<' })],
    [acceptedMutant],
  );

  assert.equal(assessment.kind, 'compared');
  if (assessment.kind !== 'compared') return;
  assert.equal(assessment.newUndetected.length, 1);
  assert.equal(assessment.newUndetected[0]?.replacement, '<');
  assert.equal(
    assessment.newUndetected[0]?.fileName,
    'src/parser.ts',
    'a reported mutant carries the working-directory-relative file name',
  );
});

test('detected and ignored mutants are outside the baseline comparison entirely', () => {
  const assessment = assessStrykerBaseline(
    workingDirectory,
    [
      survivor(),
      survivor({ id: '2', status: 'Killed', replacement: '<' }),
      survivor({ id: '3', status: 'Ignored', replacement: '<=' }),
    ],
    [acceptedMutant],
  );

  assert.deepEqual(assessment, { kind: 'compared', newUndetected: [] });
});

test('an accepted mutant the tests now detect makes the baseline stale, not silently smaller', () => {
  const assessment = assessStrykerBaseline(
    workingDirectory,
    [survivor({ status: 'Killed' })],
    [acceptedMutant],
  );

  assert.equal(assessment.kind, 'invalid');
  if (assessment.kind !== 'invalid') return;
  assert.equal(assessment.code, 'stryker-accepted-mutants-stale');
  assert.match(assessment.detail, /src\/parser\.ts@4:10-4:12/u);
});

test('a new survivor is reported before a stale accepted entry is', () => {
  const assessment = assessStrykerBaseline(
    workingDirectory,
    [survivor({ id: '2', replacement: '<' })],
    [acceptedMutant],
  );

  assert.equal(assessment.kind, 'compared');
});

test('an undetected mutant without a stable identity stops the comparison', () => {
  const { mutatorName: _mutator, ...withoutMutator } = survivor();
  const incompleteMutants: readonly StrykerMutantResult[] = [
    { id: '1', status: 'Survived' },
    withoutMutator,
    survivor({ location: { start: { line: 4, column: 10 } } }),
    survivor({ fileName: join('/', 'gate', 'outside.ts') }),
  ];

  for (const incomplete of incompleteMutants) {
    const assessment = assessStrykerBaseline(workingDirectory, [incomplete], []);
    assert.equal(assessment.kind, 'invalid');
    if (assessment.kind !== 'invalid') continue;
    assert.equal(assessment.code, 'stryker-mutant-identity-unavailable');
  }
});

test('two undetected mutants that share one identity stop the comparison', () => {
  const assessment = assessStrykerBaseline(
    workingDirectory,
    [survivor(), survivor({ id: '2', status: 'NoCoverage' })],
    [],
  );

  assert.equal(assessment.kind, 'invalid');
  if (assessment.kind !== 'invalid') return;
  assert.equal(assessment.code, 'stryker-mutant-identity-ambiguous');
});

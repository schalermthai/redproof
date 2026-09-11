import assert from 'node:assert/strict';
import { mkdir, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { stryker } from '@redproof/stryker';
import { withWorkspace } from '../helpers/workspace.ts';

/**
 * Every case here is decided before Stryker starts, so no mutation run happens.
 * The mutation run itself is proven end to end by the Stryker fixture.
 */
const runWithCwd = (root: string, cwd: string) => {
  const adapter = stryker({ cwd, rules: { mutantsDetected: true } });
  return adapter.check.run({ root, rules: [adapter.rules.mutantsDetected.id] });
};

const runWithBaseline = (root: string, acceptedMutantsFile: string) => {
  const adapter = stryker({ rules: { noNewUndetectedMutants: { acceptedMutantsFile } } });
  return adapter.check.run({ root, rules: [adapter.rules.noNewUndetectedMutants.id] });
};

const linkKind = process.platform === 'win32' ? 'junction' : 'dir';

test('the adapter exposes one Rule per selected mutation policy, and says what it will run', () => {
  const adapter = stryker({
    rules: {
      mutantsDetected: true,
      noNewUndetectedMutants: { acceptedMutantsFile: 'accepted-mutants.json' },
      mutationScore: { minimum: 85 },
    },
  });

  assert.equal(adapter.rules.mutantsDetected.id, 'stryker/mutants-detected');
  assert.equal(adapter.rules.noNewUndetectedMutants.id, 'stryker/no-new-undetected-mutants');
  assert.equal(adapter.rules.mutationScore.id, 'stryker/mutation-score');
  assert.equal(
    adapter.rules.mutationScore.description,
    'Mutation score must be at least 85%.',
  );
  assert.equal(
    adapter.check.description,
    'run Stryker mutation testing and evaluate undetected mutants and mutation score',
  );
});

test('a Gate that selects no mutation policy is rejected when it is defined', () => {
  assert.throws(
    () => stryker({ rules: {} }),
    /requires at least one Redproof rule/u,
  );
});

test('a mutation policy Stryker does not offer is rejected by name, not ignored', () => {
  assert.throws(
    () => stryker({ rules: { mutantsDetected: true, mutantsKilled: true } as never }),
    /Unknown Stryker rule option: "mutantsKilled"\. Known options: mutantsDetected, noNewUndetectedMutants, mutationScore\./u,
  );
});

test('a minimum mutation score that is not a percentage is rejected when the Gate is defined', () => {
  for (const minimum of [-1, 101, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.throws(
      () => stryker({ rules: { mutationScore: { minimum } } }),
      /minimum must be between 0 and 100/u,
      String(minimum),
    );
  }

  stryker({ rules: { mutationScore: { minimum: 0 } } });
  stryker({ rules: { mutationScore: { minimum: 100 } } });
});

test('a baseline Rule without a real file path is rejected when the Gate is defined', () => {
  for (const acceptedMutantsFile of ['', '   ']) {
    assert.throws(
      () => stryker({ rules: { noNewUndetectedMutants: { acceptedMutantsFile } } }),
      /acceptedMutantsFile must be a non-empty string/u,
      JSON.stringify(acceptedMutantsFile),
    );
  }
});

test('a working directory outside the Gate root REFUSES before Stryker starts', async () => {
  await withWorkspace(async root => {
    const result = await runWithCwd(root, '../elsewhere');

    assert.equal(result.verdict, 'refuse');
    if (result.verdict !== 'refuse') return;
    assert.equal(result.why.code, 'stryker-cwd-outside-root');
    assert.equal(result.scan.inspected, null);
  });
});

test('a working directory that leaves the Gate root through a symbolic link REFUSES', async () => {
  await withWorkspace(async root => {
    await symlink(tmpdir(), join(root, 'escape'), linkKind);

    const result = await runWithCwd(root, 'escape');

    assert.equal(result.verdict, 'refuse');
    if (result.verdict !== 'refuse') return;
    assert.equal(result.why.code, 'stryker-cwd-outside-root');
  });
});

test('a working directory below the Gate root is accepted, and the baseline is read from it', async () => {
  await withWorkspace(async root => {
    await mkdir(join(root, 'project'), { recursive: true });
    await writeFile(join(root, 'project', 'accepted-mutants.json'), '{}', 'utf8');
    await writeFile(join(root, 'accepted-mutants.json'), '[]', 'utf8');

    const adapter = stryker({
      cwd: 'project',
      rules: { noNewUndetectedMutants: { acceptedMutantsFile: 'accepted-mutants.json' } },
    });
    const result = await adapter.check.run({
      root,
      rules: [adapter.rules.noNewUndetectedMutants.id],
    });

    assert.equal(result.verdict, 'refuse');
    if (result.verdict !== 'refuse') return;
    assert.equal(
      result.why.code,
      'stryker-accepted-mutants-invalid',
      'the inner working directory is accepted, and its own baseline file is the one read',
    );
    assert.equal(result.why.location?.file, 'project/accepted-mutants.json');
  });
});

test('an accepted-mutants baseline outside the Gate root REFUSES before Stryker starts', async () => {
  await withWorkspace(async root => {
    const result = await runWithBaseline(root, '../accepted-mutants.json');

    assert.equal(result.verdict, 'refuse');
    if (result.verdict !== 'refuse') return;
    assert.equal(result.why.code, 'stryker-accepted-mutants-outside-root');
    assert.equal(result.why.location?.file, '../accepted-mutants.json');
  });
});

test('an accepted-mutants baseline that is a symbolic link out of the Gate root REFUSES', async () => {
  const outside = join(tmpdir(), `redproof-outside-accepted-${process.pid}.json`);
  await writeFile(outside, '[]', 'utf8');

  await withWorkspace(async root => {
    await symlink(outside, join(root, 'accepted-mutants.json'));

    const result = await runWithBaseline(root, 'accepted-mutants.json');

    assert.equal(result.verdict, 'refuse');
    if (result.verdict !== 'refuse') return;
    assert.equal(result.why.code, 'stryker-accepted-mutants-outside-root');
  });
});

test('an unreadable or malformed accepted-mutants baseline REFUSES before Stryker starts', async () => {
  const cases = [
    { name: 'absent', content: null },
    { name: 'not an array', content: '{}' },
    { name: 'not JSON', content: '[' },
    { name: 'an entry that escapes the working directory', content: JSON.stringify([{
      fileName: '../outside.ts',
      mutatorName: 'EqualityOperator',
      replacement: '>',
      location: { start: { line: 1, column: 1 }, end: { line: 1, column: 2 } },
    }]) },
  ] as const;

  for (const { name, content } of cases) {
    await withWorkspace(async root => {
      if (content !== null) {
        await writeFile(join(root, 'accepted-mutants.json'), content, 'utf8');
      }

      const result = await runWithBaseline(root, 'accepted-mutants.json');

      assert.equal(result.verdict, 'refuse', name);
      if (result.verdict !== 'refuse') return;
      assert.equal(result.why.code, 'stryker-accepted-mutants-invalid', name);
      assert.equal(result.why.location?.file, 'accepted-mutants.json');
      assert.equal(result.scan.inspected, null);
    });
  }
});

test('a refused run leaves the working directory of the test process where it found it', async () => {
  await withWorkspace(async root => {
    const before = process.cwd();

    await runWithBaseline(root, 'accepted-mutants.json');

    assert.equal(process.cwd(), before);
  });
});

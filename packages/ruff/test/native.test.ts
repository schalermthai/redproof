import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { ruff, type RuffOptions } from '../src/index.ts';
import { fakeRuff, ruffBinary, withProject } from './support/workspace.ts';

function run(root: string, options: Partial<RuffOptions> & { rules?: Record<string, string> } = {}) {
  const adapter = ruff({ command: ruffBinary, rules: { unusedImports: 'F401' }, ...options } as RuffOptions);
  return adapter.check.run({ root, rules: Object.values(adapter.rules).map(rule => rule.id) });
}

function refusedWith(result: Awaited<ReturnType<typeof run>>, code: string | readonly string[]): void {
  assert.equal(result.verdict, 'refuse', JSON.stringify(result));
  if (result.verdict === 'refuse') assert.ok([code].flat().includes(result.why.code), JSON.stringify(result.why));
}

test('Ruff exiting 1 on findings is a FAIL naming the rule, not a crash; a clean tree passes', async () => {
  await withProject(['F401_single.py'], async root => {
    const red = await run(root);
    assert.equal(red.verdict, 'fail', JSON.stringify(red));
    if (red.verdict === 'fail') {
      assert.equal(red.breaches.length, 1);
      assert.equal(red.breaches[0]?.rule, 'ruff/F401');
      assert.equal(red.breaches[0]?.location?.file, 'F401_single.py');
      assert.equal(red.breaches[0]?.location?.line, 1);
    }
    await writeFile(join(root, 'F401_single.py'), 'import os\nprint(os.name)\n');
    const green = await run(root);
    assert.equal(green.verdict, 'pass', JSON.stringify(green));
    assert.equal(green.scan.inspected, 1);
  });
});

test('a family selector fails on any member rule; an unselected rule does not', async () => {
  await withProject(['S101.py', 'F401_0.py'], async root => {
    const bandit = await run(root, { rules: { bandit: 'S' }, paths: ['S101.py'] });
    assert.equal(bandit.verdict, 'fail');
    if (bandit.verdict === 'fail') {
      assert.equal(bandit.breaches.length, 3);
      assert.ok(bandit.breaches.every(b => b.rule === 'ruff/S' && b.code === 'S101'));
    }
    assert.equal((await run(root, { paths: ['S101.py'] })).verdict, 'pass', 'S101 file has no F401');
    const both = await run(root, { rules: { a: 'S101', b: 'F401' }, paths: ['S101.py', 'F401_0.py'] });
    assert.equal(both.verdict, 'fail');
    if (both.verdict === 'fail') assert.deepEqual([...new Set(both.breaches.map(b => b.rule))].sort(), ['ruff/F401', 'ruff/S101']);
  });
});

const refuseCases: ReadonlyArray<readonly [string, readonly string[], Partial<RuffOptions> & { rules?: Record<string, string> }, string | readonly string[]]> = [
  ['the ruff binary is missing', ['F401_single.py'], { command: 'redproof-no-such-ruff' }, 'command-unavailable'],
  ['a selected code does not exist', ['F401_single.py'], { rules: { x: 'ZZ999' }, paths: ['F401_single.py'] }, 'ruff-unknown-rule'],
  ['a path does not exist', ['F401_single.py'], { paths: ['absent.py'] }, 'ruff-path-missing'],
  ['the working directory does not exist', ['F401_single.py'], { cwd: 'nowhere' }, 'ruff-path-missing'],
  ['the config file does not exist', ['F401_single.py'], { configFile: 'nope.toml' }, 'ruff-path-missing'],
  ['one file cannot be parsed', ['F401_single.py', 'syntax_error.py'], { paths: ['F401_single.py', 'syntax_error.py'] },
    ['ruff-syntax-error', 'ruff-input-skipped' /* Ruff < 0.8 only prints `error: Failed to parse` */]],
  ['a preview rule is selected without preview', ['F401_single.py'], { rules: { x: 'RUF029' }, paths: ['F401_single.py'] }, 'ruff-input-skipped'],
  ['the tree has no Python files', [], {}, 'ruff-nothing-inspected'],
];
for (const [name, files, options, code] of refuseCases) {
  test(`REFUSE, never PASS: ${name}`, async () => {
    await withProject(files, async root => refusedWith(await run(root, options), code));
  });
}

test('REFUSE, never PASS: force-exclude drops a file the Gate named', async () => {
  await withProject(['F401_single.py', 'F401_5.py'], async root => {
    await writeFile(join(root, 'ruff.toml'), 'force-exclude = true\nexclude = ["F401_5.py"]\n');
    refusedWith(await run(root, { paths: ['F401_5.py', 'F401_single.py'] }), 'ruff-path-excluded');
    assert.equal((await run(root, { paths: ['F401_single.py'] })).verdict, 'fail', 'the file that was kept is still judged');
  });
});

test('REFUSE, never PASS: the project configuration is broken', async () => {
  await withProject(['F401_single.py'], async root => {
    await writeFile(join(root, 'ruff.toml'), 'select = [\n');
    refusedWith(await run(root, { paths: ['F401_single.py'] }), 'ruff-config-error');
  });
});

test('project config cannot silently hide a selected rule, except documented per-file-ignores and noqa', async () => {
  await withProject(['F401_single.py'], async root => {
    await writeFile(join(root, 'ruff.toml'), '[lint]\nignore = ["F401"]\n');
    assert.equal((await run(root)).verdict, 'fail', 'config ignore is overridden by the selection');
    await writeFile(join(root, 'ruff.toml'), '[lint.per-file-ignores]\n"F401_single.py" = ["F401"]\n');
    assert.equal((await run(root)).verdict, 'pass', 'per-file-ignores is honoured (documented)');
    assert.equal((await run(root, { isolated: true })).verdict, 'fail', 'isolated drops project config');
    await writeFile(join(root, 'ruff.toml'), '');
    await writeFile(join(root, 'F401_single.py'), 'import os  # noqa: F401\n');
    assert.equal((await run(root)).verdict, 'pass', 'noqa is honoured');
    assert.equal((await run(root, { ignoreNoqa: true })).verdict, 'fail', 'ignoreNoqa reveals it');
  });
});

test('a remapped code (SIM111 is answered as SIM110) REFUSES instead of passing with the violations dropped', async () => {
  await withProject(['SIM111.py'], async root => {
    refusedWith(await run(root, { rules: { x: 'SIM111' }, paths: ['SIM111.py'] }), 'ruff-input-skipped');
    const direct = await run(root, { rules: { x: 'SIM110' }, paths: ['SIM111.py'] });
    assert.equal(direct.verdict, 'fail', 'the current code finds them');
  });
});

test('wiring: the version gate runs before any judgement (version table: decision.core.test.ts)', async () => {
  await withProject([], async root => {
    refusedWith(await run(root, { command: await fakeRuff(root, '[]', 0, '', 'ruff 0.4.9') }), 'ruff-version-unsupported');
    assert.equal((await run(root, { command: await fakeRuff(root, '[]', 0, '', 'ruff 0.4.10') })).verdict, 'pass');
  });
});

test('wiring: Ruff output variables in the caller environment REFUSE by name (table: decision.core.test.ts)', async () => {
  await withProject([], async root => {
    const command = await fakeRuff(root, '[]', 0);
    assert.equal((await run(root, { command })).verdict, 'pass', 'baseline: clean environment');
    for (const name of ['RUFF_OUTPUT_FILE', 'RUFF_OUTPUT_FORMAT']) {
      process.env[name] = 'x';
      try {
        const result = await run(root, { command });
        refusedWith(result, 'ruff-environment-conflict');
        if (result.verdict === 'refuse') assert.match(result.why.detail ?? '', new RegExp(name, 'u'));
      } finally {
        delete process.env[name];
      }
    }
    assert.equal((await run(root, { command })).verdict, 'pass', 'restored');
  });
});

test('wiring: a process that exits 1 with a finding FAILs, one that lies about its exit code REFUSES (verdict table: decision.core.test.ts)', async () => {
  await withProject([], async root => {
    const finding = JSON.stringify([{ code: 'F401', message: 'm', filename: join(root, 'a.py'), location: { row: 1, column: 1 } }]);
    const failed = await run(root, { command: await fakeRuff(root, finding, 1) });
    assert.equal(failed.verdict, 'fail');
    assert.equal((await run(root, { command: await fakeRuff(root, '[]', 0) })).verdict, 'pass');
    refusedWith(await run(root, { command: await fakeRuff(root, finding, 0) }), 'ruff-report-inconsistent');
    refusedWith(await run(root, { command: await fakeRuff(root, '', 139) }), 'ruff-unsuccessful');
  });
});

test('a check never rewrites the tree even when the project enables fix', async () => {
  await withProject(['F401_single.py'], async root => {
    await writeFile(join(root, 'ruff.toml'), 'fix = true\n');
    assert.equal((await run(root)).verdict, 'fail');
    assert.equal(await readFile(join(root, 'F401_single.py'), 'utf8'), 'import os\n');
  });
});

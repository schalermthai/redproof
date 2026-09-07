import assert from 'node:assert/strict';
import { readFile, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { parseReporterArgs } from 'redproof';
import { withWorkspace } from '../helpers/workspace.ts';

test('reporter CLI parser supports one stdout reporter plus file reporters', () => {
  assert.deepEqual(parseReporterArgs([
    'check',
    '--reporter=default',
    '--reporter=json:.redproof/results.json',
    '--reporter=sarif:.redproof/results.sarif',
  ]), [
    { name: 'default' },
    { name: 'json', outputFile: '.redproof/results.json' },
    { name: 'sarif', outputFile: '.redproof/results.sarif' },
  ]);
});

test('reporter CLI parser rejects two reporters writing to stdout', () => {
  assert.throws(
    () => parseReporterArgs(['check', '--reporter=json', '--reporter=sarif']),
    /At most one reporter may write to stdout/,
  );
});

test('CLI prints help without loading a project', () => {
  const result = spawnSync(process.execPath, [
    '--disable-warning=ExperimentalWarning',
    '--experimental-strip-types',
    'packages/redproof/src/cli.ts',
    '--help',
  ], { cwd: resolve('.'), encoding: 'utf8' });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^Usage: redproof/m);
  assert.match(result.stdout, /--config <path>/);
});

test('CLI prints its package version', async () => {
  const result = spawnSync(process.execPath, [
    '--disable-warning=ExperimentalWarning',
    '--experimental-strip-types',
    'packages/redproof/src/cli.ts',
    '--version',
  ], { cwd: resolve('.'), encoding: 'utf8' });

  assert.equal(result.status, 0, result.stderr);
  const manifest = JSON.parse(
    await readFile(resolve('packages/redproof/package.json'), 'utf8'),
  ) as { version: string };
  assert.equal(result.stdout.trim(), manifest.version);
});

test('CLI reports a missing config value without an internal stack trace', () => {
  const result = spawnSync(process.execPath, [
    '--disable-warning=ExperimentalWarning',
    '--experimental-strip-types',
    'packages/redproof/src/cli.ts',
    'check',
    '--config',
  ], { cwd: resolve('.'), encoding: 'utf8' });

  assert.equal(result.status, 2);
  assert.match(result.stderr, /^Option --config requires a path\.\n$/);
  assert.doesNotMatch(result.stderr, /node:path|at main|ERR_/);
});

test('CLI discovers an ESM config in a CommonJS project', () => {
  const result = spawnSync(process.execPath, [
    '--disable-warning=ExperimentalWarning',
    '--experimental-strip-types',
    resolve('packages/redproof/src/cli.ts'),
    'check',
    '--reporter=json',
  ], { cwd: resolve('fixtures/commonjs-config'), encoding: 'utf8' });

  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.status, 'passed');
  assert.deepEqual(report.gates.map((gate: { id: string }) => gate.id), ['commonjs-config']);
});

test('CLI prefers redproof.config.ts when several config files exist', () => {
  const result = spawnSync(process.execPath, [
    '--disable-warning=ExperimentalWarning',
    '--experimental-strip-types',
    resolve('packages/redproof/src/cli.ts'),
    'check',
    '--reporter=json',
  ], { cwd: resolve('fixtures/config-precedence'), encoding: 'utf8' });

  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.deepEqual(report.gates.map((gate: { id: string }) => gate.id), ['from-ts']);
});

test('CLI names every config file it looked for when none exists', async () => {
  await withWorkspace(async root => {
    const result = spawnSync(process.execPath, [
      '--disable-warning=ExperimentalWarning',
      '--experimental-strip-types',
      resolve('packages/redproof/src/cli.ts'),
      'check',
    ], { cwd: root, encoding: 'utf8' });

    assert.equal(result.status, 2, result.stdout);
    assert.match(result.stderr, /No Redproof config found/);
    for (const file of [
      'redproof.config.ts',
      'redproof.config.mts',
      'redproof.config.mjs',
      'redproof.config.cts',
      'redproof.config.cjs',
      'redproof.config.js',
    ]) {
      assert.ok(result.stderr.includes(file), `stderr must name ${file}`);
    }
    assert.doesNotMatch(result.stderr, /ERR_MODULE_NOT_FOUND|at main|node:internal/);
  });
});

test('CLI writes JSON output relative to the project root', async () => {
  const output = resolve('fixtures/pass-single/.redproof/reporter-test.json');
  await rm(output, { force: true });

  const result = spawnSync(process.execPath, [
    '--disable-warning=ExperimentalWarning',
    '--experimental-strip-types',
    'packages/redproof/src/cli.ts',
    'check',
    '--config',
    'fixtures/pass-single/redproof.config.ts',
    '--reporter=json',
    '--outputFile=.redproof/reporter-test.json',
  ], { cwd: resolve('.'), encoding: 'utf8' });

  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(await readFile(output, 'utf8'));
  assert.equal(parsed.version, 1);
  assert.equal(parsed.status, 'passed');
  await rm(resolve('fixtures/pass-single/.redproof'), { recursive: true, force: true });
});

test('CLI keeps Check logs out of machine-readable stdout', () => {
  const result = spawnSync(process.execPath, [
    '--disable-warning=ExperimentalWarning',
    '--experimental-strip-types',
    'packages/redproof/src/cli.ts',
    'check',
    '--config',
    'fixtures/logging-check/redproof.config.ts',
    '--reporter=json',
  ], { cwd: resolve('.'), encoding: 'utf8' });

  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.status, 'passed');
  assert.doesNotMatch(result.stdout, /message from Check/);
  assert.match(result.stderr, /message from Check/);
});

test('CLI describe can target one discovered Gate file', () => {
  const result = spawnSync(process.execPath, [
    '--disable-warning=ExperimentalWarning',
    '--experimental-strip-types',
    'packages/redproof/src/cli.ts',
    'describe',
    'gates/no-todo.ts',
    '--config',
    'fixtures/composition-native/redproof.config.ts',
  ], { cwd: resolve('.'), encoding: 'utf8' });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^Gate: no-todo/m);
  assert.equal((result.stdout.match(/^Gate:/gm) ?? []).length, 1);
});

const cli = (...args: string[]) => spawnSync(process.execPath, [
  '--disable-warning=ExperimentalWarning',
  '--experimental-strip-types',
  'packages/redproof/src/cli.ts',
  ...args,
], { cwd: resolve('.'), encoding: 'utf8' });

const gateSelection = ['--config', 'fixtures/gate-selection/redproof.config.ts'];

test('CLI check and prove accept Gate files and narrow the run', () => {
  const all = cli('check', ...gateSelection, '--reporter=json');
  assert.equal(all.status, 0, all.stderr);
  assert.deepEqual(JSON.parse(all.stdout).gates.map((gate: { id: string }) => gate.id), ['alpha', 'beta']);

  const one = cli('check', ...gateSelection, 'gates/beta.ts', '--reporter=json');
  assert.equal(one.status, 0, one.stderr);
  assert.deepEqual(JSON.parse(one.stdout).gates.map((gate: { id: string }) => gate.id), ['beta']);

  const proveAll = cli('prove', ...gateSelection);
  assert.equal(proveAll.status, 0, proveAll.stderr);
  assert.equal((proveAll.stdout.match(/^✓/gm) ?? []).length, 4);

  const proveOne = cli('prove', ...gateSelection, 'gates/alpha.ts');
  assert.equal(proveOne.status, 0, proveOne.stderr);
  assert.equal((proveOne.stdout.match(/^✓/gm) ?? []).length, 2);
});

test('CLI rejects an unmatched Gate file without an internal stack trace', () => {
  for (const command of ['check', 'prove', 'describe']) {
    const result = cli(command, ...gateSelection, 'gates/missing.ts');
    assert.equal(result.status, 2, `${command}: ${result.stderr}`);
    assert.equal(result.stderr, 'No Gate matched: gates/missing.ts\n');
    assert.equal(result.stdout, '');
  }
});

test('CLI rejects a real file that gatesRoot does not match', () => {
  const result = cli('check', ...gateSelection, 'src/alpha.txt');

  assert.equal(result.status, 2, result.stderr);
  assert.match(result.stderr, /^src\/alpha\.txt is not a discovered Gate\./);
  assert.doesNotMatch(result.stderr, /at |node:internal/);
});

test('CLI does not read a reporter or output-file value as a Gate file', () => {
  const spaced = cli('check', ...gateSelection, '--reporter', 'json');
  assert.equal(spaced.status, 0, spaced.stderr);
  assert.deepEqual(JSON.parse(spaced.stdout).gates.map((gate: { id: string }) => gate.id), ['alpha', 'beta']);

  const described = cli('describe', ...gateSelection, '--reporter', 'json');
  assert.equal(described.status, 0, described.stderr);
  assert.equal((described.stdout.match(/^Gate:/gm) ?? []).length, 2);
});

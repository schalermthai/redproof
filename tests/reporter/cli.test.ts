import assert from 'node:assert/strict';
import { readFile, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { parseReporterArgs } from 'redproof';

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

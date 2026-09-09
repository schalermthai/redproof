import assert from 'node:assert/strict';
import test from 'node:test';
import { ReporterArgumentError, parseReporterArgs } from '../../packages/redproof/src/reporter/core/arguments.ts';

const rejects = (args: readonly string[], message: RegExp) =>
  assert.throws(() => parseReporterArgs(args), (error: unknown) => {
    assert.ok(error instanceof ReporterArgumentError, `expected a ReporterArgumentError, got ${String(error)}`);
    assert.match(error.message, message);
    return true;
  });

test('a run with no reporter flag gets the default terminal reporter', () => {
  assert.deepEqual(parseReporterArgs([]), [{ name: 'default' }]);
  assert.deepEqual(parseReporterArgs(['check', 'gates/alpha.ts', '--verbose']), [{ name: 'default' }]);
});

test('a reporter name is accepted joined or spaced, and every built-in name is known', () => {
  for (const name of ['default', 'compact', 'json', 'sarif']) {
    assert.deepEqual(parseReporterArgs([`--reporter=${name}`]), [{ name }]);
    assert.deepEqual(parseReporterArgs(['--reporter', name]), [{ name }]);
  }
});

test('a colon in the reporter value names the file that reporter writes to', () => {
  assert.deepEqual(parseReporterArgs(['--reporter=json:.redproof/results.json']), [
    { name: 'json', outputFile: '.redproof/results.json' },
  ]);
  assert.deepEqual(parseReporterArgs(['--reporter', 'sarif:/tmp/out.sarif']), [
    { name: 'sarif', outputFile: '/tmp/out.sarif' },
  ]);
});

test('one stdout reporter may run beside any number of file reporters', () => {
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

  assert.deepEqual(parseReporterArgs(['--reporter=json:a.json', '--reporter=sarif:b.sarif']), [
    { name: 'json', outputFile: 'a.json' },
    { name: 'sarif', outputFile: 'b.sarif' },
  ]);
});

test('two reporters writing to stdout are refused, because their output would interleave', () => {
  rejects(['--reporter=json', '--reporter=sarif'], /At most one reporter may write to stdout/);
  rejects(['--reporter=default', '--reporter=json', '--reporter=sarif:out.sarif'], /At most one reporter may write to stdout/);
});

test('--outputFile is shorthand for the output path of the single selected reporter', () => {
  assert.deepEqual(parseReporterArgs(['--reporter=json', '--outputFile=results.json']), [
    { name: 'json', outputFile: 'results.json' },
  ]);
  assert.deepEqual(parseReporterArgs(['--outputFile', 'results.txt']), [
    { name: 'default', outputFile: 'results.txt' },
  ]);
});

test('--outputFile is refused when it cannot say which reporter it belongs to', () => {
  rejects(['--reporter=json', '--reporter=sarif:b.sarif', '--outputFile=a.json'], /only be used when exactly one reporter/);
  rejects(['--reporter=json:a.json', '--outputFile=b.json'], /Output file was specified twice/);
});

test('a reporter name that does not exist is a usage error, not a silent default', () => {
  rejects(['--reporter=bogus'], /^Unknown reporter: bogus$/);
  rejects(['--reporter', 'bogus:out.txt'], /^Unknown reporter: bogus$/);
});

test('a flag that promises a value and gives none is a usage error', () => {
  rejects(['--reporter'], /^--reporter requires a value\.$/);
  rejects(['--reporter', '--verbose'], /^--reporter requires a value\.$/);
  rejects(['--outputFile'], /^--outputFile requires a value\.$/);
  rejects(['--outputFile='], /^--outputFile requires a value\.$/);
  rejects(['--reporter=json:'], /^Reporter json output path cannot be empty\.$/);
});

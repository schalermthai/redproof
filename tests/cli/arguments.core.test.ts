import assert from 'node:assert/strict';
import test from 'node:test';
import { noConfigMessage, parseArguments } from '../../packages/redproof/src/cli/core/arguments.ts';

test('help and version win over every other argument', () => {
  assert.deepEqual(parseArguments(['check', '--help', '--config'], true), { kind: 'help' });
  assert.deepEqual(parseArguments(['-h'], false), { kind: 'help' });
  assert.deepEqual(parseArguments(['prove', '-v'], true), { kind: 'version' });
  assert.deepEqual(parseArguments(['--version', '--help'], true), { kind: 'help' });
});

function run(argv: readonly string[], stdoutIsTty = false) {
  const invocation = parseArguments(argv, stdoutIsTty);
  assert.equal(invocation.kind, 'run', JSON.stringify(invocation));
  if (invocation.kind !== 'run') throw new Error('unreachable');
  return invocation;
}

test('check is the default command, with a default reporter and TTY colour', () => {
  assert.deepEqual(run([], true), {
    kind: 'run',
    command: 'check',
    configPath: null,
    gateFiles: [],
    reporters: [{ name: 'default' }],
    color: true,
    verbose: false,
  });
  assert.equal(run([], false).color, false);
  assert.equal(run(['check', '--no-color'], true).color, false);
  assert.equal(run(['check', '--verbose'], true).verbose, true);
});

test('--config accepts a separate or inline value and requires one', () => {
  assert.equal(run(['check', '--config', 'a/redproof.config.ts']).configPath, 'a/redproof.config.ts');
  assert.equal(run(['check', '--config=b/redproof.config.ts']).configPath, 'b/redproof.config.ts');

  const missing = { kind: 'usage-error', message: 'Option --config requires a path.' };
  assert.deepEqual(parseArguments(['check', '--config'], false), missing);
  assert.deepEqual(parseArguments(['check', '--config', '--verbose'], false), missing);
  assert.deepEqual(parseArguments(['check', '--config='], false), missing);
});

test('Gate files are the positionals after the command, never a flag value', () => {
  const invocation = run([
    'prove', 'gates/a.ts', '--config', 'x.ts', '--reporter', 'json', 'gates/b.ts', '--outputFile', 'out.json', '--verbose',
  ]);

  assert.deepEqual(invocation.gateFiles, ['gates/a.ts', 'gates/b.ts']);
  assert.deepEqual(invocation.reporters, [{ name: 'json', outputFile: 'out.json' }]);
});

test('an unknown command is a usage error, and describe takes no reporter', () => {
  assert.deepEqual(parseArguments(['lint'], false), { kind: 'usage-error', message: 'Unknown command: lint' });

  const describe = run(['describe', 'gates/a.ts', '--reporter=sarif']);
  assert.equal(describe.command, 'describe');
  assert.deepEqual(describe.reporters, []);
});

test('prove accepts only the default and json reporters', () => {
  assert.equal(parseArguments(['prove', '--reporter=json'], false).kind, 'run');
  assert.deepEqual(parseArguments(['prove', '--reporter=sarif'], false), {
    kind: 'usage-error',
    message: 'Reporter sarif does not support the prove command.',
  });
});

test('a bad reporter option is a usage error, never a crash', () => {
  assert.deepEqual(parseArguments(['check', '--reporter=bogus'], false), {
    kind: 'usage-error',
    message: 'Unknown reporter: bogus',
  });
  assert.deepEqual(parseArguments(['check', '--reporter'], false), {
    kind: 'usage-error',
    message: '--reporter requires a value.',
  });
  assert.equal(parseArguments(['check', '--reporter=json', '--reporter=sarif'], false).kind, 'usage-error');
  assert.equal(parseArguments(['check', '--reporter=json:'], false).kind, 'usage-error');
});

test('the missing-config message names every file it looked for', () => {
  const message = noConfigMessage('/work');
  assert.match(message, /^No Redproof config found in \/work\.\n/);
  assert.match(message, /redproof\.config\.ts, redproof\.config\.mts, redproof\.config\.mjs, redproof\.config\.cts, redproof\.config\.cjs, redproof\.config\.js\./);
  assert.match(message, /pass --config <path>\.$/);
});

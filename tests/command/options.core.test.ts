import assert from 'node:assert/strict';
import test from 'node:test';
import { defineRule } from 'redproof';
import {
  commandDescription,
  groupDescription,
  groupSource,
  labelOf,
  validateCommandExecutionOptions,
  validateCommandOptions,
  validateGroupOptions,
  type CommandCheckOptions,
} from '../../packages/redproof/src/command/core/options.ts';

const rule = defineRule({ id: 'probe/lint', description: 'Lint must pass.' });
const types = defineRule({ id: 'probe/types', description: 'Types must pass.' });

const lint: CommandCheckOptions<typeof rule.id> = { rule, command: 'npm', args: ['run', 'lint'] };

test('a command must name an executable', () => {
  assert.throws(() => validateCommandOptions({ rule, command: '' }), /command must not be empty\./);
  assert.throws(() => validateCommandOptions({ rule, command: '  ' }), /command must not be empty\./);
  assert.doesNotThrow(() => validateCommandOptions(lint));
});

test('timeout and output bounds must be positive integers when given', () => {
  assert.throws(() => validateCommandOptions({ ...lint, timeoutMs: 0 }), /timeoutMs must be a positive integer\./);
  assert.throws(() => validateCommandOptions({ ...lint, timeoutMs: 1.5 }), /timeoutMs must be a positive integer\./);
  assert.throws(() => validateCommandOptions({ ...lint, maxOutputBytes: -1 }), /maxOutputBytes must be a positive integer\./);
  assert.throws(() => validateCommandOptions({ ...lint, maxOutputBytes: Number.NaN }), /maxOutputBytes must be a positive integer\./);
  assert.doesNotThrow(() => validateCommandOptions({ ...lint, timeoutMs: 1, maxOutputBytes: 1 }));
});

test('executeCommand accepts only an absolute working directory', () => {
  assert.throws(
    () => validateCommandExecutionOptions({ command: 'npm', cwd: 'packages' }),
    /executeCommand cwd must be absolute\./,
  );
  assert.throws(
    () => validateCommandExecutionOptions({ command: 'npm', cwd: '.' }),
    /executeCommand cwd must be absolute\./,
  );
  assert.throws(
    () => validateCommandExecutionOptions({ command: '', cwd: '/repo' }),
    /command must not be empty\./,
  );
  assert.doesNotThrow(() => validateCommandExecutionOptions({ command: 'npm', cwd: '/repo' }));
});

test('a group needs at least one entry', () => {
  assert.throws(() => validateGroupOptions({ entries: [] as never }), /commands requires at least one entry\./);
  assert.doesNotThrow(() => validateGroupOptions({ entries: [lint] }));
});

test('maxAtOnce belongs to parallel mode only, and must be a positive integer there', () => {
  assert.throws(
    () => validateGroupOptions({ entries: [lint], maxAtOnce: 2 } as never),
    /maxAtOnce is only available in parallel mode\./,
  );
  assert.throws(
    () => validateGroupOptions({ mode: 'sequential', entries: [lint], maxAtOnce: 2 } as never),
    /maxAtOnce is only available in parallel mode\./,
  );
  assert.throws(
    () => validateGroupOptions({ mode: 'parallel', entries: [lint], maxAtOnce: 0 }),
    /maxAtOnce must be a positive integer\./,
  );
  assert.doesNotThrow(() => validateGroupOptions({ mode: 'parallel', entries: [lint] }));
  assert.doesNotThrow(() => validateGroupOptions({ mode: 'parallel', entries: [lint], maxAtOnce: 3 }));
});

test('a command is labelled by its label, or else by the command exactly as written', () => {
  assert.equal(labelOf({ ...lint, label: 'lint' }), 'lint');
  assert.equal(labelOf({ rule, command: '/usr/local/bin/npm' }), '/usr/local/bin/npm');
});

test('a command describes its invocation by base name, unless a description is given', () => {
  assert.equal(commandDescription({ rule, command: '/usr/local/bin/npm', args: ['run', 'lint'] }), 'run npm run lint');
  assert.equal(commandDescription({ rule, command: 'tsc' }), 'run tsc');
  assert.equal(
    commandDescription({ rule, command: '/usr/local/bin/npm', args: ['run', 'lint'], description: 'lint the docs' }),
    'lint the docs',
  );
});

test('a group describes its size and names each entry by label, or else by base name', () => {
  const group = {
    entries: [
      { rule, command: 'npm', args: ['run', 'lint'], label: 'lint' },
      { rule: types, command: '/usr/local/bin/tsc', args: ['--noEmit'] },
    ],
  } as const;

  assert.equal(groupDescription(group), 'run 2 commands: lint, tsc');
  assert.equal(groupDescription({ ...group, description: 'lint and type-check' }), 'lint and type-check');
});

test('a group is sourced by its label, or else by the labels of its entries', () => {
  const group = {
    entries: [
      { rule, command: '/usr/local/bin/npm', label: 'lint' },
      { rule: types, command: '/usr/local/bin/tsc' },
    ],
  } as const;

  assert.equal(groupSource({ ...group, label: 'quality' }), 'quality');
  assert.equal(groupSource(group), 'lint, /usr/local/bin/tsc');
});

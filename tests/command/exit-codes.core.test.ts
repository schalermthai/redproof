import assert from 'node:assert/strict';
import test from 'node:test';
import { classifyExit, exitPolicy } from '../../packages/redproof/src/command/core/exit-codes.ts';

test('without a policy, exit zero passes and every other code breaches', () => {
  const policy = exitPolicy(undefined);

  assert.equal(classifyExit(0, policy), 'pass');
  assert.equal(classifyExit(1, policy), 'breach');
  assert.equal(classifyExit(2, policy), 'breach');
  assert.equal(classifyExit(255, policy), 'breach');
});

test('an explicit breach list leaves every other nonzero code unclassified', () => {
  const policy = exitPolicy({ pass: [0], breach: [1] });

  assert.equal(classifyExit(0, policy), 'pass');
  assert.equal(classifyExit(1, policy), 'breach');
  assert.equal(classifyExit(2, policy), 'unclassified');
});

test('a breach list alone keeps zero as the passing code', () => {
  const policy = exitPolicy({ breach: [1, 2] });

  assert.equal(classifyExit(0, policy), 'pass');
  assert.equal(classifyExit(2, policy), 'breach');
  assert.equal(classifyExit(3, policy), 'unclassified');
});

test('a pass list alone treats every remaining code as a breach', () => {
  const policy = exitPolicy({ pass: [0, 3] });

  assert.equal(classifyExit(3, policy), 'pass');
  assert.equal(classifyExit(0, policy), 'pass');
  assert.equal(classifyExit(1, policy), 'breach');
});

test('the default breach set is exactly the nonzero codes, so an unlisted zero is unclassified', () => {
  const policy = exitPolicy({ pass: [1] });

  assert.equal(classifyExit(1, policy), 'pass');
  assert.equal(classifyExit(0, policy), 'unclassified');
  assert.equal(classifyExit(2, policy), 'breach');
});

test('one exit code cannot both pass and breach', () => {
  assert.throws(
    () => exitPolicy({ pass: [0, 1], breach: [1] }),
    /Exit code 1 cannot produce both PASS and a Breach\./,
  );
});

test('exit codes must be non-negative integers, and the error names the list', () => {
  assert.throws(() => exitPolicy({ pass: [-1] }), /exitCodes\.pass must contain only non-negative integers\./);
  assert.throws(() => exitPolicy({ pass: [1.5] }), /exitCodes\.pass must contain only non-negative integers\./);
  assert.throws(() => exitPolicy({ breach: [-2] }), /exitCodes\.breach must contain only non-negative integers\./);
  assert.throws(() => exitPolicy({ breach: [Number.NaN] }), /exitCodes\.breach must contain only non-negative integers\./);
  assert.doesNotThrow(() => exitPolicy({ pass: [0], breach: [1, 2] }));
});

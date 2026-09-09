import assert from 'node:assert/strict';
import test from 'node:test';
import { rejectUnknownKeys } from '../../packages/redproof/src/composition/core/options.ts';

const known = ['root', 'gatesRoot', 'refusalExit'] as const;

test('a value whose keys are all known is accepted, including an empty one', () => {
  assert.doesNotThrow(() => rejectUnknownKeys({}, known, 'config'));
  assert.doesNotThrow(() => rejectUnknownKeys({ root: '.', refusalExit: 2 }, known, 'config'));
});

test('one unknown key is reported in the singular, quoted, with every known option', () => {
  assert.throws(
    () => rejectUnknownKeys({ root: '.', refuseExit: 2 }, known, 'config'),
    { message: 'Unknown config option: "refuseExit". Known options: root, gatesRoot, refusalExit.' },
  );
});

test('several unknown keys are reported in the plural, in the order they were written', () => {
  assert.throws(
    () => rejectUnknownKeys({ refuseExit: 2, root: '.', gateRoot: 'g' }, known, 'execution'),
    { message: 'Unknown execution options: "refuseExit", "gateRoot". Known options: root, gatesRoot, refusalExit.' },
  );
});

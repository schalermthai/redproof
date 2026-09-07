import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveConfig } from 'redproof';

test('a config with no execution block defaults to copies', () => {
  assert.deepEqual(resolveConfig({}).execution, { mode: 'copies', maxAtOnce: 4 });
  assert.deepEqual(resolveConfig({ root: 'x' }).execution, { mode: 'copies', maxAtOnce: 4 });
});

test('an explicit execution block overrides the default', () => {
  assert.deepEqual(
    resolveConfig({ execution: { mode: 'in-place' } }).execution,
    { mode: 'in-place' },
  );

  assert.deepEqual(
    resolveConfig({ execution: { mode: 'copies', maxAtOnce: 2 } }).execution,
    { mode: 'copies', maxAtOnce: 2 },
  );
});

test('config resolution rejects an unknown option instead of ignoring it', () => {
  assert.throws(
    () => resolveConfig({ root: '.', refuseExit: 2 } as never),
    /Unknown config option: "refuseExit"\. Known options: root, gatesRoot, refusalExit, execution\./,
  );

  assert.throws(
    () => resolveConfig({ execution: { mode: 'copies', maxAtOne: 4 } } as never),
    /Unknown execution option: "maxAtOne"\. Known options: mode, maxAtOnce\./,
  );

  assert.throws(
    () => resolveConfig({ refuseExit: 2, gateRoot: 'g' } as never),
    /Unknown config options: "refuseExit", "gateRoot"/,
  );

  assert.doesNotThrow(() => resolveConfig({
    root: '.',
    gatesRoot: 'gates/**/*.ts',
    refusalExit: 2,
    execution: { mode: 'copies', maxAtOnce: 2 },
  }));
});

import assert from 'node:assert/strict';
import test from 'node:test';
import { defineConfig, resolveConfig } from '../../packages/redproof/src/composition/core/config.ts';

test('an empty config resolves to the documented defaults', () => {
  assert.deepEqual(resolveConfig({}), {
    root: '.',
    gatesRoot: ['gates/**/*.ts'],
    refusalExit: 2,
    execution: { mode: 'copies', maxAtOnce: 4 },
  });
});

test('explicit values survive resolution and one gatesRoot pattern becomes a list', () => {
  assert.deepEqual(resolveConfig({ root: 'project', gatesRoot: 'checks/*.ts', refusalExit: 3 }), {
    root: 'project',
    gatesRoot: ['checks/*.ts'],
    refusalExit: 3,
    execution: { mode: 'copies', maxAtOnce: 4 },
  });
  assert.deepEqual(resolveConfig({ gatesRoot: ['a/*.ts', 'b/*.ts'] }).gatesRoot, ['a/*.ts', 'b/*.ts']);
});

test('in-place execution carries no concurrency, and copies keeps an explicit maxAtOnce', () => {
  assert.deepEqual(resolveConfig({ execution: { mode: 'in-place' } }).execution, { mode: 'in-place' });
  assert.deepEqual(resolveConfig({ execution: { mode: 'copies' } }).execution, { mode: 'copies', maxAtOnce: 4 });
  assert.deepEqual(resolveConfig({ execution: { mode: 'copies', maxAtOnce: 2 } }).execution, { mode: 'copies', maxAtOnce: 2 });
});

test('maxAtOnce must be a positive integer', () => {
  for (const maxAtOnce of [0, -1, 1.5, Number.NaN]) {
    assert.throws(
      () => resolveConfig({ execution: { mode: 'copies', maxAtOnce } }),
      { message: 'execution.maxAtOnce must be a positive integer.' },
      `maxAtOnce ${maxAtOnce} must be rejected`,
    );
  }
  assert.equal(resolveConfig({ execution: { mode: 'copies', maxAtOnce: 1 } }).execution.mode, 'copies');
});

test('config resolution rejects an unknown option instead of ignoring it', () => {
  assert.throws(
    () => resolveConfig({ root: '.', refuseExit: 2 } as never),
    { message: 'Unknown config option: "refuseExit". Known options: root, gatesRoot, refusalExit, execution.' },
  );
  assert.throws(
    () => resolveConfig({ execution: { mode: 'copies', maxAtOne: 4 } } as never),
    { message: 'Unknown execution option: "maxAtOne". Known options: mode, maxAtOnce.' },
  );
  assert.throws(
    () => resolveConfig({ refuseExit: 2, gateRoot: 'g' } as never),
    /^Error: Unknown config options: "refuseExit", "gateRoot"\./,
  );
});

test('defineConfig returns the config it was given', () => {
  const config = { root: '.', gatesRoot: 'gates/**/*.ts', refusalExit: 2, execution: { mode: 'copies', maxAtOnce: 2 } } as const;
  assert.equal(defineConfig(config), config);
});

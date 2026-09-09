import assert from 'node:assert/strict';
import test from 'node:test';
import { mapLimit } from '../../packages/redproof/src/support/map-limit.ts';

type Deferred<T> = { promise: Promise<T>; resolve(value: T): void; reject(error: unknown): void };

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

async function settle(): Promise<void> {
  for (let i = 0; i < 10; i += 1) await Promise.resolve();
}

function controlled(count: number, limit: number) {
  const gates = Array.from({ length: count }, () => deferred<string>());
  const started: number[] = [];
  const results = mapLimit(gates.map((_, index) => index), limit, (item, index) => {
    started.push(index);
    return gates[item]!.promise;
  });
  return { gates, started, results };
}

test('results keep the input order even when later items finish first', async () => {
  const { gates, results } = controlled(3, 3);
  gates[2]!.resolve('c');
  gates[0]!.resolve('a');
  gates[1]!.resolve('b');
  assert.deepEqual(await results, ['a', 'b', 'c']);
});

test('at most limit tasks run at once, and the next starts only when one finishes', async () => {
  const { gates, started, results } = controlled(4, 2);
  await settle();
  assert.deepEqual(started, [0, 1], 'only the first two start');

  gates[1]!.resolve('b');
  await settle();
  assert.deepEqual(started, [0, 1, 2], 'one finish admits one more');

  gates[0]!.resolve('a');
  await settle();
  assert.deepEqual(started, [0, 1, 2, 3]);

  gates[2]!.resolve('c');
  gates[3]!.resolve('d');
  assert.deepEqual(await results, ['a', 'b', 'c', 'd']);
});

test('a limit larger than the list starts everything at once', async () => {
  const { gates, started, results } = controlled(3, 10);
  await settle();
  assert.deepEqual(started, [0, 1, 2]);
  gates.forEach((gate, index) => gate.resolve(String(index)));
  assert.deepEqual(await results, ['0', '1', '2']);
});

test('run receives each item with its index, and an empty list resolves without running anything', async () => {
  const seen: Array<[string, number]> = [];
  await mapLimit(['x', 'y'], 1, async (item, index) => { seen.push([item, index]); });
  assert.deepEqual(seen, [['x', 0], ['y', 1]]);

  let ran = 0;
  assert.deepEqual(await mapLimit([], 2, async () => { ran += 1; }), []);
  assert.equal(ran, 0);
});

test('a failing task rejects the whole map with its error', async () => {
  await assert.rejects(
    mapLimit([1, 2, 3], 2, async item => {
      if (item === 2) throw new Error('item 2 failed');
      return item;
    }),
    { message: 'item 2 failed' },
  );
});

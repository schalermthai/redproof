import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  breach,
  counting,
  defineAdapter,
  defineGate,
  defineProofs,
  fail,
  mutate,
  pass,
  proof,
} from 'redproof';

const clean = {
  id: 'state/must-stay-clean',
  description: 'the fixture state must not contain a planted BAD marker',
} as const;

const gate = defineGate({
  id: 'in-place-state',
  adapter: defineAdapter({
    kind: 'fixture',
    rules: { clean },
    check: {
      description: 'inspect src/state.txt for the planted BAD marker',
      counting: counting.supported,
      async run(ctx) {
        const startedAt = new Date().toISOString();
        const text = await readFile(resolve(ctx.root, 'src/state.txt'), 'utf8');
        const scan = {
          source: `pid:${process.pid}`,
          startedAt,
          finishedAt: new Date().toISOString(),
          inspected: 1,
        } as const;

        if (!text.includes('BAD')) return pass(scan);
        return fail(scan, [breach(clean.id, {
          code: 'bad-marker',
          message: 'The planted BAD marker was detected.',
          location: { file: 'src/state.txt', line: 2, column: 1 },
        })]);
      },
    },
  }),
});

export const proofs = defineProofs(gate, [
  proof.red(clean, 'detects an in-place mutation', mutate.appendText('src/state.txt', 'BAD\n')),
  proof.green('sees the original state after undo'),
]);

export default gate;

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
  id: 'copy-state/no-bad-marker',
  description: 'the copied Gate workspace must start each proof without BAD markers',
} as const;

const gate = defineGate({
  id: 'copy-state',
  adapter: defineAdapter({
    kind: 'fixture',
    rules: { clean },
    check: {
      description: 'inspect the Gate copy for a planted BAD marker',
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
          message: 'BAD marker detected in the Gate copy.',
          location: { file: 'src/state.txt', line: null, column: null },
        })]);
      },
    },
  }),
});

export const proofs = defineProofs(gate, [
  proof.red(clean, 'first RED reuses the Gate copy', mutate.appendText('src/state.txt', 'BAD one\n')),
  proof.red(clean, 'second RED starts from the same clean baseline', mutate.appendText('src/state.txt', 'BAD two\n')),
  proof.green('GREEN sees the baseline after both undos'),
]);

export default gate;

import { appendFile, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  breach,
  counting,
  defineAdapter,
  defineGate,
  defineProofs,
  fail,
  pass,
  proof,
  type Mutation,
} from 'redproof';

const clean = {
  id: 'stale/no-dirty-marker',
  description: 'proof mutations must restore the Gate copy before it is reused',
} as const;

const brokenUndo: Mutation = {
  description: 'append DIRTY but intentionally return a broken undo',
  async apply(root) {
    await appendFile(resolve(root, 'src/state.txt'), 'DIRTY\n');
    return async () => {
      // Deliberately wrong: the copies-mode baseline verifier must catch this.
    };
  },
};

const gate = defineGate({
  id: 'stale-workspace',
  adapter: defineAdapter({
    kind: 'fixture',
    rules: { clean },
    check: {
      description: 'detect a DIRTY marker planted by the proof',
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
        if (!text.includes('DIRTY')) return pass(scan);
        return fail(scan, [breach(clean.id, {
          code: 'dirty-marker',
          message: 'DIRTY marker detected.',
          location: { file: 'src/state.txt', line: null, column: null },
        })]);
      },
    },
  }),
});

export const proofs = defineProofs(gate, [
  proof.red(clean, 'detects stale workspace after broken undo', brokenUndo),
  proof.green('must not run after the Gate copy becomes stale'),
]);

export default gate;

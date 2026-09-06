import {
  breach,
  counting,
  defineGate,
  defineMutation,
  defineProofs,
  defineRules,
  files,
  proof,
  result,
} from 'redproof';

const rules = defineRules({
  safeState: {
    id: 'state/must-stay-safe',
    description: 'The state file must contain SAFE and must not contain BROKEN.',
  },
});

const breakState = defineMutation({
  description: 'replace SAFE with BROKEN using captured undo',
  capture: 'src/state.txt',

  async apply(ctx) {
    const before = await ctx.files.read('src/state.txt');
    await ctx.files.write('src/state.txt', before.replace('SAFE', 'BROKEN'));
  },
});

const gate = defineGate({
  id: 'safe-state',
  rules,
  check: {
    description: 'inspect the state marker',
    counting: counting.supported,

    async run(ctx) {
      const startedAt = new Date().toISOString();
      const content = await files.read(ctx, 'src/state.txt');
      const scan = {
        source: 'state-file',
        startedAt,
        finishedAt: new Date().toISOString(),
        inspected: 1,
      } as const;

      return result.fromBreaches(
        scan,
        content.includes('BROKEN')
          ? [breach(rules.safeState, {
              code: 'broken-state',
              message: 'BROKEN marker found.',
              location: { file: 'src/state.txt', line: 1, column: 1 },
            })]
          : [],
      );
    },
  },
});

export const proofs = defineProofs(gate, [
  proof.red(rules.safeState, 'custom captured mutation is detected', breakState),
  proof.green('captured undo restores the Gate copy'),
]);

export default gate;

import {
  breach,
  counting,
  defineGate,
  defineProofs,
  defineRules,
  mutate,
  proof,
  result,
  text,
} from 'redproof';

const rules = defineRules({
  noMarker: {
    id: 'alpha/no-marker',
    description: 'src/alpha.txt must not contain MARKER.',
  },
});

const gate = defineGate({
  id: 'alpha',
  rules,

  check: {
    description: 'scan src/alpha.txt for MARKER',
    counting: counting.supported,

    async run(ctx) {
      const startedAt = new Date().toISOString();
      const found = await text.find(ctx, { files: 'src/alpha.txt', find: /MARKER/g });
      const scan = {
        source: 'alpha',
        startedAt,
        finishedAt: new Date().toISOString(),
        inspected: found.files.length,
      } as const;

      return result.fromBreaches(
        scan,
        found.matches.map(match =>
          breach(rules.noMarker, {
            code: 'marker-found',
            message: 'MARKER found.',
            location: match.location,
          }),
        ),
      );
    },
  },
});

export const proofs = defineProofs(gate, [
  proof.red(rules.noMarker, 'detects MARKER in alpha', mutate.appendText('src/alpha.txt', 'MARKER\n')),
  proof.green('accepts clean alpha'),
]);

export default gate;

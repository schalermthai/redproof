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
    id: 'beta/no-marker',
    description: 'src/beta.txt must not contain MARKER.',
  },
});

const gate = defineGate({
  id: 'beta',
  rules,

  check: {
    description: 'scan src/beta.txt for MARKER',
    counting: counting.supported,

    async run(ctx) {
      const startedAt = new Date().toISOString();
      const found = await text.find(ctx, { files: 'src/beta.txt', find: /MARKER/g });
      const scan = {
        source: 'beta',
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
  proof.red(rules.noMarker, 'detects MARKER in beta', mutate.appendText('src/beta.txt', 'MARKER\n')),
  proof.green('accepts clean beta'),
]);

export default gate;

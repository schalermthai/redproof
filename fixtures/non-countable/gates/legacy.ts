import { breach, counting, defineAdapter, defineGate, fail } from 'redproof';

const clean = { id: 'legacy/clean', description: 'legacy checker must report clean' } as const;
const complete = { id: 'legacy/complete', description: 'legacy checker must inspect all targets' } as const;

export default defineGate({
  id: 'legacy-check',
  adapter: defineAdapter({
    kind: 'command',
    rules: { clean, complete },
    check: {
      description: 'run a legacy command that only exposes exit status',
      counting: counting.unsupported('The legacy command only exposes a process exit status.'),
      async run() {
        const startedAt = new Date().toISOString();
        return fail(
          { source: 'legacy-command', startedAt, finishedAt: new Date().toISOString(), inspected: null },
          [breach(clean.id, {
            code: 'command-failed',
            message: 'The legacy checker reported a violation.',
            location: null,
            detail: 'The command does not enumerate every concrete violation.',
          })],
        );
      },
    },
  }),
});

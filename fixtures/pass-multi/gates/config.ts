import { counting, defineAdapter, defineGate, pass } from 'redproof';

const rules = Object.fromEntries(
  Array.from({ length: 5 }, (_, i) => [`rule${i + 1}`, {
    id: 'config/' + (i + 1),
    description: 'config rule ' + (i + 1) + ' must hold.',
  }]),
) as Record<string, { id: string; description: string }>;

export default defineGate({
  id: 'config',
  adapter: defineAdapter({
    kind: 'fixture',
    rules,
    check: {
      description: 'check config rules',
      counting: counting.supported,
      async run() {
        const startedAt = new Date().toISOString();
        return pass({ source: 'config', startedAt, finishedAt: new Date().toISOString(), inspected: 1 });
      },
    },
  }),
});

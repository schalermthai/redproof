import { counting, defineAdapter, defineGate, pass } from 'redproof';

const rules = Object.fromEntries(
  Array.from({ length: 8 }, (_, i) => [`rule${i + 1}`, {
    id: 'parser/' + (i + 1),
    description: 'parser rule ' + (i + 1) + ' must hold.',
  }]),
) as Record<string, { id: string; description: string }>;

export default defineGate({
  id: 'parser',
  adapter: defineAdapter({
    kind: 'fixture',
    rules,
    check: {
      description: 'check parser rules',
      counting: counting.supported,
      async run() {
        const startedAt = new Date().toISOString();
        return pass({ source: 'parser', startedAt, finishedAt: new Date().toISOString(), inspected: 1 });
      },
    },
  }),
});

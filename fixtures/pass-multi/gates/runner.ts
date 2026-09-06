import { counting, defineAdapter, defineGate, pass } from 'redproof';

const rules = Object.fromEntries(
  Array.from({ length: 12 }, (_, i) => [`rule${i + 1}`, {
    id: 'runner/' + (i + 1),
    description: 'runner rule ' + (i + 1) + ' must hold.',
  }]),
) as Record<string, { id: string; description: string }>;

export default defineGate({
  id: 'runner',
  adapter: defineAdapter({
    kind: 'fixture',
    rules,
    check: {
      description: 'check runner rules',
      counting: counting.supported,
      async run() {
        const startedAt = new Date().toISOString();
        return pass({ source: 'runner', startedAt, finishedAt: new Date().toISOString(), inspected: 1 });
      },
    },
  }),
});

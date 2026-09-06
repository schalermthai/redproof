import { counting, defineAdapter, defineGate, pass } from 'redproof';

const rule = { id: 'logging/passes', description: 'passes after logging' } as const;

export default defineGate({
  id: 'logging',
  adapter: defineAdapter({
    kind: 'fixture',
    rules: { rule },
    check: {
      description: 'log while checking',
      counting: counting.supported,
      async run() {
        console.log('message from Check');
        const now = new Date().toISOString();
        return pass({ source: 'logging', startedAt: now, finishedAt: now, inspected: 1 });
      },
    },
  }),
});

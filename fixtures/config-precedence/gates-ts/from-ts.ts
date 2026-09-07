import { counting, defineAdapter, defineGate, pass } from 'redproof';

const rule = {
  id: 'from-ts/loaded',
  description: 'the .ts config was discovered first',
};

export default defineGate({
  id: 'from-ts',
  adapter: defineAdapter({
    kind: 'fixture',
    rules: { rule },
    check: {
      description: 'pass after config discovery',
      counting: counting.supported,
      async run() {
        const startedAt = new Date().toISOString();
        return pass({
          source: 'from-ts',
          startedAt,
          finishedAt: new Date().toISOString(),
          inspected: 1,
        });
      },
    },
  }),
});

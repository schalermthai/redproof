import { counting, defineAdapter, defineGate, pass } from 'redproof';

const rule = {
  id: 'from-mjs/loaded',
  description: 'the .mjs config was discovered first',
};

export default defineGate({
  id: 'from-mjs',
  adapter: defineAdapter({
    kind: 'fixture',
    rules: { rule },
    check: {
      description: 'pass after config discovery',
      counting: counting.supported,
      async run() {
        const startedAt = new Date().toISOString();
        return pass({
          source: 'from-mjs',
          startedAt,
          finishedAt: new Date().toISOString(),
          inspected: 1,
        });
      },
    },
  }),
});

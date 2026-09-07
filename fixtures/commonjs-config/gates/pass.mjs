import { counting, defineAdapter, defineGate, pass } from 'redproof';

const rule = {
  id: 'commonjs-config/loads-esm',
  description: 'loads an ESM config in a CommonJS project',
};

export default defineGate({
  id: 'commonjs-config',
  adapter: defineAdapter({
    kind: 'fixture',
    rules: { rule },
    check: {
      description: 'pass after config discovery',
      counting: counting.supported,
      async run() {
        const startedAt = new Date().toISOString();
        return pass({
          source: 'commonjs-config',
          startedAt,
          finishedAt: new Date().toISOString(),
          inspected: 1,
        });
      },
    },
  }),
});

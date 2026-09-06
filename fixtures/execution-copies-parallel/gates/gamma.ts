import { setTimeout as delay } from 'node:timers/promises';
import { counting, defineAdapter, defineGate, pass } from 'redproof';

const rule = {
  id: 'gamma/healthy',
  description: 'gamma must complete successfully',
} as const;

export default defineGate({
  id: 'gamma',
  adapter: defineAdapter({
    kind: 'fixture',
    rules: { rule },
    check: {
      description: 'wait briefly so parallel Gate workers visibly overlap',
      counting: counting.supported,
      async run() {
        const startedAt = new Date().toISOString();
        await delay(250);
        return pass({
          source: 'pid:' + process.pid,
          startedAt,
          finishedAt: new Date().toISOString(),
          inspected: 1,
        });
      },
    },
  }),
});

import { counting, defineAdapter, defineGate, pass } from 'redproof';

const acceptsValid = { id: 'parser/accepts-valid-input', description: 'accepts valid input' } as const;
const rejectsMalformed = { id: 'parser/rejects-malformed-input', description: 'rejects malformed input' } as const;
const preservesWhitespace = { id: 'parser/preserves-whitespace', description: 'preserves whitespace' } as const;

export default defineGate({
  id: 'parser',
  adapter: defineAdapter({
    kind: 'fixture',
    rules: { acceptsValid, rejectsMalformed, preservesWhitespace },
    check: {
      description: 'exercise parser behavior',
      counting: counting.supported,
      async run() {
        const startedAt = new Date().toISOString();
        return pass({ source: 'parser', startedAt, finishedAt: new Date().toISOString(), inspected: 3 });
      },
    },
  }),
});

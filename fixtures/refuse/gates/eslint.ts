import { counting, defineAdapter, defineGate, refuse } from 'redproof';

const noConsole = { id: 'eslint/no-console', description: 'console statements are forbidden' } as const;
const eqeqeq = { id: 'eslint/eqeqeq', description: 'strict equality is required' } as const;

export default defineGate({
  id: 'eslint',
  adapter: defineAdapter({
    kind: 'fixture',
    rules: { noConsole, eqeqeq },
    check: {
      description: 'run ESLint',
      counting: counting.supported,
      async run() {
        const startedAt = new Date().toISOString();
        return refuse(
          { source: 'eslint', startedAt, finishedAt: new Date().toISOString(), inspected: null },
          {
            code: 'eslint-config-unavailable',
            message: 'ESLint configuration could not be loaded.',
            location: { file: 'eslint.config.mjs', line: null, column: null },
            detail: 'No ESLint flat configuration was found for this project.',
          },
        );
      },
    },
  }),
});

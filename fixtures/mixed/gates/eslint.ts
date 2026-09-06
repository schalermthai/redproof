import { counting, defineAdapter, defineGate, pass } from 'redproof';
const noConsole = { id: 'eslint/no-console', description: 'console statements are forbidden' } as const;
const eqeqeq = { id: 'eslint/eqeqeq', description: 'strict equality is required' } as const;
export default defineGate({ id: 'eslint', adapter: defineAdapter({ kind: 'fixture', rules: { noConsole, eqeqeq }, check: { description: 'lint source', counting: counting.supported, async run() { const startedAt = new Date().toISOString(); return pass({ source: 'eslint', startedAt, finishedAt: new Date().toISOString(), inspected: 1 }); } } }) });

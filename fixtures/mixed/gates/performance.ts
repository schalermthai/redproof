import { counting, defineAdapter, defineGate, refuse } from 'redproof';
const cpu = { id: 'performance/cpu-budget', description: 'CPU must remain within budget' } as const;
const latency = { id: 'performance/latency-budget', description: 'latency must remain within budget' } as const;
export default defineGate({ id: 'performance', adapter: defineAdapter({ kind: 'fixture', rules: { cpu, latency }, check: { description: 'measure runtime budgets', counting: counting.supported, async run() { const startedAt = new Date().toISOString(); return refuse({ source: 'performance', startedAt, finishedAt: new Date().toISOString(), inspected: null }, { code: 'measurement-unavailable', message: 'Performance measurements could not be collected.', location: null }); } } }) });

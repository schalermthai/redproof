import { breach, counting, defineAdapter, defineGate, fail } from 'redproof';

const domainNoInfrastructure = {
  id: 'architecture/domain-no-infrastructure',
  description: 'domain must not import infrastructure',
} as const;
const applicationNoAdapters = {
  id: 'architecture/application-no-adapters',
  description: 'application must not import adapters',
} as const;

export default defineGate({
  id: 'architecture',
  adapter: defineAdapter({
    kind: 'fixture',
    rules: { domainNoInfrastructure, applicationNoAdapters },
    check: {
      description: 'inspect repository dependencies',
      counting: counting.supported,
      async run() {
        const startedAt = new Date().toISOString();
        const scan = { source: 'architecture', startedAt, finishedAt: new Date().toISOString(), inspected: 3 };
        return fail(scan, [
          breach(domainNoInfrastructure.id, {
            code: 'forbidden-import',
            message: 'Domain code imports infrastructure code.',
            location: { file: 'src/domain/order.ts', line: 1, column: 1 },
            comparison: { expected: 'domain dependency', actual: 'infrastructure dependency' },
            hint: 'Depend on a domain-facing port instead.',
          }),
          breach(domainNoInfrastructure.id, {
            code: 'forbidden-import',
            message: 'Domain code imports infrastructure code.',
            location: { file: 'src/domain/customer.ts', line: 1, column: 1 },
          }),
          breach(applicationNoAdapters.id, {
            code: 'forbidden-import',
            message: 'Application code imports adapter code.',
            location: { file: 'src/application/place-order.ts', line: 1, column: 1 },
            hint: 'Depend on an application port instead.',
          }),
        ]);
      },
    },
  }),
});

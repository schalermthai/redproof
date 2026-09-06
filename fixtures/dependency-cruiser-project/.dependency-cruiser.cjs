module.exports = {
  forbidden: [
    {
      name: 'domain-no-infrastructure',
      severity: 'error',
      comment: 'Domain code must not depend on infrastructure.',
      from: { path: '^src/domain' },
      to: { path: '^src/infrastructure' },
    },
    {
      name: 'application-no-adapters',
      severity: 'error',
      comment: 'Application code must not depend on adapters.',
      from: { path: '^src/application' },
      to: { path: '^src/adapters' },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
  },
};

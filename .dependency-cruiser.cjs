module.exports = {
  forbidden: [
    {
      name: 'no-cycles',
      severity: 'error',
      comment: 'Production source must remain acyclic.',
      from: {},
      to: { circular: true },
    },
    {
      name: 'core-no-effect-imports',
      severity: 'error',
      comment: 'The functional core cannot import effectful Node modules.',
      from: { path: '^packages/redproof/src/(?:domain|[^/]+/core)/' },
      to: {
        dependencyTypes: ['core'],
        path: '^(node:)?(fs|fs/promises|child_process|os|stream|net|http|https|worker_threads|timers|timers/promises)$',
      },
    },
    {
      name: 'core-no-shell',
      severity: 'error',
      comment: 'The functional core cannot depend on orchestration or presentation.',
      from: { path: '^packages/redproof/src/(?:domain|[^/]+/core)/' },
      to: {
        path: '^packages/redproof/src/(?:[^/]+/shell/|[^/]+/index[.]ts$|index[.]ts$|reporter/|cli[.]ts$|command[.]ts$)',
      },
    },
    {
      name: 'domain-inward-only',
      severity: 'error',
      comment: 'Domain types cannot depend on outer Redproof layers.',
      from: { path: '^packages/redproof/src/domain/' },
      to: {
        path: '^packages/redproof/src/',
        pathNot: '^packages/redproof/src/domain/',
      },
    },
    {
      name: 'composition-no-runtime-or-reporters',
      severity: 'error',
      comment: 'Composition cannot depend on runtime orchestration or presentation.',
      from: { path: '^packages/redproof/src/composition/' },
      to: { path: '^packages/redproof/src/(?:(?:project|proof|workspace|run|reporter)/|cli[.]ts$|command[.]ts$)' },
    },
    {
      name: 'adapters-public-core-api-only',
      severity: 'error',
      comment: 'Adapters must consume Redproof through its public entrypoint.',
      from: { path: '^packages/(?:eslint|dependency-cruiser|stryker|testing)/src/' },
      to: {
        path: '^packages/redproof/src/',
        pathNot: '^packages/redproof/src/index[.]ts$',
      },
    },
    {
      name: 'production-no-test-fixture-dependencies',
      severity: 'error',
      comment: 'Publishable source cannot depend on repository tests, fixtures, scripts, or Gates.',
      from: { path: '^packages/[^/]+/src/' },
      to: { path: '^(?:tests|fixtures|scripts|gates)/' },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    tsConfig: { fileName: 'tsconfig.json' },
    enhancedResolveOptions: {
      extensions: ['.ts', '.js', '.mjs', '.cjs', '.json'],
    },
  },
};

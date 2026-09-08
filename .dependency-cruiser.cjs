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
      comment: 'The functional core cannot depend on orchestration or presentation. A context barrel carries its shell, so a core uses core/index.ts instead. The domain barrel is types only.',
      from: { path: '^packages/redproof/src/(?:domain|[^/]+/core)/' },
      to: {
        path: '^packages/redproof/src/(?:[^/]+/shell/|[^/]+/index[.]ts$|index[.]ts$|cli[.]ts$)',
        pathNot: '^packages/redproof/src/domain/index[.]ts$',
      },
    },
    {
      name: 'contexts-import-through-index',
      severity: 'error',
      comment: 'A context uses another context only through its index.ts or core/index.ts.',
      from: { path: '^packages/redproof/src/([^/]+)/' },
      to: {
        path: '^packages/redproof/src/[^/]+/',
        pathNot: [
          '^packages/redproof/src/$1/',
          '^packages/redproof/src/[^/]+/index[.]ts$',
          '^packages/redproof/src/[^/]+/core/index[.]ts$',
        ],
      },
    },
    {
      name: 'entrypoints-import-through-index',
      severity: 'error',
      comment: 'The package entrypoints use a context only through its index.ts.',
      from: { path: '^packages/redproof/src/[^/]+[.]ts$' },
      to: {
        path: '^packages/redproof/src/[^/]+/',
        pathNot: '^packages/redproof/src/[^/]+/index[.]ts$',
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
      comment: 'Composition may depend only on itself, the domain, and inspection. Every other context is downstream of it.',
      from: { path: '^packages/redproof/src/composition/' },
      to: {
        path: '^packages/redproof/src/',
        pathNot: '^packages/redproof/src/(?:composition|domain|inspect)/',
      },
    },
    {
      name: 'adapters-public-core-api-only',
      severity: 'error',
      comment: 'Adapters must consume Redproof through its public entrypoints.',
      from: { path: '^packages/(?:eslint|dependency-cruiser|stryker|testing)/src/' },
      to: {
        path: '^packages/redproof/src/',
        pathNot: [
          '^packages/redproof/src/index[.]ts$',
          '^packages/redproof/src/command/index[.]ts$',
        ],
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

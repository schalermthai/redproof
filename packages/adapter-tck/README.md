# @redproof/adapter-tck

Technology compatibility kit for Redproof Adapters. It turns the common
Adapter guidelines into executable, contract-tagged tests.

## Install

```bash
npm install --save-dev @redproof/adapter-tck redproof
```

## Use

Keep the registration beside the Adapter's own tests:

```ts
import { runAdapterTck, type AdapterTckSpec } from '@redproof/adapter-tck';
import { example, exampleBreaches } from '../src/index.js';

const spec = {
  name: 'example',
  kind: 'example',
  construction: {
    valid: () => example({ rules: { valid: true } }),
    emptyRules: {
      name: 'rejects an empty Rule selection',
      run: () => example({ rules: {} }),
      message: /requires at least one Redproof rule/u,
    },
    unknownOption: {
      name: 'rejects an unknown top-level option',
      run: () => example({ rules: { valid: true }, mystery: true } as never),
      message: /unknown option/u,
    },
    invalidValues: [{
      name: 'rejects an invalid value',
      run: () => example({ rules: { valid: -1 } }),
      message: /must be positive/u,
    }],
  },
  unavailable: [{
    name: 'REFUSES when execution is unavailable',
    code: 'example-unavailable',
    run: () => example({ rules: { valid: true } }).check.run({
      root: '/missing',
      rules: ['example/valid'],
    }),
  }],
  evidence: [{
    rule: 'example/valid',
    expectedBreaches: [{ code: 'example-invalid', message: 'bad example' }],
    violating: () => ({ kind: 'translated', breaches: exampleBreaches(['bad']) }),
    clean: () => ({ kind: 'translated', breaches: exampleBreaches([]) }),
    unselected: () => ({ kind: 'translated', breaches: [] }),
  }],
  purity: {
    kind: 'sources',
    files: ['packages/example/src/model.ts'],
    allowedExternalImports: ['redproof'],
  },
  capabilities: {
    kind: 'not-applicable',
    reason: 'the Adapter consumes a programmatic result',
  },
} as const satisfies AdapterTckSpec;

runAdapterTck([spec]);
```

The TCK covers construction, unavailable execution, functional-core purity,
report capabilities, and structured evidence. When one implementation surface
delegates its evidence model to another, register both specs in the same call
and use `{ kind: 'delegated', to: 'other-name' }`.

The registration is trusted test code. The TCK validates the shape and
consistency of the observations it receives—including exact expected Breach
identities—but it cannot prove that an intentionally fabricated callback called
the real Adapter. Keep the probes close to the Adapter's public API and use a
real-tool integration fixture to verify the external-tool boundary.

The package is test infrastructure. Adapter production source must not import
it; list it only in `devDependencies`.

## License

Apache-2.0

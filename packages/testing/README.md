# @redproof/testing

Redproof adapter for test suites. It reads a JUnit XML report, so any runner that writes one becomes a Redproof Gate you can prove.

Part of [Redproof](https://github.com/schalermthai/redproof). Redproof does not
just run your guardrails. It proves they can fail.

## Install

```bash
npm install --save-dev @redproof/testing redproof
```

## Use

```ts
// gates/unit-tests.ts
import { vitest } from '@redproof/testing';
import { defineGate } from 'redproof';

const adapter = vitest({
  configFile: 'vitest.config.js',
  rules: {
    testsPass: true,
    noSkippedTests: true,
    noTodoTests: true,
  },
});

export default defineGate({ id: 'unit-tests', adapter });
```

Then run:

```bash
npx redproof check   # do the rules hold right now?
npx redproof prove   # can each rule actually fail?
```

## Documentation

See the [Redproof documentation](https://github.com/schalermthai/redproof#readme).

## License

Apache-2.0

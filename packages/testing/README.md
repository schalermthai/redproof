# @redproof/testing

Redproof adapter for test suites. It reads structured JSON or JUnit XML reports,
so any runner that writes one becomes a Redproof Gate you can prove.

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
  cwd: 'packages/app',
  configFile: 'vitest.config.js',
  reportFile: 'test-results.json',
  rules: {
    testsPass: true,
    noSkippedTests: true,
    noTodoTests: true,
  },
});

export default defineGate({ id: 'unit-tests', adapter });
```

`cwd` selects a project below the Gate root. `reportFile` consumes a JSON
`outputFile` already configured by Vitest, allowing project setup or teardown
to inspect the same fresh report. It is relative to `cwd` and must name the
same file as the config `outputFile`. Redproof restores any pre-existing report
afterward. Omit `reportFile` to use Redproof's private temporary report.

Then run:

```bash
npx redproof check   # do the rules hold right now?
npx redproof prove   # can each rule actually fail?
```

## Documentation

See the [Redproof documentation](https://github.com/schalermthai/redproof#readme).

## License

Apache-2.0

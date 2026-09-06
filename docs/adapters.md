# Built-in integrations

Redproof integrations translate an existing tool or result format into Redproof Rules and Check results.

The external tool remains responsible for doing the real analysis. Redproof adds the Rule model and proofs around it.

## Testing

Package:

```bash
npm install --save-dev @redproof/testing
```

### Vitest

Vitest has a convenience integration:

```ts
import { vitest } from '@redproof/testing';
import { defineGate, defineProofs, mutate, proof } from 'redproof';

const adapter = vitest({
  rules: {
    testsPass: true,
    noSkippedTests: true,
    noTodoTests: true,
  },
});

const gate = defineGate({
  id: 'tests',
  adapter,
});

export const proofs = defineProofs(gate, [
  proof.red(
    adapter.rules.testsPass,
    'detects broken behavior',
    mutate.writeText('src/example.ts', 'export const value = "broken";\n'),
  ),
  proof.green('accepts the healthy test suite'),
]);

export default gate;
```

The testing integration can expose these Rules, depending on the selected report format:

- `testing/tests-pass`
- `testing/no-skipped-tests`
- `testing/no-todo-tests`

### Other test runners

You do not need a dedicated Redproof package for every test framework.

Use the generic testing adapter with a runner and a structured report format:

```ts
import { report, runner, testing } from '@redproof/testing';

const adapter = testing({
  runner: runner.command({
    command: 'pytest',
    args: ({ reportFile }) => [
      '-q',
      `--junitxml=${reportFile}`,
    ],
  }),

  report: report.junitXml(),

  rules: {
    testsPass: true,
    noSkippedTests: true,
  },
});
```

Built-in report formats:

```ts
report.jestJson()
report.junitXml()
```

For a custom test system, implement only the runner or report normalization layer:

```ts
defineTestRunner(...)
defineTestReport(...)
```

Create a new full Adapter only when a tool introduces a genuinely different policy model.

## ESLint

Package:

```bash
npm install --save-dev @redproof/eslint eslint
```

Select the ESLint rules you want to adopt as Redproof Rules:

```ts
import { eslint } from '@redproof/eslint';
import { defineGate, defineProofs, mutate, proof } from 'redproof';

const adapter = eslint({
  files: ['src/**/*.ts'],
  rules: {
    noConsole: 'no-console',
    strictEquality: 'eqeqeq',
  },
});

const gate = defineGate({
  id: 'eslint',
  adapter,
});

export const proofs = defineProofs(gate, [
  proof.red(
    adapter.rules.noConsole,
    'detects console usage',
    mutate.appendText('src/example.ts', '\nconsole.log("proof");\n'),
  ),
  proof.green('accepts clean source'),
]);

export default gate;
```

A configured ESLint finding becomes a Breach of the corresponding Redproof Rule.

Fatal parsing or execution problems become `REFUSE`, not fake Rule breaches.

## dependency-cruiser

Package:

```bash
npm install --save-dev @redproof/dependency-cruiser dependency-cruiser
```

Keep dependency-cruiser's rule definitions in its own configuration. Redproof selects the named rules you want to prove:

```ts
import { dependencyCruiser } from '@redproof/dependency-cruiser';
import { defineGate, defineProofs, mutate, proof } from 'redproof';

const adapter = dependencyCruiser({
  configFile: '.dependency-cruiser.cjs',
  files: ['src'],
  rules: {
    domainNoInfrastructure: 'domain-no-infrastructure',
    applicationNoAdapters: 'application-no-adapters',
  },
});

const gate = defineGate({
  id: 'architecture',
  adapter,
});

export const proofs = defineProofs(gate, [
  proof.red(
    adapter.rules.domainNoInfrastructure,
    'detects domain importing infrastructure',
    mutate.appendText(
      'src/domain/order.js',
      "\nimport '../infrastructure/database.js';\n",
    ),
  ),
  proof.green('accepts valid architecture'),
]);

export default gate;
```

One dependency-cruiser run can report breaches across several selected Rules.

## Stryker

Package:

```bash
npm install --save-dev @redproof/stryker @stryker-mutator/core
```

Stryker exposes mutation-testing policies instead of ordinary test-case policies:

```ts
import { stryker } from '@redproof/stryker';
import { defineGate } from 'redproof';

const adapter = stryker({
  configFile: 'stryker.config.mjs',
  rules: {
    mutantsDetected: true,
    mutationScore: {
      minimum: 80,
    },
  },
});

export default defineGate({
  id: 'mutation-testing',
  adapter,
});
```

Available policies include:

- all valid mutants must be detected
- mutation score must stay at or above a configured minimum

For a useful RED proof, weaken the test suite and confirm Stryker notices the loss of test strength.

## Choosing between an Adapter and a parser

A useful rule of thumb:

> Create a new Adapter when the external system introduces a new policy model.

> Create a runner or parser when it only introduces a new invocation method or data format.

For writing your own integration, continue with **[Composing Redproof](composition.md#creating-an-adapter)**.

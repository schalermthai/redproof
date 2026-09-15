# Built-in Adapters

Use a built-in Adapter when a tool you already run should become a Gate you can prove.

The important model is:

```text
Gate
└── Adapter              @redproof/eslint, @redproof/testing, ...
     ├── Rules           the tool findings you select
     └── Check           one fresh run of the tool
          └── PASS | FAIL | REFUSE
```

The tool does the analysis. Redproof adds the Rule model and the proofs around it.

## Packages

```text
@redproof/testing              test suites: Vitest, Jest, JUnit XML, any runner
@redproof/eslint               selected ESLint rules
@redproof/dependency-cruiser   module boundaries
@redproof/stryker              mutation testing
@redproof/knip                 unused files, exports, and dependencies
@redproof/istanbul             coverage thresholds
```

Each package installs beside the tool it wraps:

```bash
npm install --save-dev @redproof/eslint eslint
```

## What every built-in Adapter promises

You select the findings that matter. An unselected finding never breaches.

```text
tool finding              → Breach → FAIL
tool cannot answer        → Diagnostic → REFUSE
bad option                → throw when the Gate file loads
```

Each Check runs the tool again. The Adapter does not use the tool's result cache, so a RED proof cannot reuse a result from before the mutation.

Each Check counts what it inspected. A PASS over zero targets is refused as `nothing-inspected`, unless the Gate sets `policies: { emptyEvidence: 'allow' }`. See [Empty evidence](composition.md#empty-evidence).

Path options are relative paths. An empty or absolute path throws when the Gate file loads.

## Testing

`vitest()` makes a Vitest suite a Gate:

```ts
import { vitest } from '@redproof/testing';
import { defineGate, defineProofs, mutate, proof } from 'redproof';

const adapter = vitest({
  rules: {
    testsPass: true,
    noFlakyTests: true,
    noSkippedTests: true,
    noTodoTests: true,
  },
});

const gate = defineGate({ id: 'tests', adapter });

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

The Rules:

```text
testing/tests-pass
testing/no-flaky-tests       Jest-compatible JSON only
testing/no-skipped-tests
testing/no-todo-tests
```

A flaky test is a test that passes only after a retry.

### Other test runners

Any runner that writes a structured report works. Pair a runner with a report format:

```ts
import { report, runner, testing } from '@redproof/testing';

const adapter = testing({
  runner: runner.command({
    command: 'pytest',
    args: ({ reportFile }) => ['-q', `--junitxml=${reportFile}`],
  }),
  report: report.junitXml(),
  rules: { testsPass: true, noSkippedTests: true },
});
```

Built-in report formats:

```ts fragment
report.jestJson()
report.junitXml()
```

For an in-house tool, implement only the runner or the report format. See
[Extend the testing adapter instead](custom-adapter.md#extend-the-testing-adapter-instead).

See the [testing package](../packages/testing/README.md) for `cwd`, `reportFile`,
process limits, and the Vitest flags.

## ESLint

Select the ESLint rules you adopt:

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

const gate = defineGate({ id: 'eslint', adapter });

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

An adopted Rule cannot be silenced. A finding under `/* eslint-disable */` still breaches.

Name a path in `files` and ESLint must read it. A path that your `ignores` pattern excludes is REFUSE, not PASS.

See the [ESLint package](../packages/eslint/README.md).

## dependency-cruiser

Keep the rules in dependency-cruiser's own configuration. Select the ones to prove:

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

const gate = defineGate({ id: 'architecture', adapter });

export const proofs = defineProofs(gate, [
  proof.red(
    adapter.rules.domainNoInfrastructure,
    'detects domain importing infrastructure',
    mutate.appendText('src/domain/order.js', "\nimport '../infrastructure/database.js';\n"),
  ),
  proof.green('accepts valid architecture'),
]);

export default gate;
```

A baseline in `knownViolationsFile` makes the Gate quieter on purpose. Keep a RED proof that plants a new violation, so you know the Gate still fails.

See the [dependency-cruiser package](../packages/dependency-cruiser/README.md).

## Stryker

Stryker measures the tests, not the source:

```ts
import { stryker } from '@redproof/stryker';
import { defineGate } from 'redproof';

const adapter = stryker({
  configFile: 'stryker.config.mjs',
  rules: {
    mutantsDetected: true,
    mutationScore: { minimum: 80 },
  },
});

export default defineGate({ id: 'mutation-testing', adapter });
```

The policies:

```text
mutantsDetected            every valid mutant is detected
noNewUndetectedMutants     no survivor outside an accepted baseline
mutationScore              the score stays at or above a minimum
```

For a RED proof, weaken a test. Stryker must notice the loss of test strength.

See the [Stryker package](../packages/stryker/README.md) for the accepted-mutant baseline.

## Knip

Select the Knip categories you adopt:

```ts
import { knip } from '@redproof/knip';
import { defineGate } from 'redproof';

const adapter = knip({
  rules: {
    unusedFiles: 'files',
    unusedExports: 'exports',
    unresolvedImports: 'unresolved',
  },
});

export default defineGate({ id: 'unused-code', adapter });
```

The Knip configuration decides the scope. A selected category that the Knip configuration disables is REFUSE, not PASS.

See the [Knip package](../packages/knip/README.md) for every category and its Rule ID.

## Coverage

`nyc()` collects fresh coverage and applies thresholds:

```ts
import { nyc } from '@redproof/istanbul';
import { defineGate } from 'redproof';

const adapter = nyc({
  command: 'node',
  args: ['node_modules/mocha/bin/mocha', 'test/**/*.js'],
  include: ['src/**/*.js'],
  expectedFiles: ['src/orders.js'],
  rules: {
    statements: { minimum: 90 },
    branches: { minimum: 80, perFile: true },
  },
});

export default defineGate({ id: 'coverage', adapter });
```

Coverage measures execution, not assertion quality. Combine it with a testing Gate and a Stryker Gate.

`istanbul()` accepts a full coverage map from another producer, such as c8. See the [Istanbul package](../packages/istanbul/README.md).

## Next

- **[Custom Adapter](custom-adapter.md)** when no built-in integration fits, and for
  choosing between a Check, a runner or report format, and an Adapter.
- **[Command Checks](commands.md)** when the tool is an executable and its exit code is the result.

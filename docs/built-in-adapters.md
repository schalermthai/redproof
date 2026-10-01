# Built-in Adapters

Redproof adapters let you turn results from tools you already use into Redproof Rules.

You keep using Vitest, ESLint, dependency-cruiser, Stryker, or another supported tool for the actual analysis. The adapter translates that tool's result into Redproof Checks and Breaches that you can prove.

## Choose an adapter

| If you want to prove... | Use |
| --- | --- |
| Tests pass, are not skipped, or are not flaky | [`@redproof/testing`](#testing) |
| ESLint rules have no violations | [`@redproof/eslint`](#eslint) |
| Architecture rules from dependency-cruiser hold | [`@redproof/dependency-cruiser`](#dependency-cruiser) |
| Mutation-testing requirements hold | [`@redproof/stryker`](#stryker) |
| Unused files, exports, or dependencies are absent | [`@redproof/knip`](#knip) |
| Coverage thresholds hold | [`@redproof/istanbul`](#coverage) |
| A command succeeds based on its exit code | [Command Checks](./commands.md) |
| Something not covered here | [Custom Adapter](./custom-adapter.md) |

If you are new to adapters, start with the integration for the tool you already use. You usually only need to:

1. Install the adapter.
2. Select the rules you want Redproof to enforce.
3. Add the adapter to a Gate.
4. Add a RED proof that demonstrates the Gate can detect a real violation.

### What every built-in adapter promises

You select the findings that matter. An unselected finding never breaches.
Each Check runs the tool again without reusing its result cache, so a RED proof
cannot reuse a result from before the mutation.

Each Check counts what it inspected. A PASS over zero targets is refused as
`nothing-inspected`, unless the Gate sets `policies: { emptyEvidence: 'allow' }`.
See [Empty evidence](./composition.md#empty-evidence).

Path options must be non-empty relative paths. Invalid options throw when the
Gate file loads. See each package's documentation for its path confinement rules.

---

## Testing

Use `@redproof/testing` to create Rules from test-runner results.

### Vitest

If you use Vitest, start with the built-in `vitest()` integration.

Install it:

```bash
npm install --save-dev @redproof/testing
```

Create an adapter and select the policies you want:

```ts
import { vitest } from '@redproof/testing';
import { defineGate, defineProofs, mutate, proof } from 'redproof';

const adapter = vitest({
  rules: {
    testsPass: true,
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
    mutate.writeText(
      'src/example.ts',
      'export const value = "broken";\n',
    ),
  ),
  proof.green('accepts the healthy test suite'),
]);

export default gate;
```

This Gate now requires the test suite to pass.

### Available testing rules

You can enable any rules that apply to the report format you use:

```ts
import { vitest } from '@redproof/testing';

const adapter = vitest({
  rules: {
    testsPass: true,
    noFlakyTests: true,
    noSkippedTests: true,
    noTodoTests: true,
  },
});
```

These map to:

| Option | Redproof Rule | Meaning |
| --- | --- | --- |
| `testsPass` | `testing/tests-pass` | All tests must pass |
| `noFlakyTests` | `testing/no-flaky-tests` | Tests must not require retries to pass |
| `noSkippedTests` | `testing/no-skipped-tests` | Tests must not be skipped |
| `noTodoTests` | `testing/no-todo-tests` | Tests must not be marked TODO |

Only enable the Rules that matter to your project.

### Running Vitest from a subdirectory

For a project below the Gate root, set `cwd`:

```ts
import { vitest } from '@redproof/testing';

const adapter = vitest({
  cwd: 'packages/app',
  configFile: 'vitest.config.ts',
  rules: {
    testsPass: true,
  },
});
```

`cwd` must stay inside the Gate root.

`configFile` and test-file filters use Vitest's normal resolution relative to that directory.

### Using an existing Vitest JSON report

Most projects do not need to configure this.

By default, Redproof asks Vitest to write a temporary JSON report and cleans it up afterward.

If your Vitest setup already writes a JSON `outputFile` that other setup or teardown code depends on, tell Redproof about the same file:

```ts
import { vitest } from '@redproof/testing';

const adapter = vitest({
  cwd: 'packages/app',
  configFile: 'vitest.config.ts',
  reportFile: 'test-results.json',
  rules: {
    testsPass: true,
  },
});
```

`reportFile`:

- is relative to `cwd`
- must match Vitest's configured JSON `outputFile`
- cannot be empty or absolute

Redproof restores any pre-existing report file after each Check.

Keep Vitest's `root` aligned with `cwd`. If Vitest writes the report somewhere else, Redproof refuses the Check rather than treating a missing report as a passing result.

See the [testing package](../packages/testing/README.md) for process limits and
Vitest flags, including `--configLoader runner` when config bundling leaves
files in the proof workspace.

### Flaky-test detection

`noFlakyTests` requires a report format that records retry information.

Redproof supports retry evidence from Jest-compatible JSON reports, including:

- earlier failure messages
- `invocations`
- `retryReasons`

JUnit XML only records the final test result, so it cannot reliably prove that a test was not flaky. Redproof therefore rejects `noFlakyTests` when used with JUnit XML.

Redproof also validates test totals when the report provides them. A contradictory or incomplete report produces `REFUSE` instead of an incorrect `PASS`.

### Other test runners

You do not need a dedicated Redproof package for every test framework.

Use the generic testing adapter when your runner can produce a supported structured report:

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

Built-in report formats are:

```ts
import { report } from '@redproof/testing';

report.jestJson()
report.junitXml()
```

This means you can combine:

- a command that runs your test system
- a report parser
- the Redproof Rules you want to enforce

For a custom test system, you usually only need to implement the missing runner or report format. See [Extend the testing adapter](./custom-adapter.md).

### Command runner metadata

A command runner describes what it will execute:

```ts
import { runner } from '@redproof/testing';

const built = runner.command({
  command: 'npm',
  args: ['test'],
});

built.description;
// 'run npm test'

built.plan;
// { command: 'npm', args: ['test'] }
```

`redproof describe` uses this metadata so you do not need to maintain a separate description of the command.

When arguments depend on the current run:

```ts
import { runner } from '@redproof/testing';

const built = runner.command({
  command: 'pytest',
  args: ({ reportFile }) => [
    `--junitxml=${reportFile}`,
  ],
});
```

`plan` contains the command, while `argsFor` can resolve the arguments for a particular run.

You can also set `cwd` for commands that must run below the Gate root. Redproof rejects paths and symbolic links that escape the root.

See [Command Checks](./commands.md) if the command's exit code itself is the result you want to prove.

---

## ESLint

Use `@redproof/eslint` when you want selected ESLint rules to become Redproof Rules.

Install it:

```bash
npm install --save-dev @redproof/eslint eslint
```

Then map names you choose to the ESLint rules you want to enforce:

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
    mutate.appendText(
      'src/example.ts',
      '\nconsole.log("proof");\n',
    ),
  ),
  proof.green('accepts clean source'),
]);

export default gate;
```

In this example:

```ts
const selectedRules = { noConsole: 'no-console' };

selectedRules.noConsole;
```

means:

- `noConsole` is the name you use from Redproof
- `no-console` is the ESLint rule being checked

A finding from that ESLint rule becomes a Breach of the corresponding Redproof Rule.

Parsing errors, configuration failures, and other ESLint execution problems produce `REFUSE`. They are not reported as ordinary rule violations.

An adopted Rule cannot be silenced: a finding reported under
`/* eslint-disable */` still breaches. A named path in `files` that `ignores`
excludes produces `REFUSE`; globs retain the configured ignore patterns.

See the [ESLint package](../packages/eslint/README.md) for path options.

### When to use the ESLint adapter

Use this adapter when the thing you want to prove is specifically an ESLint rule.

If you only want to prove that an arbitrary lint command exits successfully, a [Command Check](./commands.md) may be simpler.

---

## dependency-cruiser

Use `@redproof/dependency-cruiser` to prove architecture constraints that are already defined in dependency-cruiser.

Install it:

```bash
npm install --save-dev @redproof/dependency-cruiser dependency-cruiser
```

Keep your architecture rules in dependency-cruiser's configuration. Then select the rules that should become Redproof Rules:

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

One dependency-cruiser run can report Breaches for several selected Rules.

### Existing architecture violations

If your project already has known violations, you can use a checked-in baseline:

```ts
import { dependencyCruiser } from '@redproof/dependency-cruiser';

const adapter = dependencyCruiser({
  configFile: '.dependency-cruiser.cjs',
  knownViolationsFile: '.dependency-cruiser-known-violations.json',
  files: ['src'],
  rules: {
    domainNoInfrastructure: 'domain-no-infrastructure',
  },
});
```

Matching baseline violations are ignored, but new violations still breach the Rule.

A baseline deliberately makes the Gate less strict, so protect it with a RED proof. The proof should add a **new** violation and confirm that the Gate still detects it.

Do not automatically add every new violation to the baseline. If the baseline grows whenever new debt is introduced, the Gate can continue to PASS without protecting the architecture.

Malformed baseline files produce `REFUSE` rather than being silently ignored.

The adapter disables dependency-cruiser caching during Checks so a RED mutation cannot accidentally reuse a pre-mutation result.

A selected rule must be active in dependency-cruiser. Severity `ignore` produces
`REFUSE`. See the [dependency-cruiser package](../packages/dependency-cruiser/README.md).

---

## Stryker

Use `@redproof/stryker` to prove mutation-testing policies.

Install it:

```bash
npm install --save-dev @redproof/stryker @stryker-mutator/core
```

A basic mutation-score Gate looks like this:

```ts
import { stryker } from '@redproof/stryker';
import { defineGate } from 'redproof';

const adapter = stryker({
  configFile: 'stryker.config.mjs',
  rules: {
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

This Gate requires a mutation score of at least `80`.

### Available policies

Stryker can enforce policies such as:

- all valid mutants must be detected
- no new undetected mutant may appear outside an accepted-mutant baseline
- mutation score must stay above a configured minimum

For example:

```ts
import { stryker } from '@redproof/stryker';

const adapter = stryker({
  configFile: 'stryker.config.mjs',
  rules: {
    mutantsDetected: true,
    mutationScore: {
      minimum: 80,
    },
  },
});
```

### Working directory

For a package below the Gate root, set `cwd`:

```ts
import { stryker } from '@redproof/stryker';

const adapter = stryker({
  cwd: 'packages/app',
  configFile: 'stryker.config.mjs',
  rules: {
    mutationScore: {
      minimum: 80,
    },
  },
});
```

`configFile` and `acceptedMutantsFile` are resolved from that directory.

### Projects with accepted surviving mutants

Sometimes a project intentionally accepts specific surviving mutants.

In that case, use `noNewUndetectedMutants` instead of requiring every mutant to be detected:

```ts
import { stryker } from '@redproof/stryker';

const adapter = stryker({
  configFile: 'stryker.config.mjs',
  rules: {
    noNewUndetectedMutants: {
      acceptedMutantsFile: 'accepted-mutants.json',
    },
  },
});
```

The accepted-mutants file is a checked-in JSON array describing the exact mutants that are allowed to survive.

Redproof matches mutant identities rather than only comparing counts. Replacing one accepted survivor with a different survivor therefore still breaches the Rule.

An invalid, duplicate, or escaping baseline entry produces `REFUSE`.

If an accepted mutant starts being detected by your tests, Redproof also refuses the baseline. Remove that mutant from the accepted list.

For a useful RED proof, weaken the test suite and confirm that Stryker detects the loss of test strength.

See the [Stryker package](../packages/stryker/README.md) for the baseline schema
and mutant identity fields.

---

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

---

## Adapter behavior: Breach vs REFUSE

A useful distinction when adopting adapters is:

**Breach**

The external tool ran correctly and found something that violates one of your Rules.

Examples:

- a test fails
- ESLint finds `no-console`
- dependency-cruiser finds a forbidden dependency
- mutation score drops below your threshold

**REFUSE**

Redproof could not reliably determine whether the Rule holds.

Examples:

- a report is missing or malformed
- ESLint cannot parse the project
- a baseline file is invalid
- the tool configuration and report location disagree

Redproof prefers `REFUSE` over turning infrastructure or configuration problems into false Rule failures or false passes.

---

## What should I use?

A practical rule of thumb:

**The tool already has structured results and Redproof has an adapter**

Use the built-in adapter.

**The tool has structured results but no built-in adapter**

See [Custom Adapter](./custom-adapter.md).

**You only care whether a command succeeds**

Use a [Command Check](./commands.md).

**You are integrating another test runner**

Start with the generic [`testing()` adapter](#other-test-runners). You may only need to provide a runner or report parser rather than writing a complete adapter.

---

## Next

- [Custom Adapter](./custom-adapter.md) — integrate a tool that does not have a built-in adapter, or learn when to build a Check, runner, report format, or Adapter.
- [Command Checks](./commands.md) — prove an executable succeeds when its exit code is the result.
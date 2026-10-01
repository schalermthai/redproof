# Built-in Adapters

Already running a linter, tests, or coverage tool? An Adapter turns its findings
into named Redproof Rules, so you can check—and prove—each policy separately.
You keep the underlying tool; the Adapter interprets its results for Redproof.

## Choose an Adapter

| What you want to protect | Package and entry point | What you can check |
|---|---|---|
| [Test behavior](#testing) | `@redproof/testing` · `vitest()` or `testing()` | Passing tests, retries, skipped tests, and TODO tests; available policies depend on the report format. |
| [Lint rules](#eslint-your-first-adapter-gate) | `@redproof/eslint` · `eslint()` | Selected ESLint rules, including findings suppressed by inline comments. |
| [Architecture boundaries](#dependency-cruiser) | `@redproof/dependency-cruiser` · `dependencyCruiser()` | Named dependency rules, with optional acceptance of known violations. |
| [Test strength](#stryker) | `@redproof/stryker` · `stryker()` | Undetected mutants, new undetected mutants, or a minimum mutation score. |
| [Unused code and dependencies](#knip) | `@redproof/knip` · `knip()` | Selected Knip categories: unused files, exports, dependencies, unresolved imports, and more. |
| [Coverage](#coverage) | `@redproof/istanbul` · `nyc()` or `istanbul()` | Statement, branch, function, and line thresholds, overall or per file. |

Install only the packages you need, alongside their tools. All require Node.js 24
or later. Package READMEs linked below list tool compatibility and advanced options.

## Why not just call `command()`?

Use [`command()`](commands.md) when an exit code answers your question—for example,
“Does `npm run lint` succeed?” Use `commands()` to group several such checks.

An Adapter answers a more specific question: “Which lint rule failed, and where?”
It reads structured tool results instead of using the exit code alone.

| Situation | Command Check | Built-in Adapter |
|---|---|---|
| ESLint reports both `no-console` and `eqeqeq` | Breaches the Rule you assigned to that command. | Attributes each finding to its selected Rule, with the reported source location. |
| A test passes only after a retry | A successful exit passes. | The testing Adapter can breach `noFlakyTests` when the report provides retry evidence. |
| The tool cannot produce trustworthy results | Spawn failures, signals, exceeded limits, and exit codes outside an explicit policy REFUSE. | Also interprets tool-specific problems, such as malformed reports or disabled selected policies. |
| You want to prove a safeguard works | Supports RED, GREEN, and REFUSE proofs. | Supports the same proofs, targeted at the selected tool Rules. |

For example, a command Check can map ESLint exit `1` to one `lint` Rule and
exit `2` to REFUSE. The ESLint Adapter below gives `no-console` and `eqeqeq`
separate Rules. A loose-equality finding cannot satisfy a RED proof targeting
console usage. That is useful when you need to know that a particular safeguard
works, not just that the lint command can fail.

## ESLint: your first Adapter Gate

### 1. Install and configure

From your project root:

```bash
npm install --save-dev redproof @redproof/eslint eslint
```

If you have not configured Redproof yet, create `redproof.config.ts`:

```ts
import { defineConfig } from 'redproof';

export default defineConfig({ root: '.', gatesRoot: 'gates/**/*.ts' });
```

This example uses JavaScript to avoid needing a TypeScript parser. It assumes
`src/example.js` exists and has no lint violations. For a new project, start with:

```js
export const value = 1;
```

Keep your existing ESLint configuration. If you do not have one, create
`eslint.config.mjs`:

```js
export default [{
  files: ['src/**/*.js'],
  rules: { 'no-console': 'error', eqeqeq: 'error' },
}];
```

### 2. Select the Rules and add a proof

Create `gates/eslint.ts`:

```ts
import { eslint } from '@redproof/eslint';
import { defineGate, defineProofs, mutate, proof } from 'redproof';

const adapter = eslint({
  files: ['src/**/*.js'],
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
    mutate.appendText('src/example.js', '\nconsole.log("proof");\n'),
  ),
  proof.green('accepts clean source'),
]);

export default gate;
```

`noConsole` is your local name; `no-console` is the ESLint rule it selects.
The Adapter enables selected rules at error severity for its run. Your ESLint
configuration still supplies parsers, plugins, and file settings.

Browse the [official ESLint Rules Reference](https://eslint.org/docs/latest/rules/)
for core rule IDs and options. For plugin rules, use the plugin's own reference.

**Using an ESLint preset?** Keep it in `eslint.config.*`. The Adapter loads that
configuration, but does not automatically select every rule in the preset.
If the preset enables 100 rules and you select two here, only those two can
breach this Gate. A PASS does not mean the entire ESLint configuration passed.
Use a [Command Check](commands.md#exit-codes-decide-the-verdict) alongside this
Gate if you also want to require the full ESLint run to succeed.

### 3. Check it, then prove it

```bash
npx redproof describe gates/eslint.ts
npx redproof check gates/eslint.ts
npx redproof prove gates/eslint.ts
```

`describe` shows the Gate's Rules, Check, and proofs. `check` should PASS on clean
source. By default, during `prove`, Redproof adds the console call to a temporary copy and
expects the Gate to FAIL for `noConsole`. That expected failure means the RED
proof succeeded. The GREEN proof checks that clean source still passes.

This Gate checks two Rules, but proves detection for only `noConsole`. Add a
separate RED proof that introduces `==` to prove `strictEquality` too.

Two ESLint-specific protections go beyond the command's exit code:

- Findings suppressed by `/* eslint-disable */` still breach selected Rules.
- An explicitly named file that ESLint ignores produces REFUSE. A glob still
  respects ignore patterns; it does not establish that every matching file was read.

See the [ESLint package](../packages/eslint/README.md) for details.

## Recipes for the other Adapters

These examples assume Redproof is configured as above and the underlying tool
already works in your project. Save a Gate in `gates/` and run `npx redproof check`
with its path. Each recipe below is **check-only**: it selects Rules but does not
include proofs. See [Add proofs to your Gate](#add-proofs-to-your-gate) when it passes.

### Testing

Use this when “the test command passed” is not enough: you also want to reject
skipped tests, TODOs, or tests that passed only after a retry.

```bash
npm install --save-dev @redproof/testing vitest
```

```ts
import { vitest } from '@redproof/testing';
import { defineGate } from 'redproof';

const adapter = vitest({
  rules: {
    testsPass: true,
    noFlakyTests: true,
    noSkippedTests: true,
    noTodoTests: true,
  },
});

export default defineGate({ id: 'tests', adapter });
```

These select `testing/tests-pass`, `testing/no-flaky-tests`,
`testing/no-skipped-tests`, and `testing/no-todo-tests`.

Not using Vitest? `testing()` pairs a command with a supported report format.
For example, with pytest installed and tests in the project:

```ts
import { report, runner, testing } from '@redproof/testing';
import { defineGate } from 'redproof';

const adapter = testing({
  runner: runner.command({
    command: 'pytest',
    args: ({ reportFile }) => ['-q', `--junitxml=${reportFile}`],
  }),
  report: report.junitXml(),
  rules: { testsPass: true, noSkippedTests: true },
});

export default defineGate({ id: 'python-tests', adapter });
```

Built-in formats are `report.jestJson()` and `report.junitXml()`.
Retry detection needs Jest-compatible JSON; selecting `noFlakyTests` with JUnit
XML is rejected because that format cannot establish it.

The [testing package](../packages/testing/README.md) covers Jest retry signals,
Vitest config-loader settings for proof runs, report paths, and process limits.
For another format, [extend the runner or report parser](custom-adapter.md#extend-the-testing-adapter-instead).

### dependency-cruiser

Use this to protect individual module boundaries rather than one “architecture
command passes” promise. Define the boundaries in dependency-cruiser's config,
then select their names:

```bash
npm install --save-dev @redproof/dependency-cruiser dependency-cruiser
```

```ts
import { dependencyCruiser } from '@redproof/dependency-cruiser';
import { defineGate } from 'redproof';

const adapter = dependencyCruiser({
  configFile: '.dependency-cruiser.cjs',
  files: ['src'],
  rules: {
    domainNoInfrastructure: 'domain-no-infrastructure',
    applicationNoAdapters: 'application-no-adapters',
  },
});

export default defineGate({ id: 'architecture', adapter });
```

The config must define both selected rules. A selected rule disabled with severity
`ignore` produces REFUSE, not PASS. Set `knownViolationsFile` to accept an existing
baseline while still rejecting new violations.

See the [dependency-cruiser package](../packages/dependency-cruiser/README.md)
for configuration and baseline details.

### Stryker

Stryker deliberately changes source code to see whether your tests notice.
Use this Adapter to set test-strength policies or accept specific existing
survivors without accepting new ones.

```bash
npm install --save-dev @redproof/stryker @stryker-mutator/core
```

With a working Stryker configuration and its test-runner dependencies installed:

```ts
import { stryker } from '@redproof/stryker';
import { defineGate } from 'redproof';

const adapter = stryker({
  configFile: 'stryker.config.mjs',
  rules: { mutationScore: { minimum: 80 } },
});

export default defineGate({ id: 'test-strength', adapter });
```

Choose `mutationScore` for a minimum score, `mutantsDetected` to require every
valid mutant to be detected, or `noNewUndetectedMutants` to reject undetected
mutants outside an accepted baseline. A different survivor breaches the last
policy even if the total survivor count stays unchanged.

See the [Stryker package](../packages/stryker/README.md) for baseline setup.

### Knip

Use this to give unused files, unused exports, dependency issues, and other Knip
categories their own Rules. A selected warning breaches even if Knip exits zero.

```bash
npm install --save-dev @redproof/knip knip
```

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

Knip's configuration determines scope, plugins, and ignore patterns. A selected
category disabled by that configuration produces REFUSE, not PASS. The Adapter
does not prove that ignored code is unused or safe.

See the [Knip package](../packages/knip/README.md) for all categories, Rule IDs,
and workspace options.

### Coverage

Use this to check coverage metrics separately, apply per-file thresholds, and
require specific files to appear in the report—not just trust a coverage command's
exit code.

```bash
npm install --save-dev @redproof/istanbul nyc
```

This example assumes Mocha is installed, tests live under `test/`, and
`src/orders.js` exists:

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

You can also select `functions` and `lines`. `nyc()` collects fresh coverage and
includes unexecuted files in its configured scope by default. Pass the test
executable, not a script that already wraps nyc.

A missing expected file or failed test process produces REFUSE, even if a report
exists. `expectedFiles` cannot detect omitted statements within a reported file.
Coverage measures execution, not assertion quality.

Already using c8 or another coverage producer? `istanbul()` accepts a fresh,
full Istanbul coverage map—not summary-only JSON. See the
[Istanbul package](../packages/istanbul/README.md) for that recipe and all options.

## Configuration details

These options extend the recipes above. Keep them in the same Gate file.

### Testing configuration

#### Running Vitest from a subdirectory

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

#### Using an existing Vitest JSON report

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

#### Flaky-test detection

`noFlakyTests` requires a report format that records retry information.

Redproof supports retry evidence from Jest-compatible JSON reports, including:

- earlier failure messages
- `invocations`
- `retryReasons`

JUnit XML only records the final test result, so it cannot reliably prove that a test was not flaky. Redproof therefore rejects `noFlakyTests` when used with JUnit XML.

Redproof also validates test totals when the report provides them. A contradictory or incomplete report produces `REFUSE` instead of an incorrect `PASS`.

#### Command runner metadata

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

### Architecture baselines

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

### Stryker configuration

#### Working directory

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

#### Projects with accepted surviving mutants

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


## Add proofs to your Gate

An Adapter supplies Rules and a Check. It does **not** supply project-specific
proofs. Once `check` passes, follow the ESLint example: keep the Gate in a variable
and export a `defineProofs` suite targeting `adapter.rules.<yourRule>`.

Choose a mutation that breaks the policy you want to trust:

| Adapter | Example RED proof | Existing example |
|---|---|---|
| Testing | Break behavior that an existing test asserts. | [Vitest proofs](../fixtures/testing-vitest/gates/tests.ts) |
| ESLint | Add a console call or loose equality. | [ESLint proofs](../fixtures/eslint-project/gates/eslint.ts) |
| dependency-cruiser | Add an import across a forbidden boundary. | [Architecture proofs](../fixtures/dependency-cruiser-project/gates/architecture.ts) |
| Stryker | Weaken an assertion so a mutant survives. | [Test-strength proofs](../fixtures/stryker-project/gates/test-strength.ts) |
| Knip | Introduce an unused file or export. | [Redproof's Knip Gate](../gates/unused-code.ts) |
| Coverage | Add an unexecuted branch. | [Coverage proofs](../fixtures/istanbul-project/gates/coverage.ts) |

Add a GREEN proof for the healthy state and a REFUSE proof for unavailable
evidence. Then run `npx redproof prove` with your Gate's path. A RED proof verifies
only its targeted Rule, not every Rule selected by the Adapter.

## How to read the result

- **PASS:** the Check completed and found no breaches of the selected Rules.
- **FAIL:** tool evidence breached a selected Rule. Unselected findings do not breach.
- **REFUSE:** Redproof could not establish the result—for example, the report was
  malformed or a selected policy was disabled. Fix the evidence problem and rerun.

Checks run the tool again rather than just reading yesterday's report. If you
write a custom test or coverage producer, it must collect fresh evidence too.
A PASS with zero inspected targets becomes REFUSE by default; see
[Empty evidence](composition.md#empty-evidence) for intentional exceptions.

Adapters still depend on the tool's configured scope. Selecting a policy does
not automatically include ignored code. Invalid Adapter options throw when the
Gate file loads; package READMEs explain supported paths and options.

If an exit code is all you need, start with [Command Checks](commands.md).
If neither approach fits, see [Custom Adapter](custom-adapter.md).

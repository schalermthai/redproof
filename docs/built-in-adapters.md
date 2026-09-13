# Built-in Adapters

Redproof integrations translate an existing tool or result format into Redproof Rules and Check results.

The external tool remains responsible for doing the real analysis. Redproof adds the Rule model and proofs around it.

Every Adapter reports how many targets it inspected. A PASS over zero targets is refused as `nothing-inspected` unless the Gate sets `policies: { emptyEvidence: 'allow' }`. See [Empty evidence](composition.md#empty-evidence).

## Knip

`@redproof/knip` exposes Knip issue categories as named Rules:

```ts
import { knip } from '@redproof/knip';
import { defineGate } from 'redproof';

export default defineGate({
  id: 'unused-code',
  adapter: knip({
    rules: { unusedFiles: 'files', unusedExports: 'exports', unresolvedImports: 'unresolved' },
  }),
});
```

Warnings breach selected Rules; disabled categories and incomplete evidence
REFUSE. The adapter preserves processed-file counts, issue locations and group
details through a private Knip reporter.

The adapter requires Knip 6.35.1 or later, below 7. It reads the installed
version from the Knip package manifest and REFUSES an unsupported one. The
`cli` option does not skip that check when the path it names sits inside an
installed Knip. A `cli` path outside an installed Knip carries no version to
read, so no version check runs for it.

See the [Knip package](../packages/knip/README.md) for options and scope.

## Testing

For coverage thresholds, use [`@redproof/istanbul`](../packages/istanbul/README.md).
It provides `nyc()` for fresh native coverage collection and `istanbul()` for
other full coverage-map producers. Four Rules protect statement, branch,
function and line thresholds; each can apply overall or per file. Missing
expected files and unsuccessful producers REFUSE. Coverage complements test
outcomes; it does not prove assertion quality.

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
    noFlakyTests: true,
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

For a Vitest project below the Gate root, select its working directory. If the
project already configures a JSON `outputFile` that setup or teardown code
consumes, name it with `reportFile`; Redproof will use that fresh report and
restore any file that existed before the run:

```ts
import { vitest } from '@redproof/testing';

const adapter = vitest({
  cwd: 'packages/app',
  configFile: 'vitest.config.ts',
  reportFile: 'test-results.json',
  timeoutMs: 120_000,
  maxOutputBytes: 20 * 1024 * 1024,
  rules: { testsPass: true },
});
```

`cwd` is relative to and confined inside the Gate root. `configFile` and test
file filters follow Vitest's normal cwd-relative resolution. `reportFile` is
relative to `cwd` and must name the same file as the JSON `outputFile` in the
Vitest config. Keep the Vitest `root` at `cwd`. If the two disagree, the Check
refuses because the report is not found. A keyed `outputFile` works when
`reportFile` matches its `json` entry. When `reportFile` is absent, Redproof
continues to direct Vitest to a private temporary JSON report.
Empty or absolute `reportFile` values are rejected before Vitest starts.

Every Vitest path option must be a non-empty relative path. That covers `cwd`,
`configFile`, `reportFile`, and each entry of `files`. An empty value or an
absolute value throws when the Gate file loads. The raw `args` list is not
checked, so it can still carry an absolute path.
The report's parent directory may be absent before the run when Vitest creates
it while writing the report. Redproof removes newly created report directories
afterward when they remain empty.

`timeoutMs` bounds the complete Vitest invocation. `maxOutputBytes` bounds
combined stdout and stderr capture and defaults to 10 MiB. Exceeding either
limit REFUSES the Gate and stops the Vitest process group before returning.
Workers and test-created child processes in that group stop with it. A process
that starts its own session is outside the group. The run is stopped, not
truncated, so a Gate above the limit refuses instead of reading a partial report.

Redproof passes `--no-cache` to Vitest. Without it, Vitest writes a results
cache under `node_modules/.vite` inside the project, and a proof run refuses
with `workspace-not-restored`. The adapter is proven against Vitest 5.

Vite's default config loader has the same effect. It writes a temporary bundle
of the config file under the nearest `node_modules/.vite-temp` and leaves that
directory behind. When a `node_modules` directory sits inside the Gate root, as
in a pnpm workspace, a proof run refuses with `workspace-not-restored`. Pass
`args: ['--configLoader', 'runner']` to load the config without that bundle.
The flag needs Vitest 3.1 or later, and Vitest marks the loader experimental.

The testing integration can expose these Rules, depending on the selected report format:

- `testing/tests-pass`
- `testing/no-flaky-tests` (Jest-compatible JSON only)
- `testing/no-skipped-tests`
- `testing/no-todo-tests`

The flaky-test Rule breaches when a test passes only after a retry. The evidence
differs by producer. Vitest keeps the failure messages of earlier attempts in
its Jest-compatible JSON report. Jest clears them, reports `invocations` greater
than 1, and fills `retryReasons` only when `logErrorsBeforeRetry` is set.
Redproof reads all three signals. JUnit XML records only the final outcome, so
Redproof refuses `noFlakyTests` with that format at composition time.

When a Jest-compatible JSON report includes total or failed test counts, Redproof
checks them against the contained assertions. A contradictory report refuses
the Gate instead of producing a false PASS from incomplete result data.

### Other test runners

You do not need a dedicated Redproof package for every test framework.

Use the generic testing adapter with a runner and a structured report format:

```ts
import { report, runner, testing } from '@redproof/testing';

const adapter = testing({
  runner: runner.command({
    command: 'pytest',
    timeoutMs: 120_000,
    maxOutputBytes: 10 * 1024 * 1024,
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

```ts fragment
report.jestJson()
report.junitXml()
```

For a custom test system, implement only the runner or the report format. See
**[Extend the testing adapter instead](custom-adapter.md#extend-the-testing-adapter-instead)**.

### What a command runner reports about itself

A command runner states what it will run. `redproof describe` uses this, so a
Gate does not need a hand-written sentence that can drift from the real command.

```ts
import { runner } from '@redproof/testing';

const built = runner.command({ command: 'npm', args: ['test'] });

built.description;                                  // 'run npm test'
built.plan;                                         // { command: 'npm', args: ['test'] }
built.argsFor?.({ root: '.', reportFile: 'r.xml' }); // ['test']
```

`plan.args` is present only when the arguments are a fixed list. When `args` is
a function, the arguments depend on the run, so `plan` carries the command
alone and `argsFor` answers for one run.

The default description uses the command's base name. A description therefore
reads the same on every machine, even when `command` is an absolute path. Set
`description` yourself when a sentence explains more than the command line does.

Set `cwd` to run a generic test command below the Gate root. Redproof rejects
both `..` escapes and symbolic links that resolve outside the root.
The generic runner accepts the same `timeoutMs` and `maxOutputBytes` process
limits as `vitest()` and uses the shared `redproof/command` process supervisor.
Spawn failures, signals, and exceeded limits are reported as unavailable test
evidence, so the Gate REFUSES rather than guessing.

A Check built from `redproof/command` reports itself the same way. See
**[Command Checks](commands.md#what-a-check-says-about-itself)**.

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

An adopted Rule cannot be suppressed in the source. A finding that ESLint
reports as suppressed by `/* eslint-disable */` still breaches the Redproof
Rule that adopted it. The ESLint Adapter has no baseline.

Name a path in `files` and ESLint must read it. A configured `ignores` pattern
that excludes that path becomes `REFUSE`, not `PASS`. A glob in `files` keeps
your `ignores` patterns, so name the path when you need Redproof to prove that
ESLint read it.

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
  knownViolationsFile: '.dependency-cruiser-known-violations.json',
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
When `knownViolationsFile` is set, the adapter ignores matching committed baseline
violations while still reporting new violations. The adapter disables dependency-
cruiser caching so RED mutations cannot reuse a stale pre-mutation result.

A baseline makes the Gate quieter on purpose. That is a weakening, so keep it
honest. A baseline that grows every time somebody adds debt guards nothing, and
it still reports PASS. Keep a RED proof that plants a new violation, and confirm
the Gate still fails. A malformed baseline file is refused, not ignored.

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
- no undetected mutant may appear outside an exact accepted-mutant baseline
- mutation score must stay at or above a configured minimum

Set `cwd` to run Stryker from a package inside the Gate root. `configFile` and
`acceptedMutantsFile` are resolved from that directory.

For a project with intentional survivors, select `noNewUndetectedMutants`
instead of `mutantsDetected`, and point `acceptedMutantsFile` at a checked-in
JSON array. Each entry records the file name relative to the working directory,
the mutator, the replacement, the full start and end location, and an optional
reason. Redproof matches identities, not counts, so replacing one accepted
survivor with a new survivor still breaches the Rule. A malformed, duplicate,
or escaping entry refuses. An accepted mutant that the tests now detect
refuses; remove it from the baseline.

For a useful RED proof, weaken the test suite and confirm Stryker notices the loss of test strength.

## Path rules

Adapter path options must be non-empty relative paths. The check runs when the
Gate file loads, not when the tool runs.

| Adapter | Options that must be relative |
| --- | --- |
| ESLint | each entry of `files` |
| dependency-cruiser | `configFile`, `knownViolationsFile`, each entry of `files` |
| Stryker | `cwd`, `configFile`, `rules.noNewUndetectedMutants.acceptedMutantsFile` |
| Vitest | `cwd`, `configFile`, `reportFile`, each entry of `files` |

The `command` option of a test command runner is not a path option. An absolute
command is still allowed.

These rules reject an absolute path. They do not reject a `..` segment, so they
are not a containment boundary. Stryker `cwd` and the Vitest paths are confined
to the Gate root at run time. The ESLint and dependency-cruiser `files` lists
are not confined.

## Next

- **[Custom Adapter](custom-adapter.md)** when no built-in integration fits, and for
  choosing between a Check, a runner or report format, and an Adapter.
- **[Command Checks](commands.md)** when the tool is an executable and its exit code is the result.

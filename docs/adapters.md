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

```ts fragment
report.jestJson()
report.junitXml()
```

For a custom test system, implement only the runner or report normalization layer:

```ts fragment
defineTestRunner(...)
defineTestReport(...)
```

Create a new full Adapter only when a tool introduces a genuinely different policy model.

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

## Choosing between an Adapter and a parser

A useful rule of thumb:

> Create a new Adapter when the external system introduces a new policy model.

> Create a runner or parser when it only introduces a new invocation method or data format.

When the tool is simply an executable, a Check is enough. See **[Command
Checks](commands.md)**.

For writing your own integration, continue with **[Composing Redproof](composition.md#creating-an-adapter)**.

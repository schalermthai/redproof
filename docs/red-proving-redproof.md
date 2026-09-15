# Redproof proves Redproof

This repository runs Redproof on itself. Six Gates hold 39 Rules and 61 Proofs.
The real CI and release workflows use these Gates. They are not a separate
showcase suite. Every push asks two questions:

```text
npm run self:check   does the repository satisfy its guardrails now?
npm run self:prove   can each guardrail still detect the defect it names?
```

The model behind every proof is:

```text
healthy repository   ──▶ same Gate ──▶ PASS
controlled defect    ──▶ same Gate ──▶ FAIL the targeted Rule
unavailable evidence ──▶ same Gate ──▶ REFUSE
```

A RED proof succeeds only when the Rule it names breaches. Any other failure
does not count. A GREEN proof shows that the healthy repository passes. A REFUSE
proof shows that the Check declines to guess when its evidence is missing.

## The six Gates

```text
architecture         module graph and functional-core effect boundaries   16 Rules   25 Proofs
static-contracts     types, documentation examples, fragment budget         3 Rules    4 Proofs
test-health          every test passes, none is skipped                    2 Rules    4 Proofs
adapter-contracts    five promises every built-in Adapter keeps            5 Rules    9 Proofs
repository-policy    packages, versions, CI, documentation links, lockfile 7 Rules   10 Proofs
unused-code          files, exports, and dependencies stay connected       6 Rules    9 Proofs
```

Each Gate is one file under [`gates/`](../gates). The sections below show one
pattern each:

- [Describing a Gate](#describing-a-gate). `redproof describe` prints the
  Rules, the Check, and every Proof before anything runs.
- [The static-contracts Gate](#the-static-contracts-gate). `commands()` turns
  a script with an exit code into a Rule with a name and a proof.
- [The architecture Gate](#the-architecture-gate). One mutation per boundary,
  and each proof must breach the one Rule it names.
- [Two tools in one Check](#two-tools-in-one-check). An Adapter's Rules and
  native Rules share one catalogue, and one Check runs both tools.
- [The test-health Gate](#the-test-health-gate). A runner builds its
  arguments per run, and its description comes from the same option.
- [The adapter-contracts Gate](#the-adapter-contracts-gate). Mutations edit
  the production source of an Adapter to prove the contract suite notices.
- [The repository-policy Gate](#the-repository-policy-gate). Release mistakes
  become mutations, including one from a real incident.
- [Gate discovery in CI](#gate-discovery-in-ci). CI lists the Gate files
  itself, and a Rule pins the command each leg runs.

## Describing a Gate

`npm run self:describe` prints every Gate before anything runs. The output
below describes the [`unused-code`](../gates/unused-code.ts) Gate, which is
built on the Knip Adapter:

```text
Gate: unused-code

Rules:
  R1 Files in the configured scan must be reachable from its entrypoints.
  R2 Exports in the configured scan must be used.
  R3 Declared dependencies must be used in the configured scan.
  R4 Development dependencies must be used and not duplicate regular dependencies.
  R5 Used dependencies must be declared in the applicable package manifest.
  R6 Import specifiers in the configured scan must resolve.

Check:
  run Knip and evaluate selected structured issue categories

Proof R1:
  finds an unreachable file in the root workspace
  mutation: write gates/support/unused-receipt.ts
  run the same Check
  expect Gate FAIL

Proof R3:
  finds a dependency without consumers
  mutation: merge $.dependencies
  run the same Check
  expect Gate FAIL

Proof REFUSE:
  refuses incomplete Knip configuration
  mutation: write knip.json
  run the same Check
  expect Gate REFUSE

Proof GREEN:
  accepts the maintained repository inventory
  run the same Check
  expect Gate PASS
```

The Gate file is 31 lines. The description puts the promise, the defect, and
the expected verdict together. A reviewer reads what the Gate guards from this
output alone, without the Knip documentation.

## The static-contracts Gate

The [`static-contracts`](../gates/static-contracts.ts) Gate makes three
promises:

```text
R1 Workspace source, tests, fixtures, and self-hosted Gates must type-check.
R2 Standalone TypeScript examples in the documentation must compile.
R3 The number of documentation fragments excluded from compilation must not grow.
```

The first promise is the normal TypeScript build. `tsc` checks it.

The other two promises are about the code examples in the documentation.
`README.md` and every page under `docs/` contain TypeScript examples in `ts`
code blocks. When the API changes, an example can stop compiling, and nobody
notices until a reader copies it. No linter checks that. So the repository has
its own script, `scripts/typecheck-docs.ts`. It copies every `ts` block into a
file and runs `tsc` over those files. That is R2.

Some examples are only a few lines and cannot compile on their own. Such a
block is marked `ts fragment`, and the script skips it. The marker is needed,
but each fragment is one example the script does not check. A second script,
`gates/support/check-doc-fragment-budget.ts`, is 30 lines long. It counts the
fragments and fails when the count is above 37. That is R3. The count can go
down but not up.

Both scripts print a message and exit with a non-zero code when they find a
problem. That is all a script can do. It has no Rule with a name, no proof
that it still fails on a bad example, and no way to say that it could not run
at all.

`commands()` turns each script into one entry of the Check. The entry names
the Rule that the script guards. When the script exits non-zero, the Gate
reports a breach of that Rule:

```ts
import { defineGate, defineRules } from 'redproof';
import { commands } from 'redproof/command';

const rules = defineRules({
  docsExamplesCompile: {
    id: 'static/docs-examples-compile',
    description: 'Standalone TypeScript examples in the documentation must compile.',
  },
  docsFragmentDebt: {
    id: 'static/docs-fragment-debt-does-not-grow',
    description: 'The number of documentation fragments excluded from compilation must not grow.',
  },
});

export default defineGate({
  id: 'static-contracts',
  rules,
  check: commands({
    mode: 'parallel',
    maxAtOnce: 2,
    label: 'documentation contracts',
    entries: [
      {
        rule: rules.docsExamplesCompile,
        label: 'documentation examples',
        command: process.execPath,
        args: ['--experimental-strip-types', 'scripts/typecheck-docs.ts'],
      },
      {
        rule: rules.docsFragmentDebt,
        label: 'documentation fragment budget',
        command: process.execPath,
        args: ['--experimental-strip-types', 'gates/support/check-doc-fragment-budget.ts'],
      },
    ],
  }),
});
```

`commands()` also gives each script a timeout and an output limit. A script
that cannot start does not become PASS. The Gate reports REFUSE and says which
entry could not run.

The proofs are two Markdown files that the mutation creates. One holds an
example that does not compile. The other holds one more fragment than the
budget allows:

```text
Proof R2:
  rejects an invalid checked documentation example
  mutation: create docs/redproof-doc-example-proof.md
  run the same Check
  expect Gate FAIL

Proof R3:
  rejects growth in unchecked documentation fragments
  mutation: create docs/redproof-doc-fragment-proof.md
  run the same Check
  expect Gate FAIL
```

Every `ts` block in `README.md` and `docs/` compiles. The budget for
`ts fragment` blocks is 37, and it cannot grow. This page is under `docs/`, so
the same Gate checks the examples on it.

## The architecture Gate

The [`architecture`](../gates/architecture.ts) Gate protects a functional core
and an imperative shell. Core modules make decisions from values. Shell modules
read files, watch the clock, and supervise processes. A written convention is
easy to break by accident, so each boundary has a mutation that crosses it.
Three of those mutations touch the same file:

```text
Proof R2:
  keeps effect imports out of the functional core
  mutation: append text to packages/redproof/src/run/core/exit-code.ts

Proof R14:
  keeps ambient process state out of the functional core
  mutation: append text to packages/redproof/src/run/core/exit-code.ts

Proof R3:
  keeps the imperative shell out of the functional core
  mutation: append text to packages/redproof/src/run/core/exit-code.ts
```

The three appended lines are:

```text
import 'node:fs/promises';             → R2  core-no-effect-imports
void process.cwd();                    → R14 core-no-ambient-inputs
import '../shell/worker-process.ts';   → R3  core-no-shell
```

Each proof names one Rule. If the change breaches a different Rule, the proof
fails. The Gate therefore has to tell the three kinds of boundary crossing
apart. A report that something went wrong does not satisfy the proof.

## Two tools in one Check

The architecture Gate has 16 Rules. Thirteen come from dependency-cruiser, and
three are native:

```text
R14 Functional-core modules receive ambient values from the shell.
R15 Filesystem, process, clock, randomness, and subprocess effects stay in approved boundary modules.
R16 Functional-core tests use plain values rather than filesystem, subprocess, or workspace fixtures.
```

dependency-cruiser checks the first thirteen. It sees the import graph, and an
import is where a module boundary is crossed. It cannot check the last three,
because a core module can read ambient state without an import:

```text
process.cwd()   in a function body
Date.now()      in a function body
```

dependency-cruiser never looks inside a function body. A TypeScript syntax scan
does, so the Gate runs both.

The Gate keeps one Rule catalogue and one Check for both tools. The promise is
one promise, "the functional core is pure", and one Gate gives it one verdict.
The proof for R14 then sits beside the proof for R2, and both plant a change in
the same file.

The Adapter Rules spread into the catalogue beside the native ones. The native
Check takes the Adapter as an option and runs it first:

```text
const dependencies = dependencyCruiser({ configFile: '.dependency-cruiser.cjs', ... });

const rules = {
  ...dependencies.rules,
  coreNoAmbientInputs: defineRule({ id: 'architecture/core-no-ambient-inputs', ... }),
  effectsAllowlistedBoundaries: defineRule({ ... }),
  coreTestsNoIoHelpers: defineRule({ ... }),
};

defineGate({
  id: 'architecture',
  rules,
  check: effectBoundaries({ dependencies, rules, sources: 'packages/*/src/**/*.ts', ... }),
});
```

[`effectBoundaries`](../gates/checks/effect-boundaries.ts) is built on the
[`scanning`](../gates/support/scanning.ts) helper, which has one optional
`delegate`. Here the delegate is the dependency-cruiser Check. The result
carries its breaches, and then the syntax scan adds its own. A REFUSE from
either side wins, so the Gate does not give a verdict from half of the
evidence.

`redproof describe` prints the two as one:

```text
Check:
  enforce source dependencies and functional-core effect boundaries
```

The approved effect boundaries are a list of 28 files in
[`effects-model.ts`](../gates/support/effects-model.ts). A new file that reads
the filesystem must join that list in a reviewed change. The proof creates such
a file and expects R15 to breach.

## The test-health Gate

The [`test-health`](../gates/test-health.ts) Gate runs every test file under
`node --test`. It reads the JUnit report through `@redproof/testing`. The file
list depends on the workspace, so the Gate builds the arguments per run:

```ts
import { globSync } from 'node:fs';
import { runner, type TestRunner } from '@redproof/testing';

export function nodeTestSuite(options: { readonly files: string }): TestRunner {
  return runner.command({
    command: process.execPath,
    description: `run ${options.files} under node --test with a JUnit report`,
    args: ctx => [
      '--experimental-strip-types',
      '--test',
      '--test-reporter=junit',
      `--test-reporter-destination=${ctx.reportFile}`,
      ...globSync(options.files, { cwd: ctx.root }).sort(),
    ],
  });
}
```

The description and the arguments come from the same `files` option.
`redproof describe` prints the description, so the sentence cannot drift from
the real command:

```text
Check:
  run {tests,packages/*/test}/**/*.test.ts under node --test with a JUnit report; interpret junit-xml test results

Proof R2:
  detects a collected skipped test
  mutation: create tests/redproof-skipped-proof.test.ts
  run the same Check
  expect Gate FAIL
```

A skipped test is not a passing test. The Rule `noSkippedTests` breaches on it.

## The adapter-contracts Gate

An Adapter can return the right TypeScript shape and still be unsafe. It can
accept invalid options, turn a crashed tool into PASS, or drop a finding it
should report. The [`adapter-contracts`](../gates/adapter-contracts.ts) Gate
holds five promises for every built-in Adapter. Its mutations edit the
production source of an Adapter with `locate.text`, and then they expect the
contract suite to notice:

```text
Proof R1:
  detects an Adapter that accepts unknown constructor options
  mutation: remove "  rejectUnknownKeys(options, ['files', 'rules'], 'ESLint adapter');\n"

Proof R2:
  detects a runner exception mapped to the wrong evidence lane
  mutation: replace "kind: 'unavailable' as const"

Proof R4:
  detects a report format that overstates what it can observe
  mutation: replace "capabilities: { todo: false, flaky: false }"

Proof R5:
  detects evidence translation that drops selected structured findings
  mutation: replace "if (!message.ruleId) continue;"

Proof REFUSE:
  refuses when a contract suite floods its output budget
  mutation: append text to tests/adapters/adapter-contracts.constructor.test.ts
```

Each promise runs twice. The original contract suite runs, and the
package-owned [`@redproof/adapter-tck`](../packages/adapter-tck/README.md)
registration runs beside it. That is ten commands for five Rules, in parallel.
The REFUSE proof writes 4 MB of output against a 1 MB budget, and the Gate
refuses instead of reading a partial result.

Real-tool fixtures then prove the same promises with ESLint, dependency-cruiser,
Stryker, and Vitest against representative projects. The dependency direction
stays clean:

```text
Adapter production ──▶ redproof
Adapter tests      ──▶ @redproof/adapter-tck ──peer/types──▶ redproof
root Gate          ──▶ package-owned TCK tests
```

The diagram states three things. Redproof does not depend on the TCK. Adapter
production does not import the TCK. The TCK does not import built-in Adapters.

Two of those statements have a proof. The architecture Gate plants a TCK import
in Adapter source, and the repository-policy Gate adds the TCK to the redproof
dependencies. Both proofs expect a breach.

## The repository-policy Gate

The [`repository-policy`](../gates/repository-policy.ts) Gate extends the
checks from the source code to the packages that users install. It reads the
package manifests, the release scripts, both workflows, every Markdown link,
and the lockfile. Its mutations are the release mistakes a team makes:

```text
rename 'packages/testing' in the version setter              → R1 a package leaves the inventory
set one package to "0.6.1" while the rest are "0.12.0"       → R2 versions diverge
add "@redproof/adapter-tck" to redproof's dependencies       → R3 a layer boundary breaks
rename the "schema" export to "schema-off"                    → R4 a public surface is undeclared
remove "run: npm run verify:package" from ci.yml              → R5 CI drops verification
write  npm publish "$TARBALL"  without the "./"              → R5 npm reads a GitHub shorthand
link ./definitely-missing.md from a document                  → R6 a documentation link breaks
delete lightningcss-linux-x64-gnu from package-lock.json      → R7 a platform binary vanishes
rename .github/workflows/ci.yml                               → REFUSE, not PASS
```

The `npm publish` mutation records a real incident. The 0.12.0 release
published nothing, because npm reads a bare `artifacts/x.tgz` as the GitHub
shorthand `github:artifacts/x.tgz`. The Rule now pins
`npm publish "./$TARBALL"`.

The release workflow packs every publishable package and installs the tarballs
into a clean consumer. It then verifies runtime imports, published types, CLI
behaviour, package contents, and internal links. The same verified tarballs are
attached to the workflow run and passed to `npm publish`. Nothing is rebuilt
afterward. See the [publish workflow](../.github/workflows/publish.yml).

## Gate discovery in CI

The [CI workflow](../.github/workflows/ci.yml) does not keep a list of Gates. A
`discover` job lists `gates/*.ts`, and a matrix job then runs the proofs of one
Gate per leg:

```text
discover ──▶ proofs (architecture)
         ──▶ proofs (static-contracts)
         ──▶ proofs (test-health)
         ──▶ proofs (adapter-contracts)
         ──▶ proofs (repository-policy)
         ──▶ proofs (unused-code)
```

The `discover` job picks up a new Gate file on the next run. There is no
hand-written list to update. The `repository-policy` Gate then checks the run
line of each leg, which must be exactly:

```text
npm run check:proofs -- gates/${{ matrix.gate }}.ts
```

Quality checks, the proof legs, and clean-consumer package verification start
together and report separately. A slow proof does not hold the other layers.

## Run it

Describe the Gates as an executable specification:

```bash
npm run self:describe
```

Check the current repository:

```bash
npm run self:check
```

Run every controlled defect, healthy baseline, and refusal:

```bash
npm run self:prove
```

The complete delivery check adds types, documentation examples, native tests,
and the real-tool fixtures:

```bash
npm run check
```

The proof report puts the claim and the outcome side by side:

```text
✓ architecture / detects a production dependency cycle expected=red actual=fail
✓ adapter-contracts / refuses when a contract suite floods its output budget expected=refuse actual=refuse
✓ repository-policy / accepts the current repository contracts expected=green actual=pass
```

## Guardrails for agent-written code

An agent can change more code, configuration, and documentation in one pass
than a person usually touches at once. It can also make plausible mistakes at
the same speed. A guardrail that still works tells the agent what crossed a
boundary, and the agent can act on that evidence. A guardrail that has stopped
working tells it nothing.

A stale glob, an ignored report field, or a parser that turns a crash into PASS
each breaks a guardrail this way. The pipeline then reports success while a
defect is present. The proofs on this page detect a guardrail in that state,
because its RED proof no longer breaches the Rule it names.

## Next

- **[The Contract-to-Gate method](contract-to-gate.md)** to turn a quality idea
  into a Rule, a Check, and Proofs.
- **[Gating Adapter contracts](adapter-contract-gates.md)** for the design of
  the `adapter-contracts` Gate.
- **[Command Checks](commands.md)** for everything `commands()` can do.
- **[Custom Adapter](custom-adapter.md)** for the guidelines those contracts
  enforce.

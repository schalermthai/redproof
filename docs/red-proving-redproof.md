# Redproof proves Redproof

This repository runs Redproof on itself. Six Gates hold 39 Rules and 61 Proofs.

The real CI and release workflows use these Gates. They are not a separate showcase suite.

Every push asks two questions:

```text
npm run self:check   does the repository satisfy its guardrails now?
npm run self:prove   can each guardrail still detect the defect it names?
```

The important model is:

```text
healthy repository   ──▶ same Gate ──▶ PASS
controlled defect    ──▶ same Gate ──▶ FAIL the targeted Rule
unavailable evidence ──▶ same Gate ──▶ REFUSE
```

A RED proof only succeeds when the Rule it names breaches. Any other failure is not enough.

A GREEN proof shows the healthy repository passes.

A REFUSE proof shows the Check declines to guess when its evidence is missing.

## The six Gates

```text
architecture         module graph and functional-core effect boundaries   16 Rules   25 Proofs
static-contracts     types, documentation examples, fragment budget         3 Rules    4 Proofs
test-health          every test passes, none is skipped                    2 Rules    4 Proofs
adapter-contracts    five promises every built-in Adapter keeps            5 Rules    9 Proofs
repository-policy    packages, versions, CI, documentation links, lockfile 7 Rules   10 Proofs
unused-code          files, exports, and dependencies stay connected       6 Rules    9 Proofs
```

Each Gate is one file under [`gates/`](../gates). This page shows what those files make possible.

## A Gate reads as a specification

`npm run self:describe` prints every Gate before anything runs.

This is the [`unused-code`](../gates/unused-code.ts) Gate. It is built on the Knip Adapter:

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

The Gate file is 31 lines.

A reviewer reads the promise, the defect, and the expected verdict together. Nobody has to open the Knip documentation to know what the Gate guards.

## A Gate for something no tool checks

The [`static-contracts`](../gates/static-contracts.ts) Gate makes three promises:

```text
R1 Workspace source, tests, fixtures, and self-hosted Gates must type-check.
R2 Standalone TypeScript examples in the documentation must compile.
R3 The number of documentation fragments excluded from compilation must not grow.
```

R1 is ordinary. `tsc` checks it.

R2 and R3 are not ordinary. No linter compiles a `ts` block inside a Markdown file.

Documentation examples rot. An API changes and the example on the page does not. Nobody notices until a user copies it.

R3 guards the escape hatch of R2. A block that cannot stand alone is marked `ts fragment`, and the compiler skips it.

That marker is useful. It is also the easy way out.

If it is free to add, every hard example becomes a fragment. R2 then slowly guards nothing.

The check for R2 is the script `scripts/typecheck-docs.ts`. It extracts every `ts` block, writes each one to a file, and runs `tsc` over them.

The check for R3 is a 30-line script. It counts `ts fragment` blocks against a budget.

Both scripts already exit non-zero when they find a problem. They lack three things:

```text
a Rule with a name
a REFUSE lane
a proof
```

`commands()` adds exactly those three. Each script becomes one entry.

The entry names its Rule. A failure is then a breach of that Rule, not a generic red job:

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

`commands()` also gives each script a timeout, an output limit, and the REFUSE lane.

A script that cannot start becomes REFUSE, not PASS. The Gate says which entry could not run.

The proofs are Markdown files. One holds a bad example, and one holds one more fragment than the budget allows:

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

Every `ts` block in `README.md` and `docs/` compiles. The budget for `ts fragment` blocks is 37, and it cannot grow.

The Gate that this page describes also checks this page.

## The mutation is the specification

The [`architecture`](../gates/architecture.ts) Gate protects a functional core and an imperative shell.

```text
core modules    make decisions from values
shell modules   read files, watch the clock, and supervise processes
```

A written convention is easy to break by accident. So each boundary has a mutation that crosses it.

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

Each proof names one Rule. If the change breaches a different Rule, the proof fails.

The Gate must know the difference between three kinds of leak. It is not enough to know that something went wrong.

## Two tools, one Check

The architecture Gate has 16 Rules. Thirteen come from dependency-cruiser, and three are native:

```text
R14 Functional-core modules receive ambient values from the shell.
R15 Filesystem, process, clock, randomness, and subprocess effects stay in approved boundary modules.
R16 Functional-core tests use plain values rather than filesystem, subprocess, or workspace fixtures.
```

dependency-cruiser is the right tool for the first thirteen. It sees the import graph, and an import is where a module boundary is crossed.

It is the wrong tool for the last three. A core module can leak without an import:

```text
process.cwd()   in a function body
Date.now()      in a function body
```

dependency-cruiser never looks inside a function body. A TypeScript syntax scan does.

The easy answer is two Gates. One runs dependency-cruiser, and one runs the scan.

That answer has a cost. The promise is one promise, "the functional core is pure". Two Gates split it across two files with two verdicts.

A proof for R14 would then live away from the proof for R2. Both plant a leak in the same file.

So the Gate keeps one Rule catalogue and one Check.

The Adapter Rules spread into the catalogue beside the native ones. The native Check takes the Adapter as an option and runs it first:

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

[`effectBoundaries`](../gates/checks/effect-boundaries.ts) is built on the [`scanning`](../gates/support/scanning.ts) helper. That helper has one optional `delegate`.

Here the delegate is the dependency-cruiser Check. The result carries its breaches. Then the syntax scan adds its own.

A REFUSE from either side wins. A half-answer about purity is not an answer.

`redproof describe` prints the two as one:

```text
Check:
  enforce source dependencies and functional-core effect boundaries
```

The approved effect boundaries are a list of 28 files in [`effects-model.ts`](../gates/support/effects-model.ts).

A new file that reads the filesystem must join that list on purpose, in a reviewed change. The proof creates such a file and expects R15 to breach.

## The test runner describes itself

The [`test-health`](../gates/test-health.ts) Gate runs every test file under `node --test`. It reads the JUnit report through `@redproof/testing`.

The file list depends on the workspace. So the Gate builds the arguments per run:

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

`redproof describe` prints the description. The sentence cannot drift from the real command:

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

## The guards are guarded

An Adapter can return the right TypeScript shape and still be unsafe:

```text
it accepts invalid options
it turns a crashed tool into PASS
it drops a finding it should report
```

The [`adapter-contracts`](../gates/adapter-contracts.ts) Gate holds five promises for every built-in Adapter.

Its mutations edit the production source of an Adapter with `locate.text`. Then they expect the contract suite to notice:

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

Each promise runs twice. The original contract suite runs, and the package-owned [`@redproof/adapter-tck`](../packages/adapter-tck/README.md) registration runs beside it.

That is ten commands for five Rules, in parallel.

The REFUSE proof writes 4 MB of output against a 1 MB budget. The Gate refuses instead of reading a partial result.

Real-tool fixtures then prove the same promises with ESLint, dependency-cruiser, Stryker, and Vitest against representative projects. The dependency direction stays clean:

```text
Adapter production ──▶ redproof
Adapter tests      ──▶ @redproof/adapter-tck ──peer/types──▶ redproof
root Gate          ──▶ package-owned TCK tests
```

The diagram states three things:

```text
Redproof does not depend on the TCK.
Adapter production does not import the TCK.
The TCK does not import built-in Adapters.
```

Two of those statements have a proof. The architecture Gate plants a TCK import in Adapter source. The repository-policy Gate adds the TCK to the redproof dependencies.

Both must breach.

## The release is a Rule

Dogfooding is not convincing if it protects source code but not what users install.

The [`repository-policy`](../gates/repository-policy.ts) Gate reads:

```text
the package manifests
the release scripts
both workflows
every Markdown link
the lockfile
```

Its mutations are the release mistakes a team makes:

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

The `npm publish` mutation records a real incident. The 0.12.0 release published nothing.

npm reads a bare `artifacts/x.tgz` as the GitHub shorthand `github:artifacts/x.tgz`. The Rule now pins `npm publish "./$TARBALL"`.

The release workflow packs every publishable package and installs the tarballs into a clean consumer. It then verifies:

```text
runtime imports
published types
CLI behaviour
package contents
internal links
```

The same verified tarballs are attached to the workflow run and passed to `npm publish`. Nothing is rebuilt afterward.

See the [publish workflow](../.github/workflows/publish.yml).

## CI discovers the Gates

The [CI workflow](../.github/workflows/ci.yml) does not keep a list of Gates.

A `discover` job lists `gates/*.ts`. A matrix job then runs the proofs of one Gate per leg:

```text
discover ──▶ proofs (architecture)
         ──▶ proofs (static-contracts)
         ──▶ proofs (test-health)
         ──▶ proofs (adapter-contracts)
         ──▶ proofs (repository-policy)
         ──▶ proofs (unused-code)
```

A new Gate file joins CI by existing. There is no hand-written list to forget.

The `repository-policy` Gate then checks the run line of each leg. It must be exactly:

```text
npm run check:proofs -- gates/${{ matrix.gate }}.ts
```

Quality checks, the proof legs, and clean-consumer package verification start together and report separately. A slow proof does not hold the other layers.

## REFUSE is a first-class outcome

Three Gates carry a REFUSE proof. Each removes the evidence the Check needs:

```text
unused-code          write  knip.json  as  { invalid
repository-policy    rename  .github/workflows/ci.yml
adapter-contracts    write 4 MB to stdout inside a 1 MB budget
```

None of those becomes PASS. None becomes a false product defect.

The Gate says it could not decide.

## Proofs run in copies

Proofs run in isolated project copies. `redproof.config.ts` sets:

```text
execution: { mode: 'copies', maxAtOnce: 4 }
```

A mutation can delete a workflow, corrupt a lockfile, or edit Adapter source. The working tree stays untouched.

Redproof checks that each copy returns to its baseline before it is reused. A proof that leaves a file behind refuses with `workspace-not-restored`.

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

The complete delivery check adds types, documentation examples, native tests, and the real-tool fixtures:

```bash
npm run check
```

The proof report puts the claim and the outcome side by side:

```text
✓ architecture / detects a production dependency cycle expected=red actual=fail
✓ adapter-contracts / refuses when a contract suite floods its output budget expected=refuse actual=refuse
✓ repository-policy / accepts the current repository contracts expected=green actual=pass
```

## Why this matters when agents write code

An agent can change more code, configuration, and documentation in one pass than a person usually touches at once. It can also make plausible mistakes at the same speed.

A guardrail that still works tells the agent what crossed a boundary. It gives evidence the agent can act on.

A guardrail that has quietly stopped working tells it nothing. Each of these makes a pipeline confidently wrong:

```text
a stale glob
an ignored report field
a parser that turns a crash into PASS
```

The proofs on this page exist so that cannot happen in silence.

## Next

- **[The Contract-to-Gate method](contract-to-gate.md)** to turn a quality idea
  into a Rule, a Check, and Proofs.
- **[Gating Adapter contracts](adapter-contract-gates.md)** for the design of
  the `adapter-contracts` Gate.
- **[Command Checks](commands.md)** for everything `commands()` can do.
- **[Custom Adapter](custom-adapter.md)** for the guidelines those contracts
  enforce.

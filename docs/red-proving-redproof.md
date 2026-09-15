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

- [Executable specification](#executable-specification). `redproof describe` prints the
  Rules, the Check, and every Proof before anything runs.
- [Custom check for each Rule](#custom-check-for-each-rule). When no tool
  checks a Rule, a small script does, and `commands()` gives each script a
  Rule and a proof.
- [One mutation per boundary](#one-mutation-per-boundary). Each boundary has
  a mutation that crosses it, and each proof must breach the one Rule it names.
- [Multiple checks composition](#multiple-checks-composition). One Check runs
  another Check first and carries its result, so one Gate holds Rules from
  several sources and gives one verdict.
- [Self-describing runner](#self-describing-runner). A runner builds its
  arguments per run, and its description comes from the same option.
- [Guidelines as guardrails](#guidelines-as-guardrails). The five custom
  Adapter guidelines become five Rules with proofs, and a TCK makes them
  reusable by any Adapter.
- [Release policy as Rules](#release-policy-as-rules). Release mistakes
  become mutations, including one from a real incident.
- [Gate discovery](#gate-discovery). CI lists the Gate files
  itself, and a Rule pins the command each leg runs.

## Executable specification

Executable specification is the pattern where the Gate file is the
specification. The same file that runs the Check also prints the promise, the
defect, and the expected verdict, so the two cannot drift apart.

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

## Custom check for each Rule

Custom check for each Rule is the pattern for a Rule that no existing tool
checks. You write a small script that exits non-zero when the Rule is broken.
`commands()` then binds each script to its Rule, so the script gains a proof
and a REFUSE when it cannot run.

The [`static-contracts`](../gates/static-contracts.ts) Gate uses this pattern.
It makes three promises:

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

## One mutation per boundary

One mutation per boundary is the pattern where every architectural rule has a
proof that crosses that exact boundary. The proof names one Rule, so the Gate
must tell the boundaries apart.

The [`architecture`](../gates/architecture.ts) Gate uses this pattern. It
protects a functional core and an imperative shell. Core modules make decisions from values. Shell modules
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

## Multiple checks composition

Multiple checks composition is the pattern where one Check runs other Checks
and merges their results. The Rules of every source sit in one catalogue, and
the Gate gives one verdict. A breach from any source is a breach of the Gate,
and a REFUSE from any source is a REFUSE of the Gate.

The architecture Gate uses this pattern. It has 16 Rules. Thirteen come from
dependency-cruiser, and three are native:

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

## Self-describing runner

Self-describing runner is the pattern where a runner builds its description
and its arguments from the same option. `redproof describe` then prints a
sentence that always matches the real command.

The [`test-health`](../gates/test-health.ts) Gate uses this pattern. It runs
every test file under `node --test`. It reads the JUnit report through
`@redproof/testing`. The file list depends on the workspace, so the runner
builds the arguments per run. The runner lives in
[`gates/checks/node-test-suite.ts`](../gates/checks/node-test-suite.ts), and
the Gate file passes it to `testing()`:

```ts
import { globSync } from 'node:fs';
import { report, runner, testing, type TestRunner } from '@redproof/testing';
import { defineGate } from 'redproof';

function nodeTestSuite(options: { readonly files: string }): TestRunner {
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

const adapter = testing({
  runner: nodeTestSuite({ files: '{tests,packages/*/test}/**/*.test.ts' }),
  report: report.junitXml(),
  rules: {
    testsPass: true,
    noSkippedTests: true,
  },
});

export default defineGate({ id: 'test-health', adapter });
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

## Guidelines as guardrails

Guidelines as guardrails is the pattern where a written guideline becomes a
Rule with a proof. Without Redproof, a guideline stays in a playbook. A
reviewer may remember it or not, and nothing fails when new code ignores it.
As a Gate, the guideline runs on every check and has a proof that it still
detects a violation.

The [Custom Adapter](custom-adapter.md#guidelines) page lists five guidelines
for an Adapter author:

```text
1. Validate options in the constructor and throw
2. Give your runner a result union with an unavailable case
3. Keep the parser pure and let it throw on untrusted structure
4. Declare capabilities on the report format
5. Emit a Breach only from structured evidence
```

An Adapter can return the right TypeScript shape and still break one of them.
It can accept invalid options, turn a crashed tool into PASS, or drop a finding
it should report. The [`adapter-contracts`](../gates/adapter-contracts.ts) Gate
turns the five guidelines into five Rules. Its mutations edit the production
source of an Adapter with `locate.text`, and then they expect the contract
suite to notice:

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

The contract suites in `tests/adapters/` check the built-in Adapters of this
repository. An Adapter written elsewhere cannot use them. So the same five
contracts are also packaged as
[`@redproof/adapter-tck`](../packages/adapter-tck/README.md). A TCK is a
technology compatibility kit. An Adapter author installs it, registers the
Adapter with `runAdapterTck`, and gets the five contracts as tests beside the
Adapter's own tests.

## Release policy as Rules

Release policy as Rules is the pattern where the files that control a release
are inputs to a Check. Those files are the package manifests, the release
scripts, the CI and publish workflows, and the lockfile. A release mistake is
then a Rule with a proof, like a defect in source code.

The [`repository-policy`](../gates/repository-policy.ts) Gate uses this
pattern. It has seven Rules:

```text
R1 Every publishable package participates in every build and release stage.
R2 All packages share one version and internal Redproof dependencies use it exactly.
R3 Internal package dependencies follow the core, TCK, and Adapter layers.
R4 Public runtime, type, binary, subpath, and schema surfaces are source-backed and declared.
R5 CI and publishing retain self-check, proof, build, and consumer verification.
R6 Repository and skill documentation cannot point to missing local files.
R7 The lockfile records every optional dependency its packages declare, so no platform binary silently disappears.
```

Each proof makes one release mistake and expects the matching Rule to breach:

```text
R1  misspell 'packages/testing' in the package list of scripts/set-version.ts
R2  set one package.json to "0.6.1" while the others say "0.12.0"
R3  add "@redproof/adapter-tck" as a dependency of the redproof package
R4  rename the "schema" entry in the package.json files list to "schema-off"
R5  remove the line "run: npm run verify:package" from ci.yml
R5  write  npm publish "$TARBALL"  instead of  npm publish "./$TARBALL"
R6  create a Markdown file that links to ./definitely-missing.md
R7  delete lightningcss-linux-x64-gnu from package-lock.json
```

The second R5 proof records a real incident. The 0.12.0 release published
nothing. npm reads a bare path such as `artifacts/x.tgz` as the GitHub
shorthand `github:artifacts/x.tgz`, so the publish step never opened the
tarball. The Rule now requires the exact text `npm publish "./$TARBALL"` in the
publish workflow.

The REFUSE proof renames `.github/workflows/ci.yml`. The Gate cannot read one
of its inputs, so it refuses instead of passing.

The [publish workflow](../.github/workflows/publish.yml) is what R5 protects.
It packs every publishable package into a tarball and installs those tarballs
into an empty project. In that project it checks that the packages import,
that their types resolve, that the CLI runs, that the package contents are
right, and that internal links resolve. The same tarballs are attached to the
workflow run and passed to `npm publish`. Nothing is rebuilt after the checks.

## Gate discovery

Gate discovery is the pattern where CI finds the Gate files itself instead of
keeping a list. A new Gate cannot be left out of CI, and a Rule pins the
command that each CI leg runs.

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

A coding agent writes code fast. In one pass it can change source files,
configuration, and documentation. It can also make a mistake in each of them
at the same speed. So the checks that run after each change matter more, not
less. The agent reads a failed check and fixes the code. That loop only works
when the check still fails on a real mistake.

A check can stop working without anyone noticing. Three examples:

```text
the file pattern in a lint config no longer matches a new source directory
a test report changed its format, and the reader now sees zero failures
a tool crashes, and the script that reads its output reports success
```

In each case the check still prints green. The agent sees green and moves on.
The mistake ships.

The RED proofs on this page catch this. A RED proof plants a known mistake and
expects the check to fail. When the check has stopped working, the RED proof
fails instead. The team learns that the guardrail is broken before the agent
relies on it.

Run `redproof check` when the agent ends a turn, for example from a Stop hook.
In this repository the full check takes about 16 seconds. Do not run it after
every file edit. Run `redproof prove` in CI, and run it for one Gate file when
the agent has edited that file:

```bash
npx redproof prove gates/architecture.ts
```

This repository ships that hook for Claude Code in
[`.claude/settings.json`](../.claude/settings.json):

```json
{
  "hooks": {
    "Stop": [
      {
        "hooks": [
          {
            "type": "command",
            "timeout": 120,
            "command": "input=$(cat); case \"$input\" in *'\"stop_hook_active\":true'*|*'\"stop_hook_active\": true'*) exit 0;; esac; out=$(npm run -s self:check 2>&1) && exit 0; printf '%s\\n' \"$out\" >&2; exit 2"
          }
        ]
      }
    ]
  }
}
```

The hook exits 0 when every Gate passes, and the turn ends. When a Gate
fails, the hook prints the Redproof report to stderr and exits 2. Exit 2 keeps
the turn open and hands the report to the agent, so it sees the breached Rule
and its location. The first line reads the `stop_hook_active` field. When that
field is true, the hook exits at once, so a blocked stop does not run the check
a second time.

## Next

- **[The Contract-to-Gate method](contract-to-gate.md)** to turn a quality idea
  into a Rule, a Check, and Proofs.
- **[Gating Adapter contracts](adapter-contract-gates.md)** for the design of
  the `adapter-contracts` Gate.
- **[Command Checks](commands.md)** for everything `commands()` can do.
- **[Custom Adapter](custom-adapter.md)** for the guidelines those contracts
  enforce.

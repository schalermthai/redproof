# Redproof Proves Redproof

Redproof uses Redproof to protect its own repository.

This page has two goals:

1. **Show what Redproof looks like in a real project.**
2. **Share patterns you can reuse in your own repository.**

The Redproof repository protects things such as:

- architecture boundaries
- TypeScript and documentation examples
- test health
- Adapter behavior
- package and dependency policy
- CI and release workflows
- unused files, exports, and dependencies

But the repository does more than check that those things are healthy today.

It deliberately breaks them and verifies that the corresponding Gate detects the defect.

```text
healthy repository
        ↓
     same Gate
        ↓
       PASS

controlled defect
        ↓
     same Gate
        ↓
targeted Rule FAILS

unavailable evidence
        ↓
     same Gate
        ↓
      REFUSE
```

That gives Redproof two useful questions:

```bash
npm run self:check
```

> Does the repository satisfy its guardrails right now?

and:

```bash
npm run self:prove
```

> Can those guardrails still detect the defects they claim to protect against?

The examples below come from Redproof itself, but the patterns are general. You can apply them to architecture, releases, security rules, API contracts, documentation, workflows, or almost any other engineering promise.

---

## What Redproof protects

The repository currently has six self-hosted Gates:

| Gate | What it protects |
| --- | --- |
| `architecture` | module boundaries and functional-core effect boundaries |
| `static-contracts` | TypeScript, documentation examples, and unchecked-fragment debt |
| `test-health` | tests pass and are not skipped |
| `adapter-contracts` | behavioral contracts for built-in Adapters |
| `repository-policy` | packages, versions, CI, release, documentation, and lockfile policy |
| `unused-code` | unused files, exports, dependencies, and unresolved imports |

The [Gate files](../redproof.config.ts) live under:

```text
gates/
```

and contains:

```text
Rules
  +
Check
  +
Proofs
```

Together, the Gates act as an executable specification of the repository.
The excerpts below are simplified examples; the linked Gate files remain the
source of truth for exact options and proof portfolios.

---

## Example 1: Make the Gate explain itself

Before running a Gate, Redproof can describe what it protects:

```bash
npm run self:describe
```

For example, the `unused-code` Gate is built on the Knip Adapter.

A simplified description looks like this:

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

The important part is that the specification and the implementation live together.

A reviewer can see:

```text
what must remain true
        ↓
how it is checked
        ↓
how the Gate is deliberately broken
        ↓
what verdict is expected
```

without first learning the underlying tool.

### Pattern to borrow: make guardrails executable specifications

A Gate should explain more than:

```text
run this command
```

Try to make it answer:

```text
What is the promise?
What evidence checks it?
What defect proves the guardrail works?
What verdict should that defect produce?
```

This makes the Gate useful to both CI and human reviewers.

---

## Example 2: Turn existing commands into Rules

Not every important contract needs a custom Adapter.

Sometimes the evidence already exists as a command.

The [`static-contracts` Gate](../gates/static-contracts.ts) protects three promises:

```text
R1 Workspace source, tests, fixtures, and self-hosted Gates must type-check.

R2 Standalone TypeScript examples in the documentation must compile.

R3 The number of documentation fragments excluded from compilation must not grow.
```

The first Rule uses normal TypeScript compilation.

```text
tsc
 ↓
R1
```

The other two Rules use small repository scripts.

Every standalone TypeScript example in `README.md` and `docs/` is extracted and compiled.

That protects documentation against API changes such as:

```text
API changes
    ↓
old documentation example stops compiling
    ↓
static/docs-examples-compile FAILS
```

Some existing snippets are marked `ts fragment` and excluded from compilation.
The current repository budget is 36 fragments.

Those fragments are useful, but every fragment is also one example outside the compiler's protection.

So the repository keeps a budget:

```text
current fragment count
        ≤
accepted fragment budget
```

The count may not exceed that ceiling. If it goes down, lower the budget in a
reviewed change to prevent unchecked examples from growing back.

The Gate combines all three commands:

```ts
import { defineGate, defineRules } from 'redproof';
import { commands } from 'redproof/command';

const rules = defineRules({
  workspaceCompiles: {
    id: 'static/workspace-compiles',
    description:
      'Workspace source, tests, fixtures, and self-hosted Gates must type-check.',
  },

  docsExamplesCompile: {
    id: 'static/docs-examples-compile',
    description:
      'Standalone TypeScript examples in the documentation must compile.',
  },

  docsFragmentDebt: {
    id: 'static/docs-fragment-debt-does-not-grow',
    description:
      'The number of documentation fragments excluded from compilation must not grow.',
  },
});

export default defineGate({
  id: 'static-contracts',

  rules,

  check: commands({
    mode: 'parallel',
    maxAtOnce: 3,

    entries: [
      {
        rule: rules.workspaceCompiles,
        command: process.execPath,
        args: [
          'node_modules/typescript/bin/tsc',
          '--noEmit',
        ],
      },

      {
        rule: rules.docsExamplesCompile,
        command: process.execPath,
        args: [
          '--experimental-strip-types',
          'scripts/typecheck-docs.ts',
        ],
      },

      {
        rule: rules.docsFragmentDebt,
        command: process.execPath,
        args: [
          '--experimental-strip-types',
          'gates/support/check-doc-fragment-budget.ts',
        ],
      },
    ],
  }),
});
```

The RED proofs create exactly the bad inputs those commands should reject.

For example:

```text
Proof:
  create a documentation example that does not compile

Expected:
  static/docs-examples-compile FAILS
```

and:

```text
Proof:
  create enough unchecked fragments to exceed the budget

Expected:
  static/docs-fragment-debt-does-not-grow FAILS
```

If one of the commands cannot execute reliably, the Gate returns `REFUSE` rather than pretending the Rule passed.

### Pattern to borrow: reuse evidence you already trust

If you already have:

```text
compiler
linter
repository script
schema validator
security scanner
artifact checker
```

you may not need a new integration.

Bind the command to a named Rule and add a proof that deliberately makes the command detect the problem.

The useful upgrade is:

```text
command
```

becoming:

```text
named Rule
  +
clear failure
  +
REFUSE behavior
  +
RED proof
```

---

## Example 3: Prove one architecture boundary at a time

The [`architecture` Gate](../gates/architecture.ts) protects Redproof's functional core and imperative shell.

Core modules should make decisions from values.

Shell modules are allowed to:

```text
read files
watch the clock
inspect process state
run subprocesses
```

A written architecture rule is easy to violate accidentally.

So Redproof gives each boundary its own Rule and its own mutation.

Three different proofs can even modify the same source file:

```text
import 'node:fs/promises'
        ↓
architecture/core-no-effect-imports

void process.cwd()
        ↓
architecture/core-no-ambient-inputs

import '../shell/worker-process.ts'
        ↓
architecture/core-no-shell
```

The important part is that each proof names one Rule.

If this mutation:

```ts
import 'node:fs/promises';
```

causes some unrelated TypeScript Rule to fail but the architecture Rule stays green, the proof does not succeed.

A RED proof is not:

> Make something fail.

It is:

> Introduce this specific defect and verify that this specific Rule detects it.

### Pattern to borrow: make proof mutations causal

A good proof mutation changes the behavior named by the Rule.

For example:

```text
Architecture Rule
  → add forbidden dependency

Skipped-test Rule
  → add skipped test

Release Rule
  → damage release command

Documentation Rule
  → add invalid documentation example
```

Avoid mutations such as:

```text
introduce syntax error
delete random configuration file
make the program crash
```

unless that is the actual contract you are proving.

The closer the mutation is to the promise, the more useful the proof is.

---

## Example 4: Combine evidence sources when one tool cannot see enough

One tool does not always have enough information to prove the whole contract.

The `architecture` Gate is an example.

Most architecture Rules use dependency-cruiser.

That works well for module relationships:

```text
module A
   ↓ imports
module B
```

But dependency-cruiser only sees dependency edges.

It cannot detect code such as:

```ts
process.cwd();
Date.now();
```

Those expressions can violate the functional-core contract without creating an import.

So Redproof combines two evidence sources:

```text
dependency-cruiser
        +
TypeScript syntax scan
        ↓
one architecture Gate
```

The dependency graph checks module boundaries.

The syntax scan checks ambient process access and other effectful behavior inside the source.

The Rules still live in one catalogue:

```ts
import { dependencyCruiser } from '@redproof/dependency-cruiser';
import { defineRule } from 'redproof';

const dependencies = dependencyCruiser({
  configFile: '.dependency-cruiser.cjs',
  files: ['packages'],
  rules: { coreNoShell: 'core-no-shell' },
});

const rules = {
  ...dependencies.rules,

  coreNoAmbientInputs: defineRule({
    id: 'architecture/core-no-ambient-inputs',
    description: 'Functional-core modules receive ambient values from the shell.',
  }),

  effectsAllowlistedBoundaries: defineRule({
    id: 'architecture/effects-allowlisted-boundaries',
    description: 'Effects stay in approved boundary modules.'
  }),

  coreTestsNoIoHelpers: defineRule({
    id: 'architecture/core-tests-no-io-helpers',
    description: 'Functional-core tests use plain values instead of I/O helpers.'
  }),
};
```

The resulting Gate presents one contract:

```text
the functional core stays pure
```

even though multiple checks contribute evidence.

If one required evidence source cannot run, the Gate returns `REFUSE`.

It does not give a confident verdict from only half of the evidence.

### Pattern to borrow: compose evidence around the promise

Choose tools based on what they can observe.

Do not force one tool to represent the whole contract.

For example:

```text
dependency graph
     +
source scan

API response
     +
database state

manifest inspection
     +
artifact inspection

static analysis
     +
runtime test
```

can all contribute to one Gate when the promise genuinely requires both.

The Rule should describe the contract.

The checks are implementation details used to establish it.

---

## Example 5: Keep descriptions tied to real execution

The [`test-health` Gate](../gates/test-health.ts) runs Redproof's test suite through the generic testing Adapter.

The set of test files is configurable.

Instead of separately maintaining:

```text
description shown to humans
```

and:

```text
arguments actually executed
```

the runner derives both from the same option.

For example:

```ts
import { globSync } from 'node:fs';
import { report, runner, testing, type TestRunner } from '@redproof/testing';
import { defineGate } from 'redproof';

function nodeTestSuite(options: {
  readonly files: string;
}): TestRunner {
  return runner.command({
    command: process.execPath,

    description:
      `run ${options.files} under node --test with a JUnit report`,

    args: ctx => [
      '--experimental-strip-types',
      '--test',
      '--test-reporter=junit',
      `--test-reporter-destination=${ctx.reportFile}`,
      ...globSync(options.files, {
        cwd: ctx.root,
      }).sort(),
    ],
  });
}

// Enable the policies the JUnit report can establish.
const adapter = testing({
  runner: nodeTestSuite({
    files: '{tests,packages/*/test,agents/tests}/**/*.test.ts',
  }),

  report: report.junitXml(),

  rules: {
    testsPass: true,
    noSkippedTests: true,
  },
});

export default defineGate({ id: 'test-health', adapter });
```

A proof introduces a real skipped test:

```text
create a collected skipped test
        ↓
same test runner
        ↓
noSkippedTests FAILS
```

The description produced by `redproof describe` and the actual execution both come from the same `files` value.

### Pattern to borrow: derive documentation from execution configuration

Whenever possible:

```text
description
arguments
scope
```

should come from the same configuration.

Avoid separately maintaining:

```text
"Checks all packages"
```

while the real command gradually changes to:

```text
only checks packages/a
```

This pattern is especially useful for:

- test runners
- workspace selectors
- linters
- scanners
- release commands

---

## Example 6: Turn engineering guidelines into guardrails

Some contracts begin as prose.

For example, Redproof's Adapter guidance says an Adapter should:

```text
validate constructor options

represent unavailable execution explicitly

keep evidence parsing pure

declare report capabilities accurately

create Breaches from structured evidence
```

Without an executable guardrail, those remain review guidelines.

A contributor might remember them.

Or not.

The [`adapter-contracts` Gate](../gates/adapter-contracts.ts) turns those guidelines into Rules.
Its TCK registrations cover ESLint, dependency-cruiser, Stryker, generic testing,
and Vitest; original suites also cover runner behavior. Pure-model scenarios
verify evidence translation, while real-tool fixtures cover integration wiring.

For example:

```text
Guideline:
Unknown Adapter options must be rejected.

Proof mutation:
Remove unknown-option validation.

Expected:
adapters/options-validated-at-construction FAILS.
```

Another proof changes:

```text
kind: 'unavailable'
```

so a runner failure enters the wrong evidence lane.

The corresponding Rule must detect it.

Another deliberately makes a report format claim capabilities it does not really provide.

Another removes structured findings from evidence translation.

The same contracts are also packaged in:

```text
@redproof/adapter-tck
```

so Adapter authors outside the Redproof repository can reuse them.

### Pattern to borrow: turn important review guidance into executable contracts

If your team repeatedly says:

```text
"Remember to..."
"Always make sure..."
"Never allow..."
"Reviewers should check..."
```

that may be a candidate for a Rule.

Ask:

```text
Can we state the promise precisely?

Can we produce evidence for it?

Can we deliberately violate it?

Can a Gate detect that violation?
```

If yes, the guideline can become a guardrail instead of relying only on reviewer memory.

---

## Example 7: Turn release policy into Rules

Release configuration is production code.

A typo in a workflow or package list can break a release just as effectively as a bug in application source.

The [`repository-policy` Gate](../gates/repository-policy.ts) protects things such as:

```text
every publishable package participates in the release

all packages share one version

internal package dependencies follow the intended layers

public package surfaces are correctly declared

CI retains required verification

documentation links resolve

optional dependencies remain represented in the lockfile
```

Each policy has a proof that introduces one realistic release defect.

Examples include:

```text
misspell one package in the release package list
```

```text
give one package the wrong version
```

```text
add a dependency in the wrong package layer
```

```text
remove required consumer verification from CI
```

```text
add a broken documentation link
```

```text
delete a required optional dependency from package-lock.json
```

One proof came from a real release incident.

The publish workflow needed:

```bash
npm publish "./$TARBALL"
```

but used:

```bash
npm publish "$TARBALL"
```

The 0.12.0 release published nothing.

Instead of keeping that lesson only in documentation or team memory, the repository now has a Rule protecting the exact behavior.

The proof changes the correct command back to the broken one and requires the Rule to fail.

The [publish workflow](../.github/workflows/publish.yml) also verifies packed
tarballs in a clean consumer project before publishing those same artifacts.
This checks imports, types, CLI behavior, and package contents at the delivery
boundary rather than relying only on source checks.

```text
past production incident
        ↓
Rule
        ↓
controlled mutation
        ↓
permanent regression guard
```

### Pattern to borrow: turn incidents into RED proofs

When a real defect reaches CI, staging, or production, fixing the code is only one part of the response.

Also ask:

> What guardrail should have caught this?

Then capture the incident as:

```text
promise
  +
Rule
  +
mutation that recreates the failure
```

This is especially useful for problems in:

- release workflows
- migrations
- manifests
- package configuration
- infrastructure
- security boundaries
- compatibility contracts

Instead of:

```text
"Don't make this mistake again."
```

you get:

```text
"This mistake now has an executable proof."
```

---

## Example 8: Make new Gates join CI automatically

A new Gate should not depend on someone remembering to add it to a second CI configuration.

The [CI workflow](../.github/workflows/ci.yml) discovers the Gate files itself.

Conceptually:

```text
gates/*.ts
    ↓
discover
    │
    ├── architecture
    ├── static-contracts
    ├── test-health
    ├── adapter-contracts
    ├── repository-policy
    └── unused-code
```

CI then creates one proof job for each Gate.

The proof command is:

```bash
npm run check:proofs -- gates/${{ matrix.gate }}.ts
```

Adding another Gate file therefore adds another proof leg automatically.

There is no separate list of Gate names to maintain.

The `repository-policy` Gate also protects the CI command itself.

That gives two layers:

```text
CI discovers every Gate
        +
a Rule verifies how each Gate is executed
```

### Pattern to borrow: eliminate registration steps

Whenever possible, make new guardrails participate automatically.

For example, discover:

```text
gate files
schema files
migration files
package directories
test fixtures
policy definitions
```

instead of maintaining another hand-written list.

This removes a common failure mode:

```text
new protection exists
        ↓
but nobody added it to CI
        ↓
protection never runs
```

---

## RED, GREEN, and REFUSE are three different properties

The self-hosted suite uses all three proof types.

They answer different questions.

### RED

A controlled defect must breach the named Rule.

```text
introduce forbidden dependency
        ↓
architecture/core-no-shell FAILS
```

RED answers:

> Can this guardrail detect the defect it claims to protect against?

---

### GREEN

The maintained repository must pass.

```text
healthy repository
        ↓
PASS
```

GREEN answers:

> Can this guardrail accept a healthy project?

Without GREEN coverage, an over-strict Gate could look effective simply because it always fails.

---

### REFUSE

The Gate must decline to guess when required evidence cannot be trusted.

```text
required report missing
        ↓
REFUSE
```

REFUSE answers:

> Does the Gate avoid inventing a PASS or FAIL when it cannot establish the truth?

Together:

```text
RED
Can the Gate detect a violation?

GREEN
Can the Gate accept the healthy state?

REFUSE
Can the Gate avoid guessing?
```

### Pattern to borrow: test all three evidence lanes

A useful guardrail should not only know how to reject bad states.

It should also know:

```text
when to accept
```

and:

```text
when it does not have enough evidence to decide
```

That distinction becomes especially important when Checks depend on:

- external commands
- reports
- APIs
- files
- network services
- generated artifacts

---

## Is self-proving circular?

Redproof is not proving itself correct simply because Redproof says it is correct.

Each proof changes an input that exists independently of the Gate.

For example:

```text
healthy source
    ↓
architecture Gate
    ↓
PASS
```

Then:

```text
add forbidden import
    ↓
same architecture Gate
    ↓
targeted Rule FAILS
```

Or:

```text
healthy workflow
    ↓
repository-policy Gate
    ↓
PASS
```

Then:

```text
remove required verification step
    ↓
same repository-policy Gate
    ↓
targeted Rule FAILS
```

The mutation creates an observable change in the repository.

The same Gate must distinguish the healthy state from the defective state.

That is the useful part of self-hosting. It establishes sensitivity to the
selected defects, not correctness for every possible failure. The engine,
mutation definitions, and external tools still require their own tests and
independent review.

---

## Patterns worth borrowing

You do not need to copy Redproof's repository structure to use these ideas.

The reusable patterns are:

### 1. Make important promises explicit

Give each important expectation a stable Rule identity.

```text
"Architecture should be clean"
```

is harder to protect than:

```text
"Domain code must not import infrastructure."
```

---

### 2. Reuse evidence you already trust

Existing tools and scripts are often enough.

```text
compiler
linter
test runner
dependency analyzer
repository script
```

can become Rule evidence without rewriting them.

---

### 3. Make mutations causal

Break the exact behavior the Rule protects.

```text
Rule:
Tests must not be skipped.

Mutation:
Add a skipped test.
```

is stronger than:

```text
Mutation:
Break test configuration so nothing runs.
```

---

### 4. Turn incidents into regression guards

When something escapes, capture the lesson as:

```text
Rule
  +
proof mutation
```

rather than only a comment or checklist item.

---

### 5. Compose evidence around the contract

Use more than one Check when the promise requires more than one kind of observation.

Do not make the contract weaker just because one tool cannot see everything.

---

### 6. Keep execution and description together

Generate human-readable descriptions from the same configuration that controls the real command.

That reduces documentation drift.

---

### 7. Turn recurring review guidance into Rules

If reviewers repeatedly need to remember the same invariant, investigate whether it can become executable.

---

### 8. Treat delivery configuration as production code

CI, release scripts, package manifests, documentation links, and lockfiles can all cause production failures.

They can have Rules and proofs too.

---

### 9. Remove manual registration

Make new Gates automatically join CI whenever possible.

A guardrail that exists but never runs is not much of a guardrail.

---

### 10. Test RED, GREEN, and REFUSE separately

A trustworthy Gate should demonstrate that it can:

```text
reject a real violation
accept the healthy project
refuse when evidence is unsafe
```

Those are three different behaviors.

---

## Try the same approach in your repository

You do not need six Gates or dozens of Rules to start.

Pick one engineering promise that matters.

For example:

```text
The API package never imports application infrastructure.
```

Then:

```text
1. Give the promise a Rule.

2. Find evidence that can check it.

3. Make the healthy repository PASS.

4. Deliberately violate the promise.

5. Require the target Rule to FAIL.

6. Decide what should happen when the evidence is unavailable.
```

That is the core loop:

```text
promise
   ↓
Rule
   ↓
evidence
   ↓
healthy baseline
   ↓
controlled defect
   ↓
proof
```

Once that works, add the next promise.

Redproof's own repository grew the same way: one useful contract at a time.

---

## Run the Redproof self-hosted suite

Describe the Gates:

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

The proof report puts the claim and outcome side by side:

```text
✓ architecture / detects a production dependency cycle
  expected=red
  actual=fail

✓ adapter-contracts / refuses when a contract suite floods its output budget
  expected=refuse
  actual=refuse

✓ repository-policy / accepts the current repository contracts
  expected=green
  actual=pass
```

For the complete repository verification:

```bash
npm run check
```

This adds the broader delivery checks around the self-hosted Gates, including types, documentation examples, native tests, and real-tool fixtures.
CI runs package-consumer verification as a separate job; run
`npm run build && npm run verify:package` locally for that layer.

---

## Next

- [The Contract-to-Gate method](./contract-to-gate.md) — turn an engineering promise into a Rule, Check, and Proofs.
- [Adapter Contract Gates](./adapter-contract-gates.md) — see how Adapter guidelines become reusable executable contracts.
- [Command Checks](./commands.md) — turn existing commands and scripts into Rule evidence.
- [Custom Adapter](./custom-adapter.md) — build an integration when an existing Adapter is not enough.
- [Guardrails for agent-written code](./agent-guardrails.md) — apply Redproof to agent-assisted development workflows.

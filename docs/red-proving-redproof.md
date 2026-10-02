# Redproof proves Redproof

This repository uses Redproof to check Redproof itself.

The important idea is that Redproof does two different jobs.

```bash
npm run self:check
```

checks whether the repository follows its guardrails **right now**.

```bash
npm run self:prove
```

checks whether those guardrails can still detect the problems they claim to detect.

That difference matters.

A repository can be healthy even when one of its checkers is broken. If there is currently no bad code for that checker to find, the broken checker may still appear to pass.

So Redproof does not only test healthy code.

It deliberately creates known defects and asks the same Gate to detect them.

The basic model is:

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
FAIL the targeted Rule

missing evidence
       ↓
    same Gate
       ↓
     REFUSE
```

This gives Redproof three important proof states.

**GREEN** means known-good code passes.

**RED** means a controlled defect causes the intended Rule to breach.

**REFUSE** means the Check does not have enough trustworthy evidence to decide.

A RED proof is strict.

If a proof targets R3, then R3 must breach. A random failure somewhere else does not count.

So the question is not simply:

> Did something fail?

It is:

> Did the correct Rule detect the exact defect it was designed to detect?

---

# The six Gates

Redproof currently protects the repository with six Gates.

| Gate | What it protects |
|---|---|
| `architecture` | Module relationships and functional-core effect boundaries |
| `static-contracts` | TypeScript and documentation contracts |
| `test-health` | Passing tests and skipped tests |
| `adapter-contracts` | Contracts every built-in Adapter must follow |
| `repository-policy` | Packages, versions, CI, releases, documentation, and lockfiles |
| `unused-code` | Reachability, exports, dependencies, and imports |

Each Gate is a real source file under:

```text
gates/
```

A Gate normally contains:

```text
Rules
  +
Check
  +
Proofs
```

The rest of this page shows the main patterns used by those Gates.

---

# 1. Executable specification

**Executable specification** is the pattern where the Gate file is the specification.

The same file that runs the Check also describes:

- the Rules being protected,
- the Check that evaluates them,
- the controlled defects used as Proofs,
- and the verdict each Proof expects.

Because those pieces come from the same Gate definition, the written specification and the executable check are much harder to let drift apart.

Run:

```bash
npm run self:describe
```

to print every Gate before anything runs.

For example, this is the original description of the `unused-code` Gate:

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

This output is important because a reviewer can understand the Gate without first reading the Knip configuration or Knip documentation.

The structure is visible immediately:

```text
Rules
  ↓
what must remain true

Check
  ↓
how the repository is inspected

Proof
  ↓
what controlled change is introduced

Expected verdict
  ↓
FAIL / REFUSE / PASS
```

For example, R1 says:

```text
Files in the configured scan must be reachable from its entrypoints.
```

Its Proof then creates:

```text
gates/support/unused-receipt.ts
```

and runs the **same Check** again.

The expected result is:

```text
Gate FAIL
```

R3 does the same thing for an unused dependency.

The REFUSE proof deliberately makes the Knip configuration incomplete and expects:

```text
Gate REFUSE
```

The GREEN proof runs the maintained repository without introducing a defect and expects:

```text
Gate PASS
```

So `self:describe` gives a reviewer the whole contract in one place:

```text
promise
+
checker
+
known defect
+
expected outcome
```

That is what Redproof means by an **executable specification**.

The actual Gate file is only 31 lines, but its description explains what the Gate guards, what defects prove those guardrails, and what result each scenario should produce.

---

# 2. Custom checks can become first-class Rules

Not every useful engineering rule already has a linter.

The `static-contracts` Gate shows how Redproof handles that.

It protects three things.

### R1 — The workspace must type-check

Source code, tests, fixtures, and the self-hosted Gates must compile.

### R2 — Documentation examples must compile

TypeScript examples in the documentation should remain valid when APIs change.

### R3 — Unchecked documentation debt must not grow

Some examples are intentionally incomplete and are marked as fragments.

Those examples cannot be compiled independently, so the documentation checker skips them.

But allowing fragments creates a possible escape hatch:

```text
example stops compiling
        ↓
mark it as a fragment
        ↓
problem disappears
```

To prevent that, Redproof maintains a fragment budget.

The number can go down.

It cannot go up.

---

## The actual `static-contracts` Gate

This is the real Gate implementation:

```ts
import { defineGate, defineRules } from 'redproof';
import { commands } from 'redproof/command';

const rules = defineRules({
  workspaceCompiles: {
    id: 'static/workspace-compiles',
    description: 'Workspace source, tests, fixtures, and self-hosted Gates must type-check.',
  },
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
    maxAtOnce: 3,
    label: 'workspace types and documentation contracts',
    entries: [
      {
        rule: rules.workspaceCompiles,
        label: 'workspace TypeScript',
        command: process.execPath,
        args: ['node_modules/typescript/bin/tsc', '--noEmit'],
      },
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

This code is worth reading carefully because it shows the Redproof model directly.

---

## Step 1: define the Rules

The Gate first creates three named Rules:

```ts
const rules = defineRules({
```

Each Rule has a stable ID and a human-readable promise.

For example:

```ts
workspaceCompiles: {
  id: 'static/workspace-compiles',
  description: 'Workspace source, tests, fixtures, and self-hosted Gates must type-check.',
},
```

That is more useful than having an anonymous command such as:

```bash
tsc --noEmit
```

because now Redproof knows **what contract that command protects**.

The command is implementation.

The Rule is the promise.

---

## Step 2: define the Gate

The Rules belong to:

```ts
defineGate({
  id: 'static-contracts',
  rules,
```

So `static-contracts` becomes the group that owns these related promises.

---

## Step 3: run the checks

The Gate uses:

```ts
commands({
```

to turn normal commands into a Redproof Check.

There are three entries because there are three Rules.

The first entry protects workspace compilation:

```ts
{
  rule: rules.workspaceCompiles,
  label: 'workspace TypeScript',
  command: process.execPath,
  args: ['node_modules/typescript/bin/tsc', '--noEmit'],
},
```

The important connection is:

```text
rules.workspaceCompiles
        ↓
      tsc
```

If TypeScript reports a normal compilation failure, Redproof can report a breach of the specific workspace compilation Rule.

---

## Documentation examples use a custom checker

The second entry is:

```ts
{
  rule: rules.docsExamplesCompile,
  label: 'documentation examples',
  command: process.execPath,
  args: ['--experimental-strip-types', 'scripts/typecheck-docs.ts'],
},
```

This runs:

```text
scripts/typecheck-docs.ts
```

The script extracts checked TypeScript examples from the documentation and compiles them.

This solves a problem normal `tsc` does not solve.

A TypeScript example inside Markdown can become wrong after an API change, even while all `.ts` source files continue to compile.

For example, documentation might contain:

```ts
const result = await adapter.run(input);
```

If `adapter.run()` later changes, ordinary workspace compilation may never notice this snippet.

The documentation checker does.

---

## Fragment debt gets its own Rule

The third entry runs:

```text
gates/support/check-doc-fragment-budget.ts
```

through:

```ts
{
  rule: rules.docsFragmentDebt,
  label: 'documentation fragment budget',
  command: process.execPath,
  args: ['--experimental-strip-types', 'gates/support/check-doc-fragment-budget.ts'],
},
```

Some documentation examples are intentionally partial and cannot compile independently.

Those can be marked as fragments.

But every fragment is an example that the compiler does not verify.

So Redproof limits how many can exist.

The current budget is 37.

This is allowed:

```text
37 → 36
```

This is not:

```text
37 → 38
```

The goal is not to eliminate useful partial snippets.

The goal is to prevent unchecked examples from quietly accumulating.

---

# Why `commands()` matters

Without Redproof, all three checks could simply be shell commands.

But a shell command usually communicates very little:

```text
exit 0
```

or:

```text
exit 1
```

An exit code does not tell the wider system:

- which engineering promise failed,
- which Rule owns that promise,
- whether that Rule has a proof,
- or whether the command could not run at all.

`commands()` connects each command to a Rule.

So instead of:

```text
command failed
```

Redproof can reason in terms of:

```text
static/docs-examples-compile breached
```

There is another important difference.

If the command cannot start or cannot produce usable evidence, Redproof does not convert that situation into PASS.

It can return:

```text
REFUSE
```

That preserves the difference between:

```text
the Rule holds
```

and:

```text
I could not check the Rule
```

---

# 3. Every architecture boundary gets its own proof

The `architecture` Gate protects Redproof's functional-core / imperative-shell design.

The basic idea is:

```text
functional core
    ↓
decisions from explicit values

imperative shell
    ↓
filesystem, processes, clock,
environment, subprocesses, etc.
```

A written architecture rule is useful, but it is easy to accidentally violate.

Redproof therefore creates a controlled mutation for each important boundary.

Three particularly useful examples all modify the same core file.

A filesystem effect can be introduced with:

```ts
import 'node:fs/promises';
```

Ambient process state can be accessed with:

```ts
void process.cwd();
```

And the functional core can be made to depend on the shell with:

```ts
import '../shell/worker-process.ts';
```

These mutations look similar because they all make a small source-code change.

But they represent different architectural defects.

Redproof therefore expects different Rules to identify them.

Conceptually:

```text
filesystem import
    ↓
core effect-import Rule

process.cwd()
    ↓
ambient-input Rule

core → shell import
    ↓
core/shell dependency Rule
```

This is stronger than a generic:

```text
architecture check failed
```

because every proof asks the Gate to identify the exact boundary that was crossed.

---

# 4. One Gate can use several kinds of evidence

The architecture Gate cannot rely on only one analysis tool.

Some architecture rules concern imports.

Those are visible in the dependency graph.

For example:

```ts
import '../shell/worker-process.ts';
```

creates an import edge.

A dependency analysis tool can see it.

But this:

```ts
process.cwd();
```

does not create an import.

Neither does a direct clock read such as:

```ts
Date.now();
```

Those operations happen inside function bodies.

A dependency graph cannot tell that they occurred.

So the architecture Gate combines different Checks.

Conceptually:

```text
architecture Gate
       │
       ├── dependency analysis
       │
       └── TypeScript source scan
                │
                ↓
           one Gate verdict
```

This is an important design point.

The promise belongs to the Gate:

> Keep the functional core pure.

The implementation may need several sources of evidence to establish that promise.

And if one required source cannot run, Redproof should not make a decision from only the remaining half.

```text
dependency analysis = available
source scan        = unavailable
                     ↓
                  REFUSE
```

Not:

```text
PASS
```

---

# 5. The test runner describes the command it actually runs

The `test-health` Gate addresses another type of drift.

Imagine documentation saying:

```text
run all test files
```

while the actual test command slowly changes to use a different pattern.

Now the description and behavior disagree.

Redproof avoids maintaining those two values separately.

The runner receives the test file pattern as configuration and uses that same value to build:

- the real arguments,
- the description shown by `redproof describe`.

The configured pattern is:

```text
{tests,packages/*/test}/**/*.test.ts
```

So when the pattern changes, both execution and description change together.

That is why the page calls it a **self-describing runner**.

---

## Skipped tests are not successful tests

The test-health Gate also distinguishes:

```text
test passed
```

from:

```text
test did not run
```

For example:

```ts
test.skip('important behavior', () => {
  // ...
});
```

should not quietly contribute to a healthy test result.

The Gate therefore has a Rule specifically protecting against collected-but-skipped tests.

One proof deliberately creates a skipped test.

The expected result is that the skipped-test Rule breaches.

---

# 6. Guidelines can become executable guardrails

Redproof applies the same approach to Adapter design.

The project has several guidelines for Adapter authors.

For example, an Adapter should:

1. validate constructor options,
2. represent unavailable runner results explicitly,
3. keep parsing separate from execution,
4. declare what its report format can actually observe,
5. create Breaches from structured evidence.

Without enforcement, these remain review guidelines.

A maintainer may remember them during review.

Or they may not.

The `adapter-contracts` Gate turns those expectations into Rules and then deliberately breaks them.

For example, a proof can remove constructor validation.

Another can modify the unavailable-evidence path.

Another can make a report format claim capabilities it does not really have.

Another can alter evidence translation so findings disappear.

The contract suite must identify the corresponding violation.

So the pattern becomes:

```text
written guideline
       ↓
      Rule
       ↓
controlled violation
       ↓
     Proof
```

---

# The Adapter TCK

The repository can run its own Adapter contract tests against built-in Adapters.

External Adapter authors need the same protections.

So the contracts are also packaged as:

```text
@redproof/adapter-tck
```

TCK means **Technology Compatibility Kit**.

The idea is:

```text
third-party Adapter
        ↓
@redproof/adapter-tck
        ↓
same core Adapter contracts
```

That means the design rules are not limited to Redproof's own repository.

An Adapter author can run those contracts beside their normal test suite.

---

# 7. Release policy becomes executable too

Release engineering has its own invariants.

For example:

- every publishable package must participate in the release,
- package versions must remain synchronized,
- internal package dependencies must respect package layering,
- public package surfaces must point to real files,
- required CI and publishing checks must remain present,
- documentation must not link to missing files,
- optional dependencies must remain represented correctly in the lockfile.

These rules are spread across many files:

```text
package.json
release scripts
CI workflows
publish workflows
package-lock.json
documentation
```

The `repository-policy` Gate treats those files as evidence.

That means a release mistake can be handled the same way as a source-code mistake:

```text
release invariant
      ↓
     Rule
      ↓
controlled release mistake
      ↓
     Proof
```

---

# A real release incident became a proof

One useful repository-policy proof came from an actual release problem.

The safe publishing form is:

```bash
npm publish "./$TARBALL"
```

The problematic form omitted the explicit relative-path prefix:

```bash
npm publish "$TARBALL"
```

The issue was fixed, but Redproof goes one step further.

The mistake is now represented as a mutation.

So the repository does not rely on future maintainers remembering:

> Be careful with this command because we had a release problem once.

Instead, the knowledge becomes executable:

```text
known dangerous change
       ↓
repository-policy Gate
       ↓
specific Rule must breach
```

This is one of the most useful Redproof patterns:

```text
real incident
     ↓
identify the missing invariant
     ↓
make the invariant a Rule
     ↓
reproduce the incident as a mutation
     ↓
prove the Rule detects it
```

The repository remembers the lesson even when the people working on it change.

---

# 8. REFUSE is especially important for release checks

Suppose a repository Rule needs to inspect:

```text
.github/workflows/ci.yml
```

Now imagine that file is unavailable.

A weak checker might behave like this:

```text
I searched for the forbidden state.
I did not find it.
PASS.
```

But the checker never actually had the evidence it needed.

Redproof represents this separately.

```text
PASS
    enough evidence exists,
    and the Rule holds

FAIL
    enough evidence exists,
    and the Rule is broken

REFUSE
    required evidence is unavailable,
    so no trustworthy judgment can be made
```

This prevents missing evidence from silently turning into success.

---

# 9. Verify the artifact that will actually be published

The publishing workflow also checks the real package artifacts.

The packages are first packed into tarballs.

Those tarballs are installed into a clean consumer project.

The consumer verification checks things such as:

```text
Can the package be imported?

Do the TypeScript types resolve?

Does the CLI work?

Are the expected files present?

Do internal package links resolve?
```

Then the same tested tarballs continue to publishing.

Nothing needs to be rebuilt between those stages.

The desired relationship is:

```text
artifact tested
      =
artifact published
```

rather than:

```text
source tested
     ↓
artifact rebuilt later
     ↓
artifact published
```

This matters because packaging can introduce problems that do not appear in the original source tree.

---

# 10. CI discovers Gates automatically

There is another easy way for a guardrail system to fail.

A developer can create:

```text
gates/new-policy.ts
```

and forget to add it to a hand-maintained CI matrix.

The Gate exists.

But CI never runs it.

Redproof avoids keeping a separate Gate list.

CI discovers:

```text
gates/*.ts
```

and creates a proof job for every Gate it finds.

Conceptually:

```text
discover
   │
   ├── architecture
   ├── static-contracts
   ├── test-health
   ├── adapter-contracts
   ├── repository-policy
   └── unused-code
```

A newly added Gate is therefore automatically visible to CI.

The repository-policy Gate also protects the command used to run those proof jobs.

This is important because the real guardrail system includes both:

```text
the Gate
```

and:

```text
the CI wiring that causes the Gate to run
```

A correct Gate that never executes provides no protection.

---

# Running it

There are four useful commands to remember.

## Describe the specification

```bash
npm run self:describe
```

This answers:

> What does each Gate claim to protect?

Use it to inspect the Rules, Checks, and Proofs.

---

## Check the current repository

```bash
npm run self:check
```

This answers:

> Does the current repository satisfy those Rules?

No deliberate defect needs to be introduced.

---

## Prove the guardrails

```bash
npm run self:prove
```

This answers:

> Do the guardrails themselves still behave correctly?

This is where Redproof exercises GREEN, RED, and REFUSE scenarios.

---

## Run the complete delivery check

```bash
npm run check
```

This runs the broader project verification, including the normal repository checks and the Redproof Gates.

---

# The model to remember

The easiest way to understand Redproof is to separate four concepts.

```text
Rule
  ↓
what must remain true


Check
  ↓
how evidence is collected


Evidence
  ↓
what the Check actually observed


Verdict
  ↓
PASS / FAIL / REFUSE
```

Then add a Proof:

```text
Proof
  ↓
create a known condition
  ↓
run the same Check
  ↓
require the expected Rule
and verdict
```

For example:

```text
Rule
Functional-core code must not use filesystem effects.

RED proof
Introduce filesystem access into the core.

Check
Run the normal architecture analysis.

Expected result
The filesystem-effect Rule breaches.
```

The key point is that Redproof does **not** replace the real Check with a special test-only checker.

It changes the condition and runs the same Check again.

That is what makes the proof meaningful.

---

# The larger idea

Redproof is not mainly about creating more CI commands.

It is about turning engineering knowledge into executable contracts.

A project may know things such as:

```text
The functional core should stay pure.

Documentation examples should compile.

Skipped tests should not count as healthy.

Adapters must not turn missing evidence into PASS.

Package versions must remain synchronized.

The artifact we test should be the artifact we publish.
```

Without a system like this, those facts can live in many places:

```text
documentation
code review habits
CI configuration
release scripts
maintainers' memories
```

Redproof tries to give them a common structure:

```text
Rule
+
Check
+
Proof
```

And each proof asks for one of three meaningful outcomes:

```text
GREEN
Known-good behavior is accepted.

RED
A known defect is detected by the intended Rule.

REFUSE
Missing evidence is not mistaken for success.
```

So the repository is not only asking:

> Are we passing CI today?

It is also asking:

> Can we still demonstrate that each guardrail catches the exact mistake it was created to prevent?

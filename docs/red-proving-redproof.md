# Red proving Redproof

Redproof runs Redproof on itself. Five Gates guard this repository. They hold
27 Rules and 36 Proofs, and they run on every push. This page is not a guide
to running them. It shows what that looks like, and it makes one point: a Gate
can guard anything that leaves evidence. A module graph, a purity rule, the
documentation, and the release inventory are all guarded the same way.

- [The suite at a glance](#the-suite-at-a-glance)
- [A Gate spec reads like a promise](#a-gate-spec-reads-like-a-promise)
- [Gate 1: architecture](#gate-1-architecture)
- [Gate 2: static-contracts](#gate-2-static-contracts)
- [How a proof drives tidy-up](#how-a-proof-drives-tidy-up)
- [Gate 3: test-health](#gate-3-test-health)
- [Gate 4: adapter-contracts](#gate-4-adapter-contracts)
- [Gate 5: repository-policy](#gate-5-repository-policy)
- [What this shows](#what-this-shows)

## The suite at a glance

| Gate | The promise | Built from | Rules | Proofs |
| --- | --- | --- | --- | --- |
| `architecture` | The structure stays intact. Imports point inward. The core stays pure. | `@redproof/dependency-cruiser` plus a TypeScript AST scan | 12 | 14 |
| `static-contracts` | The code compiles. Every checked example in the docs compiles. Fragment debt cannot grow. | `redproof/command` with three parallel commands | 3 | 4 |
| `test-health` | Every test ran and passed. None was skipped. | `@redproof/testing` with a JUnit report | 2 | 3 |
| `adapter-contracts` | Every built-in Adapter keeps the five documented verdict and evidence contracts. | Five original suites plus five package-owned TCK lanes through `redproof/command` | 5 | 8 |
| `repository-policy` | A release ships whole. Docs do not link to missing files. | A native Check over a pure policy model | 5 | 7 |

`npm run self:check` runs the five Gates in isolated copies, in parallel:

```text
 ✓ gates/architecture.ts (12 rules) 7.79s
 ✓ gates/adapter-contracts.ts (5 rules) 1.63s
 ✓ gates/repository-policy.ts (5 rules) 469ms
 ✓ gates/static-contracts.ts (3 rules) 12.52s
 ✓ gates/test-health.ts (2 rules) 44.83s

 Gates      5 passed (5)
 Rules      27 held (27)
```

`npm run self:prove` then breaks each Rule on purpose, one defect at a time,
and expects the Gate to go red. Every Gate also has a GREEN proof. The
`repository-policy` Gate has a REFUSE proof as well.

## A Gate spec reads like a promise

A Gate file states what is protected and how each Rule is broken. It holds no
plumbing. `redproof describe` prints the same file back as a specification.
This is the `static-contracts` Gate:

```text
Gate: static-contracts

Rules:
  R1 Workspace source, tests, fixtures, and self-hosted Gates must type-check.
  R2 Standalone TypeScript examples in the documentation must compile.
  R3 The number of documentation fragments excluded from compilation must not grow.

Check:
  run 3 commands: workspace TypeScript, documentation examples, documentation fragment budget

Proof R1:
  rejects a workspace type error
  mutation: create tests/redproof-type-proof.ts
  run the same Check
  expect Gate FAIL

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

Proof GREEN:
  accepts the current workspace and documentation contracts
  run the same Check
  expect Gate PASS
```

A reviewer can read this without opening the code. Each Rule is a sentence.
Each Proof names the defect it plants and the verdict it expects. Run
`npm run self:describe` to print all five Gates.

## Gate 1: architecture

**The promise.** New code cannot quietly break the shape that keeps Redproof
easy to change. Imports point inward. Contexts talk only through their public
surface. The pure core never touches a file, a clock, or a process.

Source: [`gates/architecture.ts`](../gates/architecture.ts).

### The boundaries

`packages/redproof/src` holds nine contexts side by side: `cli`, `command`,
`composition`, `inspect`, `project`, `proof`, `reporter`, `run`, and
`workspace`. Inside a context, code sits in one of three layers.

```text
                     imports point downward only

  entrypoints   index.ts, cli.ts        reach a context only through its index.ts
       │
  shell         <context>/shell/**      most of the 23 approved effect boundaries live here
       │
  core          <context>/core/**       pure: no fs, process, clock, subprocess, shell
       │
  domain        domain/**               types only; depends on nothing above it

  across contexts: <context-a>/** ──▶ <context-b>/index.ts or core/index.ts, never deeper
  composition may depend only on domain and inspect; every other context is downstream
  adapters (eslint, testing, ...) ──▶ packages/redproof/src/index.ts only
```

Nine dependency-cruiser rules draw those lines. Each one is a Redproof Rule,
and each one has a RED proof that plants the forbidden import:

| Rule | Proof mutation |
| --- | --- |
| `no-cycles` | create two domain files that import each other |
| `core-no-effect-imports` | append `import 'node:fs/promises'` to `run/core/exit-code.ts` |
| `core-no-shell` | append `import '../shell/worker-process.ts'` to a core file |
| `domain-inward-only` | make `domain/rule.ts` import `run/core` |
| `composition-no-runtime-or-reporters` | make `composition/core` import `run/core` |
| `adapters-public-core-api-only` | make the eslint adapter import a core file directly |
| `production-no-test-fixture-dependencies` | make a domain file import a fixture |
| `contexts-import-through-index` | make `run/core` import `proof/core/outcome.ts` directly |
| `entrypoints-import-through-index` | make `index.ts` export from `proof/shell/runner.ts` |

**How Redproof protects.** A dependency rule that nobody tests is a comment.
The RED proof shows the rule is live: the planted import breaches exactly the
Rule that names it. The GREEN proof shows the current tree is clean. When a
change breaks a boundary, `self:check` names the Rule and the file.

### Functional core and imperative shell

The functional core is `domain/**` and every `*/core/**`. The core receives
values and returns decisions. It cannot read files, spawn processes, observe
the clock or the environment, or import a shell module. Three native Rules
enforce this with a TypeScript AST scan in
[`gates/checks/effect-boundaries.ts`](../gates/checks/effect-boundaries.ts):

- `core-no-ambient-inputs`: a core module cannot read `process.cwd()` or
  `process.env`. The shell reads them and passes values in.
- `effects-allowlisted-boundaries`: filesystem, process, clock, randomness,
  timer, and subprocess effects may appear only in the 23 files listed in
  [`gates/support/effects-model.ts`](../gates/support/effects-model.ts).
- `core-tests-no-io-helpers`: a core test cannot import a filesystem,
  subprocess, or workspace fixture helper.

**Why it is powerful.** A new effect site is a breach, not a habit. Adding one
means editing the allowlist in a visible, reviewed change. The core therefore
stays a set of pure functions, and a pure function is tested with plain
values. No temporary directory, no subprocess, no clock. This core test builds
a result by hand and checks one decision:

```text
const scan: Scan = { source: 'unit', startedAt: '', finishedAt: '', inspected: 1 };
const R1 = { id: 'r1', description: 'R1' } as const;
const R2 = { id: 'r2', description: 'R2' } as const;

test('RED proof requires its target Rule, not merely a failed Gate', () => {
  const result = fail(scan, [
    breach(R2.id, { code: 'r2', message: 'R2 failed', location: null }),
  ]);

  assert.deepEqual(evaluateProof(proof.red(R1, 'prove R1', noop), result), {
    kind: 'target-rule-not-breached',
    target: 'r1',
    breached: ['r2'],
  });
});
```

`npm run test:core` runs that lane alone. The Gate guards the lane too. Its
proof appends `import './helpers/workspace.ts'` to a core test and expects
FAIL.

## Gate 2: static-contracts

**The promise.** The workspace type-checks. Every standalone TypeScript example
in the documentation compiles. The number of examples excused from that check
cannot grow.

Source: [`gates/static-contracts.ts`](../gates/static-contracts.ts).

**A custom-made guardrail.** No package checks documentation examples. Two
small scripts in this repository do it. One extracts every ` ```ts ` block from
the docs and compiles it. The other counts the ` ```ts fragment ` blocks that
are excused, and fails when the count exceeds a limit. Redproof wraps both as
Rules with `redproof/command`, next to the workspace compiler:

```text
const check = commands({
  mode: 'parallel',
  maxAtOnce: 3,
  entries: [
    { rule: rules.workspaceCompiles,   command: node, args: tsc('--noEmit') },
    { rule: rules.docsExamplesCompile, command: node, args: stripTypes('scripts/typecheck-docs.ts') },
    { rule: rules.docsFragmentDebt,    command: node, args: stripTypes('gates/support/check-doc-fragment-budget.ts') },
  ],
});
```

That is the whole integration. A script that exits non-zero is a Rule breach.
A script that cannot start is a REFUSE. Nothing about Redproof had to change
to guard the docs.

**The proofs.** One plants a type error in a test file. One plants a markdown
file with a checked example that does not compile. One plants a markdown file
with one excused fragment. Each expects FAIL.

## How a proof drives tidy-up

A proof does not only catch a broken Rule. It catches a Rule that has gone
slack. This happened on 2026-09-08.

A change moved two documentation examples into checked blocks. The fragment
count fell from 39 to 37. `self:check` stayed green, because 37 is under the
limit of 39. `self:prove` failed:

```text
✗ static-contracts / rejects growth in unchecked documentation fragments expected=red actual=pass
    expected fail, got pass; the mutation did not reach what the Rule guards
```

The proof plants exactly one fragment. With the debt at 37 and the limit at
39, one more fragment makes 38, and nothing breaches. The Rule "fragment debt
must not grow" was no longer guarding anything. Two fragments could have crept
back in unnoticed.

The only fix was to lower the limit to 37. The proof forced the ratchet down.
The maintainer did not get to leave slack in the budget. That is the point of
red proving: green is not evidence until red has been seen.

## Gate 3: test-health

**The promise.** A green test run means every test ran and passed. Not most of
them. Not the ones nobody skipped.

Source: [`gates/test-health.ts`](../gates/test-health.ts).

This Gate is the `@redproof/testing` adapter with a JUnit report. Redproof
tests its own test adapter with itself. The runner starts `node --test` over
`tests/**/*.test.ts` and asks for JUnit output. The adapter reads the report
and exposes two Rules: `testsPass` and `noSkippedTests`.

**Example.** A developer marks a flaky test with `skip` to get the build green.
The Gate breaches `testing/no-skipped-tests` and names the test. The skip is
a finding, not an escape.

**The proofs.** One creates a test file with one failing test. One creates a
test file with one skipped test. Each expects FAIL.

## Gate 4: adapter-contracts

**The promise.** Every built-in Adapter validates options before execution,
REFUSES unavailable runs, keeps parsers and evidence models pure, declares
report capabilities where they apply, and creates Breaches only from selected
structured evidence.

Source: [`gates/adapter-contracts.ts`](../gates/adapter-contracts.ts).

Ten small contract commands run in parallel: one legacy suite and one
package-owned TCK lane per Rule. Each RED proof makes one precise promise
false: it removes constructor validation, corrupts runner mapping, introduces
I/O into a pure model, reads ambient process state, overstates JUnit
capabilities, or drops a selected ESLint finding. A flooded output budget
supplies the REFUSE proof.

The command timeout is 60 seconds. It is a safety net, not a speed budget. The
suites finish much sooner, but a shared machine can be many times slower. A
tight timeout turns a slow machine into a false refusal, which reads like a
broken contract.

See **[Gating Adapter contracts](adapter-contract-gates.md)** for the contract
matrix and the RED-first sequence used to build it.

## Gate 5: repository-policy

**The promise.** Six packages ship together. They share one version. Every
one of them is in every build and release step. The public surfaces are
declared and backed by source. CI keeps its verification steps. No document
links to a missing file.

Source: [`gates/repository-policy.ts`](../gates/repository-policy.ts).

This Gate is a native Check over a pure policy model. The shell reads the
package manifests, the workflow files, and the markdown. The core evaluates
the five Rules over those values. The Check is composed with the
`scanning` helper in `gates/support`, which stamps the scan window, counts
what was inspected, maps findings to breaches, and REFUSES when an input
cannot be read.

**Examples.** Someone adds a seventh package and forgets the version setter:
`repository/packages-inventory-is-consistent` breaches. Someone bumps one
package to a new version and forgets the others:
`repository/package-versions-and-internal-pins-align` breaches. A document
links to a file that was renamed: `repository/docs-relative-links-resolve`
breaches and names the link.

**The proofs.** Five RED proofs replace one string each: a package name in the
inventory, a version, a schema entry, a CI step, and a link target. The REFUSE
proof renames `ci.yml` and expects REFUSE, because a policy input cannot be
read. The Gate does not guess.

## What this shows

Every Gate above guards a different kind of evidence. A module graph. An AST.
A compiler exit code. A JUnit report. A set of JSON manifests and markdown
files. Redproof did not need a feature for any of them. Each one is a Rule, a
Check that gathers evidence, and a Proof that plants the defect.

Three directories keep the Gate files readable:

```text
gates/*.ts            what is protected, and how each Rule is broken
gates/checks/*.ts     how a Check gathers input and reports findings
gates/support/*.ts    pure models and shared plumbing
```

To run the suite yourself, build once and use the three scripts:

```bash
npm run build
npm run self:describe
npm run self:check
npm run self:prove
```

`npm run check` runs all of it in CI, after the type, documentation, test, and
fixture verification.

## Next

- **[Composing Redproof](composition.md)** for Rules, Checks, Proofs, and Mutations.
- **[Command Checks](commands.md)** for wrapping a script or executable, as `static-contracts` does.
- **[Custom Adapter](custom-adapter.md)** for a tool with its own policy model.

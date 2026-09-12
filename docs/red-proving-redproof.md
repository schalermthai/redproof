# Redproof proves Redproof

This repository is not a demonstration project built to make Redproof look
good. It is one of Redproof's most demanding users.

Every pull request and every push to `main` asks two separate questions:

1. Does the repository satisfy its guardrails now?
2. Can those guardrails still detect the defects they claim to protect us
   from?

The first question is familiar. Tests pass, types compile, dependency rules
hold, and release metadata is consistent. Most quality pipelines stop there.

Redproof asks the second question by temporarily introducing a controlled
defect, running the same Gate, and requiring the expected Rule to breach. A
green check is useful. A green check whose detection has also been demonstrated
is much stronger evidence.

Redproof currently protects itself with six Gates.
These are the controls used by the real CI and release workflows, not a separate
showcase suite.

## The dogfooding loop

Each Gate owns a promise, the Rules that make the promise precise, and the
Check that evaluates those Rules. Its proofs exercise that same Check under
three conditions:

```text
healthy repository   ──▶ same Gate ──▶ PASS
controlled defect    ──▶ same Gate ──▶ FAIL the targeted Rule
unavailable evidence ──▶ same Gate ──▶ REFUSE
```

A RED proof is not satisfied by any failure. If a proof targets the Rule
“domain must not import infrastructure” but a different Rule fails, the target
has not been proven. Redproof reports that distinction instead of treating a
generically red build as success.

A GREEN proof establishes the healthy baseline. It prevents a permanently
broken Gate from appearing effective merely because every mutation also fails.

A REFUSE proof establishes honest uncertainty. Missing tools, unreadable
inputs, timeouts, signals, output overflow, or disallowed empty evidence do not
become PASS. They also do not become a false product defect. Redproof says that
the Check could not make a trustworthy decision.

Proofs run in isolated project copies. Mutations can create files, remove
validation, change configuration, break imports, or corrupt evidence
translation without modifying the developer's working tree. Redproof checks
that the proof workspace returns to its baseline before it is reused.

The proof report makes the claim and the observed outcome visible together:

```text
✓ architecture / detects a production dependency cycle expected=red actual=fail
✓ adapter-contracts / refuses when a contract suite floods its output budget expected=refuse actual=refuse
✓ repository-policy / accepts the current repository contracts expected=green actual=pass
```

## One model for very different guardrails

Redproof's self-hosted portfolio covers several different kinds of evidence. The
value is not the number of Gates; it is that the same proof model works across
all of them.

| Gate | Promise | Evidence | Representative controlled defect |
| --- | --- | --- | --- |
| [`architecture`](../gates/architecture.ts) | Dependencies point inward and the functional core remains pure. | dependency-cruiser plus TypeScript syntax analysis | Introduce a dependency cycle, import a shell from the core, or read ambient process state. |
| [`static-contracts`](../gates/static-contracts.ts) | Source and checked documentation compile, while unchecked fragment debt cannot grow. | TypeScript and documentation commands | Add a type error, an invalid documentation example, or one unbudgeted fragment. |
| [`test-health`](../gates/test-health.ts) | Every collected test passes and none is skipped. | Structured JUnit evidence through `@redproof/testing` | Add a failing test or a skipped test. |
| [`coverage`](../gates/coverage.ts) | The coverage model retains its statement, branch, function and line thresholds. | Fresh Istanbul-format evidence from c8 | Add unexecuted statements, branches, functions or lines; fail the producer. |
| [`adapter-contracts`](../gates/adapter-contracts.ts) | Built-in Adapters validate configuration, handle unavailable execution honestly, preserve pure evidence models, respect report capabilities, and attribute structured findings correctly. | Original contract suites plus package-owned `@redproof/adapter-tck` suites | Remove option validation, corrupt runner mapping, add an effect to a pure model, or drop a selected finding. |
| [`repository-policy`](../gates/repository-policy.ts) | Every package is complete, aligned, documented, and verified before release. | Package manifests, workflows, source inventory, and documentation links | Omit a package from release automation, diverge a version, remove verification, or add a broken link. |

Together they protect behavior, architecture, documentation, integrations, and
the release boundary. Redproof does not require all guardrails to speak the
same native protocol. Commands, structured reports, dependency graphs, syntax
trees, and repository metadata are translated into the same PASS, FAIL, and
REFUSE semantics.

## The architecture Gate protects how Redproof is built

Redproof has a functional core and an imperative shell. Core modules make
decisions from values. Boundary modules read files, inspect the environment,
observe time, and supervise processes.

The architecture Gate makes that design executable. It prevents contexts from
reaching through each other's private modules, keeps domain types independent,
restricts effects to reviewed boundary files, and keeps filesystem helpers out
of functional-core tests.

The corresponding proofs do more than assert that dependency-cruiser or the
syntax scanner ran. They introduce the forbidden relationships:

```text
create two production modules that import each other
append a filesystem import to a core module
make a core module import its shell
read process.cwd() inside the functional core
make an Adapter import Redproof internals
```

Each mutation must breach the Rule that names that boundary. This matters as
the codebase grows: an architectural convention cannot quietly become a
diagram that no longer matches the implementation.

## Redproof also guards the guardrail integrations

An Adapter can return the right TypeScript shape and still be unsafe. It might
accept invalid options, turn a crashed tool into a false PASS, parse untrusted
output inside an I/O-heavy shell, claim evidence its report cannot provide, or
create Breaches from the wrong findings.

The [`adapter-contracts`](../gates/adapter-contracts.ts) Gate protects five
shared promises against ESLint, dependency-cruiser, Stryker, the generic
testing Adapter, and Vitest. It runs two complementary implementations of each
contract side by side:

- the original focused contract suites;
- package-owned registrations executed by
  [`@redproof/adapter-tck`](../packages/adapter-tck/README.md).

The TCK owns the reusable assertions, while each Adapter owns the scenarios
that exercise its public behavior. Its self-tests deliberately feed it
malformed and inconsistent observations, proving those contract checks reject
bad evidence rather than merely confirming that current registrations pass.
The Adapter-owned callbacks are still trusted test code; real-tool fixtures
verify that they cross the actual Adapter boundary.

Real-tool fixtures add the final layer. They run ESLint, dependency-cruiser,
Stryker, and Vitest against representative projects and prove their actual
tool boundaries. The fast contract Gate identifies which shared promise broke;
the integration fixtures show that the promise holds when the external tool is
really involved.

This dependency direction keeps the production graph clean:

```text
Adapter production ──▶ redproof
Adapter tests      ──▶ @redproof/adapter-tck ──peer/types──▶ redproof
root Gate          ──▶ package-owned TCK tests
```

Redproof does not depend on the TCK, Adapter production does not import it, and
the TCK does not import built-in Adapters.

## The release is guarded like product code

Dogfooding stops being convincing if it protects source code but not what users
install.

The repository-policy Gate reads the package manifests, public exports,
source inventory, automation workflows, and documentation links. It checks
that packages share a version, internal dependency pins match, package edges
follow the core–TCK–Adapter layers, public runtime and type surfaces are backed
by source, and CI cannot silently drop required verification.

The release workflow then packs all publishable packages and installs those tarballs
into a clean consumer. It verifies runtime imports, published types, CLI
behavior, package contents, and exact internal links. The same verified
tarballs are retained, attached to the workflow run, and passed directly to
`npm publish`; the release does not rebuild a different artifact afterward.

CI runs quality and integration checks, the complete proof portfolio, and the
clean-consumer package verification as independent jobs. They start together,
so a slow proof no longer makes unrelated verification wait, while the root
`npm run check` command still composes the complete source and proof portfolio
for local and release use.

The proofs cover this boundary too. A deliberately omitted package must breach
the inventory Rule. A divergent version must breach alignment. A forbidden
runtime dependency from core to the TCK must breach package boundaries. A
removed CI verification step must breach automation policy. An unreadable
policy input must REFUSE rather than let an incomplete release inspection pass.

See the live [CI workflow](../.github/workflows/ci.yml) and
[publish workflow](../.github/workflows/publish.yml).

## What goes beyond a typical guardrail runner

A command runner can tell you that ESLint, a test suite, or a custom script
exited successfully. Redproof can use that evidence, but its model adds several
important guarantees:

- **The promise has a name.** Failures are attributed to stable Rules, not only
  to a command or job.
- **Detection is exercised.** A RED proof supplies a controlled counterexample
  and requires the targeted Rule to notice it.
- **The healthy state is exercised.** GREEN proves the Gate is capable of
  accepting a valid project.
- **Uncertainty stays visible.** REFUSE prevents missing or insufficient
  evidence from becoming false confidence.
- **The real scope is preserved.** Check and prove run the same Gate rather
  than a weakened proof-only version.
- **The mechanism is composable.** A new guardrail can begin as an executable,
  a structured Adapter, or a native Check and still participate in the same
  proof lifecycle.
- **The integrations are guarded too.** Adapter contracts, the TCK, real-tool
  fixtures, and packed-consumer verification test the layers that translate
  external evidence into Redproof decisions.

This is the practical difference between running guardrails and proving your
guardrails still work.

## Why this matters when agents write code

AI agents can change more code, configuration, and documentation in one pass
than a person would usually touch at once. They can also produce plausible
mistakes at the same speed. Reliable guardrails become part of the steering
loop: they tell the agent what crossed a boundary and give it concrete evidence
to course-correct.

But an agent can only respond to a signal that still works. A stale glob, an
ignored report field, a missing package in automation, or a parser that turns
unavailable evidence into PASS can make a pipeline confidently wrong.

Redproof does not decide what a team's standards should be. It lets the team
compose those standards from the tools and evidence it already trusts, then
continuously demonstrates that the resulting guardrails remain sensitive to
the problems they were built to catch.

## Run the dogfood portfolio

Describe the Gates as an executable specification:

```bash
npm run self:describe
```

Check the current repository:

```bash
npm run self:check
```

Run every controlled defect, healthy baseline, and refusal scenario:

```bash
npm run self:prove
```

The complete delivery check runs those self-hosted Gates together with types,
documentation examples, native tests, and the real-tool fixture portfolio:

```bash
npm run check
```

The implementation is intentionally readable. Start with the Gate files in
[`gates/`](../gates), then see the reusable
[Contract-to-Gate method](contract-to-gate.md), the
[Adapter contract design](adapter-contract-gates.md), and the
[custom Adapter guidelines](custom-adapter.md).

The repository's claim is not merely that Redproof can run many kinds of
guardrail. It is that a guardrail is more trustworthy when the project can show
all three outcomes: the healthy system passes, a representative defect breaches
the expected Rule, and unavailable evidence is refused.

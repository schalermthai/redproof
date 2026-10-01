# Adapter Contract Gates

Redproof uses contract Gates to verify shared behavioral rules for its registered
Adapters and supporting runners.

These Gates protect the **Adapter implementation itself**.

They are different from the Rules an Adapter exposes to users.

For example:

```text
User-facing Rule
────────────────
"Tests must pass"

Adapter contract
────────────────
"If the test runner cannot execute,
the Adapter must REFUSE"
```

The first protects the user's project.

The second protects Redproof's implementation of the Adapter.

This page explains how Redproof tests those Adapter contracts.

If you are building your own Adapter, start with [Custom Adapter](./custom-adapter.md). This page is mainly useful when contributing to Redproof itself or when you want to understand how the built-in Adapters are verified.

---

## The verification model

Adapter behavior is checked at two levels:

```text
Fast contract Gate
        +
Real-tool fixtures
```

They answer different questions.

### Contract Gate

Runs quickly and checks the common behavior every Adapter is expected to follow.

Examples:

- invalid configuration is rejected
- unavailable execution becomes `REFUSE`
- evidence translation stays pure
- unsupported report capabilities are rejected
- Breaches come from structured evidence

### Real-tool fixtures

Run the actual external integration.

Examples:

- ESLint returns real lint messages
- dependency-cruiser returns real dependency violations
- Stryker returns real mutant results
- Vitest produces a real test report

The contract Gate tells you **which Adapter promise broke**.

The real-tool fixture confirms that the same promise still holds at the actual tool boundary.

Neither replaces the other.

---

## The Adapter contracts

This matrix describes the current `adapter-contracts` Gate's coverage. The TCK
registers ESLint, dependency-cruiser, Stryker, generic testing, and Vitest.
Command-runner contracts also run in the original repository suites. Knip and
Istanbul are built-in Adapters, but are not registered in this TCK matrix.

Not every contract applies to every Adapter.

Redproof records those differences explicitly rather than forcing every Adapter into the same shape.

| Contract | ESLint | dependency-cruiser | Stryker | testing | Vitest | command runner |
| --- | --- | --- | --- | --- | --- | --- |
| Invalid options fail during construction | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Unavailable execution becomes `REFUSE` | programmatic API | programmatic API | programmatic API | runner + Adapter mapping | command runner | command runner |
| Evidence parsing is pure | ESLint model | violation model | result + baseline models | report + test models | testing models | N/A |
| Unsupported report capabilities are rejected | N/A | N/A | N/A | JUnit + Jest-compatible reports | testing formats | N/A |
| Breaches come from structured evidence | lint messages | dependency violations | mutant results | normalized test cases | testing models | N/A |

`N/A` is intentional.

For example, ESLint, dependency-cruiser, and Stryker expose programmatic results rather than selectable report formats. Adding a fake report-capability abstraction would make the API less accurate, not more consistent.

---

## 1. Invalid configuration must fail early

Adapters should reject invalid configuration during construction whenever possible.

For example:

```ts
import { eslint } from '@redproof/eslint';

// Construction throws: at least one Rule must be selected.
eslint({
  rules: {},
});
```

should not silently create an Adapter that can never enforce anything.

Likewise, unknown options should not be quietly ignored.

The contract covers both:

```text
TypeScript users
      ↓
compile-time validation

JavaScript / loaded Gate config
      ↓
runtime constructor validation
```

Both matter.

TypeScript catches mistakes for typed consumers.

Runtime validation still protects JavaScript users and configuration loaded after types have been erased.

---

## 2. Unavailable execution must become REFUSE

An external tool failing to run is usually not evidence that the user's Rule was violated.

For example:

```text
ESLint programmatic API unavailable
          ↓
       REFUSE
```

not:

```text
ESLint programmatic API unavailable
          ↓
        FAIL
```

The same applies when:

- a programmatic API throws
- a command cannot start
- a custom test runner throws
- command arguments are invalid at execution time

The Adapter should convert that failure into a useful `REFUSE` result.

This keeps a clear distinction between:

```text
FAIL
The evidence proves the Rule is broken.

REFUSE
Redproof cannot obtain trustworthy evidence.
```

---

## 3. Evidence translation should be pure

Whenever possible, translating tool output into Redproof evidence should be separate from I/O.

For example:

```text
ESLint
  ↓
lint messages
  ↓
pure evidence model
  ↓
Breaches
```

The evidence model should not:

- read files
- start processes
- access the network
- depend on hidden global state

Keeping this layer pure makes it cheap to test and easier to reason about.

Redproof applies this pattern to:

- ESLint evidence
- dependency-cruiser violations
- Stryker results and baselines
- testing report parsers
- normalized test results

Vitest reuses the generic testing models.

The command runner does not have an equivalent structured evidence model, so this contract does not apply there.

---

## 4. Report formats must advertise their capabilities

Some testing Rules require information that not every report format contains.

For example, a format may contain enough information to prove:

```text
tests passed
```

but not enough to prove:

```text
no test was flaky
```

The testing Adapter therefore models report capabilities explicitly.

If a user selects a Rule that the report cannot support, the Adapter should reject that configuration rather than pretending the evidence is sufficient.

This contract currently applies to:

- Jest-compatible JSON reports
- JUnit reports
- Vitest through the shared testing models

It does not apply to Adapters whose tools return structured results directly.

---

## 5. Breaches must come from structured evidence

Adapters should not infer user-facing Breaches from vague process behavior when richer structured evidence is available.

Examples:

```text
ESLint
  lint message
      ↓
  Breach
```

```text
dependency-cruiser
  dependency violation
      ↓
  Breach
```

```text
Stryker
  surviving mutant
      ↓
  Breach
```

```text
testing Adapter
  normalized failing test
      ↓
  Breach
```

This lets Redproof identify the exact Rule and evidence responsible for the failure.

It also keeps process failures separate from Rule failures.

---

## The Adapter TCK

The shared Adapter contracts live in:

```text
@redproof/adapter-tck
```

TCK means **Technology Compatibility Kit**.

Its job is to define reusable assertions that every compatible Adapter can run against.

A built-in Adapter registers scenarios describing things such as:

```text
valid construction
invalid options
unavailable execution
selected evidence
clean evidence
unselected evidence
purity expectations
report capabilities
```

The TCK owns the assertions.

The Adapter owns the examples used to exercise those assertions.

Conceptually:

```text
Adapter registration
        ↓
@redproof/adapter-tck
        ↓
shared contract assertions
        ↓
contract-tagged tests
```

The `runAdapterTck()` helper owns these reusable assertions. Adding a registered
Adapter does not require copying five separate assertion suites.

Register the Adapter beside its package tests in `adapter.tck.test.ts`, and it
participates in every applicable TCK contract selected by the root Gate. See the
[TCK package](../packages/adapter-tck/README.md) for the registration API.

---

## Why contract-tagged tests matter

The TCK emits tests tagged by contract.

The root Gate can therefore run something like:

```text
construction contracts
refusal contracts
purity contracts
capability contracts
evidence contracts
```

as separate lanes.

A failure can then breach a precise Rule such as:

```text
adapters/unavailable-execution-refuses
```

instead of producing one vague result such as:

```text
Adapter incompatible
```

That makes failures much easier to diagnose.

---

## What the TCK can and cannot prove

The TCK can verify that an Adapter registration behaves consistently.

But the registration is still trusted test code.

For example, a fake callback could claim:

```text
"this came from ESLint"
```

without ever running ESLint.

No reusable test kit can prove that a deliberately fake test double exercised the real external tool.

That is why built-in Adapters also keep real-tool fixtures.

The two layers work together:

```text
TCK
  ↓
Does the Adapter satisfy the shared contract?

Real-tool fixture
  ↓
Does that contract still hold against the actual tool?
```

---

## How the repository wires this together

Each registered built-in Adapter keeps its contract registration beside its
own package tests.

The root repository Gate orchestrates those tests. It currently runs the five
original contract suites alongside the five matching TCK lanes so their coverage
can be compared before any original suite is retired.

Construction, refusal, and capability scenarios exercise public Adapter behavior.
Structured-evidence scenarios exercise the pure evidence models; they do not
prove that the Adapter shell passes the correct selected Rules to those models.
Real-tool fixtures and the full test suite cover that wiring.

The dependency direction is deliberately one-way:

```text
adapter production
      │
      ▼
   redproof


adapter tests
      │
      ▼
@redproof/adapter-tck
      │
      └── peer/types ──▶ redproof


root Gate
      │
      ▼
adapter-owned TCK tests
```

There are three important constraints:

1. `redproof` does not depend on the TCK.
2. production Adapter code does not import the TCK.
3. the TCK does not import any built-in Adapter.

That keeps the published runtime dependency graph acyclic.

It also means external Adapter authors can reuse the same TCK without depending on Redproof's built-in integrations.

---

## How the contract Gate was built

The Gate follows the same [Contract-to-Gate method](./contract-to-gate.md) used elsewhere in Redproof.

### 1. Turn each guideline into an observable promise

For example:

```text
Guideline:
"Bad options should be rejected."

Observable contracts:
- empty Rule selection is rejected
- unknown options are rejected
- invalid paths are rejected
```

Do not test prose directly.

Turn it into behavior that can be executed.

---

### 2. Start with a RED probe

Before fixing the implementation, write a focused test that exposes the problem.

Examples include:

```text
empty ESLint Rule selection is accepted
unknown Adapter option is ignored
throwing custom runner escapes check.run()
```

Run the probe first.

It should fail before the implementation is corrected.

---

### 3. Fix the implementation

Make the smallest change needed to satisfy the contract.

Where possible, separate:

```text
external I/O
    ↓
structured data
    ↓
pure evidence translation
```

This often creates a cleaner boundary for both production code and contract testing.

---

### 4. Put each contract behind a Redproof Rule

The [repository Gate](../gates/adapter-contracts.ts) has five separate Rules:

| Contract | Rule ID |
| --- | --- |
| Construction | `adapters/options-validated-at-construction` |
| Refusal | `adapters/unavailable-execution-refuses` |
| Purity | `adapters/parsers-and-evidence-models-are-pure` |
| Capability | `adapters/report-capabilities-are-enforced` |
| Structured evidence | `adapters/breaches-require-structured-evidence` |

The contract suites are executed with Command Checks.

A test assertion failure reported by the command therefore means:

> The Adapter contract test failed.

It does **not** mean:

> The wrapped external tool produced a user-facing violation.

That distinction is important because this Gate protects Redproof itself.

---

### 5. Add causal RED proofs

Once the healthy contract Gate passes, add proof mutations that deliberately remove the protected behavior.

Examples:

```text
remove unknown-key rejection

add I/O to a pure evidence parser

drop a structured finding

stop converting runner errors to REFUSE
```

Each mutation should target the specific behavior named by the Rule.

Then:

```bash
npx redproof prove gates/adapter-contracts.ts
```

should confirm that the target Rule becomes red.

---

### 6. Add GREEN and REFUSE coverage

The proof suite should also establish that:

```text
healthy Adapter contracts
        ↓
       PASS
```

and:

```text
contract evidence cannot be trusted
        ↓
       REFUSE
```

For example, the repository has a REFUSE proof that causes a wrapped contract process to exceed its output budget.

---

### 7. Verify the real tool boundary

Fast contract tests are not the end of the verification chain.

Existing Adapter fixtures still run against the real integrations.

These fixtures verify outcomes such as:

```text
real violation
      ↓
     FAIL

healthy project
      ↓
     PASS

tool unavailable or evidence invalid
      ↓
     REFUSE
```

This closes the gap between the reusable contract model and the actual external tool.

---

## RED probe vs proof mutation

Keep these separate.

They happen at different stages and answer different questions.

```text
RED probe
"Can I expose the defect?"
        ↓
implementation
"Can I fix it?"
        ↓
redproof check
"Does the healthy project pass?"
        ↓
proof mutation
"Can I deliberately reintroduce the defect?"
        ↓
npx redproof prove gates/adapter-contracts.ts
"Does the Gate catch it?"
```

### RED probe

An ordinary focused test written before the implementation is corrected.

For example:

```text
Construct an Adapter with no Rules
and assert that construction throws.
```

Or:

```text
Provide a runner that throws
and assert that the Adapter returns REFUSE.
```

### Proof mutation

A deliberate regression introduced only after the healthy Gate passes.

For example:

```text
remove rejectUnknownKeys
```

or:

```text
remove one structured finding from the evidence model
```

The probe specifies the required behavior.

The proof mutation demonstrates that the guardrail protecting that behavior is effective.

---

## Adding another built-in Adapter

When introducing another Adapter, work through the contracts in this order.

### 1. Define valid construction

Provide the smallest valid configuration.

Then define invalid cases such as:

```text
empty Rule selection
unknown options
invalid paths
invalid combinations
```

### 2. Define unavailable execution

Identify how the integration fails when its dependency cannot run.

Verify that the public Adapter returns `REFUSE`.

### 3. Identify the evidence boundary

Ask:

> What structured value does the external tool give us?

Examples:

```text
messages
violations
mutants
test cases
report document
```

Keep translation from that value into Redproof evidence pure where possible.

### 4. Declare report capabilities

Only do this if the Adapter actually has selectable report formats.

Use `N/A` when the concept genuinely does not apply.

### 5. Register structured evidence scenarios

Provide examples for:

```text
selected violation
clean evidence
unselected violation
```

The TCK verifies the exact expected Breach identities.

### 6. Run the shared TCK

The registration should now participate in every applicable TCK lane selected
by the root Gate. Run `npm run test:adapter-tck` to build the packages and run
the shared kit and Adapter-owned suites.

### 7. Add a real-tool fixture

Finally, verify the same behavior against the actual integration.

This closes the boundary that the TCK intentionally cannot prove.

---

## What to record while adding an Adapter

For each contract, keep enough context for another contributor to understand why the behavior exists.

Record:

- the guideline being protected
- the executable probe
- the initial RED result
- the implementation decision
- important rejected alternatives
- the final `PASS`, `FAIL`, or `REFUSE` evidence

Prefer testing behavior over testing source-code spelling.

For example, test:

```text
unknown options are rejected
```

rather than:

```text
this exact helper function appears in this file
```

The main exception is architectural contracts such as purity, where Redproof intentionally analyzes the implementation structure.

---

## When is an Adapter sufficiently covered?

A contributor should be able to answer:

1. **What happens when its configuration is invalid?**
2. **What happens when its external dependency cannot run?**
3. **Where is external output translated into Redproof evidence?**
4. **Which Rules can its evidence actually support?**
5. **What structured evidence creates each Breach?**
6. **Does the shared TCK verify those contracts?**
7. **Does a real-tool fixture verify the actual integration boundary?**
8. **Can a proof mutation demonstrate that each important contract is genuinely protected?**

If those answers are clear, the Adapter has both fast contract coverage and real integration coverage.

---

## Next

- [Custom Adapter](./custom-adapter.md) — the behavioral promises Adapter authors should implement.
- [Contract-to-Gate](./contract-to-gate.md) — the reusable method used to build these Gates.
- [Red proving Redproof](./red-proving-redproof.md) — the larger self-hosted verification suite.
- [Built-in Adapters](./built-in-adapters.md) — the integrations available to Redproof users.

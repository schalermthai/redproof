# Gating Adapter contracts

The custom Adapter guidelines are executable contracts in this repository.
The `adapter-contracts` Gate runs on every check. Slower ESLint,
dependency-cruiser, Stryker, and Vitest fixtures then prove the same behavior
against the real tools.

The Gate covers construction, refusal, purity, capability, and evidence
selection. It reaches each contract at the level that is cheap to reach in
about one second. Construction, refusal, and capability run through the
Adapter. Evidence selection runs through the pure evidence models, not through
a real tool run. So the Gate does not prove that an Adapter passes the right
Rule to its evidence model. The fixtures and the full test suite cover that.

The reusable `@redproof/adapter-tck` package owns the shared assertions. Each
built-in Adapter keeps its declarative registration beside its own package
tests: construction, unavailable execution, structured evidence, purity, and
capability scenarios. The root Gate only orchestrates those package-owned
suites in five contract-filtered lanes. It still runs the original five suites
beside them so we can compare both implementations before retiring any coverage.

This page is a worked example of the reusable **[Contract-to-Gate method](contract-to-gate.md)**.

This split matters. A frequent contract Gate should identify which Adapter
promise broke in seconds. An integration fixture should show that the promise
still holds at the actual tool boundary. Neither replaces the other.

## The contract matrix

Not every guideline applies to every Adapter in the same way. The Gate records
the differences explicitly instead of forcing fake abstractions.

| Contract | ESLint | dependency-cruiser | Stryker | testing | Vitest | command runner |
| --- | --- | --- | --- | --- | --- | --- |
| Invalid options throw during construction | yes | yes | yes | yes | yes | yes |
| Unavailable execution becomes REFUSE | caught around the programmatic API | caught around the programmatic API | caught around the programmatic API | runner union plus Adapter mapping | missing binary through the command runner | missing binary and bad arguments |
| Parsers and evidence models are pure | ESLint evidence model | violation model | result and baseline models | report parsers and test model | shares the testing models | not applicable |
| Report capabilities reject unsupported Rules | not applicable | not applicable | not applicable | JUnit and Jest-compatible formats | shares the testing formats | not applicable |
| Breaches require structured evidence | lint messages | dependency violations | mutant results | normalized test cases | shares the testing models | not applicable |

“Not applicable” is part of the contract. ESLint, dependency-cruiser, and
Stryker expose programmatic results rather than a selectable report format, so
inventing report capabilities for them would make the design less honest.

## How the Gate was built

1. Start with one sentence from the Adapter guidelines and turn it into an
   observable promise. For example, “bad options throw” became probes for an
   empty Rule selection, an unknown option, and an invalid path.
2. Run the probes before changing the implementation. The first run confirmed
   that empty ESLint and dependency-cruiser Rule sets passed construction,
   unknown top-level options were ignored, and a throwing custom test runner
   escaped `check.run()`.
3. Separate evidence translation from I/O before testing it. ESLint message
   translation moved from its shell entrypoint into a pure model, matching the
   existing dependency-cruiser, Stryker, and testing models.
4. Give each guideline its own Redproof Rule. Command Checks run both the five
   original contract suites and the corresponding TCK lanes in parallel. A
   nonzero test exit breaches the contract being tested; it is not treated as
   evidence from the wrapped external tool.
5. Prove the Gate causally. Each Rule has a RED proof that removes or corrupts
   the behavior it protects. The suite also has a GREEN proof and a REFUSE proof
   that makes one wrapped contract process exceed its output budget.
6. Keep compile-time and runtime validation together. Public type probes reject
   unknown option keys for TypeScript consumers, while constructor probes cover
   JavaScript and type-stripped Gate loading.
7. Finish with the real adapters. Focused contract tests run frequently; the
   existing fixture portfolios still supply one RED proof per Adapter Rule plus
   GREEN and REFUSE outcomes against the external tools.

## A probe is not a proof mutation

Keep the first failing test separate from the later mutation proof. They answer
different questions:

```text
RED probe         = “Can I expose the defect?”
implementation   = “Can I fix it?”
redproof check   = “Does the healthy project pass?”
proof mutation   = “Can I deliberately reintroduce the defect?”
redproof prove   = “Does the Gate catch it?”
```

A RED probe is an ordinary focused test. For example, call an Adapter with an
empty Rule set and assert that construction throws, or give it a runner that
throws and assert that the Adapter returns REFUSE. The probe should fail before
the implementation is corrected and pass afterwards.

A proof mutation comes only after the healthy Gate passes. It changes the
implementation, configuration, or evidence model on purpose—for example,
removing `rejectUnknownKeys`, adding I/O to a pure parser, or dropping a
structured finding. `redproof prove` applies that mutation and checks that the
target Rule becomes red, then restores the workspace.

The probe specifies the behavior. The proof mutation demonstrates that the
guardrail is genuinely effective.

## What to record while adding another Adapter

For each contract, keep the guideline, the executable probe, the initial RED
result, the implementation decision, rejected alternatives, and the final
GREEN or REFUSE evidence together. This makes review easier and leaves enough
evidence to update this process without reconstructing it from Git history.

Prefer behavior over source spelling. The one structural contract here is
purity, and it uses the same TypeScript effect analysis as the architecture
Gate. Constructor, runner, capability, and evidence contracts execute the
public behavior they protect.

## The Adapter TCK

The `runAdapterTck()` helper owns every assertion. A registration must provide
a valid construction, bad-option probes, an unavailable execution, selected,
clean, and unselected structured evidence with the exact expected Breach
identities, a purity profile, and an explicit report-capability profile. ESLint,
dependency-cruiser, Stryker, the generic testing Adapter, and the Vitest
convenience Adapter are registered.

The TCK emits contract-tagged Node test cases. The existing Gate selects one
tag per command, so a failure still breaches the precise Redproof Rule rather
than a vague “Adapter incompatible” Rule. Adding another registration therefore
places the new Adapter under every applicable contract without editing five
assertion suites.

The registration remains trusted test code. The TCK can reject malformed or
inconsistent observations, but no test kit can prove that a deliberately fake
callback exercised the real Adapter. Adapter-owned probes should call the
public behavior they claim to observe; real-tool fixtures close that final
boundary.

The dependency direction is deliberate:

```text
adapter production ──▶ redproof
adapter tests      ──▶ @redproof/adapter-tck ──peer/types──▶ redproof
root Gate          ──▶ adapter-owned TCK tests
```

`redproof` never depends on the TCK, Adapter production never imports it, and
the TCK never imports a built-in Adapter. That keeps the published runtime graph
acyclic while making the same contracts reusable by external Adapter authors.

## Next

- **[Custom Adapter](custom-adapter.md)** for the promises these Gates enforce.
- **[Contract-to-Gate method](contract-to-gate.md)** for the reusable RED-probe,
   Check, and proof workflow.
- **[Red proving Redproof](red-proving-redproof.md)** for the complete self-hosted suite.
- **[Built-in Adapters](built-in-adapters.md)** for each supported tool.

---
name: redproof-gate-design
description: Turn an agreed domain concern into bounded Redproof Gates, Rules, evidence contracts, and brownfield enforcement frontiers. Use after the protected outcome is understood but before implementing its Check. Do not use to discover stakeholder priorities or to certify an existing Check.
---

# Redproof Gate Design

Turn an agreed Gate brief into the smallest promise that available evidence can
enforce honestly. Preserve the original domain concern even when the executable
Rule must be narrower.

## Confirm the input

Start from a Gate brief containing a protected outcome, stakeholders, failure
consequence, policy source, existing enforcement, policy status, and explicit
stage authorization. Proceed only when an accountable human recorded
`approved-for-design`, `approved-for-experiment`, or `approved-for-adoption`.
If those inputs are missing or disputed, return to
`$redproof-domain-discovery`.

Do not let a convenient scanner, command, or file pattern redefine the outcome.

## Recommend a useful first scope

Separate the recommendation into **Do first**, **Decide**, and **Do later**:

- **Do first:** the smallest change that meaningfully protects the selected
  outcome, not merely the easiest observable signal. Explain its benefit, existing
  control to reuse, minimum evidence mechanism, effort/maintenance tradeoff, and
  exclusions. Native tests or an existing Check may be enough; a new Gate is not
  a required outcome. This is a recommendation, not permission to implement.
- **Decide:** only unresolved choices requiring accountable judgment about policy,
  supported behavior, exceptions, ownership, or accepted risk. Recommend an option
  and tradeoff where possible; say which part depends on the answer. Do not turn
  parser selection, test mechanics, or ordinary error handling into approval
  blockers unless they change those choices. If none remain, say so; do not
  manufacture a decision list. Proposed defaults are not confirmed policy.
- **Do later:** optional strengthening or broader coverage, with the added benefit
  and the condition that would make it worthwhile. Do not fully design speculative
  extensions or make the first increment depend on their evidence inputs.

Evidence needed to trust the first promise belongs in **Do first**, not **Do
later**. If its minimum mechanism is unresolved, identify the technical question
or narrow the promise explicitly; do not claim readiness or silently weaken PASS.
Keep an honest, useful first increment rather than a comprehensive assurance
system. Continue unaffected design work while material decisions remain open.

## Design bounded Rules

Use [rule-contract.md](references/rule-contract.md) for every Rule. A bounded
Rule states one observable promise and makes its evidence boundary visible.

Define:

- an allowed example and a violating example;
- a precise policy or evidence source for every material clause in the Rule;
- the evidence source and its authority;
- what PASS proves and explicitly does not prove;
- what FAIL establishes;
- when the Check must REFUSE because evidence is missing, malformed, stale,
  ambiguous, incomplete, unsafe, or unclassifiable;
- ownership, cadence, and failure response.

The protected outcome of a Gate must be no broader than the combined `PASS
proves` statements of its Rules. A static prerequisite must not be described as
runtime behavior. If evidence establishes only a prerequisite, name that
prerequisite. Narrow or split the Rule when evidence cannot support its wording.

Evidence completeness is part of the contract. Before PASS is possible, define
how the Check knows it inspected the whole promised scope. Successful execution
with empty, partial, or silently skipped evidence is not enough.

Trace the Rule clause by clause. Every material inclusion, prohibition,
exception, comparison base, and scope boundary must cite supporting policy or
evidence, or remain an explicit open question. Do not silently add a convenient
category—such as treating copies as renames—when the cited policy only discusses
edits and additions. Record counterevidence considered before fixing the Rule's
meaning.

Cross-check the cited policy's relevant worked examples, exceptions, and nearby
implementation before calling its meaning confirmed. When they conflict, show
the conflicting sources and plausible interpretations; do not invent a waiver or
assume an example is wrong. Isolate the affected clause and the clarification
needed. This is a targeted consistency check, not exhaustive repository research.

## Compose existing enforcement deliberately

Inventory the project's native lint, test, architecture, build, and CI extension
points as well as its expert tools and existing controls. Before designing a
custom Check, ask where the project would naturally enforce this Rule without
Redproof. Prefer adding or improving the Rule in that native slot, then have
Redproof invoke and prove it.

Choose the smallest honest integration:

1. Use `command()` when the native executable has trustworthy exit semantics and
   its diagnostics are sufficient for one bounded Rule.
2. Create or reuse an Adapter when the native tool provides structured findings,
   maps to several Rules, or needs tool-specific evidence validation and REFUSE
   semantics.
3. If the native tool is not safely callable at the required cadence, first try
   to add a machine-readable mode, expose a reusable decision core, or run its
   focused native test.
4. Implement duplicate detection inside a custom Check only as a last resort.
   Bound it to the smallest literal contract, record why reuse was impossible,
   and define how drift from the authoritative implementation will be detected.

Compare the proposed integration with the simplest plausible alternative:
extending the existing in-process Check or native test, native enforcement alone,
or a focused native executable plus `command()`.
A weakness in today's compound command does not establish that an improved,
focused command needs an Adapter. If choosing an Adapter, identify the concrete
evidence or verdict distinction the simpler option cannot preserve, and its
maintenance cost. Structured output alone is not a reason to parse it in Redproof
if native validation and a simpler wrapper can preserve the required semantics.

Apply that comparison to the whole first increment, including proposed parsers,
inventories, snapshot mechanisms, and test protocols—not just its wrapper. State
what each added mechanism establishes that existing evidence cannot. When old and
new controls overlap, explain their reuse, replacement, or intentional coexistence;
do not require a new CLI merely to make existing decision code callable.

Do not treat exit code `0` as trustworthy merely because a command ran. Confirm
that the tool distinguishes compliant, violating, and unavailable or invalid
evidence. If it cannot, improve the integration or REFUSE rather than translating
an ambiguous result into PASS.

Redproof should normally govern and prove native enforcement, not become a
second weaker implementation of it. Redproof overlap is justified when it adds
concrete value such as:

- explicit PASS, FAIL, and REFUSE semantics;
- composition across authoritative signals;
- a brownfield frontier or ratchet;
- RED proofs of the integration and selected configuration;
- governance, attestation, or a more useful cadence.

Record that value. A wrapper that adds no demonstrated assurance should be
rejected or deferred.

## Keep Gates cohesive

Group Rules only when they protect the same stakeholder-visible outcome and
normally share the owner, review conversation, cadence, failure response, and
lifecycle. Sharing a tool, directory, language, or subsystem is insufficient.

## Choose the brownfield frontier

When the repository cannot satisfy the end state immediately, choose a frontier
that permits improvement without regression: changed code, new behavior, a
scoped exception inventory, or a versioned semantic baseline.

For a ratchet, read [ratchet-design.md](references/ratchet-design.md). Define
semantic identity, provenance, moves and renames, growth, shrinkage, stale
entries, resurrection, unknown evidence, ownership, and retirement. If a Check
compares base and current inventories, every item in both `current - base` and
`base - current` needs an explicit PASS, FAIL, or REFUSE meaning.

## Preserve policy status, authorization, and remainder

Preserve the Gate's policy status separately from stage authorization. Only a
`confirmed` Rule with `approved-for-adoption` may become production policy. A
Rule with `approved-for-experiment` may be built to learn without being
presented as adopted, whatever the strength of its repository evidence.

When the executable Rule covers only part of the Gate brief, record the
**deferred domain remainder**. Do not silently equate what is easy to observe
with everything stakeholders care about.

## Produce the handoff

Lead with a concise **Do first / Decide / Do later** recommendation. Keep the
supporting contracts for the selected first scope below it; share common evidence
details rather than repeating them for each Rule. Deferred extensions need their
benefit and boundary, not a full implementation design.

Produce one contract per Rule:

```text
Domain concern:
Gate:
Bounded Rule:
Policy status:
Stage authorization:
Policy source and strength:
Policy clause traceability:
Counterevidence considered:
Allowed example:
Violating example:
Evidence source and authority:
Evidence completeness obligation:
Native enforcement slot:
Integration choice: command() | Adapter | custom Check
Why this is the smallest honest integration:
PASS proves:
PASS does not prove:
FAIL means:
Check-level REFUSE conditions:
Enforcement frontier:
Existing enforcement and incremental Redproof value:
Owner / cadence / failure response:
Deferred domain remainder:
Open questions:
```

Stop before claiming the Check is trustworthy. Do not hand off to certification
while the comparison base, policy scope, exception owner, lifecycle, evidence
completeness, or failure response remains material to the Rule and unresolved.
The next stage is `$redproof-gate-certification` only when the Rule evidence
contract is agreed and implementation or review is explicitly authorized. If
implementation exposes a contract mismatch, return here and revise the design
explicitly.

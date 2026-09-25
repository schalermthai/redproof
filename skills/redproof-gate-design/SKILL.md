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
consequence, policy source, existing enforcement, and readiness. If those are
missing or disputed, return to `$redproof-domain-discovery`.

Do not let a convenient scanner, command, or file pattern redefine the outcome.

## Design bounded Rules

Use [rule-contract.md](references/rule-contract.md) for every Rule. A bounded
Rule states one observable promise and makes its evidence boundary visible.

Define:

- an allowed example and a violating example;
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

## Compose existing enforcement deliberately

Inventory expert tools and existing controls. Prefer their authoritative output
over reimplementing weaker analysis. Redproof overlap is justified only when it
adds concrete value such as:

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

## Preserve readiness and remainder

Use exactly one Rule readiness state: `candidate`, `proposed`, `confirmed`,
`experiment-only`, `deferred`, or `rejected`. Record policy-source strength
separately. Only `confirmed` Rules may become production policy; an
`experiment-only` Rule may be built to learn without being presented as adopted.

When the executable Rule covers only part of the Gate brief, record the
**deferred domain remainder**. Do not silently equate what is easy to observe
with everything stakeholders care about.

## Produce the handoff

Produce one contract per Rule:

```text
Domain concern:
Gate:
Bounded Rule:
Readiness:
Policy source and strength:
Allowed example:
Violating example:
Evidence source and authority:
Evidence completeness obligation:
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

Stop before claiming the Check is trustworthy. The next stage is
`$redproof-gate-certification`. If implementation exposes a contract mismatch,
return here and revise the design explicitly.

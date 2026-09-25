---
name: redproof-gate-certification
description: Implement, prove, and adversarially certify a Redproof Gate against an agreed Rule evidence contract. Use when the protected outcome and evidence boundary are already defined and the task is to build or review the Check, validate RED/GREEN/REFUSE behavior, or decide whether the Gate deserves trust. Do not use to infer project policy from repository patterns.
---

# Redproof Gate Certification

Determine whether a Check deserves trust for its agreed, bounded promise. A
passing healthy baseline is necessary but insufficient.

## Confirm the contract

Require a Rule evidence contract that defines the bounded promise, evidence
source and authority, evidence completeness, PASS and FAIL meaning, Check-level
REFUSE conditions, enforcement frontier, and readiness.

Return to `$redproof-gate-design` if those are missing, contradictory, or wider
than the evidence. Return to `$redproof-domain-discovery` if the protected
outcome itself lacks stakeholder value or authority. Do not silently narrow the
contract during implementation or review.

Implement a Check only when the user has authorized implementation. Experiments
remain `experiment-only`; a successful proof does not promote them into policy.

## Implement an honest Check

Keep evidence translation separate from I/O when practical so the decision
model can be tested directly. Use Redproof verdicts precisely:

- PASS: complete, trustworthy evidence establishes the bounded promise;
- FAIL: trustworthy evidence identifies a violation of a targeted Rule;
- REFUSE: evidence is missing, malformed, incomplete, stale, unsafe, or cannot
  support an honest decision.

Tie diagnostics to the Rule and evidence that produced the verdict. Empty or
silently skipped evidence is not PASS unless the contract explicitly establishes
why emptiness is complete and valid.

## Run the author proof portfolio

Read [adversarial-proof-checklist.md](references/adversarial-proof-checklist.md).
For every important, non-trivial Rule, establish at least:

- a primary RED mutation for the intended regression;
- an alternate RED using a materially different representation or escape path;
- a meaningful GREEN counterexample that resembles a violation but is allowed;
- a REFUSE proof for unavailable or untrustworthy evidence.

Validate the defect independently of the Gate verdict. A syntax error, broken
fixture, crash, or unrelated failure is not proof of the intended Rule. Confirm
the expected diagnostic, restore the mutation, and return the same scope to
GREEN.

## Conduct a distinct adversarial review

After the author portfolio passes, run a separate falsification stage. When an
independent reviewer is available and authorized, prefer someone other than the
Check author. Give the reviewer the contract, implementation, and healthy
baseline, but do not restrict them to the author's mutations.

Challenge alternate syntax, aliases, indirect forms, valid counterexamples,
wrong-reason failures, evidence disappearance, partial inventories, moves,
renames, collisions, growth, shrinkage, stale baselines, and successful evidence
producers that emit no usable evidence—as relevant to the contract.

An escaped attack is a result, not a reason to weaken the mutation. Choose
explicitly among hardening the Check, narrowing or splitting the Rule, delegating
to a more authoritative tool, deferring adoption, or rejecting the guardrail.
Contract changes return to Gate design before certification resumes.

## Issue a trust decision

Produce a certification record:

```text
Rule contract reference:
Check implementation:
Healthy baseline:
Author RED / GREEN / REFUSE proofs:
Independent attacks:
Escapes and wrong-reason failures:
Restoration confirmation:
Known blind spots:
Readiness and authority:
Decision: TRUSTED | NOT TRUSTED
Disposition:
```

Use `TRUSTED` only when the implementation supports the full recorded contract,
the proof mutations genuinely create the claimed conditions, the evidence
completeness obligation is met, adversarial findings are resolved, and the
working tree is restored. Otherwise use `NOT TRUSTED` and say which earlier
stage or implementation work is required.

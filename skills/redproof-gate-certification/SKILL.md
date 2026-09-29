---
name: redproof-gate-certification
description: Implement, prove, and adversarially certify a Redproof Gate, then deliver an interactive HTML comparison of the agreed design and verified results. Use to build or review a Check against a defined evidence contract, validate RED/GREEN/REFUSE behavior, or report certification outcomes. Do not use to infer project policy from repository patterns.
---

# Redproof Gate Certification

Determine whether a Check deserves trust for its agreed, bounded promise. A
passing healthy baseline is necessary but insufficient.

## Confirm the contract

Require a Rule evidence contract that defines the bounded promise, evidence
source and authority, evidence completeness, PASS and FAIL meaning, Check-level
REFUSE conditions, enforcement frontier, policy status, clause traceability,
counterevidence considered, and stage authorization.

Return to `$redproof-gate-design` if those are missing, contradictory, or wider
than the evidence. Return to `$redproof-domain-discovery` if the protected
outcome itself lacks stakeholder value or authority. Do not silently narrow the
contract during implementation or review.

Implement or certify a Check only with `approved-for-experiment`,
`approved-for-implementation` (local build/proof, not adoption), or
`approved-for-adoption` authorization from an accountable human. A technically
`TRUSTED` experiment remains an experiment; successful proof does not confirm
policy or authorize adoption.
An actual Gate Design review submission can carry this authorization. Preserve
its selected scope, work location, notes and stopping point; do not require the
same approval again or treat preview/test selections as user authorization.

## Carry implementation through to its finish line

For `approved-for-implementation`, deliver the Gate definition, Check and proof
portfolio for the selected scope, then run and review them against the actual
target project and evidence producer. A safe copy changes where this happens,
not what counts as complete. Continue through the stages below; another design
document or a successful fixture-only prototype does not fulfill implementation.

Check technical prerequisites early and resolve them within existing authority.
If required tooling, dependencies, safe isolation or permissions are unavailable,
complete unaffected work, then report the precise blocker and next needed action.
Do not silently replace real integration with simulated evidence or call a
blocked implementation a completed experiment. If actual evidence cannot support
the contract, return to design explicitly. An authorized feasibility experiment
retains its bounded question and stopping point; it is not implementation approval.

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
Implementation status: implemented-and-verified | partially-implemented | blocked
Actual target/tool and revision:
Real-project evidence versus controlled-fixture evidence:
Healthy baseline:
Author RED / GREEN / REFUSE proofs:
Independent attacks:
Escapes and wrong-reason failures:
Restoration confirmation:
Known blind spots:
Policy status and authority:
Stage authorization:
Decision: TRUSTED | NOT TRUSTED
Disposition:
Remaining work / blocker / next action:
```

Use `TRUSTED` only when the implementation supports the full recorded contract,
the proof mutations genuinely create the claimed conditions, the evidence
completeness obligation is met, adversarial findings are resolved, and the
working tree is restored. Otherwise use `NOT TRUSTED` and say which earlier
stage or implementation work is required.

Use `implemented-and-verified` only when the selected implementation, actual
integration, proof portfolio, adversarial review and mutation restoration are
complete. With code written but validation incomplete, report
`partially-implemented` and the blocker; with work prevented before implementation, report
`blocked`. Keep these delivery statuses separate from the Check's PASS/FAIL/REFUSE
verdicts and from an explicitly limited experiment's result. Restoration means
removing proof mutations while preserving the implementation and user changes.

Return a concise result per selected Gate: what was built and where, what ran
against the real project/tool, which proofs passed or failed, what remains,
and the recommended next action. Do not summarize mixed results as “all done.”

`TRUSTED` is a technical statement about the recorded contract, not permission
to install, merge, or adopt the Gate. Adoption still requires confirmed policy
and `approved-for-adoption` authorization.

## Deliver the results review

Read [results-handoff.md](references/results-handoff.md). A technical certification
record alone is not a complete handoff. Deliver beginner-friendly HTML plus a
concise Markdown fallback, including partial and blocked Gates. Compare the
approved design with actual implementation and proof results, explain what was
learned and improved, and recommend the next useful action.

Lead with what the user received, what remains uncertain and what to do next.
Write a short owner-facing layer before adding technical detail; use the helper's
reader summaries and labelled disclosures for full evidence and describe blocks.
Keep blockers and scope limits visible, with next-step choices before learning
and audit detail. When a browser is available, inspect the page at wide and
narrow sizes; report unavailable views. Schema-valid HTML alone does not
establish a good handoff.

Use [the shared review helper](../redproof-review-ui/SKILL.md) in `certification`
stage to collect scoped follow-up choices. Do not invent another server or
relabel results as a design proposal. Preserve original design/approval records;
new selections authorize only the displayed next work, never retroactive approval,
an altered trust result, CI adoption or publication. If the user requested only
a report or skill evaluation, use a preview; honor explicit format/no-file limits.

Close with the actual outcome per Gate, a prominent results HTML link, the key
learning and recommended next step. Distinguish report generation/UI validation
from execution or independent certification; do not rerun proofs merely to fill
the page. Apply the reference's acceptance checks before calling delivery complete.

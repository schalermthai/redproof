---
name: redproof-domain-discovery
description: Discover and align the domain, architectural, operational, and modernization outcomes an existing repository should protect with Redproof. Use before Rule or Check design when the important guardrails are not yet agreed. Do not use when a specific Gate outcome is already agreed and only its evidence contract or implementation remains.
---

# Redproof Domain Discovery

Discover what the project should protect before deciding what can be checked.
The output is an agreed or explicitly unresolved Gate brief, not implementation
work and not a list of repository patterns promoted into policy.

Start with:

> What should this project protect?

Do not start with:

> What checks can we write?

Repository evidence reveals possible constraints. The user, an accountable
maintainer, or an authoritative project source establishes which constraints are
intentional.

## Scope the discovery

Clarify the repository, modernization seam, stakeholders, and decisions in
scope. Do not modernize the system, design detailed Checks, or install policy as
part of this skill unless the user separately asks for that work.

Inspect enough evidence to understand promises and failure costs. Useful sources
include architecture documents, ADRs, APIs, schemas, migrations, tests, CI,
deployment assumptions, compatibility layers, ownership, security boundaries,
generated artifacts, and relevant history.

Look for consequential concerns such as:

- user- or business-visible behavior;
- dependency direction and ownership boundaries;
- public compatibility and data integrity;
- transaction and delivery guarantees;
- operational recovery and failure handling;
- containment or retirement of legacy behavior.

Do not convert style, popularity, repetition, or incidental consistency into a
guardrail.

## Separate observation from policy

Record candidates with
[candidate-inventory.md](references/candidate-inventory.md). For each candidate,
identify the consequence, policy source, contradictory evidence, current
enforcement, accountable stakeholder, and unresolved questions.

Classify the concern as one of:

- preservation: healthy behavior that should remain true;
- regression prevention: a known failure that must not return;
- direction of travel: legacy debt that must not grow while it is removed.

Reject or defer candidates that are low consequence, adequately enforced,
unsupported by authority, contradicted by legitimate behavior, or too vague to
describe as a stakeholder-visible outcome. Deferral is a successful discovery
result.

## Converge in Gate language

Describe each candidate Gate as a protected outcome and use concrete examples
to challenge it. A productive loop is:

```text
describe -> ask questions -> test examples -> revise -> describe again
```

Ask:

- Who is harmed if this fails, and how?
- Which source makes this intentional rather than inferred?
- Which apparent exceptions are legitimate?
- Is this one outcome or several unrelated concerns?
- Does existing enforcement already protect it adequately?
- Is the intent to preserve, prevent recurrence, or ratchet improvement?

Keep technical detection ideas as notes only. They may inform feasibility, but
they do not define the domain promise.

## Record readiness honestly

Use exactly one state:

- `candidate`: observed but not appraised;
- `proposed`: credible enough for stakeholder discussion;
- `confirmed`: authorized as production policy;
- `experiment-only`: safe to explore, not authorized as policy;
- `deferred`: plausible but missing evidence or a decision;
- `rejected`: unsuitable or unintended.

Record the strength and source of policy evidence separately. Automated
classification, repository consistency, or a simulated reviewer cannot confirm
policy.

## Produce the handoff

For each surviving concern, produce a compact Gate brief:

```text
Gate:
Protected domain outcome:
Stakeholders:
Failure consequence:
Category:
Policy source and strength:
Contradictory or exception evidence:
Existing enforcement and remaining gap:
Readiness:
Open questions:
```

Stop before choosing the exact Rule or Check. The next stage is
`$redproof-gate-design`, which may narrow one Gate brief into one or more
enforceable promises. Preserve any domain remainder that the evidence cannot
cover rather than silently losing it.

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

Before concluding discovery, deliberately sample each relevant concern class:

- stakeholder-visible and business behavior;
- operational behavior and data integrity;
- public contracts and compatibility;
- architecture and ownership boundaries;
- modernization direction and legacy retirement.

Do not invent a candidate for every class. Record which classes were sampled,
were out of scope, or produced no credible candidate. This breadth check prevents
the easiest written engineering policy from crowding out the project's core
domain promises.

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

Before promoting a candidate to `proposed` or `confirmed`, actively search for
counterevidence: exceptions, waivers, deprecations, compatibility windows,
lifecycle or retirement rules, supersession or replacement behavior, alternate
release or branch paths, and relevant history when available. A squash,
replacement, or supported deprecation can change the meaning of an apparently
absolute rule. Record unavailable history as uncertainty; do not report “no
contradiction” unless this search was actually performed.

Classify what the counterevidence does:

- **invalidates**: the proposed outcome conflicts with intended behavior;
- **narrows**: the outcome remains valid for a smaller scope;
- **defines an exception or lifecycle**: the outcome remains valid when the
  exception, authority, and retirement path are explicit;
- **leaves unresolved uncertainty**: more evidence or an accountable decision is
  required.

Do not automatically discard a consequential candidate merely because intended
exceptions exist. Narrow it or expose its exception lifecycle when the underlying
outcome remains valid. Reject it only when the counterevidence defeats the
outcome itself.

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

Keep the protected outcome separate from the proposed assurance mechanism. For
example, “supported upgrades preserve data” is an outcome; “run the migration
matrix before merge” is a cadence proposal that still needs approval.

## Map authoritative policy to existing controls

Before ranking the portfolio, build a small policy-to-control gap map using the
template in
[candidate-inventory.md](references/candidate-inventory.md) under
“Policy-to-control gap map.”
Select consequential, authoritative promises from the sampled concern classes,
especially explicit requirements, prohibitions, guarantees, and lifecycle
commitments. Interpret their meaning; do not promote every sentence containing
`must`, `never`, or `required`.

For each selected promise, identify the native control that claims to enforce it
and inspect the control's actual scope, cadence, exceptions, and failure
behavior. Classify coverage as:

- `full`: the authoritative control covers the promised scope;
- `partial`: some promised cases, paths, or decision points escape;
- `none`: no control was found;
- `unknown`: available evidence cannot establish coverage.

Record the uncovered scenario rather than merely saying that enforcement is
weak. Preserve intended exceptions and lifecycle operations explicitly.

Choose the smallest appropriate response:

- recommend a focused native test or control fix when that fully closes the gap;
- retain a Redproof candidate when Redproof adds material assurance through
  composition, PASS/FAIL/REFUSE semantics, proof of the integration, a ratchet,
  governance, or a more useful decision cadence;
- reject or defer a Redproof Gate when it would only wrap a sufficient native
  control or ceremonialize a small missing assertion.

This map is a recall aid, not authorization and not a requirement to turn every
policy gap into a Gate.

## Use independent review for broad discovery

When the repository spans several domains, the consequences are high, multiple
candidates compete, or the policy-to-control map is likely incomplete, use the
two independent passes in
[independent-review.md](references/independent-review.md) when fresh reviewers
are available and their use is authorized.

1. Before drafting the final Gate portfolio, have a fresh gap reviewer inspect
   the repository and scope without seeing the primary shortlist or expected
   Gates. Use it to find missed policies, incomplete controls, and native fixes.
2. After drafting the portfolio, have a different maintainer-lens reviewer
   challenge stakeholder value, policy fit, control coverage, cost, exception
   burden, native alternatives, and incremental Redproof value.

Reconcile findings with repository evidence and record material disagreements.
Reviewer recommendations are decision support only. A simulated maintainer does
not confirm policy, grant stage authorization, or substitute for an accountable
human. For a narrow, already-agreed concern, skip this panel rather than adding
ceremony.

## Converge the portfolio

Before asking for approval, compare the surviving candidates rather than
presenting them as an unranked list. Use evidence-backed `high`, `medium`, or
`low` judgments for:

- stakeholder consequence;
- policy strength;
- uncovered assurance gap;
- practical enforceability through an authoritative native control;
- implementation and recurring execution cost;
- incremental Redproof value;
- unresolved exception or lifecycle burden;
- confidence in the evidence.

Prefer a candidate with a consequential, explicit policy, a concrete weak spot,
and a cheap authoritative enforcement path over a broader candidate whose
evidence would be expensive or ambiguous. This is prioritization, not permission
to design the Rule.

Use the policy-to-control map for one final missed-opportunity pass:

> Is there an explicit, consequential policy with weak enforcement and a cheap
> authoritative native check that the current shortlist missed?

Revisit any unmapped or partially covered high-consequence promise when the
answer might be yes. Do not require a particular candidate or promote a
low-value technical rule merely because it is easy to scan.

Produce a short ranked portfolio with the recommendation `approve-for-design`,
`approve-for-experiment`, `approve-for-adoption`, `defer`, or `reject` and the
tradeoff that drives it. Recommend adoption only for confirmed policy.
The recommendation is decision support only; stage authorization remains
`pending` until an accountable human decides.

## Separate policy status from stage authorization

Record exactly one policy status:

- `candidate`: observed but not appraised;
- `proposed`: credible enough for stakeholder discussion;
- `confirmed`: authorized as production policy;
- `deferred`: plausible but missing evidence or a decision;
- `rejected`: unsuitable or unintended.

Record the strength and source of policy evidence separately. Automated
classification, repository consistency, or a simulated reviewer cannot confirm
policy.

Separately record stage authorization:

- `pending`;
- `approved-for-design`;
- `approved-for-experiment`;
- `approved-for-adoption`.

Repository evidence can confirm the meaning of a policy, but it does not grant
the agent permission to change enforcement. Before handoff, ask the user or an
accountable maintainer to approve the Gate for design, approve an isolated
experiment, approve adoption, defer it, or reject it. Without that explicit
decision, leave stage authorization `pending` and stop after the Gate brief.

## Produce the handoff

For each surviving concern, produce a compact Gate brief:

```text
Gate:
Protected domain outcome:
Stakeholders:
Accountable policy owner:
Failure consequence:
Category:
Policy source and strength:
Precise source citation:
Contradictory or exception evidence:
Existing enforcement and remaining gap:
Portfolio priority and recommendation:
Independent review and unresolved disagreement:
Policy status:
Stage authorization:
Open questions:
```

Use exact repository paths and sections or line ranges for promoted evidence
when available. Stop before choosing the exact Rule or Check. Only a Gate brief
with explicit `approved-for-design`, `approved-for-experiment`, or
`approved-for-adoption` authorization may advance to `$redproof-gate-design`,
which may narrow it into one or more enforceable promises. Preserve any domain
remainder that the evidence cannot cover rather than silently losing it.

End with the same explicit decision menu for every shortlisted Gate: approve for
design, approve an isolated experiment, approve for adoption, defer, or reject.

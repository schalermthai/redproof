---
name: redproof-domain-discovery
description: Discover the important outcomes an existing repository should protect with Redproof, draft Gate descriptions, and let the user choose Gates in a local interactive report. Use when guardrail priorities are not yet agreed. Do not use when a specific outcome is agreed and only its evidence contract or implementation remains.
---

# Redproof Domain Discovery

Discover what the project should protect, then assess what protection needs to
change. Present a beginner-friendly decision summary and visual report, backed
by a compact protected-outcomes map and ranked recommendations. Produce Gate
briefs only where Gate work is justified, with a draft in real Redproof
`describe` syntax for every Gate presented in the final portfolio.

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
part of this skill unless the user separately asks for that work. Draft Rules,
plausible Checks and conceptual proof cases are part of discovery: they make the
proposal discussable, not implementation-ready or approved.

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

When the project changes files, copies workspaces, starts processes, deploys, or
restores state, also inspect the operational boundaries it promises. Trace a
representative effect from its public entry point through execution and cleanup.
Consider paths outside the intended root, absolute/parent paths, symlink targets,
shared or linked dependencies, subprocess lifetime, and whether failed operations
or restoration leave observable changes. Check relevant assertions and exception
paths; the presence of an isolation test suite alone does not establish coverage.
Record deliberate access outside the workspace and limits of the trust model.
These are inspection prompts, not mandatory policies for every project. Route a
direct implementation defect to a native fix; separately assess whether proving
that safeguard's regression detection adds value.

Look for consequential concerns such as:

- user- or business-visible behavior;
- dependency direction and ownership boundaries;
- public compatibility and data integrity;
- transaction and delivery guarantees;
- operational recovery and failure handling;
- containment or retirement of legacy behavior.

Do not convert style, popularity, repetition, or incidental consistency into a
guardrail.

## Research the important promises in depth

For broad repository discovery, read
[research-depth.md](references/research-depth.md). Research in both directions:
from consequential promises to their controls, and from existing controls to the
promises their assertions protect. Inspect the project's verification entry
points, test groups, native tool configuration (including hidden configuration
files), and delivery steps before concluding the inventory is sufficient.

Spend depth on likely high-impact failures, common change paths, explicit
commitments and coverage uncertainty. Preserve distinct promises within broad
outcomes when their failure cases, evidence or exceptions differ. A list of test
suite names is not a substitute for describing those promises. This is an 80:20
prioritization goal, not a claim to have measured 80% of all possible risks.

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

Reject outcomes that are incidental, invalidated, or too vague to explain. Keep
credible outcomes visible even when they are already protected or their coverage
is unknown. Reject or defer the proposed new control separately when it duplicates
adequate enforcement or lacks evidence, authority, or value.

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

Express plausible detection ideas in the draft describe block, preferring
existing project controls. They inform feasibility but do not define the domain
promise. Keep assumptions and unresolved evidence/tool capabilities beside the
draft; Gate Design will verify and refine them after the human selects the work.

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

For each selected promise, identify the existing Gate or native control that claims to enforce it
and inspect the control's actual scope, cadence, exceptions, and failure
behavior. Classify coverage as:

- `full`: the authoritative control covers the promised scope;
- `partial`: some promised cases, paths, or decision points escape;
- `none`: no control was found;
- `unknown`: available evidence cannot establish coverage.

Record the uncovered scenario rather than merely saying that enforcement is
weak. Preserve intended exceptions and lifecycle operations explicitly.

Assess **demonstrated detection** separately from coverage: what evidence shows
this control catches the specific regression it claims to catch? Inspected
assertions and healthy passing runs do not alone demonstrate that. Use the
proof-value appraisal in [candidate-inventory.md](references/candidate-inventory.md)
for consequential controls before rejecting Gate work as duplication. Reusing a
native control as evidence and proving its detection is not reimplementing it.

Choose the smallest appropriate response:

- recommend a focused native test or control fix for a behavior/coverage gap;
- consider proving an existing safeguard when a bounded regression proof adds
  worthwhile detection confidence; a native fix and a proof can be complementary;
- retain a Redproof candidate when Redproof adds material assurance through
  composition, PASS/FAIL/REFUSE semantics, proof of the integration, a ratchet,
  governance, or a more useful decision cadence;
- reject or defer a Redproof Gate when the appraisal finds no worthwhile added
  assurance, not merely because a native test exists or can be improved.

This map is a recall aid, not authorization and not a requirement to turn every
policy gap into a Gate.

## Separate protected outcomes from recommended changes

Use the policy-to-control map as the **protected-outcomes portfolio**. Retain
important promises with their policy evidence and coverage, including those
already protected and those whose enforcement cannot be inspected. Unknown
coverage means investigate; it does not make the promise unimportant or prove
that protection is absent.

Create a separate, ranked **action portfolio** linked to those outcomes. For
each outcome, record: keep existing protection, investigate coverage, improve an
existing Gate/control, fix a native defect, prove an existing safeguard, consider
a new Gate, or reject the proposed control. Only a concrete behavior or
detection-assurance gap with incremental Redproof value warrants a
new Gate brief. When an existing Gate owns the promise, identify the amendment
instead of presenting a renamed Gate. A change in control recommendation must
not silently erase the protected outcome.

These can be two short sections in one artifact; do not duplicate the evidence.

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

Before asking for approval, compare the recommended changes rather than
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
to finalize or implement a Rule; draft wording remains open to revision.

Use the policy-to-control map for one final missed-opportunity pass:

> Is there an explicit, consequential policy with weak enforcement and a cheap
> authoritative native check that the current shortlist missed?

Also ask whether a consequential existing control's detection claim was accepted
without evidence or a reasoned proof-value decision. Zero new Gates is valid;
unknown detection alone is neither a defect nor a mandate to add one.

Revisit any unmapped or partially covered high-consequence promise when the
answer might be yes. Do not require a particular candidate or promote a
low-value technical rule merely because it is easy to scan.

Reconcile the research record before finalizing: every consequential promise
identified by either worker must map to an explicit protected clause or a
reasoned narrowing, resolution or rejection. Include earlier findings when they
are supplied in the task; do not search outside the authorized evidence boundary
for them. Preserve the concrete failure case when grouping findings, and report
important uninspected areas instead of implying complete coverage.

For Gate additions or amendments in the action portfolio, give the recommendation `approve-for-design`,
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
- `approved-for-implementation` (local build/proof only, not adoption);
- `approved-for-adoption`.

Repository evidence can confirm the meaning of a policy, but it does not grant
the agent permission to change enforcement. At handoff, let the user select
Gates for design, later or skip in the local review. Without an explicit decision,
leave stage authorization `pending` and stop after the Gate brief and draft
describe block. Writing that draft does not require design-stage approval.
Preserve any separately granted experiment/implementation/adoption authority,
but do not offer premature implementation or adoption in the discovery selector.

## Produce the handoff

Read [beginner-handoff.md](references/beginner-handoff.md) before presenting the
results. Lead with what to protect, why it matters, what already works, and the
next decision—not the research schema. For broad discovery, provide a short
Markdown summary and a self-contained HTML report alongside the detailed
research. Use diagrams, concrete examples and short source excerpts only when
they make the finding or choice easier to understand. They must not turn a
hypothesis into a confirmed defect or a proposal into implemented protection.

Keep the outcome map, evidence, exceptions and reviewer reconciliation linked
from the report. Simplify the entry point, not the research. Clearly separate
new Gate candidates, amendments, ordinary native fixes and existing protection
worth keeping; report their actual dispositions rather than one inflated count.
Explain why unresolved Gate opportunities are worth considering and what decision
would make them actionable. Close with a recommended sequence, separating real
prerequisites, optional repairs and later opportunities; identify when a named
Gate should be designed and proven without promising adoption in advance.
Use the local interactive review described in
[beginner-handoff.md](references/beginner-handoff.md#let-the-user-choose-in-the-report)
instead of a copy-paste prompt. Let the user choose Gates for design, later, or
skip, with notes beside each candidate. Use `$redproof-review-ui` through its
[bundled entrypoint](../redproof-review-ui/SKILL.md); it owns the local collector,
not the research or next-stage work. No preselection and no work on silent or
unanswered choices. Fall back to a short chat choice when local serving is unavailable.

Include a draft `describe` block for every Gate presented in the final portfolio,
not just the recommended first Gate. Include deferred candidates and proposed
amendments; show retained existing Gates accurately if presented as Gates. Use
the actual terminal syntax, with R-numbered Rules, a plausible Check and supported
conceptual proof cases. Follow the format, status and missing-information rules in
[beginner-handoff.md](references/beginner-handoff.md#draft-every-gate-in-real-describe-syntax).
Keep each block visible with its Gate in the HTML and retain it in the Markdown
handoff; supporting research can be linked or expandable.
Ordinary fixes and rejected/no-Gate outcomes need their disposition, not invented
Gates. Missing drafts for presented Gates make the handoff incomplete.

For each surviving Gate candidate, retain a compact technical brief behind that
summary:

```text
Gate:
Draft describe block (or link to its Markdown section):
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
when available. Propose Rules, Checks and proof cases now, but stop before
settling their detailed evidence contracts or implementing them. Only a Gate brief
with explicit `approved-for-design`, `approved-for-experiment`, `approved-for-implementation`, or
`approved-for-adoption` authorization may advance to `$redproof-gate-design`,
which verifies, challenges and refines the draft into enforceable promises.
Pass the draft and its assumptions forward, not just the Gate title. Preserve any domain
remainder that the evidence cannot cover rather than silently losing it.

Retain each shortlisted Gate's actual choice in its technical brief, separately
from later possible stages. The reader-facing ending should recommend the next
choice and sequence; the discovery selector offers design/later/skip, not an
unranked menu of every possible authorization stage.

On a real review submission, restate the selected Gates and notes, record their
design authorization and invoke `$redproof-gate-design` for those Gates only.
Do not ask for the same approval again. Later, skipped and unanswered candidates
remain visible with their distinct dispositions. This selection does not approve
implementation or confirm production policy. A preview/test submission never
authorizes work.

# Independent Discovery Review

Use this review pattern when broad or consequential discovery benefits from
fresh perspectives. It improves recall and portfolio appraisal; it does not
create policy authority.

## Pass 1: independent gap review

Run this after the primary evidence sweep and policy-to-control map begin, but
before the final Gate portfolio is drafted.

Give a fresh reviewer:

- the repository and discovery scope;
- the domain-discovery skill;
- the same authorization and external-action boundaries as the primary worker;
- no primary shortlist, expected Gate, prior evaluation, or proposed answer.

Ask the reviewer to:

- sample relevant concern classes;
- research from both promises and control families using
  [research-depth.md](research-depth.md), including referenced and hidden
  configuration; inspect representative assertions rather than just test names;
- inspect operational boundaries when the project changes files, copies
  workspaces, runs processes, deploys, or restores state;
- find consequential authoritative promises;
- map each selected promise to the real native control;
- inspect actual control scope, cadence, exceptions, and failure behavior;
- identify concrete partial, absent, or unknown coverage;
- distinguish coverage from demonstrated regression detection and appraise
  proof value for consequential native controls;
- distinguish a focused native fix, proving an existing safeguard, and adding
  a new control; native fixes and proof opportunities may coexist;
- retain important outcomes with full or unknown coverage, independently of
  whether a new control is worthwhile;
- stop before detailed Rule/Check implementation design; concrete draft promises
  and detection/proof ideas are welcome, not finalized contracts.

Merge new evidence into the primary inventory. Do not accept a candidate merely
because the reviewer proposed it; verify its source, consequence, control gap,
and incremental Redproof value.

## Pass 2: independent maintainer-lens review

Run this after a draft portfolio exists but before asking the real human for a
decision.

Give a different fresh reviewer:

- the repository evidence boundary;
- the protected-outcomes map, research/clauses record, ranked actions, and any Gate briefs;
- the scoring dimensions used by portfolio convergence;
- no instruction to favor a particular candidate or later iteration.

Ask the reviewer to challenge:

- whether stakeholders would pay to maintain the Gate;
- whether the policy is real, scoped, and exception-aware;
- whether the claimed native-control gap is accurate;
- whether a native fix is smaller and sufficient;
- whether existing safeguards were trusted merely because tests exist, without
  detection evidence or the proof-value appraisal;
- whether a proposed proof reuses the native control, adds meaningful confidence,
  and is safe and proportionate; unknown detection alone does not justify a Gate;
- whether Redproof adds composition, honest REFUSE behavior, proofs, ratcheting,
  governance, or useful cadence;
- implementation and recurring execution cost;
- whether proposed Gates should be split, narrowed, deferred, or rejected;
- whether an existing Gate should be amended instead of adding a new one;
- whether important outcomes disappeared merely because coverage was unknown
  or a proposed new control was rejected;
- whether broad headings conceal distinct consequential promises, or a control
  family was inventoried without investigating what its assertions protect;
- whether each consequential research/reviewer finding has a retained, narrowed,
  resolved or rejected disposition supported by evidence;
- which decision-changing questions remain for a real maintainer.

When reviewing the final handoff, also read its beginner summary independently
of the technical inventory. Can a new user identify the next useful action,
understand the concrete consequence and existing protection, distinguish
suspected from demonstrated failures, and tell what approval is requested?
Check that diagrams, examples, excerpts and counts preserve those distinctions;
presentation quality must not conceal uncertainty or create extra Gate claims.
Check that unresolved opportunities explain their potential value and missing
decision, and that the ending gives a recommended order with honest dependencies,
optional work and conditions for designing/proving a named Gate. A list of labels
or repeated approval menus is not an actionable handoff.
Verify that every Gate presented in the final portfolio has a draft in actual
Redproof describe syntax, including deferred candidates and amendments. Challenge
the draft Rules, plausible Check and conceptual proofs; identify unsupported
capability claims, missing proof ideas and unresolved assumptions. Do not demand
implementation-ready patches or mistake expected proof outcomes for executed
results. Ordinary fixes/no-Gate dispositions must not become invented Gates.

## Reconciliation record

Record the review rather than silently replacing the primary judgment:

```text
Independent gap-review additions:
Gap-review findings rejected after verification:
Maintainer-lens recommendation:
Outcomes retained when control recommendations changed:
Research omissions, merged clauses, and reasons for final dispositions:
Primary/reviewer disagreements:
Evidence used to reconcile them:
Remaining human decision:
```

The primary worker owns the final synthesis. Preserve disagreement when evidence
does not settle it.

## Authority boundary

Fresh reviewers may recommend `approve-for-design`, `approve-for-experiment`,
`approve-for-adoption`, `defer`, or `reject`. Their recommendation does not change
policy status or stage authorization.

Only the user, an accountable maintainer, or another explicitly authorized human
may approve advancement. If independent reviewers are unavailable, perform two
separately labeled self-review passes and disclose that they were not
independent.

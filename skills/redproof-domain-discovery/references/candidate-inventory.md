# Candidate Inventory and Promotion

Use this inventory before proposing a Gate. Its purpose is to stop repository
observations, preferences, and duplicated tooling from silently becoming policy.

## Candidate record

```text
Candidate:
Observation:
Protected domain outcome:
Stakeholders:
Accountable policy owner:
Concrete consequence if violated:
Policy source and strength:
Precise source citation:
Contradictory or exception evidence:
Counterevidence search performed:
Counterevidence effect: invalidates | narrows | exception/lifecycle | unresolved
Existing enforcement:
Authority of that enforcement:
Gap in current enforcement:
Why Redproof might add value:
Expected cadence:
Current state: compliant | partially compliant | violated | unknown
Current-state evidence boundary:
Category: preservation | regression prevention | direction of travel
Possible detection ideas (non-binding):
Confidence:
Policy status: candidate | proposed | confirmed | deferred | rejected
Stage authorization: pending | approved-for-design | approved-for-experiment | approved-for-adoption
Open questions:
```

For a direction-of-travel Rule, distinguish existing debt from a regression at
the proposed frontier. Existing debt may show that a ratchet is useful, but it
does not prove “new debt was introduced” without a comparison base or reviewed
baseline.

## Discovery coverage record

Record breadth once per discovery, without manufacturing candidates:

```text
Stakeholder-visible / business behavior: sampled | out of scope | no candidate
Operational / data integrity: sampled | out of scope | no candidate
Public contracts / compatibility: sampled | out of scope | no candidate
Architecture / ownership: sampled | out of scope | no candidate
Modernization / legacy direction: sampled | out of scope | no candidate
Notable evidence inspected:
Known blind spots or unavailable history:
```

## Promotion test

Promote a candidate from `candidate` to `proposed` only when the answers support
all of these claims:

1. There is evidence of an important constraint, not merely a common pattern.
2. A project source or accountable person can plausibly authorize the policy.
3. Violation has a concrete business, architectural, behavioral, operational,
   security, compatibility, or modernization consequence.
4. Known counterexamples and exceptions do not invalidate the outcome.
5. Existing enforcement leaves a specific gap.
6. Redproof can plausibly add assurance without pretending to replace a more
   authoritative expert tool.
7. Stakeholders can discuss the concern without relying on a proposed technical
   implementation.

Before asserting item 4, search for exceptions, waivers, deprecations,
compatibility windows, lifecycle or retirement rules, replacement or
supersession behavior, alternate release paths, and relevant history when
available. Missing history is uncertainty, not proof that no contradiction
exists.

Classify the effect of that evidence. `Invalidates` means the intended behavior
defeats the proposed outcome. `Narrows` means the candidate survives with a
smaller scope. `Exception/lifecycle` means the candidate survives when the
authorized exception and retirement path are explicit. `Unresolved` means a
human or better evidence must decide. Do not use a legitimate squash,
deprecation, or retirement path as an automatic reason to lose an otherwise
valuable candidate.

If an answer is unknown, keep the candidate visible but mark it `deferred`. An
accountable human may separately authorize an experiment without confirming the
policy. If the constraint is stylistic, incidental, already enforced adequately,
too broad to explain, or not intended by the project, reject it.

## Existing-enforcement appraisal

For every candidate, determine:

- what currently detects or prevents the problem;
- whether that mechanism is authoritative for the domain;
- whether it runs at the needed scope and cadence;
- what happens when its evidence is absent or malformed;
- whether it has ever been shown to catch the intended regression;
- what Redproof could add beyond a second implementation of the same rule.

Good potential value includes making the promise explicit, composing separate
authoritative signals, adding an honest inability-to-decide outcome, preventing
legacy debt from growing, proving an integration can detect regression, or
moving a control to a useful cadence. These are hypotheses at discovery time;
Gate design must demonstrate the concrete value.

Weak value includes duplicating an expert parser, mirroring a mature test suite
with a less capable scanner, or proposing a Gate solely because a command exists.

## Policy-to-control gap map

Before portfolio ranking, map a small set of consequential authoritative
promises to their real controls. Normative words can help locate candidates, but
the promise's meaning, consequence, and authority determine whether it belongs
in the map.

```text
Policy promise:
Protected consequence:
Authority and precise source:
Intended exceptions or lifecycle:
Native control:
Control authority:
Actual control scope and cadence:
Coverage: full | partial | none | unknown
Concrete uncovered scenario:
Smallest sufficient response: native fix | Redproof candidate | no new control | investigate
Why Redproof adds value beyond the native response:
```

Inspect the implementation of the control rather than inferring coverage from
its name. A script named for a policy may cover only new files, one execution
path, or one branch. A mature test suite may already cover the entire promise.

Use the map as follows:

- `full`: normally reject a new Redproof Gate unless composition, proof, or
  governance adds a specific missing assurance;
- `partial` or `none`: preserve the uncovered scenario for portfolio comparison;
- `unknown`: record the uncertainty and defer any claim of coverage;
- `native fix`: recommend the focused test or control improvement when Redproof
  would add no material value;
- `Redproof candidate`: retain it only when Redproof contributes more than a
  ceremonial wrapper around the native fix.

Legitimate lifecycle operations do not automatically erase a policy. Narrow the
promise to its normal scope and identify who authorizes the exception.

## Portfolio convergence

After appraising individual candidates, rank the surviving portfolio using
qualitative, evidence-backed judgments:

```text
Candidate:
Stakeholder consequence: high | medium | low
Policy strength: high | medium | low
Uncovered assurance gap: high | medium | low
Native enforceability: high | medium | low
Implementation / recurring cost: high | medium | low
Incremental Redproof value: high | medium | low
Exception / lifecycle burden: high | medium | low
Evidence confidence: high | medium | low
Recommendation: approve-for-design | approve-for-experiment | approve-for-adoption | defer | reject
Primary tradeoff:
```

Use the comparison to help an accountable person choose what to do next. Do not
collapse the judgments into a pseudo-objective total, and do not let an easily
documented but expensive broad outcome hide a narrower high-value, low-cost gap.

Before finalizing, review the policy-to-control map for an explicit,
consequential promise with partial or absent enforcement and a cheap
authoritative response. This is a recall check, not a requirement to manufacture
a technical Gate.

## Example promotion decision

```text
Observation:
No current production domain module imports a database adapter.

Protected outcome:
Business rules remain usable without selecting one persistence implementation.

Policy source:
The architecture decision record says the domain remains storage-independent.

Consequence:
Direct imports couple business rules to one database and invalidate the supported
in-memory adapter.

Contradictory evidence:
One test helper imports the adapter, but it is outside the production domain.

Existing enforcement:
The compiler resolves imports but does not prohibit their direction.

Decision:
Promote to proposed; confirm the test-helper boundary with the owner. Leave the
exact dependency Rule and evidence source to Gate design.
```

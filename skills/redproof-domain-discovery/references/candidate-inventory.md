# Candidate Inventory and Promotion

Use this inventory before proposing a Gate. Its purpose is to stop repository
observations, preferences, and duplicated tooling from silently becoming policy.

## Candidate record

```text
Candidate:
Observation:
Protected domain outcome:
Stakeholders:
Concrete consequence if violated:
Policy source and strength:
Contradictory or exception evidence:
Existing enforcement:
Authority of that enforcement:
Gap in current enforcement:
Why Redproof might add value:
Expected cadence:
Current state: compliant | partially compliant | violated | unknown
Category: preservation | regression prevention | direction of travel
Possible detection ideas (non-binding):
Confidence:
Readiness: candidate | proposed | confirmed | experiment-only | deferred | rejected
Open questions:
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

If an answer is unknown, keep the candidate visible but mark it `deferred` or
`experiment-only`. If the constraint is stylistic, incidental, already enforced
adequately, too broad to explain, or not intended by the project, reject it.

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

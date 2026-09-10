---
name: redproof-pr-review
description: Review a pull request by extracting its important claims, inspecting the implementation, and trying to disprove those claims with focused evidence before accepting them. Use when the user asks for a PR review, asks whether a PR actually achieves its stated outcome, wants an architectural or correctness claim challenged, or wants a review suggestion validated through an experiment. Do not use for a simple diff summary or ordinary implementation work without a review request.
---

# Redproof PR Review

Review a pull request as a set of claims that need evidence.

A code change is not proof that the intended outcome happened. A passing test
is not proof that the test can detect the failure it claims to guard against.
A plausible review suggestion is also only a claim until it is verified.

Move the review from:

> The code looks reasonable.

to:

> The important claims made by this PR have evidence.

## Core principle

Start with the **claim**, not the implementation.

Examples:

- This removes the dependency between `domain` and `infrastructure`.
- This prevents duplicate processing.
- This makes the parser more robust.
- This improves testability.
- This fixes the race condition.
- This reduces memory usage.
- This preserves the old behavior while replacing the implementation.

The code may compile, the tests may pass, and the implementation may look
cleaner. None of those facts alone proves the claim.

Ask:

> What observable condition would have to be true for this claim to be true?

Then find or create evidence for that condition.

## Workflow

### 1. Read the PR description first

Understand what the author says the PR is trying to accomplish. Extract the
important claims and separate the goal, the proposed implementation, and the
claimed outcome.

For example:

```text
Goal:
Reduce coupling between the billing domain and database implementation.

Implementation:
Introduce a repository interface and move SQL code into an adapter.

Claim:
The billing domain no longer depends on database infrastructure.
```

Do not treat the implementation as evidence for the claim. If the PR
description is vague, infer claims cautiously from the code and clearly mark
them as inferred.

### 2. Review the diff statically

First review without changing or executing the code. Understand:

- what changed and what did not
- module and dependency boundaries
- public contracts
- data and control flow
- failure paths and concurrency behavior
- tests added or removed
- architectural impact
- assumptions introduced by the change

Look for ordinary review findings such as bugs, missing cases, accidental
coupling, duplicated responsibility, leaky abstractions, inconsistent
contracts, unnecessary complexity, unsafe failure behavior, and compatibility
problems.

Also compare the implementation with the PR claims:

> Does this implementation appear capable of producing the claimed outcome?

Static inspection can raise or lower confidence. It does not prove important
claims.

### 3. Build a claim inventory

List the claims worth investigating. Do not attempt to prove every statement.
Prioritize claims that are:

- central to the purpose of the PR
- architecturally important
- difficult to see from the diff
- easy to get subtly wrong
- related to correctness or safety
- likely to regress later
- used to justify a significant design decision or added complexity

Example:

```text
C1  Domain no longer imports infrastructure.
C2  Existing API behavior remains compatible.
C3  Retry logic cannot produce duplicate processing.
C4  New implementations can be tested independently.
```

Redproof the claims that matter. Do not create proofs merely to increase the
number of checks.

### 4. Set the investigation budget

Decide what evidence could change the review verdict before running commands.
Start with the highest-value falsification attempt, not the author's longest
verification command.

- Treat successful CI as the baseline that the submitted checks passed. Do not
  replay the PR's entire verification checklist by default.
- Run the smallest existing check that bears directly on the chosen claim.
- Choose one high-value falsification attempt first. Add another only when its
  result could materially change the verdict or reveal an independent blocker.
- Do not start a full suite, clean-consumer install, benchmark, or other costly
  operation merely because the PR description lists it.
- Before a check likely to take more than about two minutes, require network
  access, or reach an external system, decide whether the evidence justifies
  the cost and whether additional authorization is required.

Define the stopping condition as part of the plan. Once a central claim has a
reproducible counterexample, stop expensive experimentation. Finish the static
scan for independent blocking problems, record what remains unverified, and
report. Continue deeper only when the user asks for an exhaustive review or
the additional evidence could change the recommendation.

### 5. Inspect the repository

For important claims, inspect the actual repository rather than relying only
on the rendered diff. Use the existing PR checkout, a clean checkout, or a
worktree as appropriate.

Read surrounding implementation that may not appear in the diff. Establish the
starting state from CI and run focused checks when they are needed to reproduce
or challenge a claim. Run the full suite only when the review requires it, not
as a ritual before investigation.

The PR diff is a view of the change. The repository is the system being
changed.

## Redproof important claims

For each important claim, determine how it could be disproved. Then try to
disprove it. Prefer deterministic evidence.

Depending on the claim, this may involve:

- architecture or dependency checks
- characterization or contract tests
- property-based tests
- mutation
- fault injection
- concurrency tests
- static analysis
- targeted benchmarks
- temporary instrumentation
- small exploratory spikes

Use Redproof when a repeatable executable Gate is appropriate. Use an ad-hoc
red-proof when the investigation is useful but should not become a permanent
Gate.

### Prove red and green

A green result by itself is weak evidence. Whenever practical:

1. Establish the expected green condition.
2. Introduce the smallest fault that should violate the claim.
3. Verify that the check goes red for the correct reason.
4. Revert the fault.
5. Verify that the same check returns to green.

Plant one fault per experiment. Do not combine counterexamples in one run:
that obscures which condition the check detected or missed. Restore and
confirm green before challenging the next claim.

Report both sides:

```text
Claim:
Domain cannot depend on infrastructure.

RED:
Introduced domain -> postgres.
The architecture check failed and reported that dependency.

GREEN:
Removed the dependency.
The same architecture check passed.
```

This demonstrates that the evidence can distinguish the protected condition
from its violation.

### Refuse when the claim cannot be verified

Do not manufacture confidence. Some claims cannot be established from the
available environment, such as:

- Reduces production latency.
- Handles the expected production traffic.
- Eliminates the incident observed last week.

If the required evidence is unavailable, report the claim as unverified and
state what evidence would be needed.

Do not let a blocked network request, unavailable production trace, or costly
suite hold the review open indefinitely. Stop the attempt, retain any partial
evidence, and name the limitation.

```text
UNVERIFIED

The implementation removes one database round trip, but no representative
latency benchmark or production trace is available.

The claim that this improves latency is plausible but not demonstrated.
```

## Treat review suggestions as claims

Apply the same standard to recommendations made during the review.

For example:

```text
Suggestion:
Move this dependency behind an interface.

Claims:
C1  Coupling will decrease.
C2  Testability will improve.
```

Do not assume those claims are true because the refactoring follows a familiar
pattern. For important suggestions, prefer an experiment over an argument.
Spike the smallest version of the change in a separate worktree when
practical, then inspect:

- dependency direction
- concepts and public contracts introduced
- call sites and changed responsibilities
- testing seams and setup
- duplication
- resulting complexity

Redproof the relevant claims where possible. The spike exists to learn whether
the recommendation works; it is not a commitment to keep the implementation.

### Back off when evidence disagrees

Do not defend a suggestion merely because work has already been done.

```text
Suggestion:
Introduce an event abstraction to reduce dependencies.

Observed result:
The same modules remain coupled.
Two additional abstractions are introduced.
Tests require more setup.
The dependency graph is unchanged.
```

Return to the original goal. Revert the spike and rethink the approach.
Implementation effort is sunk cost; the claim is what matters.

### When the user accepts a suggestion

If the user asks to apply a review suggestion:

1. Keep the original goal as the success criterion.
2. Make the smallest change that could achieve it.
3. Run the relevant existing checks.
4. Redproof the important claim.
5. Compare the result with the original state.
6. Keep the change only if the evidence supports the claim.

Do not let the proposed implementation become the new goal.

```text
Original goal:
Make order creation independent of the payment provider.

Proposed change:
Introduce PaymentGateway.

Observed result:
OrderService still imports Stripe types through PaymentGateway arguments.
```

The refactor exists, but the goal has not been achieved. Do not report the
suggestion as successful.

## Isolate experiments

Avoid contaminating the main review environment with speculative changes. Use
separate worktrees when practical:

```text
main review worktree
    PR as submitted

spike-a
    proposed architecture change

spike-b
    alternative implementation

proof-c
    fault injection or mutation used to challenge a claim
```

This makes it cheap to compare alternatives, abandon failed suggestions, and
preserve the submitted PR. A worktree is an experimental environment, not
evidence by itself.

When delegation is available and explicitly authorized, separate important
investigations to reduce anchoring. Give each agent a claim to challenge and
the evidence to seek. Prefer:

```text
Claim:
This change prevents duplicate processing.

Find a realistic execution in which duplicate processing could still occur.
If you find one, demonstrate it. If you cannot, explain what you tested.
```

Avoid broad prompts such as `Is this implementation good?`

## Report findings

Lead with actionable findings, ordered by severity. Tie each finding to a
claim and evidence.

A review finding needs a demonstrated defect, a concrete contradiction in the
code, or a reproducible counterexample. Put plausible but untested weaknesses
under **Risks or unverified claims**, not among findings, and say what experiment
would distinguish them.

For a claim that did not hold:

```text
Claim: Retry cannot create duplicate jobs
Verdict: Not proven

Static review:
retry() schedules a new job after the transaction commits, but the worker can
crash between the commit and acknowledgement.

Experiment:
Injected a crash at that point in a worktree.

Result:
The job was processed twice after restart.

Impact:
The PR's main idempotency claim does not currently hold.

Suggestion:
Persist the processing key with the state transition and reject an already
processed key.

Verification needed:
Repeat the crash experiment after the change.
```

For a verified claim:

```text
Claim: Domain is independent of infrastructure
Verdict: Proven for the checked dependency boundary

Evidence:
The architecture Gate forbids domain -> infrastructure imports.

RED:
Introduced an infrastructure import into domain. The Gate failed and identified
the dependency.

GREEN:
Reverted the mutation. The same Gate passed.
```

### Severity

**Blocking:** The main claim is false, or the implementation introduces a
serious correctness, safety, compatibility, or architectural problem.

**Important:** The main claim may hold, but an important assumption is
unsupported or a significant secondary claim is false.

**Suggestion:** There is a plausible improvement, but the existing
implementation still satisfies the important claims. Suggestions are
hypotheses; do not present them as facts without evidence.

## Avoid false equivalence

Do not equate:

- tests passing with the PR being correct
- code changing with the intended outcome changing
- a familiar pattern appearing with the architecture improving
- more abstractions with less coupling
- one benchmark movement with a performance improvement

Do not keep pushing a proposed solution after its underlying claim has failed.
Return to the goal.

## Review mindset

The purpose of PR review is not merely to find bad code. Determine whether the
change deserves the claims being made about it.

Read the claim. Inspect the implementation. Challenge the claim. Create
evidence where the claim matters. Redproof the evidence when practical. Treat
your own suggestions as claims too. When reality disagrees with the proposed
design, trust the evidence and rethink the design.

# Stage routing (internal)

When installed as a plugin, first read [host and path guidance](runtime.md).

Identify the missing decision, then use the smallest Redproof skill that owns it.
Do not compress discovery, design, implementation, and proof into one pass merely
because the user asked broadly for “guardrails.”

## Choose the stage

Use these questions in order:

1. **Is the protected domain outcome agreed?**
   - No: use `$discover`.
   - Yes: continue.
2. **Has an accountable human authorized Gate design?**
   - No: return to `$discover` and ask for an explicit
     approve-for-design, approve-for-experiment, defer, or reject decision.
   - Yes: continue.
3. **Is there a bounded Rule and evidence contract?**
   - No: use `$design`.
   - Yes: continue.
4. **Are material design decisions settled and is implementation or review
   authorized?**
   - No: remain in `$design`.
   - Yes: continue.
5. **Does the user request a recheck, or is the prior evidence stale for the
   current revision, tool version or scope?**
   - Yes: use `$build` in recheck-only mode within the authorized test scope.
   - No: continue.
6. **Has the Check earned trust through valid proofs and adversarial review?**
   - No: use `$build`.
   - Yes: report that the guardrail is already certified for its recorded scope,
     then handle the user's narrower request.

Do not force every engagement to begin at stage one. A repository may already
have an agreed Gate brief or Rule evidence contract. An artifact's existence is
not approval to advance it. Repository policy may confirm intent, but it does not
authorize the agent to alter enforcement. A broad request to “introduce
guardrails” does not approve a particular Gate. Do not skip a missing stage just
because implementation looks straightforward.

## Handoff boundaries

Each stage produces the input required by the next:

```text
domain concern
  -> agreed and authorized Gate brief
  -> bounded, agreed Rule evidence contract
  -> implemented and certified Gate
```

- Domain discovery decides **what is worth protecting**. It does not design a
  convenient Check and infer policy from it.
- Gate design decides **what the available evidence can honestly enforce**. It
  does not certify an implementation.
- Gate certification decides **whether the implementation deserves trust**. It
  does not silently narrow or replace the agreed promise.

If a later stage exposes a mismatch, return to the owning earlier stage. For
example, evidence that cannot support the Rule returns to Gate design; a Rule
that lacks stakeholder value returns to domain discovery.

Do not route to certification while the comparison base, policy scope,
exceptions, owner, or evidence contract can materially change the Rule and
remain unresolved. Resolve them in discovery or design first.

## Report the routing decision

State briefly:

```text
Current stage:
Why:
Available input:
Missing artifact:
Recommended skill:
```

If the user authorized work beyond routing, continue with the selected skill.
Otherwise, stop after making the next decision clear.

Discovery, Gate Design and certification use the [internal review UI](review-ui/guide.md)
for Gate selection, scope/work-depth choices and results follow-up,
respectively. An explicit, non-preview submission
is a human decision for its displayed scope, not merely a generated artifact;
do not ask for that approval again. Preserve notes and unanswered choices.
`approved-for-implementation` permits the named local build/proof scope, not CI
enforcement or production adoption. Confirmed policy plus separately authorized
adoption is still required for those changes.

For a settled design, recommend implementation and proof as the next finish
line. After an actual `implement` selection, continue with certification through
building, real-project verification and results, or report a precise blocker.
Missing local tooling is an implementation prerequisite, not an automatic route
back to design or a substitute feasibility experiment. A named experiment stays
an optional, separately selected learning task, not the default finish line.

---
name: redproof-discovery
description: Route an existing repository to the right Redproof guardrail stage. Use when introducing Redproof, exploring brownfield guardrails, or when it is unclear whether the work needs domain discovery, Gate design, or Gate certification. Do not use when the user already names one of those stages explicitly.
---

# Redproof Discovery

Identify the missing decision, then use the smallest Redproof skill that owns it.
Do not compress discovery, design, implementation, and proof into one pass merely
because the user asked broadly for “guardrails.”

## Choose the stage

Use these questions in order:

1. **Is the protected domain outcome agreed?**
   - No: use `$redproof-domain-discovery`.
   - Yes: continue.
2. **Has an accountable human authorized Gate design?**
   - No: return to `$redproof-domain-discovery` and ask for an explicit
     approve-for-design, approve-for-experiment, defer, or reject decision.
   - Yes: continue.
3. **Is there a bounded Rule and evidence contract?**
   - No: use `$redproof-gate-design`.
   - Yes: continue.
4. **Are material design decisions settled and is implementation or review
   authorized?**
   - No: remain in `$redproof-gate-design`.
   - Yes: continue.
5. **Has the Check earned trust through valid proofs and adversarial review?**
   - No: use `$redproof-gate-certification`.
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

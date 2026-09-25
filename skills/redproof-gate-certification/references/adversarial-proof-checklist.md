# Adversarial Proof Checklist

Use this after a non-trivial Check reaches a healthy GREEN baseline. The goal is
to establish that the Check distinguishes the protected condition from realistic
violations, valid counterexamples, and untrustworthy evidence.

Treat this as a separate review stage after the Check author's initial proof. If
an independent reviewer is available and authorized, prefer someone other than
the author. Give the reviewer the Rule, evidence contract, implementation, and
healthy baseline, but do not preselect the only attacks they should try. When an
independent reviewer is unavailable, perform a clearly separated falsification
pass and record that limitation.

## Validate every RED mutation

Before accepting a RED proof, verify in order:

1. The mutation was applied at the intended location.
2. The mutated repository contains the exact defect described by the Rule.
3. Unrelated prerequisites still work well enough for the Check to inspect that
   defect.
4. The same Gate and scope used for GREEN are executed.
5. The expected Rule fails.
6. Its diagnostic identifies the intended evidence and reason.
7. The mutation is restored.
8. The same Gate returns to GREEN.

A syntax error, missing import, startup crash, or broken fixture does not prove a
semantic Rule unless that failure is itself the protected condition.

## Attack the representation

For each relevant Check, consider:

- alternate syntax and aliases;
- qualified, indirect, or re-exported references;
- paths or package roots outside the obvious scope;
- dynamic or unclassifiable evidence;
- malformed, missing, empty, partial, or stale evidence;
- baseline growth, shrinkage, deletion, and resurrection;
- file moves, symbol renames, and legitimate refactors;
- valid counterexamples that resemble a violation;
- several defects collapsing into the same identity;
- failure for the wrong reason;
- an evidence producer that exits successfully without producing usable evidence.

Choose attacks that match the Check's trust boundary; do not mechanically test
irrelevant language features.

When a Check compares a current semantic inventory with a base, classify and
prove both set-difference directions: `current - base` and `base - current`.
Disappearance, rename, collision, and resurrection must each have an explicit
PASS, FAIL, or REFUSE meaning. None may disappear into an empty target set.

## Minimum proof portfolio

For a non-trivial Check, require at least:

- the primary RED proof for the intended regression;
- one alternate RED that uses a materially different representation or escape
  path;
- one meaningful GREEN counterexample that resembles a violation but is allowed;
- one REFUSE proof for missing, malformed, stale, dynamic, incomplete, or
  otherwise untrustworthy evidence.

Add more only when they cover an independent risk. Proof count is not a quality
measure.

## When an attack escapes

An escaping mutation is a useful finding. Decide explicitly whether to:

- harden the Check;
- return to Gate design to narrow or split the Rule;
- delegate the analysis to a more authoritative tool;
- document the limitation and defer adoption;
- reject the guardrail.

Do not make the mutation larger merely to force RED. Do not preserve broad Rule
wording after discovering the evidence cannot support it.

An implementation is not trusted merely because the eventual portfolio passes.
Record which attack exposed each gap and whether the author or the independent
review found it. This distinguishes prevention from later repair.

## Proof record

```text
Rule:
Claimed defect:
Mutation location:
Independent confirmation that defect exists:
Expected Rule and diagnostic:
Observed verdict:
Why the verdict is for the intended reason:
Restore method:
GREEN confirmation:
Residual blind spots:
```

Never commit, push, or hand off a working tree while a proof mutation is planted.

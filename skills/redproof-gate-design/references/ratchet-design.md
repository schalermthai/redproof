# Brownfield Ratchet Design

A ratchet allows existing debt to remain or shrink while preventing it from
growing. The hard part is choosing a baseline identity that represents the
meaningful debt rather than an incidental encoding of it.

## Baseline contract

Define all of these before implementing the Check:

```text
Protected direction:
Semantic unit being counted or inventoried:
Baseline provenance:
Why that identity is stable:
Allowed refactors:
What counts as growth:
What counts as shrinkage:
Behavior when an entry disappears:
Behavior when an old entry returns:
Behavior for unknown or dynamic evidence:
Per-entry owner:
Per-entry reason:
Sunset or permanence:
Review cadence:
```

Prefer semantic identities such as a dependency edge, API method plus normalized
route, owned exception, or schema operation. Avoid raw counts, line numbers,
handler names, and file paths when ordinary refactoring can change them without
changing the debt.

## Required thought experiments

Challenge the proposed baseline before coding:

1. Can new debt hide inside an existing entry?
2. Does a rename or move look like growth?
3. Does deleting debt leave a stale exception that can later be reused?
4. Can dynamic or unparsable evidence silently disappear?
5. Can one broad allowlist entry authorize more behavior than intended?
6. Does the identity survive the refactors the modernization plan expects?

Design explicit answers. Unknown or unclassifiable evidence usually warrants
REFUSE, not omission.

## Growth and shrink semantics

A useful ratchet is usually asymmetric:

- known baseline remains: PASS;
- baseline entry is removed: PASS, and require baseline cleanup promptly;
- removed entry reappears: FAIL or REFUSE according to the contract;
- new unapproved entry appears: FAIL;
- evidence cannot be enumerated reliably: REFUSE.

When comparing current and base semantic inventories, classify both `current -
base` and `base - current`. Disappearance, rename, collision, and resurrection
must each have an explicit meaning; none may vanish into an empty target set.

Two-way parity is often safer than a one-way subset check. A subset check can
allow stale exceptions to accumulate and later conceal regression. If deletion
must be tolerated temporarily, make the cleanup window and ownership explicit.

## Example: legacy route containment

Suppose a service is replacing five legacy non-encrypted endpoints.

Weak baseline:

```text
There are at most five files containing "legacy_push".
```

This lets more routes hide in one file and fails harmless file moves.

Stronger baseline:

```text
Semantic unit: HTTP method + normalized route pattern
Growth: a new legacy method/route pair
Shrinkage: a known pair disappears
Rename behavior: handler renames do not change identity
Unknown evidence: dynamically constructed route causes REFUSE
Ownership: each retained pair has an owner and compatibility reason
Sunset: remove the pair when the supported-client window expires
```

This does not prove that handlers encrypt data correctly. It proves only that
the declared legacy route surface does not expand. State that limit in the Rule
evidence contract.

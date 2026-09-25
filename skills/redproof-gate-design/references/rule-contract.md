# Rule Evidence Contract

Complete this contract before implementing a Check. It keeps the executable
promise bounded by evidence the Check can actually observe while preserving the
larger domain concern it came from.

## Contract template

```text
Domain concern:
Gate:
Bounded Rule:
Readiness:
Policy source and strength:

Allowed example:
Violating example:

Evidence source:
Evidence authority:
Evidence completeness obligation:
Existing enforcement:
Native enforcement slot:
Integration choice: command() | Adapter | custom Check
Why this is the smallest honest integration:
Incremental Redproof value:

PASS proves:
PASS does not prove:
FAIL means:

Check-level REFUSE example:
Check-level REFUSE conditions:
Check REFUSE means:

Current state:
Category:
Enforcement frontier:
Expected cadence:
Owner / responder:
Deferred domain remainder:
Open questions:
```

## Evidence test

Read the Rule and `PASS proves` side by side.

- If PASS establishes only a prerequisite, name the prerequisite in the Rule.
- If static structure cannot establish runtime behavior, narrow the Rule or use
  runtime evidence.
- If one Rule contains independently observable promises, split it.
- If missing or dynamic evidence can disappear from inspection, define REFUSE.
- If evidence comes from an expert tool, wrap its authoritative result rather
  than rebuilding its analysis without a demonstrated reason.
- If a successful producer can emit partial or empty evidence, define how the
  Check proves inspection completeness before PASS.

## Native-enforcement test

Before choosing a custom Check, identify where the project would naturally own
the Rule: an existing linter, test suite, architecture tool, build check, or CI
extension point. Prefer implementing the detection there and using Redproof to
invoke, compose, and prove it.

Use `command()` when a native executable reliably communicates the bounded Rule
through its exit status and diagnostics. Use an Adapter when the tool emits
structured evidence, covers multiple Rules, or needs domain-specific validation
before Redproof can distinguish PASS, FAIL, and REFUSE.

An executable is not reusable merely because it can be spawned. Verify that it:

- runs in the intended environment and cadence;
- distinguishes compliant and violating states;
- exposes missing, malformed, partial, or unsafe evidence instead of returning
  apparent success;
- produces diagnostics sufficient to identify the targeted Rule.

If it does not, prefer improving its machine contract, extracting a shared
decision core, or running a focused native test. Duplicate the detection in a
custom Check only when those options are unavailable and the incremental value
justifies the maintenance risk. Record the duplicated boundary and how divergence
from the authoritative implementation will be discovered.

REFUSE is not another form of Rule violation. It says the Check cannot obtain or
trust enough evidence to decide PASS or FAIL. A Check shared by several Rules may
therefore refuse the whole inspection even though no Rule has been shown to be
violated.

For example, a scanner that finds database defaults in migration syntax can
support:

```text
New canonical non-nullable AddField operations specify an effective database
default in the supported syntax.
```

It cannot by itself support:

```text
All mixed-version deployments are backward compatible.
```

The broader statement also depends on application writers, migration ordering,
database semantics, deployment procedure, and historical versions. Record that
broader concern under `Deferred domain remainder`.

## Gate boundary test

The Gate's protected outcome must be no broader than the combined `PASS proves`
statements of its Rules. If a Gate title or description implies more, narrow the
Gate, improve the evidence, or return the uncovered outcome to discovery.

Put Rules in the same Gate only when they protect the same stakeholder-visible
outcome and normally share:

- owner;
- review conversation;
- execution cadence;
- failure response;
- lifecycle and retirement conditions.

Do not group Rules only because they mention the same subsystem, language,
directory, external tool, or implementation mechanism.

For example, event publication after commit and migration to typed event payloads
both involve events, but they protect different outcomes and may have different
owners and lifecycles. They likely belong in different Gates.

## Authority and readiness

Use exactly one readiness state. Record policy-source strength separately so a
strong source does not make an untested Rule implementation-ready, and a feasible
experiment does not masquerade as authorized policy.

Only `confirmed` contracts become production policy. Confirmation may come from
the user, an accountable maintainer, or an authoritative project policy whose
meaning is unambiguous. Use `experiment-only` when implementation is useful for
learning but authority is unresolved.

# Research depth and useful coverage

Use this pass for broad discovery. Aim to identify the promises whose failure
would most change a maintainer's decision. Neither reading every file nor
producing many Gate proposals establishes useful coverage.

## Start from two directions

**Promises to controls:** inspect the principal user or business paths, public
contracts, operational responsibilities and explicit project commitments. Ask
what harm would follow if each important promise failed, then locate its actual
protection. Keep consequential but undocumented concerns visible as hypotheses.

**Controls to promises:** inventory the normal verification entry points, major
test groups, tool configurations and delivery stages. Include dot-prefixed and
referenced configuration files; ordinary file searches can miss them. Follow
scripts and workflow references far enough to establish what is selected, what
can be skipped, and what result blocks a decision. Identify the promises behind
representative assertions and configured restrictions, including controls that
already work well. Group by purpose rather than recording every command.

A control can expose two different concerns: the behavior it tests and whether
that protection continues to run over its intended scope. Inspect both when a
scope or execution change would have a material consequence. Do not manufacture
a separate Gate for each concern.

## Choose where to go deep

Prioritize by consequence, likely exposure through normal changes, explicit
policy strength, and uncertainty about actual protection. Available bug history
or frequently changed areas can inform exposure; absent history is uncertainty.
Do not let a dramatic defect consume the entire review or let easy configuration
rules displace the project's core behavior.

For each priority concern, inspect enough to connect:

1. The concrete failure a stakeholder cares about.
2. Its policy evidence: explicit commitment, encoded repository intent,
   observed behavior, or a suggested improvement requiring a decision.
3. The implementation or configuration that controls it, including selection
   scope, invocation, failure handling and legitimate exceptions.
4. A representative assertion and an adverse or exception case, where present.
   Read what is asserted, not only the test name. Missing or unavailable evidence
   remains an explicit gap; do not fabricate an assertion or a passing run.
5. Evidence that the control detects the feared regression, distinct from its
   intended coverage. Look for relevant negative/fault-injection tests, recorded
   failing-then-passing cases or mutation evidence, and preserve their actual
   scope. Use the candidate inventory's proof-value appraisal for consequential
   controls; absent evidence remains unknown, not automatic Gate work.

Product capability examples and incidental tests do not automatically establish
mandatory repository policy. A tool configuration can establish intended rules
without establishing that the rules run. Record these limits separately.

## Preserve the distinct promises

Break broad headings into concise protected clauses when each could fail
independently or has different evidence or exceptions. For example, “reliable
order processing” may include accepting valid orders, rejecting invalid orders
and preventing duplicate fulfillment. Keep the clauses under one outcome if
useful; this does not prescribe their eventual Gate grouping or Rule design.

Keep each consequential clause identifiable in the research record. It should
carry its source, meaningful failure example, current coverage and disposition.
Merge equivalent findings by reference; do not replace several distinct
obligations with a vague heading such as “quality remains good.”

## Stop when more research is unlikely to change priorities

After the broad inventory, deepen the leading concerns and perform a final
coverage sweep. Discovery is ready for human prioritization when:

- the highest-consequence paths and principal verification/control families
  encountered have an explicit disposition;
- priority recommendations are supported by inspected evidence, or identify a
  specific missing fact that prevents a decision;
- sampled boundaries and exceptions are recorded, and unresolved high-impact
  areas are visible;
- reviewer findings and supplied prior findings are reconciled into retained,
  narrowed, resolved or rejected clauses with reasons.

“Resolved” may mean an existing control is sufficient; retain the important
outcome with that coverage. Unknown coverage does not erase a promise. An
uninspected area is not a verified absence of risk. State what additional access
or work would change a priority if the evidence boundary prevents further study.

This is an 80:20 stopping discipline, not a percentage guarantee, required file
count, time quota, or exhaustive audit. Keep the human-facing shortlist short;
retain supporting clause-level evidence in the same inventory or a linked record.

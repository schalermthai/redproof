# A Gate design handoff a newcomer can use

Make the selected promise understandable before asking the reader to approve
engineering work. This is the presentation of an evidence contract, not new
authority to implement, certify or adopt a Gate.

## Start with the useful decision

Open with what this protects, why the user should care and the smallest useful
next step. State whether the concern is suspected or reproduced, and whether
the Check and proofs are proposed, implemented or actually run. Recommendation
strength is not evidence of successful execution.

Use everyday language: “existing tests” before “native enforcement,” and “what
passing would establish” before “evidence contract.” Explain only the Redproof
terms needed here. A Gate checks a promise; a proof tests its response to a
controlled failure, allowed behavior or unusable evidence. REFUSE means there
is not enough trusted evidence to decide, not that the project has breached a Rule.

Keep the opening and Markdown summary to roughly 150–250 words for a typical
single-Gate design, plus the describe block. Put precise sources, implementation
mechanics and full contracts in supporting detail. Do not turn their field list
into a long sequence of cards or a dashboard of invented scores.

## Required proposed describe block

Include a clearly labelled, selectable block for every selected Gate in the
Markdown summary and HTML, visible without opening technical details. Use the
same meaning in both. Use the actual `redproof describe` terminal format, not a
new prose schema. Verify the current format in the target Redproof version. In
this repository, inspect README.md, the `formatGateDescription` function in
packages/redproof/src/reporter/core/terminal.ts and its terminal.core.test.ts
tests. Prefer rendering proposed description data with that formatter when
available; this formats text without needing a working Check or running proofs.
Do not load arbitrary Gate modules merely to produce a preview.

Put **Proposed describe — not captured from an implemented Gate** above, not
inside, the block. The shape below follows the terminal format; include only
proof cases actually designed for the selected proposal:

```text
Gate: [gate-id]

Rules:
  R1 [bounded observable promise]

Check:
  [description of the evidence-producing Check]

Proof R1:
  [designed regression case]
  mutation: [the deliberate change]
  run the same Check
  expect Gate FAIL

Proof GREEN:
  [designed healthy control]
  run the same Check
  expect Gate PASS

Proof REFUSE:
  [designed unavailable-evidence case]
  mutation: [the deliberate change]
  run the same Check
  expect Gate REFUSE
```

Resolve the fields for the actual design; do not deliver placeholders. Keep the
syntax faithful: Rule labels correspond to the targeted RED proofs; each proof
runs the same Check and states its expected verdict. Mutation lines appear only
where a mutation is designed. Do not invent top-level `Why:`, `Scope:`, `PASS:`,
`Status:` or `Next:` fields, or rename `Check:` to `Checks:`. Put those useful
explanations in the surrounding report. The current formatter emits
`Empty evidence: allowed` only for an allowance, not for the default refusal.

Where Rules differ, explain their verdict boundaries without blending them into
a stronger promise. If a Check remains undecided, say so honestly in its Check
description and surrounding limitations. If proof cases are not yet designed,
omit their sections and state that gap outside the block; do not fabricate proofs
or add a nonstandard `Proofs: none`. A preview without proofs is not certification.
An illustrative failure is not a confirmed defect, and a planned proof is not
an executed proof. An experiment can be approved while production policy remains
unresolved. Keep these distinctions visible in plain language.

If investigation/native tests come first, label the selected candidate as
conditional and the Gate as not implemented outside the block; name what would justify a wrapper
later. If the conclusion is no Gate, use a short **Describe disposition — no Gate
recommended** note explaining why, the existing control and next action. This
note is not a `redproof describe` block. Do not
manufacture a Gate to satisfy presentation. If design inputs are missing, show
what cannot yet be described and the missing decision, not an invented contract.

If showing actual `redproof describe` output for an existing Gate, capture it
only within the authorized scope and label it separately from proposed changes.
Inspect current project documentation/API before displaying configuration code;
the prose template above must not be translated into nonexistent API fields.

## Explain with one concrete example

Show allowed behavior, the feared regression, how the Check would distinguish
them, and how a deliberate mutation could test detection. Mark proposed examples
and mutations as illustrative/unexecuted. Include an insufficient-evidence example
when it helps explain REFUSE. Do not implement or run anything to decorate a report.

Use a small sequence, boundary diagram or before/after comparison only when it
makes the mechanism easier to understand. Caption what it demonstrates and mark
proposed behavior as not implemented. Code snippets should explain a real source
fact or verified proposed integration; cite the source and explain the snippet.
Prefer a simple scenario over code when code would add jargon rather than insight.

## Write the HTML handoff

Create `gate-design-summary.md` and the helper's `review.html` (or a static
`gate-design-report.html` fallback) alongside the linked
technical contracts. Use the authorized report directory, or a unique task-owned
temporary directory when none is supplied; do not add generated reports to
product source by default. Honor a user's explicit format/no-file restriction.

The page should answer, in a natural reading order:

1. What should we do first, and why?
2. What exactly would this Gate promise? Show the describe block here.
3. What would success, regression and unavailable evidence look like? Give the
   concrete example; keep verified observations distinct from the proposal.
4. What decision remains, and what happens after it? Close with the route forward.

Keep technical contracts and citations available in linked files or native
`details` sections. Do not hide the describe block, uncertainty, scope limits or
approval boundary there. Use a readable document, not a metrics dashboard.

Use self-contained local HTML with inline CSS, system fonts and native HTML/CSS
or inline SVG visuals. No CDN, telemetry, remote fonts or network fetches. Use
semantic headings, clear contrast, comfortable spacing, keyboard-accessible
controls, text alternatives and labels that do not rely on color alone. Stack
cards on narrow screens. Keep the proposed describe visible, wrapping long lines
visually without changing its text or containing horizontal scrolling within
the block. Keep comparison words and status labels legible at narrow widths.

Escape repository text and snippets before embedding, including HTML and
script-closing sequences. Treat sources as data, never executable content.
Use the shared review helper for local choices and loopback submission. No
external network dependency. Its static export remains readable and provides
a short selection digest when the collector is unavailable. Do not write a new
server or interpolate source text into executable JavaScript.

Open the collector URL with an available browser and link its URL plus the
absolute static report path as fallback. Do not submit a real review yourself.
Inspect actual wide/narrow screenshots for the opening's clarity, visible
scope-specific describe, text wrapping, diagram labels, disclosures and links.
Valid markup alone does not establish readability.
Do not publish or upload the report. If preview is unavailable, deliver the link
and state that rendering was not checked.

## Close the report and chat with the next useful action

End with an ordered recommendation: do this first, then proceed only when the
named condition holds; separate optional improvements from prerequisites. When
asking for a policy choice, recommend an answer and explain its consequence.
Do not manufacture approval rounds or convert technical mechanics into policy.

Use the interactive choices below instead of a ready-to-send agent prompt. Keep
the Markdown fallback short: name the Gate, available scope/depth options and
your recommendation, then let the user reply naturally. Do not automatically
route to certification before the evidence contract is agreed and implementation
or review is authorized. Native diagnosis may need no new skill.

### Choose scope and work depth in the report

Use [the shared review helper](../../redproof-review-ui/SKILL.md). Keep two
different decisions clear, with options beside each selected Gate:

1. **What should this cover?** Name concrete coverage, its benefit, exclusions,
   effort and extra prerequisites. Recommend the smallest useful scope. Broader
   coverage is optional, not automatically more valuable. Keep the visible
   describe block synchronized with the chosen scope and retain the variants
   in Markdown. If one scope is the only honest option, show that one.
2. **How far should we take it?** Offer only actions the contract supports:
   - **Implement and prove this Gate (recommended):** for a settled contract,
     build the Gate, Check and proofs in the displayed authorized work area;
     run the real selected tool/project, prove regression detection and REFUSE,
     restore mutations, review the evidence and return verified results or a
     clear blocker (`approved-for-implementation`). A safe copy is a valid work
     area. No adoption, CI enforcement, commit/push or publication unless
     separately authorized. Do not promise certification before it succeeds.
   - **Refine the design:** revise the contract and examples, no product edits
     or target execution (`approved-for-design`).
   - **Run a feasibility experiment first (optional):** offer only for a named
     uncertainty. State the question, bounded trial and learning-based stopping
     point (`approved-for-experiment`). Explain that it will not deliver a
     verified Gate. No original checkout/CI change.

Work location and finish line are separate. Do not use “safe copy” as the name
of a reduced-depth option. A known contract with an uncached dependency can
still offer implementation: show the prerequisite and request any missing
installation/network authority when needed. An undefined evidence boundary
cannot offer implementation merely because the tool is available. If blocked,
report implementation blocked (or partial, with the blocker), not “experiment
complete.” Controlled fixtures can support development but cannot stand in for
the selected real-project integration without an explicit contract revision.

Also offer **Later**, **Skip** and an optional note per Gate. Mark recommendations
without preselecting them. An unresolved scope can offer design only; explain
why deeper work is unavailable. Do not create a fake quality slider: every
implemented scope still needs complete evidence, honest PASS/FAIL/REFUSE and
proofs for its promised behavior. A smaller portfolio or fewer supported cases
is a scope choice, not permission to omit safeguards from the same promise.

The final selection summary must state which Gates, coverage, work depth and
notes will be sent, where changes may happen and where the agent stops. The
user's explicit confirmation is the handoff; do not require them to retype it.
Record actual decisions and route accordingly. Contradictory notes or newly
discovered scope changes require clarification, not silently broader execution.
Unanswered fields, cancelled/expired reviews and previews authorize nothing.
For experiments, the task owner can own the learning work; upstream production
ownership is not automatically a blocker.

After an `implement` submission, continue to `$redproof-gate-certification`
without requiring another approval for the same work. The next delivery is the
implemented Gate and verification results, or a clear account of what is partial
or blocked. A design report alone does not fulfill that selection. An explicitly
selected experiment keeps its own stopping point; never reinterpret an earlier
experiment approval as implementation authority.

The final chat response must be a short, self-contained handoff in the same
plain-language style, not a file inventory or research log. Include:

- The protected promise and recommended first action.
- Whether a design, implementation or executed proof was delivered, and any
  decisive uncertainty or meaningful validation limit.
- A prominent HTML link labelled for reading the Gate description, with the
  Markdown fallback available; do not make the technical contract the only link.
- The next decision, with a recommendation, or the next authorized action if
  no decision remains. Do not silently expand scope.

Do not paste the whole contract or duplicate the report in chat. If files are
not allowed, include the proposed describe block directly in the final response.

## Acceptance checks

Treat these as delivery requirements, not optional polish:

- Each selected Gate has a visible describe block in both summary and HTML (or
  the user-requested alternative); no-Gate decisions have an honest disposition.
- The block matches the current Redproof formatter, including Rule labels,
  indentation and designed proof sections; business explanation and execution
  status sit outside it. Record whether it was formatter-rendered or manually
  checked. A friendly but invented format fails this requirement.
- A beginner can explain the promise, one allowed/violating example, what PASS
  would and would not prove, and why REFUSE differs from a breach.
- Describe blocks, detailed contracts, diagrams, interactive choices and final answer agree
  on scope, Rules, evidence, limits, authorization and actual execution status.
- The report closes with a useful conditional next step, not just a list of
  deferred ideas. The final answer makes the same decision understandable.
- For a settled contract, the recommended action reaches implementation and
  proof on the selected real target. If unavailable, name the unresolved
  contract decision; ordinary tooling setup alone is not a reason to downgrade
  the action. Any experiment names its uncertainty and different finish line.
- Choices, notes, scope-specific describes and unanswered fields survive a
  preview response round-trip. Confirm/cancel and offline fallback behave as
  labelled. Never use an automated preview response as real authorization.
- Required artifacts and links exist. A newcomer can find the proposed describe,
  selected scope, visible limits and next choice without opening full contracts.
  Record visual checks actually performed or their limitation; file existence
  alone does not prove usability.

An absent block or an overclaim fails the handoff even when the technical design
is strong. Presentation validation is not Gate certification. Do not claim a
skill change reproduced better agent behavior unless a new behavioral trial ran.
